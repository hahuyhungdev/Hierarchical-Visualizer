/**
 * Page: Dashboard - shows stats, user management, and user detail.
 */
import { Suspense, useState } from "react";
import { useTracking } from "../hooks/useTracking";
import StatsPanel from "../features/StatsPanel";
import UserList from "../features/UserList";
import UserDetail from "../features/UserDetail";
import PostComments from "../features/PostComments";

export default function DashboardPage() {
  useTracking("DashboardPage", {
    filePath: "src/pages/DashboardPage.tsx",
    route: "/dashboard",
  });

  const [selectedUserId, setSelectedUserId] = useState<number | null>(1);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);

  return (
    <div>
      <h1>Dashboard</h1>
      <StatsPanel />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <UserList />
          <div style={{ marginTop: 12, display: "flex", gap: 8 }}>
            {[1, 2, 3].map((id) => (
              <button
                key={id}
                onClick={() => setSelectedUserId(id)}
                style={{
                  padding: "4px 12px",
                  background: selectedUserId === id ? "#4F46E5" : "#e5e7eb",
                  color: selectedUserId === id ? "#fff" : "#111",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                User #{id}
              </button>
            ))}
          </div>
          {selectedUserId && <UserDetail userId={selectedUserId} />}
        </div>
        <div>
          <h2>Post Comments</h2>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            {[1, 2, 3].map((id) => (
              <button
                key={id}
                onClick={() => setSelectedPostId(id)}
                style={{
                  padding: "4px 12px",
                  background: selectedPostId === id ? "#4F46E5" : "#e5e7eb",
                  color: selectedPostId === id ? "#fff" : "#111",
                  border: "none",
                  borderRadius: 4,
                  cursor: "pointer",
                }}
              >
                Post #{id}
              </button>
            ))}
          </div>
          {selectedPostId && (
            <Suspense fallback={<div>Loading comments...</div>}>
              <PostComments postId={selectedPostId} />
            </Suspense>
          )}
        </div>
      </div>
    </div>
  );
}
