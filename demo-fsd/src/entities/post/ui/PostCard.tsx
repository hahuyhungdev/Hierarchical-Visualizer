import React from "react";
import { Card } from "@/shared/ui";
import { truncate } from "@/shared/lib/format";
import type { Post } from "../model/types";

interface PostCardProps {
  post: Post;
  onReadMore?: () => void;
}

export function PostCard({ post, onReadMore }: PostCardProps) {
  return (
    <Card title={post.title}>
      <p className="text-gray-600 mb-2">{truncate(post.body, 120)}</p>
      {onReadMore && (
        <button
          onClick={onReadMore}
          className="text-blue-600 text-sm hover:underline"
        >
          Read more
        </button>
      )}
    </Card>
  );
}
