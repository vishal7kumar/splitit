package models

import "time"

type Expense struct {
	ID          int        `db:"id" json:"id"`
	GroupID     int        `db:"group_id" json:"group_id"`
	PaidBy      int        `db:"paid_by" json:"paid_by"`
	Amount      float64    `db:"amount" json:"amount"`
	Description string     `db:"description" json:"description"`
	Category    string     `db:"category" json:"category"`
	Date        string     `db:"date" json:"date"`
	CreatedAt   time.Time  `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time  `db:"updated_at" json:"updated_at"`
	DeletedAt   *time.Time     `db:"deleted_at" json:"deleted_at,omitempty"`
	DeletedBy   *int           `db:"deleted_by" json:"deleted_by,omitempty"`
	YourShare   *float64       `db:"-" json:"your_share,omitempty"`
	IsInvolved  *bool          `db:"-" json:"is_involved,omitempty"`
	Splits      []ExpenseSplit `db:"-" json:"splits,omitempty"`
}

type ExpenseSplit struct {
	ID          int     `db:"id" json:"id"`
	ExpenseID   int     `db:"expense_id" json:"expense_id"`
	UserID      int     `db:"user_id" json:"user_id"`
	ShareAmount float64 `db:"share_amount" json:"share_amount"`
}

type ExpenseComment struct {
	ID        int       `db:"id" json:"id"`
	ExpenseID int       `db:"expense_id" json:"expense_id"`
	UserID    int       `db:"user_id" json:"user_id"`
	UserName  string    `db:"user_name" json:"user_name"`
	Body      string    `db:"body" json:"body"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type ExpenseHistory struct {
	ID        int       `db:"id" json:"id"`
	ExpenseID int       `db:"expense_id" json:"expense_id"`
	UserID    int       `db:"user_id" json:"user_id"`
	UserName  string    `db:"user_name" json:"user_name"`
	Action    string    `db:"action" json:"action"`
	Summary   string    `db:"summary" json:"summary"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}

type GroupActivity struct {
	ID             int        `db:"id" json:"id"`
	GroupID        int        `db:"group_id" json:"group_id"`
	GroupName      string     `db:"group_name" json:"group_name,omitempty"`
	ExpenseID      *int       `db:"expense_id" json:"expense_id"`
	UserID         int        `db:"user_id" json:"user_id"`
	UserName       string     `db:"user_name" json:"user_name"`
	Action         string     `db:"action" json:"action"`
	Summary        string     `db:"summary" json:"summary"`
	CreatedAt      time.Time  `db:"created_at" json:"created_at"`
	IsInvolved     bool       `db:"is_involved" json:"is_involved"`
	IsNew          bool       `db:"is_new" json:"is_new"`
	ResourceType   string     `db:"resource_type" json:"resource_type,omitempty"`
	CanRevert      bool       `db:"can_revert" json:"can_revert"`
	RevertDeadline *time.Time `db:"revert_deadline" json:"revert_deadline,omitempty"`
	RevertedAt     *time.Time `db:"reverted_at" json:"reverted_at,omitempty"`
	GroupDeleted   bool       `db:"group_deleted" json:"group_deleted"`
	ExpenseDeleted bool       `db:"expense_deleted" json:"expense_deleted"`
}
