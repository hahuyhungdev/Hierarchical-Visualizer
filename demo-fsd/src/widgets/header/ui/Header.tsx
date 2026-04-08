import React from "react";
import { Link } from "react-router-dom";
import { APP_NAME } from "@/shared/config/constants";

interface HeaderProps {
  isLoggedIn: boolean;
  onLogout: () => void;
}

export function Header({ isLoggedIn, onLogout }: HeaderProps) {
  return (
    <header className="bg-white shadow px-6 py-4 flex justify-between items-center">
      <Link to="/" className="text-xl font-bold text-blue-600">
        {APP_NAME}
      </Link>
      <nav className="flex gap-4 items-center">
        <Link to="/" className="text-gray-600 hover:text-blue-600">
          Home
        </Link>
        <Link to="/posts" className="text-gray-600 hover:text-blue-600">
          Posts
        </Link>
        <Link to="/profile" className="text-gray-600 hover:text-blue-600">
          Profile
        </Link>
        {isLoggedIn && (
          <button
            onClick={onLogout}
            className="text-red-500 hover:text-red-700"
          >
            Logout
          </button>
        )}
      </nav>
    </header>
  );
}
