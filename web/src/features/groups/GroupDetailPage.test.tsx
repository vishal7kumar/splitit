import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GroupDetailPage from "./GroupDetailPage";

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, name: "Admin", email: "admin@test.com" } }),
}));

vi.mock("../../api/groups", () => ({
  getGroup: vi.fn().mockResolvedValue({
    group: { id: 1, name: "Trip", currency: "INR", created_by: 1, created_at: "2026-05-01T00:00:00Z" },
    members: [
      {
        group_id: 1,
        user_id: 1,
        role: "admin",
        joined_at: "2026-05-01T00:00:00Z",
        name: "Admin",
        email: "admin@test.com",
      },
    ],
  }),
  addMember: vi.fn(),
  removeMember: vi.fn(),
  deleteGroup: vi.fn(),
  updateGroup: vi.fn(),
}));

vi.mock("../../api/expenses", () => ({
  listExpenses: vi.fn().mockResolvedValue([]),
  deleteExpense: vi.fn(),
}));

vi.mock("../../api/settlements", () => ({
  getGroupBalances: vi.fn().mockResolvedValue({ balances: [], debts: [] }),
  createSettlement: vi.fn(),
}));

function renderWithProviders() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter initialEntries={["/groups/1"]}>
        <Routes>
          <Route path="/groups/:id" element={<GroupDetailPage />} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("GroupDetailPage", () => {
  it("does not render the old group activity history section", async () => {
    renderWithProviders();

    expect(await screen.findByRole("heading", { name: "Trip" })).toBeInTheDocument();
    expect(screen.queryByText("Activity History")).not.toBeInTheDocument();
  });
});
