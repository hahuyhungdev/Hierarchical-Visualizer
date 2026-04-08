import React from "react";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { HomePage } from "@/pages/home";
import { ProfilePage } from "@/pages/profile";
import { PostsPage } from "@/pages/posts";
import { Header } from "@/widgets/header";
import { useAuth } from "@/features/auth";

export function App() {
  const { isLoggedIn, handleLogin } = useAuth();

  return (
    <BrowserRouter>
      <div className="min-h-screen bg-gray-50">
        <Header isLoggedIn={isLoggedIn} onLogout={() => {}} />
        <main className="max-w-4xl mx-auto py-8 px-4">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/posts" element={<PostsPage />} />
            <Route path="/profile/:userId" element={<ProfilePage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  );
}
