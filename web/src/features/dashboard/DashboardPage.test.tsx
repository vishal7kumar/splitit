import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import DashboardPage from "./DashboardPage";
import { listUserActivity } from "../../api/activity";

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, name: "Admin", email: "admin@test.com" } }),
}));

vi.mock("../../api/settlements", () => ({
  getTotalBalance: vi.fn().mockResolvedValue({
    total_balance: 0,
    groups: [{ group_id: 1, name: "Trip", currency: "INR", balance: 0 }],
  }),
}));

vi.mock("../../api/friends", () => ({
  listFriends: vi.fn().mockResolvedValue([]),
  settleFriend: vi.fn(),
}));

vi.mock("../../api/activity", () => ({
  listUserActivity: vi.fn(({ cursor }: { cursor?: string }) =>
    Promise.resolve(
      cursor
        ? { items: [], next_cursor: "" }
        : {
            items: [
              {
                id: 1,
                group_id: 1,
                group_name: "Trip",
                expense_id: 4,
                user_id: 1,
                user_name: "Admin",
                action: "create",
                summary: "Admin added Dinner for 100.00",
                created_at: "2026-05-01T10:00:00Z",
                is_involved: true,
              },
              {
                id: 2,
                group_id: 1,
                group_name: "Trip",
                expense_id: null,
                user_id: 2,
                user_name: "Member",
                action: "settlement",
                summary: "Member paid Third 50.00 to settle up",
                created_at: "2026-05-01T09:00:00Z",
                is_involved: false,
              },
            ],
            next_cursor: "next-page",
          }
    )
  ),
}));

const observeMock = vi.fn();
const disconnectMock = vi.fn();

beforeEach(() => {
  observeMock.mockClear();
  disconnectMock.mockClear();
  vi.mocked(listUserActivity).mockClear();
  class MockIntersectionObserver {
    constructor(callback: IntersectionObserverCallback) {
      callback([{ isIntersecting: true } as IntersectionObserverEntry], this as unknown as IntersectionObserver);
    }
    observe = observeMock;
    disconnect = disconnectMock;
  }
  vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
});

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
  it("renders recent activity with not-involved labels", async () => {
    renderWithProviders();

    expect(await screen.findByRole("heading", { name: "Recent activity" })).toBeInTheDocument();
    expect(screen.getByText(/added Dinner for 100.00/)).toBeInTheDocument();
    expect(screen.getByText("You were not involved")).toBeInTheDocument();
    expect(screen.getByText(/paid Third 50.00 to settle up/)).toBeInTheDocument();
  });

  it("loads the next activity page when the sentinel is visible", async () => {
    renderWithProviders();

    await waitFor(() => expect(observeMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(listUserActivity).toHaveBeenCalledWith({ limit: 20, cursor: "next-page" })
    );
  });
});
