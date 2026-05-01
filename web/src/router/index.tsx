import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useAuth } from "../features/auth/useAuth";
import AuthLayout from "../layouts/AuthLayout";
import AppLayout from "../layouts/AppLayout";
import LoginPage from "../features/auth/LoginPage";
import RegisterPage from "../features/auth/RegisterPage";
import DashboardPage from "../features/dashboard/DashboardPage";
import GroupListPage from "../features/groups/GroupListPage";
import GroupDetailPage from "../features/groups/GroupDetailPage";
import AddExpensePage from "../features/expenses/AddExpensePage";
import EditExpensePage from "../features/expenses/EditExpensePage";
import ExpenseDetailPage from "../features/expenses/ExpenseDetailPage";

function ProtectedLayout() {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return (
      <div className="min-h-screen flex items-center justify-center">
        <p className="text-gray-500">Loading...</p>
      </div>
    );
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return <AppLayout />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<AuthLayout />}>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterPage />} />
        </Route>
        <Route element={<ProtectedLayout />}>
          <Route path="/dashboard" element={<DashboardPage />} />
          <Route path="/groups" element={<GroupListPage />} />
          <Route path="/groups/:id" element={<GroupDetailPage />} />
          <Route path="/groups/:id/add" element={<AddExpensePage />} />
          <Route path="/groups/:id/expenses/:eid" element={<ExpenseDetailPage />} />
          <Route path="/groups/:id/expenses/:eid/edit" element={<EditExpensePage />} />
        </Route>
        <Route path="*" element={<Navigate to="/dashboard" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
