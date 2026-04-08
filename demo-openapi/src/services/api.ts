/**
 * Also demonstrate direct fetchClient usage for server-side or non-hook patterns.
 * This file uses openapi-fetch directly (not react-query).
 */
import { fetchClient } from "../lib/api/client";

export async function prefetchUsers() {
  const { data, error } = await fetchClient.GET("/users");
  if (error) throw new Error("Failed to fetch users");
  return data;
}

export async function createUser(name: string, email: string) {
  const { data, error } = await fetchClient.POST("/users", {
    body: { name, email, username: name.toLowerCase().replace(/\s/g, "") },
  });
  if (error) throw new Error("Failed to create user");
  return data;
}

export async function updateUser(
  id: number,
  updates: { name?: string; email?: string },
) {
  const { data, error } = await fetchClient.PUT("/users/{id}", {
    params: { path: { id } },
    body: updates,
  });
  if (error) throw new Error("Failed to update user");
  return data;
}

export async function deleteUser(id: number) {
  const { error } = await fetchClient.DELETE("/users/{id}", {
    params: { path: { id } },
  });
  if (error) throw new Error("Failed to delete user");
}

export async function getPostComments(postId: number) {
  const { data, error } = await fetchClient.GET("/posts/{id}/comments", {
    params: { path: { id: postId } },
  });
  if (error) throw new Error("Failed to fetch comments");
  return data;
}
