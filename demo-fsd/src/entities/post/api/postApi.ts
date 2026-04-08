import { apiGet, apiPost } from "@/shared/api";
import type { Post } from "../model/types";

export async function getPosts(): Promise<Post[]> {
  return apiGet<Post[]>("/posts");
}

export async function getPostById(id: number): Promise<Post> {
  return apiGet<Post>(`/posts/${id}`);
}

export async function createPost(data: Omit<Post, "id">): Promise<Post> {
  return apiPost<Post>("/posts", data);
}
