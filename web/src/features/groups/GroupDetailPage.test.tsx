import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import GroupDetailPage from "./GroupDetailPage";
import { getGroupBalances, listSettlements } from "../../api/settlements";
import { listExpenses } from "../../api/expenses";

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
  listSettlements: vi.fn().mockResolvedValue([]),
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
    expect(await screen.findByText("Spending Totals")).toBeInTheDocument();
    expect(screen.getByText("Spends by Member")).toBeInTheDocument();

    // Defaults to All time (100 + 250 = 350)
    expect(screen.getByText(/For All time · 2 expenses/i)).toBeInTheDocument();

    // Select specific month June 2026
    fireEvent.change(screen.getByLabelText(/period/i), {
      target: { value: "2026-06" },
    });

    // Total spending for June 2026 is 100 INR
    expect(screen.getByText("Total Group Spending")).toBeInTheDocument();
    expect(screen.getByText(/For June 2026 · 1 expense/i)).toBeInTheDocument();
    
    const hundredAmounts = screen.getAllByText(/100/);
    expect(hundredAmounts.length).toBeGreaterThanOrEqual(2);

    // Verify member breakdown shows "You" paid 100 INR
    expect(screen.getByText("You")).toBeInTheDocument();
    expect(screen.getByText("100.0% of total")).toBeInTheDocument();
  });

  it("renders the logged-in user's group balance in the header", async () => {
    vi.mocked(getGroupBalances).mockResolvedValueOnce({
      balances: [
        { user_id: 1, name: "Admin", balance: 120.50 },
      ],
      debts: [],
    });

    renderWithProviders();

    expect(await screen.findByText("Your balance:")).toBeInTheDocument();
    expect(screen.getByText(/120.50/)).toBeInTheDocument();
    expect(screen.getByText("(others owe you)")).toBeInTheDocument();
  });

  it("renders transaction indicator 'you paid' in green when user is the payer", async () => {
    vi.mocked(listExpenses).mockResolvedValueOnce([
      {
        id: 10,
        group_id: 1,
        paid_by: 1,
        amount: 100,
        description: "Dinner with team",
        category: "food",
        date: "2026-06-10",
        created_at: "2026-06-10T12:00:00Z",
        updated_at: "2026-06-10T12:00:00Z",
        your_share: 25,
        is_involved: true,
      },
    ]);

    renderWithProviders();

    expect(await screen.findByText("Dinner with team")).toBeInTheDocument();
    const paidLabel = screen.getByText("you paid");
    expect(paidLabel).toBeInTheDocument();
    expect(paidLabel).toHaveClass("text-green-600");
    // amount lent = 100 - 25 = 75
    expect(screen.getByText(/75/)).toBeInTheDocument();
  });

  it("renders transaction indicator 'you borrowed' in red when another user paid and user has a share", async () => {
    vi.mocked(listExpenses).mockResolvedValueOnce([
      {
        id: 11,
        group_id: 1,
        paid_by: 2,
        amount: 80,
        description: "Movie tickets",
        category: "entertainment",
        date: "2026-06-11",
        created_at: "2026-06-11T12:00:00Z",
        updated_at: "2026-06-11T12:00:00Z",
        your_share: 40,
        is_involved: true,
      },
    ]);

    renderWithProviders();

    expect(await screen.findByText("Movie tickets")).toBeInTheDocument();
    const borrowedLabel = screen.getByText("you borrowed");
    expect(borrowedLabel).toBeInTheDocument();
    expect(borrowedLabel).toHaveClass("text-red-600");
    expect(screen.getByText(/40/)).toBeInTheDocument();
  });

  it("renders 'You are not involved' instead of 'someone paid x' when user is not involved", async () => {
    vi.mocked(listExpenses).mockResolvedValueOnce([
      {
        id: 12,
        group_id: 1,
        paid_by: 2,
        amount: 200,
        description: "Concert tickets",
        category: "entertainment",
        date: "2026-06-12",
        created_at: "2026-06-12T12:00:00Z",
        updated_at: "2026-06-12T12:00:00Z",
        your_share: 0,
        is_involved: false,
      },
    ]);

    renderWithProviders();

    expect(await screen.findByText("Concert tickets")).toBeInTheDocument();
    expect(screen.getByText("You are not involved")).toBeInTheDocument();
    expect(screen.queryByText("you paid")).not.toBeInTheDocument();
    expect(screen.queryByText("you borrowed")).not.toBeInTheDocument();
  });

  it("filters expenses by payer when Paid By dropdown is changed", async () => {
    renderWithProviders();

    expect(await screen.findByRole("heading", { name: "Trip" })).toBeInTheDocument();

    const payerSelect = screen.getByLabelText("Filter by payer");
    expect(payerSelect).toBeInTheDocument();

    // Change payer filter to user 1
    fireEvent.change(payerSelect, { target: { value: "1" } });

    expect(listExpenses).toHaveBeenCalledWith(1, expect.objectContaining({ paid_by: "1" }));
  });

  it("shows 'No expenses match your search or filter.' and resets filters when Clear filters is clicked", async () => {
    vi.mocked(listExpenses).mockResolvedValueOnce([]);

    renderWithProviders();

    expect(await screen.findByRole("heading", { name: "Trip" })).toBeInTheDocument();

    const searchInput = screen.getByPlaceholderText("Search expenses...");
    fireEvent.change(searchInput, { target: { value: "Nonexistent" } });

    expect(await screen.findByText("No expenses match your search or filter.")).toBeInTheDocument();

    const clearBtn = screen.getByRole("button", { name: "Clear filters" });
    fireEvent.click(clearBtn);

    expect(searchInput).toHaveValue("");
  });

  it("renders a settlement as a special payment entry when user is the payer", async () => {
    vi.mocked(listExpenses).mockResolvedValueOnce([]);
    vi.mocked(listSettlements).mockResolvedValueOnce([
      {
        id: 101,
        group_id: 1,
        paid_by: 1,
        paid_to: 2,
        amount: 50,
        date: "2026-06-15",
        created_at: "2026-06-15T10:00:00Z",
        paid_by_name: "Admin",
        paid_to_name: "Bob",
      },
    ]);

    renderWithProviders();

    expect(await screen.findByText("Settlement")).toBeInTheDocument();
    expect(screen.getByText("You paid Bob")).toBeInTheDocument();
    expect(screen.getByText("you paid")).toBeInTheDocument();
    expect(screen.getByText(/50/)).toBeInTheDocument();
  });

  it("renders a settlement as a special payment entry when user received payment", async () => {
    vi.mocked(listExpenses).mockResolvedValueOnce([]);
    vi.mocked(listSettlements).mockResolvedValueOnce([
      {
        id: 102,
        group_id: 1,
        paid_by: 2,
        paid_to: 1,
        amount: 75,
        date: "2026-06-16",
        created_at: "2026-06-16T11:00:00Z",
        paid_by_name: "Bob",
        paid_to_name: "Admin",
      },
    ]);

    renderWithProviders();

    expect(await screen.findByText("Settlement")).toBeInTheDocument();
    expect(screen.getByText("Bob paid you")).toBeInTheDocument();
    expect(screen.getByText("you received")).toBeInTheDocument();
    expect(screen.getByText(/\+.*75/)).toBeInTheDocument();
  });

  it("renders a settlement between two other members as not involved", async () => {
    vi.mocked(listExpenses).mockResolvedValueOnce([]);
    vi.mocked(listSettlements).mockResolvedValueOnce([
      {
        id: 103,
        group_id: 1,
        paid_by: 2,
        paid_to: 3,
        amount: 40,
        date: "2026-06-17",
        created_at: "2026-06-17T12:00:00Z",
        paid_by_name: "Bob",
        paid_to_name: "Charlie",
      },
    ]);

    renderWithProviders();

    expect(await screen.findByText("Settlement")).toBeInTheDocument();
    expect(screen.getByText("Bob paid Charlie")).toBeInTheDocument();
    expect(screen.getByText("You were not involved")).toBeInTheDocument();
    expect(screen.queryByText("you paid")).not.toBeInTheDocument();
    expect(screen.queryByText("you received")).not.toBeInTheDocument();
  });
});


