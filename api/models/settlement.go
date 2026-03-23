package models

import "time"

type Settlement struct {
	ID        int       `db:"id" json:"id"`
	GroupID   int       `db:"group_id" json:"group_id"`
	PaidBy    int       `db:"paid_by" json:"paid_by"`
	PaidTo    int       `db:"paid_to" json:"paid_to"`
	Amount    float64   `db:"amount" json:"amount"`
	Date      string    `db:"date" json:"date"`
	CreatedAt time.Time `db:"created_at" json:"created_at"`
}
