package backup

import (
	"bytes"
	"context"
	"log"
	"time"
)

type Service struct {
	Config  Config
	Store   Store
	Objects ObjectStore
	Dumper  Dumper
	Now     func() time.Time
}

func NewService(cfg Config, store Store, objects ObjectStore) *Service {
	return &Service{
		Config:  cfg,
		Store:   store,
		Objects: objects,
		Dumper:  PgDumper{},
		Now:     time.Now,
	}
}

func (s *Service) Start(ctx context.Context) {
	if !s.Config.Enabled {
		log.Println("Database backups disabled")
		return
	}
	go s.loop(ctx)
}

func (s *Service) loop(ctx context.Context) {
	s.runCatchUpIfNeeded(ctx)
	for {
		next := nextISTMidnight(s.now())
		timer := time.NewTimer(time.Until(next))
		select {
		case <-ctx.Done():
			timer.Stop()
			return
		case <-timer.C:
			s.runScheduled(ctx, next)
		}
	}
}

func (s *Service) runCatchUpIfNeeded(ctx context.Context) {
	scheduled := mostRecentISTMidnight(s.now())
	latest, err := s.Store.LatestSuccessful(ctx, s.Config.Stage)
	if err != nil {
		log.Printf("backup: failed to load latest successful run: %v", err)
		return
	}
	if latest != nil && !latest.ScheduledFor.Before(scheduled) {
		return
	}
	log.Printf("backup: running catch-up for %s", scheduled.Format("2006-01-02"))
	s.runScheduled(ctx, scheduled)
}

func (s *Service) runScheduled(ctx context.Context, scheduledFor time.Time) {
	locked, err := s.Store.TryLock(ctx)
	if err != nil {
		log.Printf("backup: failed to acquire lock: %v", err)
		return
	}
	if !locked {
		log.Println("backup: another instance is already running a backup")
		return
	}
	defer s.Store.Unlock(ctx)

	runCtx, cancel := context.WithTimeout(ctx, s.Config.Timeout)
	defer cancel()

	runID, err := s.Store.StartRun(runCtx, s.Config.Stage, scheduledFor)
	if err != nil {
		log.Printf("backup: failed to record run start: %v", err)
		return
	}

	key := backupObjectKey(s.Config.Stage, scheduledFor)
	var buf bytes.Buffer
	if err := s.Dumper.Dump(runCtx, s.Config.DatabaseURL, &buf); err != nil {
		s.markFailed(runCtx, runID, err.Error())
		return
	}
	if err := s.Objects.EnsureBucket(runCtx, s.Config.Bucket); err != nil {
		s.markFailed(runCtx, runID, err.Error())
		return
	}
	if err := s.Objects.Upload(runCtx, s.Config.Bucket, key, bytes.NewReader(buf.Bytes())); err != nil {
		s.markFailed(runCtx, runID, err.Error())
		return
	}
	if err := s.Store.MarkSuccess(runCtx, runID, key); err != nil {
		log.Printf("backup: uploaded %s but failed to mark success: %v", key, err)
		return
	}
	log.Printf("backup: uploaded %s", key)

	if err := s.enforceRetention(runCtx); err != nil {
		log.Printf("backup: retention cleanup failed: %v", err)
	}
}

func (s *Service) enforceRetention(ctx context.Context) error {
	runs, err := s.Store.SuccessfulRuns(ctx, s.Config.Stage)
	if err != nil {
		return err
	}
	if len(runs) <= s.Config.RetentionCount {
		return nil
	}
	deleteKeys := make([]string, 0, len(runs)-s.Config.RetentionCount)
	for _, run := range runs[s.Config.RetentionCount:] {
		if run.ObjectKey != "" {
			deleteKeys = append(deleteKeys, run.ObjectKey)
		}
	}
	return s.Objects.Delete(ctx, s.Config.Bucket, deleteKeys)
}

func (s *Service) markFailed(ctx context.Context, runID int, message string) {
	if err := s.Store.MarkFailed(ctx, runID, message); err != nil {
		log.Printf("backup: failed to record run failure: %v", err)
	}
	log.Printf("backup: run failed: %s", message)
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}
