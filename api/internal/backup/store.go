package backup

import (
	"context"
	"database/sql"
	"time"

	"github.com/jmoiron/sqlx"
)

const advisoryLockID int64 = 824870013

type Run struct {
	ID           int        `db:"id"`
	ScheduledFor time.Time  `db:"scheduled_for"`
	Stage        string     `db:"stage"`
	ObjectKey    string     `db:"object_key"`
	Status       string     `db:"status"`
	Error        *string    `db:"error"`
	StartedAt    time.Time  `db:"started_at"`
	FinishedAt   *time.Time `db:"finished_at"`
}

type Store interface {
	TryLock(ctx context.Context) (bool, error)
	Unlock(ctx context.Context) error
	LatestSuccessful(ctx context.Context, stage string) (*Run, error)
	StartRun(ctx context.Context, stage string, scheduledFor time.Time) (int, error)
	MarkSuccess(ctx context.Context, id int, objectKey string) error
	MarkFailed(ctx context.Context, id int, message string) error
	SuccessfulRuns(ctx context.Context, stage string) ([]Run, error)
}

type PostgresStore struct {
	DB *sqlx.DB
}

func (s PostgresStore) TryLock(ctx context.Context) (bool, error) {
	var locked bool
	err := s.DB.GetContext(ctx, &locked, "SELECT pg_try_advisory_lock($1)", advisoryLockID)
	return locked, err
}

func (s PostgresStore) Unlock(ctx context.Context) error {
	_, err := s.DB.ExecContext(ctx, "SELECT pg_advisory_unlock($1)", advisoryLockID)
	return err
}

func (s PostgresStore) LatestSuccessful(ctx context.Context, stage string) (*Run, error) {
	var run Run
	err := s.DB.GetContext(ctx, &run, `
		SELECT id, scheduled_for, stage, object_key, status, error, started_at, finished_at
		FROM backup_runs
		WHERE stage = $1 AND status = 'success'
		ORDER BY scheduled_for DESC, finished_at DESC
		LIMIT 1
	`, stage)
	if err == sql.ErrNoRows {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	return &run, nil
}

func (s PostgresStore) StartRun(ctx context.Context, stage string, scheduledFor time.Time) (int, error) {
	var id int
	err := s.DB.GetContext(ctx, &id, `
		INSERT INTO backup_runs (scheduled_for, stage, status, started_at)
		VALUES ($1, $2, 'running', NOW())
		ON CONFLICT (stage, scheduled_for)
		DO UPDATE SET status = 'running', error = NULL, object_key = '', started_at = NOW(), finished_at = NULL
		RETURNING id
	`, scheduledFor.In(istLocation()).Format("2006-01-02"), stage)
	return id, err
}

func (s PostgresStore) MarkSuccess(ctx context.Context, id int, objectKey string) error {
	_, err := s.DB.ExecContext(ctx, `
		UPDATE backup_runs
		SET status = 'success', object_key = $1, error = NULL, finished_at = NOW()
		WHERE id = $2
	`, objectKey, id)
	return err
}

func (s PostgresStore) MarkFailed(ctx context.Context, id int, message string) error {
	_, err := s.DB.ExecContext(ctx, `
		UPDATE backup_runs
		SET status = 'failed', error = $1, finished_at = NOW()
		WHERE id = $2
	`, message, id)
	return err
}

func (s PostgresStore) SuccessfulRuns(ctx context.Context, stage string) ([]Run, error) {
	var runs []Run
	err := s.DB.SelectContext(ctx, &runs, `
		SELECT id, scheduled_for, stage, object_key, status, error, started_at, finished_at
		FROM backup_runs
		WHERE stage = $1 AND status = 'success'
		ORDER BY scheduled_for DESC, finished_at DESC
	`, stage)
	return runs, err
}
