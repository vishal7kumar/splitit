package handlers

import (
	"strings"
	"testing"

	"splitit-api/models"
)

func TestNormalizeExpenseDate(t *testing.T) {
	if got := normalizeExpenseDate("2026-08-29T00:00:00Z"); got != "2026-08-29" {
		t.Fatalf("expected a calendar date, got %q", got)
	}
	if got := normalizeExpenseDate("2026-08-29"); got != "2026-08-29" {
		t.Fatalf("expected an unchanged date, got %q", got)
	}
}

func TestSplitsChangedIgnoresDerivedEqualShareChangesWithRemainder(t *testing.T) {
	oldSplits := []models.ExpenseSplit{
		{UserID: 1, ShareAmount: 33.34},
		{UserID: 2, ShareAmount: 33.33},
		{UserID: 3, ShareAmount: 33.33},
	}
	newSplits, err := calculateShares(101, "equal", []splitEntry{
		{UserID: 1}, {UserID: 2}, {UserID: 3},
	})
	if err != nil {
		t.Fatal(err)
	}

	if splitsChanged(oldSplits, newSplits, "equal", 100) {
		t.Fatal("expected automatically recalculated equal shares to be ignored")
	}
}

func TestSplitsChangedReportsMaterialChanges(t *testing.T) {
	oldSplits := []models.ExpenseSplit{
		{UserID: 1, ShareAmount: 45},
		{UserID: 2, ShareAmount: 45},
	}

	if !splitsChanged(oldSplits, []splitEntry{{UserID: 1, ShareAmount: 70}, {UserID: 2, ShareAmount: 20}}, "exact", 90) {
		t.Fatal("expected an explicit allocation change to be reported")
	}
	if !splitsChanged(oldSplits, []splitEntry{{UserID: 1, ShareAmount: 90}}, "exact", 90) {
		t.Fatal("expected a participant change to be reported")
	}
}

func TestUpdateSummaryNormalizesDatesAndReportsRealChanges(t *testing.T) {
	handler := &ExpenseHandler{}
	oldExpense := models.Expense{
		Amount:      12,
		Description: "Dinner",
		Category:    "general",
		Date:        "2026-08-29T00:00:00Z",
	}
	oldSplits := []models.ExpenseSplit{{UserID: 1, ShareAmount: 12}}

	summary := handler.updateSummary("VK", oldExpense, createExpenseRequest{
		Amount:      13,
		Description: "Dinner",
		Category:    "general",
		Date:        "2026-08-29",
		SplitType:   "equal",
	}, oldSplits, []splitEntry{{UserID: 1, ShareAmount: 13}})
	if summary != "VK changed amount from 12.00 to 13.00" {
		t.Fatalf("expected only the amount change, got %q", summary)
	}

	summary = handler.updateSummary("VK", oldExpense, createExpenseRequest{
		Amount:      12,
		Description: "Dinner",
		Category:    "general",
		Date:        "2026-08-28",
		SplitType:   "equal",
	}, oldSplits, []splitEntry{{UserID: 1, ShareAmount: 12}})
	if !strings.Contains(summary, "date from 2026-08-29 to 2026-08-28") {
		t.Fatalf("expected a normalized real date change, got %q", summary)
	}
}
