package models

import "time"

type Group struct {
	ID        int       `db:"id" json:"id"`
	Name      string    `db:"name" json:"name"`
	Currency  string    `db:"currency" json:"currency"`
	CreatedBy int       `db:"created_by" json:"created_by"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type GroupMember struct {
	GroupID  int       `db:"group_id" json:"group_id"`
	UserID   int       `db:"user_id" json:"user_id"`
	Role     string    `db:"role" json:"role"`
	JoinedAt time.Time `db:"joined_at" json:"joined_at"`
}

type GroupMemberWithUser struct {
	GroupID  int       `db:"group_id" json:"group_id"`
	UserID   int       `db:"user_id" json:"user_id"`
	Role     string    `db:"role" json:"role"`
	JoinedAt time.Time `db:"joined_at" json:"joined_at"`
	Name     string    `db:"name" json:"name"`
	Email    string    `db:"email" json:"email"`
}
