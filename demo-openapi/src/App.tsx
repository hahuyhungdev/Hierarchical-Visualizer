import { Routes, Route, Link } from "react-router-dom";
import HomePage from "./pages/HomePage";
import DashboardPage from "./pages/DashboardPage";

export default function App() {
  return (
    <div style={{ fontFamily: "system-ui, sans-serif", padding: 20 }}>
      <nav style={{ marginBottom: 20, display: "flex", gap: 16 }}>
        <Link to="/">Home</Link>
        <Link to="/dashboard">Dashboard</Link>
      </nav>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/dashboard" element={<DashboardPage />} />
      </Routes>
    </div>
  );
}
