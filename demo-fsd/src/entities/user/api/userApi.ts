import { apiGet } from "@/shared/api";
import type { User } from "../model/types";

export async function getUsers(): Promise<User[]> {
  return apiGet<User[]>("/users");
}

export async function getUserById(id: number): Promise<User> {
  return apiGet<User>(`/users/${id}`);
}
