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
		        false AS is_involved
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
	                 ) AS is_involved
	          FROM group_activity ga
	          JOIN group_members gm ON gm.group_id = ga.group_id AND gm.user_id = $1
	          JOIN groups g ON g.id = ga.group_id
	          JOIN users u ON u.id = ga.user_id`
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
	h.DB.Get(&count, "SELECT COUNT(*) FROM group_members WHERE group_id = $1 AND user_id = $2", groupID, userID)
	return count > 0
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
