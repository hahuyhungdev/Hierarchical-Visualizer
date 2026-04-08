import React, { useEffect, useState } from "react";
import { getPosts, PostCard } from "@/entities/post";
import type { Post } from "@/entities/post";
import { CommentList } from "@/features/comments";
import { ITEMS_PER_PAGE } from "@/shared/config/constants";

export function PostFeed() {
  const [posts, setPosts] = useState<Post[]>([]);
  const [selectedPostId, setSelectedPostId] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    getPosts()
      .then((data) => setPosts(data.slice(0, ITEMS_PER_PAGE)))
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading posts...</p>;

  return (
    <div className="flex flex-col gap-4">
      {posts.map((post) => (
        <div key={post.id}>
          <PostCard
            post={post}
            onReadMore={() =>
              setSelectedPostId(post.id === selectedPostId ? null : post.id)
            }
          />
          {selectedPostId === post.id && (
            <div className="ml-4 mt-2">
              <CommentList postId={post.id} />
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
