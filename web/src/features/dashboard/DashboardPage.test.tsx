import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardPage from "./DashboardPage";

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, name: "Admin", email: "admin@test.com" } }),
}));

vi.mock("../../api/settlements", () => ({
  getTotalBalance: vi.fn().mockResolvedValue({
    total_balance: 1500,
    groups: [{ group_id: 1, name: "Trip", currency: "INR", balance: 500 }],
  }),
}));

vi.mock("../../api/groups", () => ({
  createGroup: vi.fn(),
}));

function renderWithProviders() {
  const qc = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={qc}>
      <MemoryRouter>
        <DashboardPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("DashboardPage", () => {
  it("renders group section and group items correctly", async () => {
    renderWithProviders();

    expect(await screen.findByRole("heading", { name: "Groups" })).toBeInTheDocument();
    expect(screen.getByText("Trip")).toBeInTheDocument();
    expect(screen.getByText((content) => content.includes("500.00") && !content.includes("1,500.00"))).toBeInTheDocument();
  });

  it("renders overall balance card correctly", async () => {
    renderWithProviders();

    await waitFor(() => {
      expect(screen.getByText("Overall Balance")).toBeInTheDocument();
    });
    expect(screen.getByText(/1,500.00/)).toBeInTheDocument();
    expect(screen.getByText("Others owe you overall across all groups")).toBeInTheDocument();
  });
});
