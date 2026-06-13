import { render, screen, fireEvent } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import FriendsPage from "./FriendsPage";
import { listFriends, settleFriend } from "../../api/friends";

vi.mock("../../api/friends", () => ({
  listFriends: vi.fn(),
  settleFriend: vi.fn(),
}));

vi.mock("../../api/settlements", () => ({
  getTotalBalance: vi.fn().mockResolvedValue({
    total_balance: 0,
    groups: [{ group_id: 1, name: "Trip", currency: "INR", balance: 0 }],
  }),
}));

function renderWithProviders() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <FriendsPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("FriendsPage", () => {
  beforeEach(() => {
    vi.mocked(listFriends).mockReset();
    vi.mocked(settleFriend).mockReset();
  });

  it("renders friend items correctly with balances", async () => {
    vi.mocked(listFriends).mockResolvedValue([
      {
        user_id: 2,
        name: "Alice",
        email: "alice@test.com",
        total_balance: 300,
        groups: [{ group_id: 1, name: "Trip", currency: "INR", balance: 300, direction: "owed_to_you", amount: 300 }],
      },
    ]);

    renderWithProviders();

    expect(await screen.findByRole("heading", { name: "Friends" })).toBeInTheDocument();
    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.getByText("alice@test.com")).toBeInTheDocument();
    expect(screen.getByText(/300.00/)).toBeInTheDocument();
  });

  it("expands a friend to show shared group breakdown and settle up button", async () => {
    vi.mocked(listFriends).mockResolvedValue([
      {
        user_id: 2,
        name: "Alice",
        email: "alice@test.com",
        total_balance: -100,
        groups: [{ group_id: 1, name: "Apartment", currency: "INR", balance: -100, direction: "you_owe", amount: 100 }],
      },
    ]);

    renderWithProviders();

    expect(await screen.findByText("Alice")).toBeInTheDocument();
    expect(screen.queryByText("Apartment")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button"));

    expect(screen.getByText("Apartment")).toBeInTheDocument();
    expect(screen.getAllByText(/100.00/).length).toBe(2);
    expect(screen.getByRole("button", { name: "Settle up" })).toBeInTheDocument();
  });
});
