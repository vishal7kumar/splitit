import { Outlet, useNavigate, Link } from "react-router-dom";
import { logout } from "../api/auth";
import { useAuth } from "../features/auth/useAuth";

export default function AppLayout() {
  const navigate = useNavigate();
  const { invalidate } = useAuth();

  async function handleLogout() {
    await logout();
    invalidate();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm px-6 py-3 flex items-center justify-between">
        <div className="flex items-center gap-6">
          <Link to="/dashboard" className="text-lg font-semibold">Splitit</Link>
          <Link to="/groups" className="text-sm text-gray-600 hover:text-gray-900">Groups</Link>
        </div>
        <button
          onClick={handleLogout}
          className="text-sm text-gray-600 hover:text-gray-900"
        >
          Logout
        </button>
      </header>
      <main className="p-6">
        <Outlet />
      </main>
    </div>
  );
}
