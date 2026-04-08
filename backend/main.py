#!/usr/bin/env python3
"""
FastAPI Backend for Visualization System.
- Serves structure.json to the dashboard
- Provides WebSocket for real-time interaction tracking
- Triggers re-scan of repositories
"""

import asyncio
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

from fastapi import FastAPI, WebSocket, WebSocketDisconnect, Query
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel

# Add analyzer to path
sys.path.insert(0, str(Path(__file__).parent.parent / "analyzer"))
from scanner import scan_repository

app = FastAPI(title="Visualization Backend", version="1.0.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://localhost:3000", "http://localhost:3001"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ───────────────────────── State ─────────────────────────

DATA_DIR = Path(__file__).parent / "data"
DATA_DIR.mkdir(exist_ok=True)

# Current structure data (in-memory cache)
current_structure: Optional[dict] = None

# Active WebSocket connections for the dashboard
dashboard_connections: list[WebSocket] = []

# Active interaction events log
interaction_log: list[dict] = []

# Active node highlights (node_id -> timestamp)
active_nodes: dict[str, str] = {}


# ───────────────────────── Models ─────────────────────────


class InteractionEvent(BaseModel):
    eventType: str  # "mount", "unmount", "click", "navigate", "api_call"
    componentName: str
    filePath: Optional[str] = None
    route: Optional[str] = None
    timestamp: Optional[str] = None
    metadata: Optional[dict] = None


class ScanRequest(BaseModel):
    repoPath: str


# ───────────────────────── WebSocket Manager ─────────────────────────


async def broadcast_to_dashboards(message: dict):
    """Send a message to all connected dashboard clients."""
    dead = []
    for ws in dashboard_connections:
        try:
            await ws.send_json(message)
        except Exception:
            dead.append(ws)
    for ws in dead:
        dashboard_connections.remove(ws)


# ───────────────────────── REST Endpoints ─────────────────────────


@app.get("/api/structure")
async def get_structure():
    """Return the current analyzed structure."""
    global current_structure
    if current_structure is None:
        # Try loading from disk
        cache_file = DATA_DIR / "structure.json"
        if cache_file.exists():
            current_structure = json.loads(cache_file.read_text(encoding="utf-8"))
        else:
            return JSONResponse(
                status_code=404,
                content={"error": "No structure data. Trigger a scan first."},
            )
    return current_structure


@app.post("/api/scan")
async def trigger_scan(req: ScanRequest):
    """Trigger a re-scan of the repository."""
    global current_structure

    repo_path = req.repoPath
    if not os.path.isdir(repo_path):
        return JSONResponse(status_code=400, content={"error": f"'{repo_path}' is not a directory"})

    try:
        structure = scan_repository(repo_path)
        current_structure = structure

        # Persist to disk
        cache_file = DATA_DIR / "structure.json"
        cache_file.write_text(json.dumps(structure, indent=2), encoding="utf-8")

        # Notify dashboards
        await broadcast_to_dashboards({
            "type": "structure_update",
            "data": structure,
        })

        return {
            "status": "ok",
            "metadata": structure["metadata"],
        }
    except Exception as e:
        return JSONResponse(status_code=500, content={"error": str(e)})


@app.post("/api/interaction")
async def post_interaction(event: InteractionEvent):
    """Receive an interaction event from the demo app and broadcast to dashboards."""
    ts = event.timestamp or datetime.now(timezone.utc).isoformat()

    entry = {
        "eventType": event.eventType,
        "componentName": event.componentName,
        "filePath": event.filePath,
        "route": event.route,
        "timestamp": ts,
        "metadata": event.metadata or {},
    }

    interaction_log.append(entry)
    # Keep last 500 events
    if len(interaction_log) > 500:
        interaction_log.pop(0)

    # Track active nodes
    if event.eventType in ("mount", "navigate", "click"):
        active_nodes[event.componentName] = ts
    elif event.eventType == "unmount":
        active_nodes.pop(event.componentName, None)

    # Broadcast to dashboards
    await broadcast_to_dashboards({
        "type": "interaction",
        "data": entry,
        "activeNodes": list(active_nodes.keys()),
    })

    return {"status": "ok"}


@app.get("/api/interactions")
async def get_interactions(limit: int = Query(default=50, le=500)):
    """Return recent interaction events."""
    return {
        "events": interaction_log[-limit:],
        "activeNodes": list(active_nodes.keys()),
    }


@app.delete("/api/interactions")
async def clear_interactions():
    """Clear the interaction log and active nodes."""
    interaction_log.clear()
    active_nodes.clear()
    await broadcast_to_dashboards({
        "type": "clear",
        "activeNodes": [],
    })
    return {"status": "ok"}


# ───────────────────────── WebSocket Endpoints ─────────────────────────


@app.websocket("/ws/dashboard")
async def dashboard_ws(websocket: WebSocket):
    """WebSocket for dashboard clients to receive real-time updates."""
    await websocket.accept()
    dashboard_connections.append(websocket)

    # Send current state on connect
    try:
        await websocket.send_json({
            "type": "connected",
            "activeNodes": list(active_nodes.keys()),
        })

        while True:
            # Keep alive; dashboard sends pings
            data = await websocket.receive_text()
            if data == "ping":
                await websocket.send_text("pong")
    except WebSocketDisconnect:
        pass
    finally:
        if websocket in dashboard_connections:
            dashboard_connections.remove(websocket)


@app.websocket("/ws/tracker")
async def tracker_ws(websocket: WebSocket):
    """WebSocket for the demo app tracker to send interaction events."""
    await websocket.accept()

    try:
        while True:
            raw = await websocket.receive_text()
            try:
                event_data = json.loads(raw)
                event = InteractionEvent(**event_data)
                await post_interaction(event)
                await websocket.send_json({"status": "ok"})
            except Exception as e:
                await websocket.send_json({"status": "error", "message": str(e)})
    except WebSocketDisconnect:
        pass


# ───────────────────────── Health Check ─────────────────────────


@app.get("/api/health")
async def health():
    return {
        "status": "ok",
        "dashboardClients": len(dashboard_connections),
        "interactionLogSize": len(interaction_log),
        "activeNodes": len(active_nodes),
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
