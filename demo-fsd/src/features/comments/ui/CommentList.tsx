import React, { useEffect, useState } from "react";
import { getCommentsByPostId, CommentItem } from "@/entities/comment";
import type { Comment } from "@/entities/comment";
import { Button } from "@/shared/ui";

interface CommentListProps {
  postId: number;
}

export function CommentList({ postId }: CommentListProps) {
  const [comments, setComments] = useState<Comment[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);
    getCommentsByPostId(postId)
      .then(setComments)
      .finally(() => setLoading(false));
  }, [postId]);

  if (loading) return <p>Loading comments...</p>;

  return (
    <div className="flex flex-col gap-3">
      <h4 className="font-semibold">Comments ({comments.length})</h4>
      {comments.map((c) => (
        <CommentItem key={c.id} comment={c} />
      ))}
      <Button variant="secondary" size="sm">
        Add Comment
      </Button>
    </div>
  );
}
