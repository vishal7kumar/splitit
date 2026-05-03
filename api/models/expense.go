package models

import "time"

type Expense struct {
	ID          int       `db:"id" json:"id"`
	GroupID     int       `db:"group_id" json:"group_id"`
	PaidBy      int       `db:"paid_by" json:"paid_by"`
	Amount      float64   `db:"amount" json:"amount"`
	Description string    `db:"description" json:"description"`
	Category    string    `db:"category" json:"category"`
	Date        string    `db:"date" json:"date"`
	CreatedAt   time.Time `db:"created_at" json:"created_at"`
	UpdatedAt   time.Time `db:"updated_at" json:"updated_at"`
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
	ID        int       `db:"id" json:"id"`
	GroupID   int       `db:"group_id" json:"group_id"`
	ExpenseID *int      `db:"expense_id" json:"expense_id"`
	UserID    int       `db:"user_id" json:"user_id"`
	UserName  string    `db:"user_name" json:"user_name"`
	Action    string    `db:"action" json:"action"`
	Summary   string    `db:"summary" json:"summary"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}
