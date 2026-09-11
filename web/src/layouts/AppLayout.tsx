import { Outlet, useNavigate, Link, NavLink } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { logout } from "../api/auth";
import BrandLogo from "../components/BrandLogo";
import { useAuth } from "../features/auth/useAuth";
import { getUnreadActivityCount } from "../api/activity";

export default function AppLayout() {
  const navigate = useNavigate();
  const { user, invalidate } = useAuth();

  const { data: unreadData } = useQuery({
    queryKey: ["unread-count"],
    queryFn: getUnreadActivityCount,
    enabled: !!user,
    refetchInterval: 15000, // Refresh unread count badge every 15 seconds
  });

  const unreadCount = unreadData?.unread_count || 0;

  async function handleLogout() {
    await logout();
    invalidate();
    navigate("/login");
  }

  const navLinkClass = ({ isActive }: { isActive: boolean }) =>
    `text-sm transition-all duration-200 cursor-pointer shrink-0 py-1 border-b-2 ${
      isActive
        ? "text-blue-600 font-semibold border-blue-600"
        : "text-gray-500 hover:text-gray-900 font-medium border-transparent hover:border-gray-200"
    }`;

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-xs px-4 py-2.5 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between sm:gap-6 sm:px-6 sm:py-3 sticky top-0 z-30">
        <div className="flex items-center justify-between w-full sm:w-auto">
          <Link to="/dashboard" className="shrink-0 cursor-pointer">
            <BrandLogo />
          </Link>
          
          {/* Mobile Profile Actions */}
          <div className="flex items-center gap-3 sm:hidden">
            {user && (
              <div
                className="flex items-center justify-center w-7 h-7 bg-blue-100 text-blue-700 rounded-full font-semibold text-xs select-none shadow-xs"
                title={user.name}
              >
                {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
              </div>
            )}
            <button
              onClick={handleLogout}
              className="text-xs text-gray-500 hover:text-gray-900 transition-colors font-medium cursor-pointer"
            >
              Logout
            </button>
          </div>
        </div>

        {/* Navigation Links */}
        <div className="flex items-center gap-4 sm:gap-6 overflow-x-auto overflow-y-hidden py-1 sm:py-0">
          <NavLink to="/dashboard" className={navLinkClass}>
            Dashboard
          </NavLink>
          <NavLink to="/friends" className={navLinkClass}>
            Friends
          </NavLink>
          <NavLink to="/activity" className={({ isActive }) => `${navLinkClass({ isActive })} flex items-center gap-1.5`}>
            Activity
            {unreadCount > 0 && (
              <span className="flex h-4 min-w-[16px] items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white leading-none shadow-xs">
                {unreadCount}
              </span>
            )}
          </NavLink>
        </div>

        {/* Desktop Profile Actions */}
        <div className="hidden sm:flex items-center gap-3 sm:gap-4 shrink-0">
          {user && (
            <div
              className="flex items-center justify-center w-8 h-8 bg-blue-100 text-blue-700 rounded-full font-semibold text-sm select-none shadow-xs"
              title={user.name}
            >
              {user.name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2)}
            </div>
          )}
          <button
            onClick={handleLogout}
            className="text-sm text-gray-500 hover:text-gray-900 transition-colors font-medium cursor-pointer"
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
