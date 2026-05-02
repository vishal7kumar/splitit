package handlers

import (
	"net/http"
	"strconv"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

type MemberHandler struct {
	DB *sqlx.DB
}

type addMemberRequest struct {
	Email string `json:"email" binding:"required"`
}

func (h *MemberHandler) Add(c *gin.Context) {
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

	var req addMemberRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Email is required"})
		return
	}

	var targetUserID int
	err = h.DB.Get(&targetUserID, "SELECT id FROM users WHERE email = $1", req.Email)
	if err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "User not found with that email"})
		return
	}

	// Check if the user is already in another group with the same name
	var groupName string
	err = h.DB.Get(&groupName, "SELECT name FROM groups WHERE id = $1", groupID)
	if err == nil {
		var count int
		err = h.DB.Get(&count, `
			SELECT COUNT(*) FROM groups g
			JOIN group_members gm ON g.id = gm.group_id
			WHERE g.name = $1 AND gm.user_id = $2 AND g.id != $3
		`, groupName, targetUserID, groupID)
		if err == nil && count > 0 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "User is already a member of another group with this name"})
			return
		}
	}

	_, err = h.DB.Exec(
		"INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'member') ON CONFLICT DO NOTHING",
		groupID, targetUserID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add member"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Member added"})
}

func (h *MemberHandler) Remove(c *gin.Context) {
	userID := c.GetInt("userID")
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}

	targetUserID, err := strconv.Atoi(c.Param("userId"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid user ID"})
		return
	}

	if !h.isAdmin(groupID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can remove members"})
		return
	}

	// Prevent removing the last admin
	if h.isAdmin(groupID, targetUserID) {
		var adminCount int
		h.DB.Get(&adminCount, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND role = 'admin'", groupID)
		if adminCount <= 1 {
			c.JSON(http.StatusBadRequest, gin.H{"error": "Cannot remove the last admin"})
			return
		}
	}

	_, err = h.DB.Exec("DELETE FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, targetUserID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to remove member"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Member removed"})
}

func (h *MemberHandler) isMember(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID)
	return count > 0
}

func (h *MemberHandler) isAdmin(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin'", groupID, userID)
	return count > 0
}
