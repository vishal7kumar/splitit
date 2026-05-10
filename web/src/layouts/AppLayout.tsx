import { Outlet, useNavigate, Link } from "react-router-dom";
import { logout } from "../api/auth";
import BrandLogo from "../components/BrandLogo";
import { useAuth } from "../features/auth/useAuth";

export default function AppLayout() {
  const navigate = useNavigate();
  const { user, invalidate } = useAuth();

  async function handleLogout() {
    await logout();
    invalidate();
    navigate("/login");
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white shadow-sm px-4 py-3 flex items-center justify-between gap-4 sm:px-6">
        <div className="flex min-w-0 items-center gap-5 sm:gap-6">
          <Link to="/dashboard" className="shrink-0">
            <BrandLogo />
          </Link>
          <Link to="/groups" className="text-sm text-gray-600 hover:text-gray-900">Groups</Link>
        </div>
        <div className="flex shrink-0 items-center gap-3 sm:gap-4">
          {user && (
            <div
              className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-700 rounded-full font-semibold text-sm"
              title={user.name}
            >
              {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="text-sm text-gray-600 hover:text-gray-900"
          >
            Logout
          </button>
        </div>
      </header>
      <main className="p-4 sm:p-6">
        <Outlet />
      </main>
    </div>
  );
}
