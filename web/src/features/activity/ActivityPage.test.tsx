import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import { MemoryRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ActivityPage from "./ActivityPage";
import { listUserActivity, markActivityAsRead } from "../../api/activity";

vi.mock("../auth/useAuth", () => ({
  useAuth: () => ({ user: { id: 1, name: "Admin", email: "admin@test.com" } }),
}));

vi.mock("../../api/activity", () => ({
  listUserActivity: vi.fn(),
  markActivityAsRead: vi.fn().mockResolvedValue({ status: "success" }),
}));

const observeMock = vi.fn();
const disconnectMock = vi.fn();

beforeEach(() => {
  observeMock.mockClear();
  disconnectMock.mockClear();
  vi.mocked(listUserActivity).mockClear();
  vi.mocked(markActivityAsRead).mockClear();

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
        <ActivityPage />
      </MemoryRouter>
    </QueryClientProvider>
  );
}

describe("ActivityPage", () => {
  it("renders activities with 'You were not involved' labels and 'New' badges", async () => {
    vi.mocked(listUserActivity).mockResolvedValue({
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
          is_new: true,
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
          is_new: false,
        },
      ],
      next_cursor: "next-page",
    });

    renderWithProviders();

    expect(await screen.findByRole("heading", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByText(/added Dinner for 100.00/)).toBeInTheDocument();
    expect(screen.getByText("New")).toBeInTheDocument();
    expect(screen.getByText("You were not involved")).toBeInTheDocument();
    expect(screen.getByText(/paid Third 50.00 to settle up/)).toBeInTheDocument();

    // Verify marking read on mount
    expect(markActivityAsRead).toHaveBeenCalled();
  });

  it("loads the next activity page when the observer fires", async () => {
    vi.mocked(listUserActivity).mockResolvedValueOnce({
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
          is_new: false,
        },
      ],
      next_cursor: "next-page",
    }).mockResolvedValueOnce({
      items: [],
      next_cursor: "",
    });

    renderWithProviders();

    await waitFor(() => expect(observeMock).toHaveBeenCalled());
    await waitFor(() =>
      expect(listUserActivity).toHaveBeenCalledWith({ limit: 20, cursor: "next-page" })
    );
  });
});
