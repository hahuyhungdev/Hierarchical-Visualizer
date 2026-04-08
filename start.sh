#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"

echo "═══════════════════════════════════════════════"
echo "  Repo Visualizer — Full Stack Launcher"
echo "═══════════════════════════════════════════════"

# ─── 1. Python Backend ───
echo ""
echo "▸ Starting FastAPI backend on :8000 ..."
cd backend
if [ -d ".venv" ]; then
  .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
else
  # Try venv creation, fall back to system python
  if python3 -m venv .venv 2>/dev/null; then
    .venv/bin/pip install -q -r requirements.txt
    .venv/bin/uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
  else
    pip3 install --break-system-packages -q -r requirements.txt 2>/dev/null || true
    python3 -m uvicorn main:app --host 0.0.0.0 --port 8000 --reload &
  fi
fi
BACKEND_PID=$!
cd ..

# ─── 2. Dashboard ───
echo "▸ Starting Visualization Dashboard on :5173 ..."
cd dashboard
if [ ! -d "node_modules" ]; then
  npm install --silent
fi
npm run dev &
DASHBOARD_PID=$!
cd ..

# ─── 3. Demo App ───
echo "▸ Starting Demo App on :3001 ..."
cd demo-app
if [ ! -d "node_modules" ]; then
  npm install --silent
fi
npm run dev &
DEMO_PID=$!
cd ..

# ─── 4. Initial scan of the demo app ───
echo ""
echo "▸ Waiting for backend to start..."
sleep 3
DEMO_PATH="$(cd demo-app && pwd)"
curl -s -X POST http://localhost:8000/api/scan \
  -H "Content-Type: application/json" \
  -d "{\"repoPath\": \"$DEMO_PATH\"}" || true

echo ""
echo "═══════════════════════════════════════════════"
echo "  ✓ All services running!"
echo ""
echo "  Dashboard:  http://localhost:5173"
echo "  Demo App:   http://localhost:3001"
echo "  Backend:    http://localhost:8000/api/health"
echo ""
echo "  Press Ctrl+C to stop all services."
echo "═══════════════════════════════════════════════"

# Cleanup on exit
cleanup() {
  echo ""
  echo "Shutting down..."
  kill $BACKEND_PID $DASHBOARD_PID $DEMO_PID 2>/dev/null || true
  wait 2>/dev/null
}
trap cleanup EXIT INT TERM

# Wait for all background processes
wait
