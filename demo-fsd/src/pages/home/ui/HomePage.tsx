import React from "react";
import { PostFeed } from "@/widgets/post-feed";
import { UserList } from "@/widgets/user-list";

export function HomePage() {
  return (
    <div className="space-y-8">
      <section>
        <h2 className="text-2xl font-bold mb-4">Recent Posts</h2>
        <PostFeed />
      </section>
      <section>
        <h2 className="text-2xl font-bold mb-4">Users</h2>
        <UserList />
      </section>
    </div>
  );
}
