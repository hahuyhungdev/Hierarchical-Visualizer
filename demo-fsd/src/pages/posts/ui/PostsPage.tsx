import React from "react";
import { PostFeed } from "@/widgets/post-feed";

export function PostsPage() {
  return (
    <div>
      <h1 className="text-3xl font-bold mb-6">All Posts</h1>
      <PostFeed />
    </div>
  );
}
