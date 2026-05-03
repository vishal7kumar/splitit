package db

import (
	_ "github.com/jackc/pgx/v5/stdlib"
	"github.com/jmoiron/sqlx"
)

func Connect(databaseURL string) (*sqlx.DB, error) {
	db, err := sqlx.Connect("pgx", databaseURL)
	if err != nil {
		return nil, err
	}
	return db, nil
}

func Migrate(db *sqlx.DB) error {
	tables := []string{
		`CREATE TABLE IF NOT EXISTS users (
			id            SERIAL PRIMARY KEY,
			email         TEXT UNIQUE NOT NULL,
			password_hash TEXT NOT NULL,
			name          TEXT NOT NULL DEFAULT '',
			created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS groups (
			id          SERIAL PRIMARY KEY,
			name        TEXT NOT NULL,
			currency    TEXT NOT NULL DEFAULT 'USD',
			created_by  INTEGER NOT NULL REFERENCES users(id),
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS group_members (
			group_id   INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
			user_id    INTEGER NOT NULL REFERENCES users(id),
			role       TEXT NOT NULL DEFAULT 'member',
			joined_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			PRIMARY KEY (group_id, user_id)
		)`,
		`CREATE TABLE IF NOT EXISTS expenses (
			id          SERIAL PRIMARY KEY,
			group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
			paid_by     INTEGER NOT NULL REFERENCES users(id),
			amount      NUMERIC(12,2) NOT NULL,
			description TEXT NOT NULL DEFAULT '',
			category    TEXT NOT NULL DEFAULT 'general',
			date        DATE NOT NULL DEFAULT CURRENT_DATE,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS expense_splits (
			id           SERIAL PRIMARY KEY,
			expense_id   INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
			user_id      INTEGER NOT NULL REFERENCES users(id),
			share_amount NUMERIC(12,2) NOT NULL
		)`,
		`CREATE TABLE IF NOT EXISTS expense_comments (
			id          SERIAL PRIMARY KEY,
			expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
			user_id     INTEGER NOT NULL REFERENCES users(id),
			body        TEXT NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS expense_history (
			id          SERIAL PRIMARY KEY,
			expense_id  INTEGER NOT NULL REFERENCES expenses(id) ON DELETE CASCADE,
			user_id     INTEGER NOT NULL REFERENCES users(id),
			action      TEXT NOT NULL,
			summary     TEXT NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS group_activity (
			id          SERIAL PRIMARY KEY,
			group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
			expense_id  INTEGER REFERENCES expenses(id) ON DELETE SET NULL,
			user_id     INTEGER NOT NULL REFERENCES users(id),
			action      TEXT NOT NULL,
			summary     TEXT NOT NULL,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS settlements (
			id          SERIAL PRIMARY KEY,
			group_id    INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
			paid_by     INTEGER NOT NULL REFERENCES users(id),
			paid_to     INTEGER NOT NULL REFERENCES users(id),
			amount      NUMERIC(12,2) NOT NULL,
			date        DATE NOT NULL DEFAULT CURRENT_DATE,
			created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
		)`,
		`CREATE TABLE IF NOT EXISTS backup_runs (
			id            SERIAL PRIMARY KEY,
			scheduled_for DATE NOT NULL,
			stage         TEXT NOT NULL,
			object_key    TEXT NOT NULL DEFAULT '',
			status        TEXT NOT NULL,
			error         TEXT,
			started_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			finished_at   TIMESTAMPTZ,
			created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
			UNIQUE(stage, scheduled_for)
		)`,
	}
	for _, t := range tables {
		if _, err := db.Exec(t); err != nil {
			return err
		}
	}

	// Column migrations for existing tables
	migrations := []string{
		`ALTER TABLE groups ADD COLUMN IF NOT EXISTS currency TEXT NOT NULL DEFAULT 'USD'`,
	}
	for _, m := range migrations {
		db.Exec(m) // ignore errors for already-applied migrations
	}

	return nil
}
