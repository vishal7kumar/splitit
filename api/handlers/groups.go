package handlers

import (
	"net/http"
	"strconv"

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
		 WHERE gm.user_id = $1
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
	if err := h.DB.Get(&group, "SELECT * FROM groups WHERE id = $1", groupID); err != nil {
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

	var group models.Group
	currency := req.Currency
	if currency == "" {
		currency = "INR"
	}
	err = h.DB.Get(&group, "UPDATE groups SET name = $1, currency = $2 WHERE id = $3 RETURNING *", req.Name, currency, groupID)
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

	_, err = h.DB.Exec("DELETE FROM groups WHERE id = $1", groupID)
	if err != nil {
		c.JSON(http.StatusInternalServerError, gin.H{"error": "Failed to delete group"})
		return
	}

	c.JSON(http.StatusOK, gin.H{"message": "Group deleted"})
}

func (h *GroupHandler) isMember(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID)
	return count > 0
}

func (h *GroupHandler) isAdmin(groupID, userID int) bool {
	var count int
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2 AND role = 'admin'", groupID, userID)
	return count > 0
}
