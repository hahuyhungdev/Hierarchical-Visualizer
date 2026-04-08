import { apiPost } from "@/shared/api";

interface LoginPayload {
  email: string;
  password: string;
}

interface LoginResponse {
  token: string;
}

export async function login(payload: LoginPayload): Promise<LoginResponse> {
  return apiPost<LoginResponse>("/auth/login", payload);
}

export async function logout(): Promise<void> {
  await fetch("https://jsonplaceholder.typicode.com/auth/logout", {
    method: "POST",
  });
}
