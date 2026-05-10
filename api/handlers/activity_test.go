package handlers_test

import (
	"fmt"
	"net/http"
	"strings"
	"testing"

	"github.com/gin-gonic/gin"
)

type userActivityPage struct {
	Items      []map[string]interface{} `json:"items"`
	NextCursor string                   `json:"next_cursor"`
}

func listUserActivity(t *testing.T, r *gin.Engine, cookies []*http.Cookie, query string) userActivityPage {
	t.Helper()
	w := doJSON(r, "GET", "/api/user/activity"+query, nil, cookies...)
	assertStatus(t, w, http.StatusOK)

	var page userActivityPage
	decodeJSON(t, w, &page)
	return page
}

func TestUserActivityVisibilityInvolvementAndPagination(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	adminCookies := registerAndLogin(r, "activity-admin@test.com", "pass123", "Admin")
	memberCookies := registerAndLogin(r, "activity-member@test.com", "pass123", "Member")
	registerAndLogin(r, "activity-third@test.com", "pass123", "Third")
	outsiderCookies := registerAndLogin(r, "activity-outsider@test.com", "pass123", "Outsider")

	groupID := createGroup(t, r, adminCookies, "Activity Group")
	addMember(t, r, adminCookies, groupID, "activity-member@test.com")
	addMember(t, r, adminCookies, groupID, "activity-third@test.com")
	detail := getGroupDetail(t, r, adminCookies, groupID)
	adminID := memberIDByEmail(t, detail, "activity-admin@test.com")
	memberID := memberIDByEmail(t, detail, "activity-member@test.com")
	thirdID := memberIDByEmail(t, detail, "activity-third@test.com")

	createExpense(t, r, memberCookies, groupID, map[string]interface{}{
		"amount":      80.0,
		"description": "Member lunch",
		"paid_by":     memberID,
		"split_type":  "equal",
		"splits": []map[string]interface{}{
			{"user_id": memberID},
			{"user_id": thirdID},
		},
	})
	createExpense(t, r, adminCookies, groupID, map[string]interface{}{
		"amount":      30.0,
		"description": "Admin tea",
		"paid_by":     adminID,
		"split_type":  "equal",
		"splits":      []map[string]interface{}{{"user_id": adminID}},
	})
	createSettlement(t, r, memberCookies, groupID, adminID, 10.0)

	page := listUserActivity(t, r, adminCookies, "?limit=2")
	if len(page.Items) != 2 {
		t.Fatalf("expected first page of 2 activity items, got %d", len(page.Items))
	}
	if page.NextCursor == "" {
		t.Fatalf("expected next cursor for first page")
	}
	secondPage := listUserActivity(t, r, adminCookies, "?limit=2&cursor="+page.NextCursor)
	if len(secondPage.Items) != 1 {
		t.Fatalf("expected second page of 1 activity item, got %d", len(secondPage.Items))
	}
	seen := map[float64]bool{}
	for _, item := range append(page.Items, secondPage.Items...) {
		id := item["id"].(float64)
		if seen[id] {
			t.Fatalf("duplicate activity id across pages: %.0f", id)
		}
		seen[id] = true
		if item["group_name"] != "Activity Group" {
			t.Fatalf("expected group name on activity item, got %#v", item)
		}
	}

	var foundNotInvolved bool
	var recipientInvolved bool
	for _, item := range append(page.Items, secondPage.Items...) {
		if strings.Contains(item["summary"].(string), "Member lunch") {
			foundNotInvolved = true
			if item["is_involved"].(bool) {
				t.Fatalf("expected admin not to be involved in member/third-only expense: %#v", item)
			}
		}
		if item["action"] == "settlement" && item["is_involved"].(bool) {
			recipientInvolved = true
		}
	}
	if !foundNotInvolved {
		t.Fatalf("expected to find unrelated group activity in admin feed")
	}
	if !recipientInvolved {
		t.Fatalf("expected settlement recipient to be involved in admin feed")
	}

	memberPage := listUserActivity(t, r, memberCookies, "?limit=10")
	if len(memberPage.Items) != 3 {
		t.Fatalf("expected member to see 3 group activities, got %d", len(memberPage.Items))
	}
	var settlementInvolved, splitInvolved bool
	for _, item := range memberPage.Items {
		if item["action"] == "settlement" && item["is_involved"].(bool) {
			settlementInvolved = true
		}
		if strings.Contains(item["summary"].(string), "Member lunch") && item["is_involved"].(bool) {
			splitInvolved = true
		}
	}
	if !settlementInvolved || !splitInvolved {
		t.Fatalf("expected member to be involved in settlement and split activity: %#v", memberPage.Items)
	}

	outsiderPage := listUserActivity(t, r, outsiderCookies, "?limit=10")
	if len(outsiderPage.Items) != 0 {
		t.Fatalf("expected outsider to see no group activity, got %#v", outsiderPage.Items)
	}
}

func TestDeletedExpenseActivityKeepsParticipantInvolvement(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	adminCookies := registerAndLogin(r, "delete-activity-admin@test.com", "pass123", "Admin")
	memberCookies := registerAndLogin(r, "delete-activity-member@test.com", "pass123", "Member")

	groupID := createGroup(t, r, adminCookies, "Delete Activity Group")
	addMember(t, r, adminCookies, groupID, "delete-activity-member@test.com")
	detail := getGroupDetail(t, r, adminCookies, groupID)
	adminID := memberIDByEmail(t, detail, "delete-activity-admin@test.com")
	memberID := memberIDByEmail(t, detail, "delete-activity-member@test.com")

	resp := createExpense(t, r, adminCookies, groupID, map[string]interface{}{
		"amount":      50.0,
		"description": "Deleted dinner",
		"paid_by":     adminID,
		"split_type":  "equal",
		"splits": []map[string]interface{}{
			{"user_id": adminID},
			{"user_id": memberID},
		},
	})
	expenseID := int(resp["expense"].(map[string]interface{})["id"].(float64))

	w := doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d/expenses/%d", groupID, expenseID), nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)

	page := listUserActivity(t, r, memberCookies, "?limit=10")
	for _, item := range page.Items {
		if item["action"] == "delete" {
			if item["expense_id"] != nil {
				t.Fatalf("expected deleted expense activity to have null expense_id, got %#v", item)
			}
			if !item["is_involved"].(bool) {
				t.Fatalf("expected split participant to stay involved after expense delete: %#v", item)
			}
			return
		}
	}
	t.Fatalf("expected delete activity in member feed: %#v", page.Items)
}
