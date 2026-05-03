package handlers

import (
	"fmt"
	"math"
	"net/http"
	"strconv"

	"splitit-api/models"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

type FriendHandler struct {
	DB *sqlx.DB
}

type friendSummary struct {
	UserID       int                    `json:"user_id"`
	Name         string                 `json:"name"`
	Email        string                 `json:"email"`
	TotalBalance float64                `json:"total_balance"`
	Groups       []friendGroupBreakdown `json:"groups"`
}

type friendGroupBreakdown struct {
	GroupID   int     `json:"group_id"`
	Name      string  `json:"name"`
	Currency  string  `json:"currency"`
	Balance   float64 `json:"balance"`
	Direction string  `json:"direction"`
	Amount    float64 `json:"amount"`
}

func (h *FriendHandler) List(c *gin.Context) {
	userID := c.GetInt("userID")

	friends, err := h.buildFriendSummaries(userID, 0)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list friends"})
		return
	}

	c.JSON(http.StatusOK, friends)
}

func (h *FriendHandler) Settle(c *gin.Context) {
	userID := c.GetInt("userID")
	friendID, err := strconv.Atoi(c.Param("friendId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid friend ID"})
		return
	}
	if friendID == userID {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot settle with yourself"})
		return
	}

	friends, err := h.buildFriendSummaries(userID, friendID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to settle with friend"})
		return
	}
	if len(friends) == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Friend not found"})
		return
	}

	tx, err := h.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to settle with friend"})
		return
	}
	defer tx.Rollback()

	var settlements []models.Settlement
	for _, g := range friends[0].Groups {
		if g.Amount <= 0.01 {
			continue
		}
		paidBy, paidTo := userID, friendID
		if g.Balance > 0 {
			paidBy, paidTo = friendID, userID
		}

		var settlement models.Settlement
		err = tx.Get(&settlement,
			`INSERT INTO settlements (group_id, paid_by, paid_to, amount)
			 VALUES ($1, $2, $3, $4)
			 RETURNING *`,
			g.GroupID, paidBy, paidTo, g.Amount,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create settlement"})
			return
		}
		summary := fmt.Sprintf("%s paid %s %.2f to settle up", h.userName(paidBy), h.userName(paidTo), g.Amount)
		if err := h.recordGroupActivity(tx, g.GroupID, userID, summary); err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create settlement activity"})
			return
		}
		settlements = append(settlements, settlement)
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to settle with friend"})
		return
	}
	if settlements == nil {
		settlements = []models.Settlement{}
	}

	c.JSON(http.StatusCreated, settlements)
}

func (h *FriendHandler) buildFriendSummaries(userID, onlyFriendID int) ([]friendSummary, error) {
	type friendRow struct {
		UserID int    `db:"user_id"`
		Name   string `db:"name"`
		Email  string `db:"email"`
	}

	query := `SELECT DISTINCT u.id AS user_id, u.name, u.email
		FROM group_members mine
		JOIN group_members theirs ON theirs.group_id = mine.group_id AND theirs.user_id != mine.user_id
		JOIN users u ON u.id = theirs.user_id
		WHERE mine.user_id = $1`
	args := []interface{}{userID}
	if onlyFriendID != 0 {
		query += " AND u.id = $2"
		args = append(args, onlyFriendID)
	}
	query += " ORDER BY u.name, u.email"

	var rows []friendRow
	if err := h.DB.Select(&rows, query, args...); err != nil {
		return nil, err
	}

	friends := make([]friendSummary, 0, len(rows))
	for _, row := range rows {
		groups, err := h.groupBreakdowns(userID, row.UserID)
		if err != nil {
			return nil, err
		}

		total := 0.0
		for _, g := range groups {
			total += g.Balance
		}

		friends = append(friends, friendSummary{
			UserID:       row.UserID,
			Name:         row.Name,
			Email:        row.Email,
			TotalBalance: math.Round(total*100) / 100,
			Groups:       groups,
		})
	}

	return friends, nil
}

func (h *FriendHandler) userName(userID int) string {
	var name string
	if err := h.DB.Get(&name, "SELECT name FROM users WHERE id = $1", userID); err != nil || name == "" {
		return "Someone"
	}
	return name
}

func (h *FriendHandler) recordGroupActivity(tx *sqlx.Tx, groupID, userID int, summary string) error {
	_, err := tx.Exec(
		"INSERT INTO group_activity (group_id, user_id, action, summary) VALUES ($1, $2, 'settlement', $3)",
		groupID, userID, summary,
	)
	return err
}

func (h *FriendHandler) groupBreakdowns(userID, friendID int) ([]friendGroupBreakdown, error) {
	type groupRow struct {
		GroupID  int    `db:"group_id"`
		Name     string `db:"name"`
		Currency string `db:"currency"`
	}

	var groups []groupRow
	if err := h.DB.Select(&groups,
		`SELECT g.id AS group_id, g.name, g.currency
		 FROM groups g
		 JOIN group_members me ON me.group_id = g.id AND me.user_id = $1
		 JOIN group_members friend ON friend.group_id = g.id AND friend.user_id = $2
		 ORDER BY g.created_at DESC`,
		userID, friendID,
	); err != nil {
		return nil, err
	}

	breakdowns := []friendGroupBreakdown{}
	for _, group := range groups {
		debts, err := h.simplifiedDebts(group.GroupID)
		if err != nil {
			return nil, err
		}

		for _, debt := range debts {
			balance := 0.0
			direction := ""
			if debt.From == friendID && debt.To == userID {
				balance = debt.Amount
				direction = "owed_to_you"
			} else if debt.From == userID && debt.To == friendID {
				balance = -debt.Amount
				direction = "you_owe"
			} else {
				continue
			}

			breakdowns = append(breakdowns, friendGroupBreakdown{
				GroupID:   group.GroupID,
				Name:      group.Name,
				Currency:  group.Currency,
				Balance:   math.Round(balance*100) / 100,
				Direction: direction,
				Amount:    debt.Amount,
			})
		}
	}

	return breakdowns, nil
}

func (h *FriendHandler) simplifiedDebts(groupID int) ([]simplifiedDebt, error) {
	type memberInfo struct {
		UserID int    `db:"user_id"`
		Name   string `db:"name"`
	}
	var members []memberInfo
	if err := h.DB.Select(&members,
		`SELECT gm.user_id, u.name FROM group_members gm
		 JOIN users u ON gm.user_id = u.id
		 WHERE gm.group_id = $1`, groupID); err != nil {
		return nil, err
	}

	nameMap := make(map[int]string)
	netBalance := make(map[int]float64)
	for _, m := range members {
		nameMap[m.UserID] = m.Name
	}

	type amountRow struct {
		UserID int     `db:"user_id"`
		Total  float64 `db:"total"`
	}
	var paidRows []amountRow
	if err := h.DB.Select(&paidRows,
		`SELECT paid_by AS user_id, COALESCE(SUM(amount), 0) AS total
		 FROM expenses WHERE group_id = $1 GROUP BY paid_by`, groupID); err != nil {
		return nil, err
	}
	for _, r := range paidRows {
		netBalance[r.UserID] += r.Total
	}

	var splitRows []amountRow
	if err := h.DB.Select(&splitRows,
		`SELECT es.user_id, COALESCE(SUM(es.share_amount), 0) AS total
		 FROM expense_splits es
		 JOIN expenses e ON es.expense_id = e.id
		 WHERE e.group_id = $1
		 GROUP BY es.user_id`, groupID); err != nil {
		return nil, err
	}
	for _, r := range splitRows {
		netBalance[r.UserID] -= r.Total
	}

	var settPaid []amountRow
	if err := h.DB.Select(&settPaid,
		`SELECT paid_by AS user_id, COALESCE(SUM(amount), 0) AS total
		 FROM settlements WHERE group_id = $1 GROUP BY paid_by`, groupID); err != nil {
		return nil, err
	}
	for _, r := range settPaid {
		netBalance[r.UserID] += r.Total
	}

	var settReceived []amountRow
	if err := h.DB.Select(&settReceived,
		`SELECT paid_to AS user_id, COALESCE(SUM(amount), 0) AS total
		 FROM settlements WHERE group_id = $1 GROUP BY paid_to`, groupID); err != nil {
		return nil, err
	}
	for _, r := range settReceived {
		netBalance[r.UserID] -= r.Total
	}

	return simplifyDebts(netBalance, nameMap), nil
}
