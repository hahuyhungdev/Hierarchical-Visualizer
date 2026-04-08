import React from "react";
import { Card } from "@/shared/ui";
import type { User } from "../model/types";

interface UserCardProps {
  user: User;
  onClick?: () => void;
}

export function UserCard({ user, onClick }: UserCardProps) {
  return (
    <Card className="cursor-pointer hover:shadow-md" title={user.name}>
      <p className="text-sm text-gray-500">@{user.username}</p>
      <p className="text-sm text-gray-600">{user.email}</p>
      {onClick && (
        <button
          onClick={onClick}
          className="mt-2 text-blue-600 text-sm hover:underline"
        >
          View Profile
        </button>
      )}
    </Card>
  );
}
