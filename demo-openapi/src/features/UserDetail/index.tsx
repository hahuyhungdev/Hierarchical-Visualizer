/**
 * Feature: User Detail - uses $api.useQuery with path params.
 */
import { $api } from "../../lib/api";
import Card from "../../components/Card";
import { useTracking } from "../../hooks/useTracking";

export default function UserDetail({ userId }: { userId: number }) {
  useTracking("UserDetail", {
    filePath: "src/features/UserDetail/index.tsx",
  });

  // openapi-react-query: useQuery with path parameter
  const { data: user, isLoading } = $api.useQuery("get", "/users/{id}", {
    params: { path: { id: userId } },
  });

  if (isLoading) return <div>Loading user...</div>;
  if (!user) return <div>User not found</div>;

  return (
    <Card title={user.name}>
      <p>Email: {user.email}</p>
      <p>Phone: {user.phone}</p>
      <p>Website: {user.website}</p>
    </Card>
  );
}
