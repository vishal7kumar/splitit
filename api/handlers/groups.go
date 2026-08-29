package handlers

import (
	"fmt"
	"net/http"
	"strconv"
	"strings"

	"splitit-api/models"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

type GroupHandler struct {
	DB *sqlx.DB
}

type createGroupRequest struct {
	Name     string `json:"name" binding:"required"`
	Currency string `json:"currency"`
}

func (h *GroupHandler) Create(c *gin.Context) {
	userID := c.GetInt("userID")
	var req createGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	// Check if the user is already in a group with the same name
	var count int
	err := h.DB.Get(&count, `
		SELECT COUNT(*) FROM groups g
		JOIN group_members gm ON g.id = gm.group_id
		WHERE g.name = $1 AND gm.user_id = $2 AND g.deleted_at IS NULL
	`, req.Name, userID)
	if err == nil && count > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "You are already a member of a group with this name"})
		return
	}

	tx, err := h.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create group"})
		return
	}
	defer tx.Rollback()

	var group models.Group
	currency := req.Currency
	if currency == "" {
		currency = "INR"
	}
	err = tx.Get(&group,
		"INSERT INTO groups (name, currency, created_by) VALUES ($1, $2, $3) RETURNING *",
		req.Name, currency, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create group"})
		return
	}

	_, err = tx.Exec(
		"INSERT INTO group_members (group_id, user_id, role) VALUES ($1, $2, 'admin')",
		group.ID, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to add creator as member"})
		return
	}

	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create group"})
		return
	}

	c.JSON(http.StatusCreated, group)
}

func (h *GroupHandler) List(c *gin.Context) {
	userID := c.GetInt("userID")

	var groups []models.Group
	err := h.DB.Select(&groups,
		`SELECT g.* FROM groups g
		 JOIN group_members gm ON g.id = gm.group_id
		 WHERE gm.user_id = $1 AND g.deleted_at IS NULL
		 ORDER BY g.created_at DESC`, userID,
	)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to list groups"})
		return
	}
	if groups == nil {
		groups = []models.Group{}
	}
	c.JSON(http.StatusOK, groups)
}

func (h *GroupHandler) Get(c *gin.Context) {
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

	var group models.Group
	if err := h.DB.Get(&group, "SELECT * FROM groups WHERE id = $1 AND deleted_at IS NULL", groupID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	var members []models.GroupMemberWithUser
	h.DB.Select(&members,
		`SELECT gm.group_id, gm.user_id, gm.role, gm.joined_at, u.name, u.email
		 FROM group_members gm JOIN users u ON gm.user_id = u.id
		 WHERE gm.group_id = $1`, groupID,
	)
	if members == nil {
		members = []models.GroupMemberWithUser{}
	}

	c.JSON(http.StatusOK, gin.H{"group": group, "members": members})
}

type updateGroupRequest struct {
	Name     string `json:"name" binding:"required"`
	Currency string `json:"currency"`
}

func (h *GroupHandler) Update(c *gin.Context) {
	userID := c.GetInt("userID")
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}

	if !h.isAdmin(groupID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can update the group"})
		return
	}

	var req updateGroupRequest
	if err := c.ShouldBindJSON(&req); err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Name is required"})
		return
	}

	// Check if any member of this group is already in another group with the new name
	var conflictingUsers int
	err = h.DB.Get(&conflictingUsers, `
		SELECT COUNT(DISTINCT gm1.user_id)
		FROM group_members gm1
		JOIN group_members gm2 ON gm1.user_id = gm2.user_id
		JOIN groups g2 ON gm2.group_id = g2.id
		WHERE gm1.group_id = $1 AND g2.id != $1 AND g2.name = $2 AND g2.deleted_at IS NULL
	`, groupID, req.Name)
	if err == nil && conflictingUsers > 0 {
		c.JSON(http.StatusBadRequest, gin.H{"error": "One or more members are already in another group with this name"})
		return
	}

	var group models.Group
	currency := req.Currency
	if currency == "" {
		currency = "INR"
	}
	err = h.DB.Get(&group, "UPDATE groups SET name = $1, currency = $2 WHERE id = $3 AND deleted_at IS NULL RETURNING *", req.Name, currency, groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to update group"})
		return
	}

	c.JSON(http.StatusOK, group)
}

func (h *GroupHandler) Delete(c *gin.Context) {
	userID := c.GetInt("userID")
	groupID, err := strconv.Atoi(c.Param("id"))
	if err != nil {
		c.JSON(http.StatusBadRequest, gin.H{"error": "Invalid group ID"})
		return
	}

	if !h.isAdmin(groupID, userID) {
		c.JSON(http.StatusForbidden, gin.H{"error": "Only admins can delete the group"})
		return
	}

	tx, err := h.DB.Beginx()
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete group"})
		return
	}
	defer tx.Rollback()

	var group models.Group
	if err := tx.Get(&group, "SELECT * FROM groups WHERE id = $1 AND deleted_at IS NULL FOR UPDATE", groupID); err != nil {
		c.JSON(http.StatusNotFound, gin.H{"error": "Group not found"})
		return
	}

	actorName := h.userName(userID)
	summary := fmt.Sprintf("%s deleted group %s", actorName, group.Name)
	var activityID int
	if err := tx.Get(&activityID,
		`INSERT INTO group_activity (group_id, user_id, action, summary, revert_deadline)
		 VALUES ($1, $2, 'delete_group', $3, NOW() + INTERVAL '30 days') RETURNING id`,
		groupID, userID, summary,
	); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create delete activity"})
		return
	}

	var memberIDs []int
	if err := tx.Select(&memberIDs, "SELECT user_id FROM group_members WHERE group_id = $1", groupID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to load group members"})
		return
	}
	participants := []activityParticipant{{UserID: userID, Role: "actor"}}
	for _, memberID := range memberIDs {
		participants = append(participants, activityParticipant{UserID: memberID, Role: "member"})
	}
	if err := recordActivityParticipants(tx, activityID, participants); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to create delete activity"})
		return
	}

	if _, err := tx.Exec("UPDATE groups SET deleted_at = NOW(), deleted_by = $1 WHERE id = $2", userID, groupID); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete group"})
		return
	}
	if err := tx.Commit(); err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete group"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Group deleted", "activity_id": activityID})
}

func (h *GroupHandler) isMember(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, `SELECT COUNT(*) FROM group_members gm JOIN groups g ON g.id = gm.group_id
		WHERE gm.group_id = $1 AND gm.user_id = $2 AND g.deleted_at IS NULL`, groupID, userID)
	return count > 0
}

func (h *GroupHandler) isAdmin(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, `SELECT COUNT(*) FROM group_members gm JOIN groups g ON g.id = gm.group_id
		WHERE gm.group_id = $1 AND gm.user_id = $2 AND gm.role = 'admin' AND g.deleted_at IS NULL`, groupID, userID)
	return count > 0
}

func (h *GroupHandler) userName(userID int) string {
	var name string
	if err := h.DB.Get(&name, "SELECT name FROM users WHERE id = $1", userID); err != nil || strings.TrimSpace(name) == "" {
		return "Someone"
	}
	return name
}
