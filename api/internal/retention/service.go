package retention

import (
	"context"
	"log"
	"time"

	"github.com/jmoiron/sqlx"
)

const restoreWindow = 30 * 24 * time.Hour

type Service struct {
	DB       *sqlx.DB
	Now      func() time.Time
	Interval time.Duration
}

func NewService(db *sqlx.DB) *Service {
	return &Service{DB: db, Now: time.Now, Interval: 24 * time.Hour}
}

func (s *Service) Start(ctx context.Context) {
	go s.loop(ctx)
}

func (s *Service) loop(ctx context.Context) {
	s.cleanupAndLog(ctx)
	interval := s.Interval
	if interval <= 0 {
		interval = 24 * time.Hour
	}
	ticker := time.NewTicker(interval)
	defer ticker.Stop()
	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			s.cleanupAndLog(ctx)
		}
	}
}

func (s *Service) Cleanup(ctx context.Context) error {
	threshold := s.now().Add(-restoreWindow)
	tx, err := s.DB.BeginTxx(ctx, nil)
	if err != nil {
		return err
	}
	defer tx.Rollback()

	if _, err := tx.ExecContext(ctx,
		"DELETE FROM expenses WHERE deleted_at IS NOT NULL AND deleted_at <= $1",
		threshold,
	); err != nil {
		return err
	}
	if _, err := tx.ExecContext(ctx,
		"DELETE FROM groups WHERE deleted_at IS NOT NULL AND deleted_at <= $1",
		threshold,
	); err != nil {
		return err
	}
	return tx.Commit()
}

func (s *Service) cleanupAndLog(ctx context.Context) {
	if err := s.Cleanup(ctx); err != nil {
		log.Printf("retention: failed to purge expired deleted records: %v", err)
	}
}

func (s *Service) now() time.Time {
	if s.Now != nil {
		return s.Now()
	}
	return time.Now()
}
