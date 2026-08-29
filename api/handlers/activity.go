package handlers

import (
	"encoding/base64"
	"fmt"
	"net/http"
	"strconv"
	"strings"
	"time"

	"splitit-api/models"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

type ActivityHandler struct {
	DB *sqlx.DB
}

func (h *ActivityHandler) List(c *gin.Context) {
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

	var activity []models.GroupActivity
	err = h.DB.Select(&activity,
		`SELECT ga.id, ga.group_id, ga.expense_id, ga.user_id, u.name AS user_name,
		        ga.action, ga.summary, ga.created_at, ''::text AS group_name,
		        false AS is_involved, false AS is_new,
		        CASE WHEN ga.action IN ('delete_group', 'restore_group') THEN 'group'
		             WHEN ga.action IN ('delete', 'delete_expense', 'restore_expense') OR ga.expense_id IS NOT NULL THEN 'expense'
		             ELSE '' END AS resource_type,
		        (ga.action IN ('delete', 'delete_expense') AND ga.reverted_at IS NULL
		          AND ga.revert_deadline > NOW() AND e.deleted_at IS NOT NULL) AS can_revert,
		        ga.revert_deadline, ga.reverted_at, false AS group_deleted,
		        COALESCE(e.deleted_at IS NOT NULL, ga.action IN ('delete', 'delete_expense')) AS expense_deleted
		 FROM group_activity ga
		 JOIN users u ON u.id = ga.user_id
		 LEFT JOIN expenses e ON e.id = ga.expense_id
		 WHERE ga.group_id = $1
		 ORDER BY ga.created_at DESC, ga.id DESC`,
		groupID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list activity"})
		return
	}
	if activity == nil {
		activity = []models.GroupActivity{}
	}

	c.JSON(http.StatusOK, activity)
}

type activityPage struct {
	Items      []models.GroupActivity `json:"items"`
	NextCursor string                 `json:"next_cursor"`
}

func (h *ActivityHandler) ListUser(c *gin.Context) {
	userID := c.GetInt("userID")
	limit := 20
	if raw := c.Query("limit"); raw != "" {
		parsed, err := strconv.Atoi(raw)
		if err != nil || parsed < 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid limit"})
			return
		}
		if parsed > 50 {
			parsed = 50
		}
		limit = parsed
	}

	query := `SELECT ga.id, ga.group_id, g.name AS group_name, ga.expense_id,
	                 ga.user_id, u.name AS user_name, ga.action, ga.summary, ga.created_at,
	                 EXISTS (
	                   SELECT 1 FROM group_activity_participants gap
	                   WHERE gap.activity_id = ga.id AND gap.user_id = $1
	                 ) AS is_involved,
	                 (ga.created_at > (SELECT last_activity_read_at FROM users WHERE id = $1)) AS is_new,
	                 CASE WHEN ga.action IN ('delete_group', 'restore_group') THEN 'group'
	                      WHEN ga.action IN ('delete', 'delete_expense', 'restore_expense') OR ga.expense_id IS NOT NULL THEN 'expense'
	                      ELSE '' END AS resource_type,
	                 CASE
	                   WHEN ga.action IN ('delete', 'delete_expense') THEN
	                     ga.reverted_at IS NULL AND ga.revert_deadline > NOW()
	                     AND e.deleted_at IS NOT NULL AND g.deleted_at IS NULL
	                   WHEN ga.action = 'delete_group' THEN
	                     ga.reverted_at IS NULL AND ga.revert_deadline > NOW()
	                     AND g.deleted_at IS NOT NULL
	                     AND EXISTS (SELECT 1 FROM group_members admin
	                                 WHERE admin.group_id = ga.group_id AND admin.user_id = $1 AND admin.role = 'admin')
	                   ELSE false
	                 END AS can_revert,
	                 ga.revert_deadline, ga.reverted_at,
	                 (g.deleted_at IS NOT NULL) AS group_deleted,
	                 COALESCE(e.deleted_at IS NOT NULL, ga.action IN ('delete', 'delete_expense')) AS expense_deleted
	          FROM group_activity ga
	          JOIN group_members gm ON gm.group_id = ga.group_id AND gm.user_id = $1
	          JOIN groups g ON g.id = ga.group_id
	          JOIN users u ON u.id = ga.user_id
	          LEFT JOIN expenses e ON e.id = ga.expense_id`
	args := []interface{}{userID}

	if raw := c.Query("cursor"); raw != "" {
		createdAt, id, err := decodeActivityCursor(raw)
		if err != nil {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid cursor"})
			return
		}
		query += " WHERE (ga.created_at, ga.id) < ($2, $3)"
		args = append(args, createdAt, id)
	}

	query += fmt.Sprintf(" ORDER BY ga.created_at DESC, ga.id DESC LIMIT $%d", len(args)+1)
	args = append(args, limit+1)

	var activity []models.GroupActivity
	if err := h.DB.Select(&activity, query, args...); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list activity"})
		return
	}

	nextCursor := ""
	if len(activity) > limit {
		activity = activity[:limit]
		last := activity[len(activity)-1]
		nextCursor = encodeActivityCursor(last.CreatedAt, last.ID)
	}
	if activity == nil {
		activity = []models.GroupActivity{}
	}

	c.JSON(http.StatusOK, activityPage{Items: activity, NextCursor: nextCursor})
}

func (h *ActivityHandler) isMember(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, `SELECT COUNT(*) FROM group_members gm JOIN groups g ON g.id = gm.group_id
		WHERE gm.group_id = $1 AND gm.user_id = $2 AND g.deleted_at IS NULL`, groupID, userID)
	return count > 0
}

type revertActivityTarget struct {
	ID             int        `db:"id"`
	GroupID        int        `db:"group_id"`
	ExpenseID      *int       `db:"expense_id"`
	Action         string     `db:"action"`
	RevertDeadline *time.Time `db:"revert_deadline"`
	RevertedAt     *time.Time `db:"reverted_at"`
}

func (h *ActivityHandler) Revert(c *gin.Context) {
	userID := c.GetInt("userID")
	activityID, err := strconv.Atoi(c.Param("activityId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid activity ID"})
		return
	}

	tx, err := h.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore deletion"})
		return
	}
	defer tx.Rollback()

	var target revertActivityTarget
	err = tx.Get(&target,
		`SELECT ga.id, ga.group_id, ga.expense_id, ga.action, ga.revert_deadline, ga.reverted_at
		 FROM group_activity ga
		 JOIN group_members gm ON gm.group_id = ga.group_id AND gm.user_id = $2
		 WHERE ga.id = $1
		 FOR UPDATE OF ga`, activityID, userID)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Deletion activity not found"})
		return
	}
	if target.RevertedAt != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "This deletion has already been restored"})
		return
	}
	if target.RevertDeadline == nil || !target.RevertDeadline.After(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "The 30-day restore window has expired"})
		return
	}

	switch target.Action {
	case "delete", "delete_expense":
		h.revertExpense(c, tx, target, userID)
	case "delete_group":
		h.revertGroup(c, tx, target, userID)
	default:
		c.JSON(http.StatusConflict, gin.H{"error": "This activity cannot be reverted"})
	}
}

func (h *ActivityHandler) revertExpense(c *gin.Context, tx *sqlx.Tx, target revertActivityTarget, userID int) {
	if target.ExpenseID == nil {
		c.JSON(http.StatusGone, gin.H{"error": "The deleted expense is no longer available"})
		return
	}

	var groupDeletedAt *time.Time
	if err := tx.Get(&groupDeletedAt, "SELECT deleted_at FROM groups WHERE id = $1 FOR UPDATE", target.GroupID); err != nil {
		c.JSON(http.StatusGone, gin.H{"error": "The expense's group is no longer available"})
		return
	}
	if groupDeletedAt != nil {
		c.JSON(http.StatusConflict, gin.H{"error": "Restore the group before restoring this expense"})
		return
	}

	type deletedExpense struct {
		Description string     `db:"description"`
		Amount      float64    `db:"amount"`
		PaidBy      int        `db:"paid_by"`
		DeletedAt   *time.Time `db:"deleted_at"`
	}
	var expense deletedExpense
	if err := tx.Get(&expense,
		"SELECT description, amount, paid_by, deleted_at FROM expenses WHERE id = $1 AND group_id = $2 FOR UPDATE",
		*target.ExpenseID, target.GroupID,
	); err != nil {
		c.JSON(http.StatusGone, gin.H{"error": "The deleted expense is no longer available"})
		return
	}
	if expense.DeletedAt == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "The expense is not deleted"})
		return
	}
	if !expense.DeletedAt.Add(30 * 24 * time.Hour).After(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "The 30-day restore window has expired"})
		return
	}

	if _, err := tx.Exec("UPDATE expenses SET deleted_at = NULL, deleted_by = NULL WHERE id = $1", *target.ExpenseID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore expense"})
		return
	}
	if _, err := tx.Exec("UPDATE group_activity SET reverted_at = NOW(), reverted_by = $1 WHERE id = $2", userID, target.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore expense"})
		return
	}

	actorName := h.userNameTx(tx, userID)
	summary := fmt.Sprintf("%s restored %s for %.2f", actorName, expenseLabel(expense.Description), expense.Amount)
	participants := []activityParticipant{{UserID: userID, Role: "actor"}, {UserID: expense.PaidBy, Role: "payer"}}
	var splitUserIDs []int
	if err := tx.Select(&splitUserIDs, "SELECT user_id FROM expense_splits WHERE expense_id = $1", *target.ExpenseID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore expense"})
		return
	}
	for _, splitUserID := range splitUserIDs {
		participants = append(participants, activityParticipant{UserID: splitUserID, Role: "split"})
	}
	if err := h.insertRestoreActivity(tx, target.GroupID, target.ExpenseID, userID, "restore_expense", summary, participants); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore expense"})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore expense"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Expense restored", "resource_type": "expense", "group_id": target.GroupID, "expense_id": *target.ExpenseID})
}

func (h *ActivityHandler) revertGroup(c *gin.Context, tx *sqlx.Tx, target revertActivityTarget, userID int) {
	var isAdmin bool
	if err := tx.Get(&isAdmin,
		"SELECT EXISTS (SELECT 1 FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin')",
		target.GroupID, userID,
	); err != nil || !isAdmin {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only group admins can restore the group"})
		return
	}

	type deletedGroup struct {
		Name      string     `db:"name"`
		DeletedAt *time.Time `db:"deleted_at"`
	}
	var group deletedGroup
	if err := tx.Get(&group, "SELECT name, deleted_at FROM groups WHERE id = $1 FOR UPDATE", target.GroupID); err != nil {
		c.JSON(http.StatusGone, gin.H{"error": "The deleted group is no longer available"})
		return
	}
	if group.DeletedAt == nil {
		c.JSON(http.StatusConflict, gin.H{"error": "The group is not deleted"})
		return
	}
	if !group.DeletedAt.Add(30 * 24 * time.Hour).After(time.Now()) {
		c.JSON(http.StatusGone, gin.H{"error": "The 30-day restore window has expired"})
		return
	}

	restoredName := group.Name
	for suffix := 0; ; suffix++ {
		conflicts, err := h.groupNameConflicts(tx, target.GroupID, restoredName)
		if err != nil {
			c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore group"})
			return
		}
		if !conflicts {
			break
		}
		if suffix == 0 {
			restoredName = group.Name + " (restored)"
		} else {
			restoredName = fmt.Sprintf("%s (restored %d)", group.Name, suffix+1)
		}
	}
	if _, err := tx.Exec("UPDATE groups SET name = $1, deleted_at = NULL, deleted_by = NULL WHERE id = $2", restoredName, target.GroupID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore group"})
		return
	}
	if _, err := tx.Exec("UPDATE group_activity SET reverted_at = NOW(), reverted_by = $1 WHERE id = $2", userID, target.ID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore group"})
		return
	}

	var memberIDs []int
	if err := tx.Select(&memberIDs, "SELECT user_id FROM group_members WHERE group_id = $1", target.GroupID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore group"})
		return
	}
	participants := []activityParticipant{{UserID: userID, Role: "actor"}}
	for _, memberID := range memberIDs {
		participants = append(participants, activityParticipant{UserID: memberID, Role: "member"})
	}
	summary := fmt.Sprintf("%s restored group %s", h.userNameTx(tx, userID), restoredName)
	if err := h.insertRestoreActivity(tx, target.GroupID, nil, userID, "restore_group", summary, participants); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore group"})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to restore group"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"message": "Group restored", "resource_type": "group", "group_id": target.GroupID, "group_name": restoredName})
}

func (h *ActivityHandler) groupNameConflicts(tx *sqlx.Tx, groupID int, name string) (bool, error) {
	var conflict bool
	err := tx.Get(&conflict, `SELECT EXISTS (
		SELECT 1
		FROM group_members restored
		JOIN group_members other ON other.user_id = restored.user_id AND other.group_id != restored.group_id
		JOIN groups active_group ON active_group.id = other.group_id AND active_group.deleted_at IS NULL
		WHERE restored.group_id = $1 AND active_group.name = $2
	)`, groupID, name)
	return conflict, err
}

func (h *ActivityHandler) insertRestoreActivity(tx *sqlx.Tx, groupID int, expenseID *int, userID int, action, summary string, participants []activityParticipant) error {
	var activityID int
	if err := tx.Get(&activityID,
		"INSERT INTO group_activity (group_id, expense_id, user_id, action, summary) VALUES ($1, $2, $3, $4, $5) RETURNING id",
		groupID, expenseID, userID, action, summary,
	); err != nil {
		return err
	}
	return recordActivityParticipants(tx, activityID, participants)
}

func (h *ActivityHandler) userNameTx(tx *sqlx.Tx, userID int) string {
	var name string
	if err := tx.Get(&name, "SELECT name FROM users WHERE id = $1", userID); err != nil || strings.TrimSpace(name) == "" {
		return "Someone"
	}
	return name
}

func encodeActivityCursor(createdAt time.Time, id int) string {
	raw := fmt.Sprintf("%s|%d", createdAt.UTC().Format(time.RFC3339Nano), id)
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

func decodeActivityCursor(cursor string) (time.Time, int, error) {
	decoded, err := base64.RawURLEncoding.DecodeString(cursor)
	if err != nil {
		return time.Time{}, 0, err
	}
	parts := strings.Split(string(decoded), "|")
	if len(parts) != 2 {
		return time.Time{}, 0, fmt.Errorf("invalid cursor")
	}
	createdAt, err := time.Parse(time.RFC3339Nano, parts[0])
	if err != nil {
		return time.Time{}, 0, err
	}
	id, err := strconv.Atoi(parts[1])
	if err != nil {
		return time.Time{}, 0, err
	}
	return createdAt, id, nil
}

func (h *ActivityHandler) MarkRead(c *gin.Context) {
	userID := c.GetInt("userID")
	_, err := h.DB.Exec("UPDATE users SET last_activity_read_at = NOW() WHERE id = $1", userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to mark activity as read"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"status": "success"})
}

func (h *ActivityHandler) UnreadCount(c *gin.Context) {
	userID := c.GetInt("userID")
	var count int
	err := h.DB.Get(&count, `
		SELECT COUNT(*)
		FROM group_activity ga
		JOIN group_members gm ON gm.group_id = ga.group_id AND gm.user_id = $1
		WHERE ga.created_at > (SELECT last_activity_read_at FROM users WHERE id = $1)
	`, userID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to get unread count"})
		return
	}
	c.JSON(http.StatusOK, gin.H{"unread_count": count})
}
