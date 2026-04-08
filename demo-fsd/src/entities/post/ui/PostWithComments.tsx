import { CommentList } from "@/features/comments";
import type { Post } from "../model/types";

/**
 * This is an intentional FSD violation!
 * Entities should NOT import from Features (higher layer).
 */
export function PostWithComments({ post }: { post: Post }) {
  return (
    <div>
      <h3>{post.title}</h3>
      <p>{post.body}</p>
      <CommentList postId={post.id} />
    </div>
  );
}
