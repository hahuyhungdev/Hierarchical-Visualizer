import React from "react";
import type { Comment } from "../model/types";

interface CommentItemProps {
  comment: Comment;
}

export function CommentItem({ comment }: CommentItemProps) {
  return (
    <div className="border-l-2 border-gray-200 pl-3 py-2">
      <p className="text-sm font-medium">{comment.name}</p>
      <p className="text-xs text-gray-500">{comment.email}</p>
      <p className="text-sm text-gray-700 mt-1">{comment.body}</p>
    </div>
  );
}
