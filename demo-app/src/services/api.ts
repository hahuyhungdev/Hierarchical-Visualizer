/**
 * Simulated API service module.
 */

const BASE_URL = "https://jsonplaceholder.typicode.com";

export async function fetchUsers() {
  const res = await fetch(`${BASE_URL}/users`);
  return res.json();
}

export async function fetchPosts() {
  const res = await fetch(`${BASE_URL}/posts?_limit=5`);
  return res.json();
}

export async function fetchUserById(id: number) {
  const res = await fetch(`${BASE_URL}/users/${id}`);
  return res.json();
}
