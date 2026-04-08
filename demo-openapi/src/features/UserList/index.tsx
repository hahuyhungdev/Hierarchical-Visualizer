/**
 * Feature: User List - uses openapi-react-query hooks ($api.useQuery / $api.useMutation).
 */
import { useTracking } from "../../hooks/useTracking";
import { $api } from "../../lib/api";
import Card from "../../components/Card";
import Button from "../../components/Button";

export default function UserList() {
  const { trackClick } = useTracking("UserList", {
    filePath: "src/features/UserList/index.tsx",
  });

  // openapi-react-query: useQuery with typed path
  const { data: users, isLoading, refetch } = $api.useQuery("get", "/users");

  // openapi-react-query: useMutation with typed path + body
  const createUser = $api.useMutation("post", "/users");

  const handleRefresh = () => {
    trackClick("refresh_users");
    refetch();
  };

  const handleCreate = () => {
    trackClick("create_user");
    createUser.mutate({
      body: { name: "New User", email: "new@example.com", username: "newuser" },
    });
  };

  return (
    <div>
      <h2>Users</h2>
      <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
        <Button
          label={isLoading ? "Loading..." : "Refresh Users"}
          onClick={handleRefresh}
        />
        <Button label="Add User" variant="secondary" onClick={handleCreate} />
      </div>
      <div>
        {users?.map((u) => (
          <Card key={u.id} title={u.name}>
            <p>{u.email}</p>
          </Card>
        ))}
      </div>
    </div>
  );
}
