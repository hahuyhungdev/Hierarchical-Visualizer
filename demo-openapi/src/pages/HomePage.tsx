/**
 * Page: Home - landing page with user list and post feed.
 */
import { useTracking } from "../hooks/useTracking";
import UserList from "../features/UserList";
import PostFeed from "../features/PostFeed";

export default function HomePage() {
  useTracking("HomePage", { filePath: "src/pages/HomePage.tsx", route: "/" });

  return (
    <div>
      <h1>Home Page</h1>
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <UserList />
        <PostFeed />
      </div>
    </div>
  );
}
