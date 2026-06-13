import { render, screen, fireEvent } from "@testing-library/react";
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
  listExpenses: vi.fn().mockResolvedValue([
    {
      id: 1,
      group_id: 1,
      paid_by: 1,
      amount: 100,
      description: "Dinner",
      category: "food",
      date: "2026-06-10",
      created_at: "2026-06-10T12:00:00Z",
      updated_at: "2026-06-10T12:00:00Z",
    },
    {
      id: 2,
      group_id: 1,
      paid_by: 1,
      amount: 250,
      description: "Cab",
      category: "transport",
      date: "2026-05-15",
      created_at: "2026-05-15T10:00:00Z",
      updated_at: "2026-05-15T10:00:00Z",
    },
  ]),
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

  it("renders the tabs and switches content when clicked", async () => {
    renderWithProviders();

    // Verify default tab is Expenses
    expect(await screen.findByRole("heading", { name: "Trip" })).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Search expenses...")).toBeInTheDocument();
    
    // Verify Balances and Settings content is not visible
    expect(screen.queryByRole("heading", { name: "Balances" })).not.toBeInTheDocument();
    expect(screen.queryByText("Group Preferences")).not.toBeInTheDocument();

    // Click on Balances tab
    const balancesTab = screen.getByRole("button", { name: /balances/i });
    fireEvent.click(balancesTab);

    // Verify Balances content is now visible
    expect(await screen.findByRole("heading", { name: "Balances" })).toBeInTheDocument();
    expect(screen.getByText("Record a payment")).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("Search expenses...")).not.toBeInTheDocument();

    // Click on Settings tab
    const settingsTab = screen.getByRole("button", { name: /settings/i });
    fireEvent.click(settingsTab);

    // Verify Settings content is now visible
    expect(await screen.findByText("Group Preferences")).toBeInTheDocument();
    expect(screen.getByText("Members (1)")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Balances" })).not.toBeInTheDocument();
  });

  it("renders expenses grouped by month with headers", async () => {
    renderWithProviders();

    // Verify month headers are rendered
    expect(await screen.findByText("June 2026")).toBeInTheDocument();
    expect(screen.getByText("May 2026")).toBeInTheDocument();

    // Verify expenses are shown in the list
    expect(screen.getByText("Dinner")).toBeInTheDocument();
    expect(screen.getByText("Cab")).toBeInTheDocument();
  });

  it("switches to Totals tab and displays spending summary", async () => {
    renderWithProviders();

    // Click on Totals tab
    const totalsTab = await screen.findByRole("button", { name: /totals/i });
    fireEvent.click(totalsTab);

    // Verify Totals content is visible
    expect(await screen.findByText("Monthly Spending Totals")).toBeInTheDocument();
    expect(screen.getByText("Spends by Member")).toBeInTheDocument();

    // Total spending for June 2026 is 100 INR (first available month is June 2026)
    expect(screen.getByText("Total Group Spending")).toBeInTheDocument();
    
    const hundredAmounts = screen.getAllByText(/100/);
    expect(hundredAmounts.length).toBeGreaterThanOrEqual(2);

    // Verify member breakdown shows "You" paid 100 INR
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("100.0% of total")).toBeInTheDocument();
  });
});
