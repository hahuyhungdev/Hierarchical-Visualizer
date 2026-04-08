import { useState } from "react";
import { login } from "../api/authApi";

export function useAuth() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [token, setToken] = useState<string | null>(null);

  const handleLogin = async (email: string, password: string) => {
    try {
      const result = await login({ email, password });
      setToken(result.token);
      setIsLoggedIn(true);
    } catch {
      setIsLoggedIn(false);
    }
  };

  return { isLoggedIn, token, handleLogin };
}
