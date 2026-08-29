import { afterEach, describe, expect, it, vi } from "vitest";
import { formatDate, formatExpenseDate } from "./formatDate";

afterEach(() => {
  vi.useRealTimers();
});

describe("formatExpenseDate", () => {
  it("renders an ISO-midnight expense date for the current calendar day as Today", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 29, 12));

    expect(formatExpenseDate("2026-08-29T00:00:00Z")).toBe("Today");
  });

  it("formats a past expense date without applying a timezone offset", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 29, 12));

    expect(formatExpenseDate("2026-08-28T00:00:00Z")).toBe("August 28, 2026");
  });

  it("leaves timestamp formatting time-aware", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(2026, 7, 29, 12));

    expect(formatDate(new Date(2026, 7, 29, 9, 30).toISOString())).not.toBe("Today");
  });
});
