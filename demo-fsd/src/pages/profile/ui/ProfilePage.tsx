import React, { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { getUserById, UserCard } from "@/entities/user";
import type { User } from "@/entities/user";
import { PostFeed } from "@/widgets/post-feed";

export function ProfilePage() {
  const { userId } = useParams<{ userId: string }>();
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (userId) {
      getUserById(Number(userId))
        .then(setUser)
        .finally(() => setLoading(false));
    }
  }, [userId]);

  if (loading) return <p>Loading profile...</p>;
  if (!user) return <p>User not found</p>;

  return (
    <div className="space-y-6">
      <UserCard user={user} />
      <section>
        <h2 className="text-xl font-bold mb-4">Posts by {user.name}</h2>
        <PostFeed />
      </section>
    </div>
  );
}
