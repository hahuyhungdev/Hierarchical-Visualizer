import { apiGet } from "@/shared/api";
import type { Comment } from "../model/types";

export async function getCommentsByPostId(postId: number): Promise<Comment[]> {
  return apiGet<Comment[]>(`/posts/${postId}/comments`);
}
