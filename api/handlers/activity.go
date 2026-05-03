package handlers

import (
	"net/http"
	"strconv"

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
		        ga.action, ga.summary, ga.created_at
		 FROM group_activity ga
		 JOIN users u ON u.id = ga.user_id
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

func (h *ActivityHandler) isMember(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID)
	return count > 0
}
