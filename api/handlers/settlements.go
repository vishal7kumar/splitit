package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"time"

	"splitit-api/models"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

type SettlementHandler struct {
	DB *sqlx.DB
}

type createSettlementRequest struct {
	PaidBy int     `json:"paid_by"`
	PaidTo int     `json:"paid_to" binding:"required"`
	Amount float64 `json:"amount" binding:"required"`
	Date   string  `json:"date"`
}

func (h *SettlementHandler) Create(c *gin.Context) {
	userID := c.GetInt("userID")
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}

	if !h.isMember(groupID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a member of this group"})
		return
	}

	var req createSettlementRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "paid_to and amount are required"})
		return
	}

	if req.Amount <= 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Amount must be positive"})
		return
	}

	if req.Date != "" {
		if d, err := time.Parse("2006-01-02", req.Date); err == nil {
			if d.After(time.Now()) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Settlement date cannot be in the future"})
				return
			}
		}
	}

	paidBy := userID
	if req.PaidBy != 0 {
		paidBy = req.PaidBy
	}

	if paidBy == req.PaidTo {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Payer and payee cannot be the same"})
		return
	}

	if paidBy != userID && req.PaidTo != userID {
		c.JSON(http.StatusForbidden, gin.H{"error": "You can only record payments involving yourself"})
		return
	}

	if !h.isMember(groupID, paidBy) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Payer is not a member of this group"})
		return
	}

	if !h.isMember(groupID, req.PaidTo) {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Recipient is not a member of this group"})
		return
	}

	tx, err := h.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create settlement"})
		return
	}
	defer tx.Rollback()

	var settlement models.Settlement
	query := "INSERT INTO settlements (group_id, paid_by, paid_to, amount"
	values := "VALUES ($1, $2, $3, $4"
	args := []interface{}{groupID, paidBy, req.PaidTo, req.Amount}

	if req.Date != "" {
		query += ", date"
		values += ", $5"
		args = append(args, req.Date)
	}

	query += ") " + values + ") RETURNING *"
	err = tx.Get(&settlement, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create settlement"})
		return
	}

	summary := fmt.Sprintf("%s paid %s %.2f to settle up", h.userName(paidBy), h.userName(req.PaidTo), req.Amount)
	if err := h.recordGroupActivity(tx, groupID, userID, summary); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create settlement activity"})
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create settlement"})
		return
	}

	c.JSON(http.StatusCreated, settlement)
}

func (h *SettlementHandler) List(c *gin.Context) {
	userID := c.GetInt("userID")
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}

	if !h.isMember(groupID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a member of this group"})
		return
	}

	type settlementWithNames struct {
		models.Settlement
		PaidByName string `db:"paid_by_name" json:"paid_by_name"`
		PaidToName string `db:"paid_to_name" json:"paid_to_name"`
	}

	var settlements []settlementWithNames
	err = h.DB.Select(&settlements,
		`SELECT s.*, u1.name AS paid_by_name, u2.name AS paid_to_name
		 FROM settlements s
		 JOIN users u1 ON s.paid_by = u1.id
		 JOIN users u2 ON s.paid_to = u2.id
		 WHERE s.group_id = $1
		 ORDER BY s.date DESC, s.created_at DESC`, groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list settlements"})
		return
	}
	if settlements == nil {
		settlements = []settlementWithNames{}
	}

	c.JSON(http.StatusOK, settlements)
}

func (h *SettlementHandler) isMember(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID)
	return count > 0
}

func (h *SettlementHandler) userName(userID int) string {
	var name string
	if err := h.DB.Get(&name, "SELECT name FROM users WHERE id = $1", userID); err != nil || name == "" {
		return "Someone"
	}
	return name
}

func (h *SettlementHandler) recordGroupActivity(tx *sqlx.Tx, groupID, userID int, summary string) error {
	_, err := tx.Exec(
		"INSERT INTO group_activity (group_id, user_id, action, summary) VALUES ($1, $2, 'settlement', $3)",
		groupID, userID, summary,
	)
	return err
}
