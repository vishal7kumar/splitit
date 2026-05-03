package backup

import (
	"testing"
	"time"
)

func TestISTMidnightSchedule(t *testing.T) {
	loc := istLocation()
	now := time.Date(2026, 5, 3, 14, 30, 0, 0, loc)

	recent := mostRecentISTMidnight(now)
	if got := recent.Format(time.RFC3339); got != "2026-05-03T00:00:00+05:30" {
		t.Fatalf("recent midnight = %s", got)
	}

	next := nextISTMidnight(now)
	if got := next.Format(time.RFC3339); got != "2026-05-04T00:00:00+05:30" {
		t.Fatalf("next midnight = %s", got)
	}
}

func TestBackupObjectKey(t *testing.T) {
	scheduled := time.Date(2026, 5, 3, 0, 0, 0, 0, istLocation())
	got := backupObjectKey("PROD", scheduled)
	want := "PROD/backup_20260503_000000_IST.sql.gz"
	if got != want {
		t.Fatalf("key = %q, want %q", got, want)
	}
}

func TestNormalizeStage(t *testing.T) {
	tests := map[string]string{
		"production": "PROD",
		"prod":       "PROD",
		"local":      "DEV",
		"dev":        "DEV",
		"":           "DEV",
	}
	for input, want := range tests {
		if got := normalizeStage(input); got != want {
			t.Fatalf("normalizeStage(%q) = %q, want %q", input, got, want)
		}
	}
}
