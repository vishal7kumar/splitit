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
	Shares      float64 `json:"shares,omitempty"`
}

type activityParticipant struct {
	UserID int
	Role   string
}

type createExpenseRequest struct {
	Amount      float64      `json:"amount" binding:"required"`
	Description string       `json:"description"`
	Category    string       `json:"category"`
	Date        string       `json:"date"`
	PaidBy      int          `json:"paid_by"`
	SplitType   string       `json:"split_type" binding:"required"` // "equal", "exact", "percentage", "shares"
	Splits      []splitEntry `json:"splits" binding:"required"`
}

type commentRequest struct {
	Body string `json:"body" binding:"required"`
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

	actorName := h.userName(userID)
	summary := fmt.Sprintf("%s added %s for %.2f", actorName, expenseLabel(expense.Description), expense.Amount)
	if err := h.recordHistory(tx, expense.ID, userID, "create", summary); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create history"})
		return
	}
	participants := expenseParticipants(userID, req.PaidBy, shares)
	if err := h.recordGroupActivity(tx, groupID, &expense.ID, userID, "create", summary, participants); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create activity"})
		return
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

	comments := h.getExpenseComments(expenseID)
	history := h.getExpenseHistory(expenseID)

	c.JSON(http.StatusOK, gin.H{
		"expense":  expense,
		"splits":   splits,
		"comments": comments,
		"history":  history,
	})
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

	var oldExpense models.Expense
	err = h.DB.Get(&oldExpense, "SELECT * FROM expenses WHERE id = $1 AND group_id = $2", expenseID, groupID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Expense not found"})
		return
	}
	var oldSplits []models.ExpenseSplit
	h.DB.Select(&oldSplits, "SELECT * FROM expense_splits WHERE expense_id = $1", expenseID)

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
	if req.Date == "" {
		req.Date = oldExpense.Date
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

	actorName := h.userName(userID)
	summary := h.updateSummary(actorName, oldExpense, req, oldSplits, shares)
	if err := h.recordHistory(tx, expenseID, userID, "update", summary); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update history"})
		return
	}
	participants := updatedExpenseParticipants(userID, oldExpense.PaidBy, req.PaidBy, oldSplits, shares)
	if err := h.recordGroupActivity(tx, groupID, &expenseID, userID, "update", summary, participants); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update activity"})
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update expense"})
		return
	}

	var splits []models.ExpenseSplit
	h.DB.Select(&splits, "SELECT * FROM expense_splits WHERE expense_id = $1", expenseID)

	c.JSON(http.StatusOK, gin.H{"expense": expense, "splits": splits})
}

func (h *ExpenseHandler) Comment(c *gin.Context) {
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
	if !h.expenseInGroup(expenseID, groupID) {
		c.JSON(http.StatusNotFound, gin.H{"error": "Expense not found"})
		return
	}

	var req commentRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid request"})
		return
	}
	req.Body = strings.TrimSpace(req.Body)
	if req.Body == "" {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Comment cannot be empty"})
		return
	}

	tx, err := h.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add comment: " + err.Error()})
		return
	}
	defer tx.Rollback()

	var comment models.ExpenseComment
	err = tx.Get(&comment,
		`INSERT INTO expense_comments (expense_id, user_id, body)
		 VALUES ($1, $2, $3)
		 RETURNING id, expense_id, user_id, ''::text AS user_name, body, created_at`,
		expenseID, userID, req.Body,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to insert comment: " + err.Error()})
		return
	}

	actorName := h.userName(userID)
	summary := fmt.Sprintf("%s commented on %s", actorName, h.expenseDescription(expenseID))
	if err := h.recordHistory(tx, expenseID, userID, "comment", summary); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add history: " + err.Error()})
		return
	}
	participants := h.existingExpenseParticipants(expenseID, userID, "commenter")
	if err := h.recordGroupActivity(tx, groupID, &expenseID, userID, "comment", summary, participants); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add activity: " + err.Error()})
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to commit comment: " + err.Error()})
		return
	}

	comment.UserName = actorName
	c.JSON(http.StatusCreated, comment)
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

	var expense models.Expense
	if err := h.DB.Get(&expense, "SELECT * FROM expenses WHERE id = $1 AND group_id = $2", expenseID, groupID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Expense not found"})
		return
	}

	tx, err := h.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete expense"})
		return
	}
	defer tx.Rollback()

	actorName := h.userName(userID)
	summary := fmt.Sprintf("%s deleted %s for %.2f", actorName, expenseLabel(expense.Description), expense.Amount)
	participants := h.deletedExpenseParticipants(expenseID, userID, expense.PaidBy)
	if err := h.recordGroupActivity(tx, groupID, &expenseID, userID, "delete", summary, participants); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete activity"})
		return
	}

	result, err := tx.Exec("DELETE FROM expenses WHERE id = $1 AND group_id = $2", expenseID, groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete expense"})
		return
	}
	rows, _ := result.RowsAffected()
	if rows == 0 {
		c.JSON(http.StatusNotFound, gin.H{"error": "Expense not found"})
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete expense"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Expense deleted"})
}

func (h *ExpenseHandler) isMember(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID)
	return count > 0
}

func (h *ExpenseHandler) expenseInGroup(expenseID, groupID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM expenses WHERE id = $1 AND group_id = $2", expenseID, groupID)
	return count > 0
}

func (h *ExpenseHandler) userName(userID int) string {
	var name string
	if err := h.DB.Get(&name, "SELECT name FROM users WHERE id = $1", userID); err != nil || strings.TrimSpace(name) == "" {
		return "Someone"
	}
	return name
}

func (h *ExpenseHandler) expenseDescription(expenseID int) string {
	var description string
	if err := h.DB.Get(&description, "SELECT description FROM expenses WHERE id = $1", expenseID); err != nil {
		return "this expense"
	}
	return expenseLabel(description)
}

func (h *ExpenseHandler) getExpenseComments(expenseID int) []models.ExpenseComment {
	var comments []models.ExpenseComment
	h.DB.Select(&comments,
		`SELECT ec.id, ec.expense_id, ec.user_id, u.name AS user_name, ec.body, ec.created_at
		 FROM expense_comments ec
		 JOIN users u ON u.id = ec.user_id
		 WHERE ec.expense_id = $1
		 ORDER BY ec.created_at ASC, ec.id ASC`,
		expenseID,
	)
	if comments == nil {
		return []models.ExpenseComment{}
	}
	return comments
}

func (h *ExpenseHandler) getExpenseHistory(expenseID int) []models.ExpenseHistory {
	var history []models.ExpenseHistory
	h.DB.Select(&history,
		`SELECT eh.id, eh.expense_id, eh.user_id, u.name AS user_name, eh.action, eh.summary, eh.created_at
		 FROM expense_history eh
		 JOIN users u ON u.id = eh.user_id
		 WHERE eh.expense_id = $1
		 ORDER BY eh.created_at DESC, eh.id DESC`,
		expenseID,
	)
	if history == nil {
		return []models.ExpenseHistory{}
	}
	return history
}

func (h *ExpenseHandler) recordHistory(tx *sqlx.Tx, expenseID, userID int, action, summary string) error {
	_, err := tx.Exec(
		"INSERT INTO expense_history (expense_id, user_id, action, summary) VALUES ($1, $2, $3, $4)",
		expenseID, userID, action, summary,
	)
	return err
}

func (h *ExpenseHandler) recordGroupActivity(tx *sqlx.Tx, groupID int, expenseID *int, userID int, action, summary string, participants []activityParticipant) error {
	var activityID int
	err := tx.Get(&activityID,
		"INSERT INTO group_activity (group_id, expense_id, user_id, action, summary) VALUES ($1, $2, $3, $4, $5) RETURNING id",
		groupID, expenseID, userID, action, summary,
	)
	if err != nil {
		return err
	}
	return recordActivityParticipants(tx, activityID, participants)
}

func recordActivityParticipants(tx *sqlx.Tx, activityID int, participants []activityParticipant) error {
	for _, participant := range participants {
		if participant.UserID == 0 || participant.Role == "" {
			continue
		}
		_, err := tx.Exec(
			`INSERT INTO group_activity_participants (activity_id, user_id, role)
			 VALUES ($1, $2, $3)
			 ON CONFLICT DO NOTHING`,
			activityID, participant.UserID, participant.Role,
		)
		if err != nil {
			return err
		}
	}
	return nil
}

func expenseParticipants(actorID, paidBy int, splits []splitEntry) []activityParticipant {
	participants := []activityParticipant{{UserID: actorID, Role: "actor"}}
	if paidBy != 0 {
		participants = append(participants, activityParticipant{UserID: paidBy, Role: "payer"})
	}
	for _, split := range splits {
		participants = append(participants, activityParticipant{UserID: split.UserID, Role: "split"})
	}
	return participants
}

func updatedExpenseParticipants(actorID, oldPaidBy, newPaidBy int, oldSplits []models.ExpenseSplit, newSplits []splitEntry) []activityParticipant {
	participants := []activityParticipant{{UserID: actorID, Role: "actor"}}
	if oldPaidBy != 0 {
		participants = append(participants, activityParticipant{UserID: oldPaidBy, Role: "previous_payer"})
	}
	if newPaidBy != 0 {
		participants = append(participants, activityParticipant{UserID: newPaidBy, Role: "payer"})
	}
	for _, split := range oldSplits {
		participants = append(participants, activityParticipant{UserID: split.UserID, Role: "previous_split"})
	}
	for _, split := range newSplits {
		participants = append(participants, activityParticipant{UserID: split.UserID, Role: "split"})
	}
	return participants
}

func (h *ExpenseHandler) existingExpenseParticipants(expenseID, actorID int, actorRole string) []activityParticipant {
	participants := []activityParticipant{{UserID: actorID, Role: actorRole}}
	var paidBy int
	if err := h.DB.Get(&paidBy, "SELECT paid_by FROM expenses WHERE id = $1", expenseID); err == nil {
		participants = append(participants, activityParticipant{UserID: paidBy, Role: "payer"})
	}
	var splitUserIDs []int
	h.DB.Select(&splitUserIDs, "SELECT user_id FROM expense_splits WHERE expense_id = $1", expenseID)
	for _, userID := range splitUserIDs {
		participants = append(participants, activityParticipant{UserID: userID, Role: "split"})
	}
	return participants
}

func (h *ExpenseHandler) deletedExpenseParticipants(expenseID, actorID, paidBy int) []activityParticipant {
	participants := []activityParticipant{{UserID: actorID, Role: "actor"}}
	if paidBy != 0 {
		participants = append(participants, activityParticipant{UserID: paidBy, Role: "payer"})
	}
	var splitUserIDs []int
	h.DB.Select(&splitUserIDs, "SELECT user_id FROM expense_splits WHERE expense_id = $1", expenseID)
	for _, userID := range splitUserIDs {
		participants = append(participants, activityParticipant{UserID: userID, Role: "split"})
	}
	return participants
}

func expenseLabel(description string) string {
	description = strings.TrimSpace(description)
	if description == "" {
		return "an expense"
	}
	return description
}

func (h *ExpenseHandler) updateSummary(actorName string, oldExpense models.Expense, req createExpenseRequest, oldSplits []models.ExpenseSplit, newSplits []splitEntry) string {
	var changes []string
	if math.Round(oldExpense.Amount*100)/100 != math.Round(req.Amount*100)/100 {
		changes = append(changes, fmt.Sprintf("amount from %.2f to %.2f", oldExpense.Amount, req.Amount))
	}
	if oldExpense.Description != req.Description {
		changes = append(changes, "description")
	}
	if oldExpense.Category != req.Category {
		changes = append(changes, fmt.Sprintf("category from %s to %s", oldExpense.Category, req.Category))
	}
	if oldExpense.Date != req.Date {
		changes = append(changes, fmt.Sprintf("date from %s to %s", oldExpense.Date, req.Date))
	}
	if oldExpense.PaidBy != req.PaidBy {
		changes = append(changes, fmt.Sprintf("paid by from %s to %s", h.userName(oldExpense.PaidBy), h.userName(req.PaidBy)))
	}
	if splitsChanged(oldSplits, newSplits) {
		changes = append(changes, "splits")
	}
	if len(changes) == 0 {
		return fmt.Sprintf("%s updated this expense", actorName)
	}
	return fmt.Sprintf("%s changed %s", actorName, strings.Join(changes, "; "))
}

func splitsChanged(oldSplits []models.ExpenseSplit, newSplits []splitEntry) bool {
	if len(oldSplits) != len(newSplits) {
		return true
	}
	oldByUser := map[int]float64{}
	for _, s := range oldSplits {
		oldByUser[s.UserID] = math.Round(s.ShareAmount*100) / 100
	}
	for _, s := range newSplits {
		oldAmount, ok := oldByUser[s.UserID]
		if !ok || oldAmount != math.Round(s.ShareAmount*100)/100 {
			return true
		}
	}
	return false
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

	case "shares":
		var totalShares float64
		for _, e := range entries {
			if e.Shares <= 0 {
				return nil, fmt.Errorf("shares must be positive")
			}
			totalShares += e.Shares
		}
		result := make([]splitEntry, len(entries))
		var assigned float64
		for i, e := range entries {
			share := math.Round((amount*e.Shares/totalShares)*100) / 100
			result[i] = splitEntry{UserID: e.UserID, ShareAmount: share}
			assigned += share
		}
		diff := math.Round((amount-assigned)*100) / 100
		if diff != 0 {
			result[0].ShareAmount = math.Round((result[0].ShareAmount+diff)*100) / 100
		}
		return result, nil

	default:
		return nil, fmt.Errorf("invalid split_type: %s (use equal, exact, percentage, or shares)", splitType)
	}
}
