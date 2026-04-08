/**
 * Feature: Post Comments - uses $api.useSuspenseQuery.
 */
import { $api } from "../../lib/api";
import { useTracking } from "../../hooks/useTracking";
import { getPostComments } from "../../services/api";
import Card from "../../components/Card";

export default function PostComments({ postId }: { postId: number }) {
  useTracking("PostComments", {
    filePath: "src/features/PostComments/index.tsx",
  });

  // openapi-react-query: useSuspenseQuery with path param
  const { data: comments } = $api.useSuspenseQuery(
    "get",
    "/posts/{id}/comments",
    {
      params: { path: { id: postId } },
    },
  );

  return (
    <div>
      <h3>Comments ({comments.length})</h3>
      {comments.map((c) => (
        <Card key={c.id} title={c.name}>
          <p style={{ fontSize: 12, color: "#6b7280" }}>{c.body}</p>
          <p style={{ fontSize: 11, color: "#9ca3af" }}>{c.email}</p>
        </Card>
      ))}
    </div>
  );
}
