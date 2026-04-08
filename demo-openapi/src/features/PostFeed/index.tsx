/**
 * Feature: Post Feed - uses $api.useQuery and $api.useMutation.
 */
import { useState } from "react";
import { $api } from "../../lib/api";
import { useTracking } from "../../hooks/useTracking";
import Card from "../../components/Card";
import Button from "../../components/Button";

export default function PostFeed() {
  const { trackClick } = useTracking("PostFeed", {
    filePath: "src/features/PostFeed/index.tsx",
  });

  // openapi-react-query: useQuery with query params
  const { data: posts, isLoading } = $api.useQuery("get", "/posts", {
    params: { query: { _limit: 5 } },
  });

  // openapi-react-query: useMutation for creating posts
  const createPost = $api.useMutation("post", "/posts");

  const [showForm, setShowForm] = useState(false);

  const handleNewPost = () => {
    trackClick("new_post");
    createPost.mutate({
      body: { title: "New Post", body: "Post content here...", userId: 1 },
    });
  };

  return (
    <div>
      <h2>Recent Posts</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Button label="New Post" variant="secondary" onClick={handleNewPost} />
        <Button
          label={showForm ? "Hide" : "Show Form"}
          variant="secondary"
          onClick={() => {
            trackClick("toggle_form");
            setShowForm((p) => !p);
          }}
        />
      </div>
      {isLoading && <div>Loading posts...</div>}
      {posts?.map((p) => (
        <Card key={p.id} title={p.title}>
          <p style={{ fontSize: 14, color: "#6b7280" }}>{p.body}</p>
        </Card>
      ))}
    </div>
  );
}
