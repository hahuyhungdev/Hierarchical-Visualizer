/**
 * Feature: Stats Panel - shows summary statistics.
 * Uses the direct fetchClient (openapi-fetch) for a PATCH example.
 */
import { useTracking } from "../hooks/useTracking";
import { fetchClient } from "../lib/api/client";
import Button from "../components/Button";

export default function StatsPanel() {
  const { trackClick } = useTracking("StatsPanel", {
    filePath: "src/features/StatsPanel.tsx",
  });

  const handleUpdate = async () => {
    trackClick("update_post");
    // Direct openapi-fetch usage: PATCH with path param
    await fetchClient.PATCH("/posts/{id}", {
      params: { path: { id: 1 } },
      body: { title: "Updated Title" },
    });
  };

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 16,
        marginBottom: 20,
      }}
    >
      {[
        { label: "Total Users", value: "1,234" },
        { label: "Active Sessions", value: "89" },
        { label: "API Calls Today", value: "5,678" },
      ].map((stat) => (
        <div
          key={stat.label}
          style={{
            background: "#f9fafb",
            padding: 16,
            borderRadius: 8,
            textAlign: "center",
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 700 }}>{stat.value}</div>
          <div style={{ fontSize: 13, color: "#6b7280" }}>{stat.label}</div>
        </div>
      ))}
      <div style={{ gridColumn: "1 / -1", display: "flex", gap: 8 }}>
        <Button
          label="Export Report"
          variant="secondary"
          onClick={() => trackClick("export_report")}
        />
        <Button label="Update Post #1" variant="secondary" onClick={handleUpdate} />
      </div>
    </div>
  );
}
