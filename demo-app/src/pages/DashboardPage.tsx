/**
 * Page: Dashboard - shows stats and user management.
 */
import { useTracking } from "../hooks/useTracking";
import StatsPanel from "../features/StatsPanel";
import UserList from "../features/UserList";

export default function DashboardPage() {
  useTracking("DashboardPage", {
    filePath: "src/pages/DashboardPage.tsx",
    route: "/dashboard",
  });

  return (
    <div>
      <h1>Dashboard</h1>
      <StatsPanel />
      <UserList />
    </div>
  );
}
