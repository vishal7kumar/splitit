package backup

import (
	"context"
	"errors"
	"io"
	"testing"
	"time"
)

type fakeStore struct {
	locked      bool
	lockErr     error
	latest      *Run
	started     []time.Time
	successKeys []string
	failures    []string
	runs        []Run
	unlocked    bool
}

func (f *fakeStore) TryLock(context.Context) (bool, error) {
	if f.lockErr != nil {
		return false, f.lockErr
	}
	return f.locked, nil
}

func (f *fakeStore) Unlock(context.Context) error {
	f.unlocked = true
	return nil
}

func (f *fakeStore) LatestSuccessful(context.Context, string) (*Run, error) {
	return f.latest, nil
}

func (f *fakeStore) StartRun(_ context.Context, _ string, scheduledFor time.Time) (int, error) {
	f.started = append(f.started, scheduledFor)
	return len(f.started), nil
}

func (f *fakeStore) MarkSuccess(_ context.Context, _ int, objectKey string) error {
	f.successKeys = append(f.successKeys, objectKey)
	return nil
}

func (f *fakeStore) MarkFailed(_ context.Context, _ int, message string) error {
	f.failures = append(f.failures, message)
	return nil
}

func (f *fakeStore) SuccessfulRuns(context.Context, string) ([]Run, error) {
	return f.runs, nil
}

type fakeObjects struct {
	ensuredBucket string
	uploads       []string
	deleted       []string
}

func (f *fakeObjects) EnsureBucket(_ context.Context, bucket string) error {
	f.ensuredBucket = bucket
	return nil
}

func (f *fakeObjects) Upload(_ context.Context, _ string, key string, body io.Reader) error {
	if _, err := io.ReadAll(body); err != nil {
		return err
	}
	f.uploads = append(f.uploads, key)
	return nil
}

func (f *fakeObjects) Delete(_ context.Context, _ string, keys []string) error {
	f.deleted = append(f.deleted, keys...)
	return nil
}

type fakeDumper struct {
	err error
}

func (f fakeDumper) Dump(_ context.Context, _ string, dst io.Writer) error {
	if f.err != nil {
		return f.err
	}
	_, err := dst.Write([]byte("dump"))
	return err
}

func TestRunCatchUpIfNeededRunsWhenLatestSuccessfulMissedMidnight(t *testing.T) {
	now := time.Date(2026, 5, 3, 10, 0, 0, 0, istLocation())
	store := &fakeStore{
		locked: true,
		latest: &Run{ScheduledFor: time.Date(2026, 5, 2, 0, 0, 0, 0, istLocation())},
	}
	objects := &fakeObjects{}
	service := testService(store, objects)
	service.Now = func() time.Time { return now }

	service.runCatchUpIfNeeded(context.Background())

	if len(store.started) != 1 {
		t.Fatalf("expected one catch-up run, got %d", len(store.started))
	}
	if got := store.started[0].Format("2006-01-02"); got != "2026-05-03" {
		t.Fatalf("catch-up scheduled date = %s", got)
	}
}

func TestRunCatchUpIfNeededSkipsWhenCurrentMidnightBackedUp(t *testing.T) {
	now := time.Date(2026, 5, 3, 10, 0, 0, 0, istLocation())
	store := &fakeStore{
		locked: true,
		latest: &Run{ScheduledFor: time.Date(2026, 5, 3, 0, 0, 0, 0, istLocation())},
	}
	service := testService(store, &fakeObjects{})
	service.Now = func() time.Time { return now }

	service.runCatchUpIfNeeded(context.Background())

	if len(store.started) != 0 {
		t.Fatalf("expected no catch-up run, got %d", len(store.started))
	}
}

func TestRunScheduledSkipsWhenAdvisoryLockHeldElsewhere(t *testing.T) {
	store := &fakeStore{locked: false}
	objects := &fakeObjects{}
	service := testService(store, objects)

	service.runScheduled(context.Background(), time.Date(2026, 5, 3, 0, 0, 0, 0, istLocation()))

	if len(store.started) != 0 {
		t.Fatalf("expected no run without lock, got %d", len(store.started))
	}
	if len(objects.uploads) != 0 {
		t.Fatalf("expected no upload without lock, got %d", len(objects.uploads))
	}
}

func TestRunScheduledRecordsFailure(t *testing.T) {
	store := &fakeStore{locked: true}
	service := testService(store, &fakeObjects{})
	service.Dumper = fakeDumper{err: errors.New("boom")}

	service.runScheduled(context.Background(), time.Date(2026, 5, 3, 0, 0, 0, 0, istLocation()))

	if len(store.failures) != 1 || store.failures[0] != "boom" {
		t.Fatalf("failures = %#v", store.failures)
	}
	if len(store.successKeys) != 0 {
		t.Fatalf("unexpected success keys = %#v", store.successKeys)
	}
}

func TestRunScheduledUploadsThenRetainsLatestThree(t *testing.T) {
	store := &fakeStore{
		locked: true,
		runs: []Run{
			{ObjectKey: "DEV/backup_20260504_000000_IST.sql.gz"},
			{ObjectKey: "DEV/backup_20260503_000000_IST.sql.gz"},
			{ObjectKey: "DEV/backup_20260502_000000_IST.sql.gz"},
			{ObjectKey: "DEV/backup_20260501_000000_IST.sql.gz"},
			{ObjectKey: "DEV/backup_20260430_000000_IST.sql.gz"},
		},
	}
	objects := &fakeObjects{}
	service := testService(store, objects)

	service.runScheduled(context.Background(), time.Date(2026, 5, 4, 0, 0, 0, 0, istLocation()))

	wantKey := "DEV/backup_20260504_000000_IST.sql.gz"
	if len(objects.uploads) != 1 || objects.uploads[0] != wantKey {
		t.Fatalf("uploads = %#v, want %s", objects.uploads, wantKey)
	}
	if len(store.successKeys) != 1 || store.successKeys[0] != wantKey {
		t.Fatalf("success keys = %#v, want %s", store.successKeys, wantKey)
	}
	wantDeleted := []string{
		"DEV/backup_20260501_000000_IST.sql.gz",
		"DEV/backup_20260430_000000_IST.sql.gz",
	}
	if len(objects.deleted) != len(wantDeleted) {
		t.Fatalf("deleted = %#v, want %#v", objects.deleted, wantDeleted)
	}
	for i := range wantDeleted {
		if objects.deleted[i] != wantDeleted[i] {
			t.Fatalf("deleted = %#v, want %#v", objects.deleted, wantDeleted)
		}
	}
}

func TestStartDoesNothingWhenDisabled(t *testing.T) {
	store := &fakeStore{locked: true}
	service := testService(store, &fakeObjects{})
	service.Config.Enabled = false

	service.Start(context.Background())

	if len(store.started) != 0 {
		t.Fatalf("expected disabled service not to start runs")
	}
}

func testService(store *fakeStore, objects *fakeObjects) *Service {
	return &Service{
		Config: Config{
			Enabled:        true,
			Stage:          "DEV",
			Bucket:         "splitit_db_backup",
			Timeout:        time.Minute,
			RetentionCount: 3,
			DatabaseURL:    "postgres://example",
		},
		Store:   store,
		Objects: objects,
		Dumper:  fakeDumper{},
		Now:     time.Now,
	}
}
