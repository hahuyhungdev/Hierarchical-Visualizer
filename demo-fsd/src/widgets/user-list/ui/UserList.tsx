import React, { useEffect, useState } from "react";
import { getUsers, UserCard } from "@/entities/user";
import type { User } from "@/entities/user";
import { useNavigate } from "react-router-dom";

export function UserList() {
  const [users, setUsers] = useState<User[]>([]);
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  useEffect(() => {
    getUsers()
      .then(setUsers)
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading users...</p>;

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
      {users.map((user) => (
        <UserCard
          key={user.id}
          user={user}
          onClick={() => navigate(`/profile/${user.id}`)}
        />
      ))}
    </div>
  );
}
