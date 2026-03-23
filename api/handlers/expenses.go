package handlers

import (
	"fmt"
	"math"
	"net/http"
	"strconv"
	"strings"
	"time"

	"splitit-api/models"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

type ExpenseHandler struct {
	DB *sqlx.DB
}

type splitEntry struct {
	UserID      int     `json:"user_id"`
	ShareAmount float64 `json:"share_amount,omitempty"`
	Percentage  float64 `json:"percentage,omitempty"`
}

type createExpenseRequest struct {
	Amount      float64      `json:"amount" binding:"required"`
	Description string       `json:"description"`
	Category    string       `json:"category"`
	Date        string       `json:"date"`
	PaidBy      int          `json:"paid_by"`
	SplitType   string       `json:"split_type" binding:"required"` // "equal", "exact", "percentage"
	Splits      []splitEntry `json:"splits" binding:"required"`
}

func (h *ExpenseHandler) Create(c *gin.Context) {
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

	var req createExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request: " + err.Error()})
		return
	}

	if req.PaidBy == 0 {
		req.PaidBy = userID
	}
	if req.Category == "" {
		req.Category = "general"
	}

	// Validate date is not in the future
	if req.Date != "" {
		if d, err := time.Parse("2006-01-02", req.Date); err == nil {
			if d.After(time.Now()) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Expense date cannot be in the future"})
				return
			}
		}
	}

	// Calculate splits
	shares, err := calculateShares(req.Amount, req.SplitType, req.Splits)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tx, err := h.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create expense"})
		return
	}
	defer tx.Rollback()

	var expense models.Expense
	query := "INSERT INTO expenses (group_id, paid_by, amount, description, category"
	values := "VALUES ($1, $2, $3, $4, $5"
	args := []interface{}{groupID, req.PaidBy, req.Amount, req.Description, req.Category}
	argIdx := 6

	if req.Date != "" {
		query += ", date"
		values += fmt.Sprintf(", $%d", argIdx)
		args = append(args, req.Date)
		argIdx++
	}

	query += ") " + values + ") RETURNING *"
	err = tx.Get(&expense, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create expense"})
		return
	}

	for _, s := range shares {
		_, err = tx.Exec(
			"INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES ($1, $2, $3)",
			expense.ID, s.UserID, s.ShareAmount,
		)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create splits"})
			return
		}
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create expense"})
		return
	}

	var splits []models.ExpenseSplit
	h.DB.Select(&splits, "SELECT * FROM expense_splits WHERE expense_id = $1", expense.ID)

	c.JSON(http.StatusCreated, gin.H{"expense": expense, "splits": splits})
}

func (h *ExpenseHandler) List(c *gin.Context) {
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

	query := "SELECT * FROM expenses WHERE group_id = $1"
	args := []interface{}{groupID}
	argIdx := 2

	// Search/filter
	if q := c.Query("q"); q != "" {
		query += fmt.Sprintf(" AND description ILIKE $%d", argIdx)
		args = append(args, "%"+q+"%")
		argIdx++
	}
	if cat := c.Query("category"); cat != "" {
		query += fmt.Sprintf(" AND category = $%d", argIdx)
		args = append(args, cat)
		argIdx++
	}
	if paidBy := c.Query("paid_by"); paidBy != "" {
		query += fmt.Sprintf(" AND paid_by = $%d", argIdx)
		args = append(args, paidBy)
		argIdx++
	}
	if from := c.Query("from"); from != "" {
		query += fmt.Sprintf(" AND date >= $%d", argIdx)
		args = append(args, from)
		argIdx++
	}
	if to := c.Query("to"); to != "" {
		query += fmt.Sprintf(" AND date <= $%d", argIdx)
		args = append(args, to)
		argIdx++
	}

	query += " ORDER BY date DESC, created_at DESC"

	var expenses []models.Expense
	err = h.DB.Select(&expenses, query, args...)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list expenses"})
		return
	}
	if expenses == nil {
		expenses = []models.Expense{}
	}
	c.JSON(http.StatusOK, expenses)
}

func (h *ExpenseHandler) Get(c *gin.Context) {
	userID := c.GetInt("userID")
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}
	expenseID, err := strconv.Atoi(c.Param("eid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid expense ID"})
		return
	}

	if !h.isMember(groupID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a member of this group"})
		return
	}

	var expense models.Expense
	err = h.DB.Get(&expense, "SELECT * FROM expenses WHERE id = $1 AND group_id = $2", expenseID, groupID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Expense not found"})
		return
	}

	var splits []models.ExpenseSplit
	h.DB.Select(&splits, "SELECT * FROM expense_splits WHERE expense_id = $1", expenseID)

	c.JSON(http.StatusOK, gin.H{"expense": expense, "splits": splits})
}

func (h *ExpenseHandler) Update(c *gin.Context) {
	userID := c.GetInt("userID")
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}
	expenseID, err := strconv.Atoi(c.Param("eid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid expense ID"})
		return
	}

	if !h.isMember(groupID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a member of this group"})
		return
	}

	var req createExpenseRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}

	if req.PaidBy == 0 {
		req.PaidBy = userID
	}
	if req.Category == "" {
		req.Category = "general"
	}

	if req.Date != "" {
		if d, err := time.Parse("2006-01-02", req.Date); err == nil {
			if d.After(time.Now()) {
				c.JSON(http.StatusBadRequest, gin.H{"error": "Expense date cannot be in the future"})
				return
			}
		}
	}

	shares, err := calculateShares(req.Amount, req.SplitType, req.Splits)
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": err.Error()})
		return
	}

	tx, err := h.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update expense"})
		return
	}
	defer tx.Rollback()

	var expense models.Expense
	err = tx.Get(&expense,
		`UPDATE expenses SET paid_by=$1, amount=$2, description=$3, category=$4, date=$5, updated_at=NOW()
		 WHERE id=$6 AND group_id=$7 RETURNING *`,
		req.PaidBy, req.Amount, req.Description, req.Category, req.Date, expenseID, groupID,
	)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Expense not found"})
		return
	}

	tx.Exec("DELETE FROM expense_splits WHERE expense_id = $1", expenseID)
	for _, s := range shares {
		tx.Exec(
			"INSERT INTO expense_splits (expense_id, user_id, share_amount) VALUES ($1, $2, $3)",
			expenseID, s.UserID, s.ShareAmount,
		)
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update expense"})
		return
	}

	var splits []models.ExpenseSplit
	h.DB.Select(&splits, "SELECT * FROM expense_splits WHERE expense_id = $1", expenseID)

	c.JSON(http.StatusOK, gin.H{"expense": expense, "splits": splits})
}

func (h *ExpenseHandler) Delete(c *gin.Context) {
	userID := c.GetInt("userID")
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}
	expenseID, err := strconv.Atoi(c.Param("eid"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid expense ID"})
		return
	}

	if !h.isMember(groupID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Not a member of this group"})
		return
	}

	result, err := h.DB.Exec("DELETE FROM expenses WHERE id = $1 AND group_id = $2", expenseID, groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete expense"})
		return
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Expense not found"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Expense deleted"})
}

func (h *ExpenseHandler) isMember(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID)
	return count > 0
}

func calculateShares(amount float64, splitType string, entries []splitEntry) ([]splitEntry, error) {
	if len(entries) == 0 {
		return nil, fmt.Errorf("splits cannot be empty")
	}

	switch strings.ToLower(splitType) {
	case "equal":
		share := math.Round(amount/float64(len(entries))*100) / 100
		remainder := math.Round((amount-share*float64(len(entries)))*100) / 100
		result := make([]splitEntry, len(entries))
		for i, e := range entries {
			result[i] = splitEntry{UserID: e.UserID, ShareAmount: share}
		}
		// Give remainder to first person
		if remainder != 0 {
			result[0].ShareAmount = math.Round((result[0].ShareAmount+remainder)*100) / 100
		}
		return result, nil

	case "exact":
		var total float64
		for _, e := range entries {
			total += e.ShareAmount
		}
		total = math.Round(total*100) / 100
		if total != math.Round(amount*100)/100 {
			return nil, fmt.Errorf("exact splits must sum to %.2f, got %.2f", amount, total)
		}
		return entries, nil

	case "percentage":
		var totalPct float64
		for _, e := range entries {
			totalPct += e.Percentage
		}
		if math.Round(totalPct) != 100 {
			return nil, fmt.Errorf("percentages must sum to 100, got %.2f", totalPct)
		}
		result := make([]splitEntry, len(entries))
		var assigned float64
		for i, e := range entries {
			share := math.Round(amount*e.Percentage) / 100
			result[i] = splitEntry{UserID: e.UserID, ShareAmount: share}
			assigned += share
		}
		// Fix rounding
		diff := math.Round((amount-assigned)*100) / 100
		if diff != 0 {
			result[0].ShareAmount = math.Round((result[0].ShareAmount+diff)*100) / 100
		}
		return result, nil

	default:
		return nil, fmt.Errorf("invalid split_type: %s (use equal, exact, or percentage)", splitType)
	}
}
