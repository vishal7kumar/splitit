package handlers_test

import (
	"context"
	"fmt"
	"net/http"
	"strings"
	"testing"
	"time"

	"splitit-api/internal/retention"

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
		if item["action"] == "delete_expense" {
			if int(item["expense_id"].(float64)) != expenseID {
				t.Fatalf("expected deleted expense activity to retain expense_id, got %#v", item)
			}
			if !item["is_involved"].(bool) {
				t.Fatalf("expected split participant to stay involved after expense delete: %#v", item)
			}
			if !item["can_revert"].(bool) {
				t.Fatalf("expected current member to be able to restore expense: %#v", item)
			}
			return
		}
	}
	t.Fatalf("expected delete activity in member feed: %#v", page.Items)
}

func TestRevertExpenseRestoresDataAndBalances(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	adminCookies := registerAndLogin(r, "restore-expense-admin@test.com", "pass123", "Admin")
	memberCookies := registerAndLogin(r, "restore-expense-member@test.com", "pass123", "Member")
	groupID := createGroup(t, r, adminCookies, "Restore Expense Group")
	addMember(t, r, adminCookies, groupID, "restore-expense-member@test.com")
	detail := getGroupDetail(t, r, adminCookies, groupID)
	adminID := memberIDByEmail(t, detail, "restore-expense-admin@test.com")
	memberID := memberIDByEmail(t, detail, "restore-expense-member@test.com")

	created := createExpense(t, r, adminCookies, groupID, map[string]interface{}{
		"amount": 80.0, "description": "Restorable dinner", "paid_by": adminID,
		"split_type": "equal", "splits": []map[string]interface{}{{"user_id": adminID}, {"user_id": memberID}},
	})
	expenseID := int(created["expense"].(map[string]interface{})["id"].(float64))
	addExpenseComment(t, r, adminCookies, groupID, expenseID, "Keep this comment")

	w := doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d/expenses/%d", groupID, expenseID), nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)
	var deleted map[string]interface{}
	decodeJSON(t, w, &deleted)
	activityID := int(deleted["activity_id"].(float64))

	balances := getBalances(t, r, memberCookies, groupID)
	assertBalance(t, balances, adminID, 0)
	assertBalance(t, balances, memberID, 0)

	w = doJSON(r, "POST", fmt.Sprintf("/api/activity/%d/revert", activityID), nil, memberCookies...)
	assertStatus(t, w, http.StatusOK)

	restored := getExpenseDetail(t, r, memberCookies, groupID, expenseID)
	if len(restored["comments"].([]interface{})) != 1 || len(restored["history"].([]interface{})) != 2 {
		t.Fatalf("expected comments and history to survive restore, got %#v", restored)
	}
	balances = getBalances(t, r, memberCookies, groupID)
	assertBalance(t, balances, adminID, 40)
	assertBalance(t, balances, memberID, -40)

	w = doJSON(r, "POST", fmt.Sprintf("/api/activity/%d/revert", activityID), nil, memberCookies...)
	assertStatus(t, w, http.StatusConflict)
}

func TestRevertGroupRequiresAdminAndRenamesOnConflict(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	adminCookies := registerAndLogin(r, "restore-group-admin@test.com", "pass123", "Admin")
	memberCookies := registerAndLogin(r, "restore-group-member@test.com", "pass123", "Member")
	groupID := createGroup(t, r, adminCookies, "Holiday")
	addMember(t, r, adminCookies, groupID, "restore-group-member@test.com")
	originalDetail := getGroupDetail(t, r, adminCookies, groupID)
	adminID := memberIDByEmail(t, originalDetail, "restore-group-admin@test.com")
	memberID := memberIDByEmail(t, originalDetail, "restore-group-member@test.com")
	createExpense(t, r, adminCookies, groupID, map[string]interface{}{
		"amount": 60.0, "description": "Holiday dinner", "paid_by": adminID,
		"split_type": "equal", "splits": []map[string]interface{}{{"user_id": adminID}, {"user_id": memberID}},
	})

	w := doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d", groupID), nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)
	var deleted map[string]interface{}
	decodeJSON(t, w, &deleted)
	activityID := int(deleted["activity_id"].(float64))
	w = doJSON(r, "GET", "/api/groups", nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)
	var visibleGroups []map[string]interface{}
	decodeJSON(t, w, &visibleGroups)
	if len(visibleGroups) != 0 {
		t.Fatalf("expected deleted group to be hidden, got %#v", visibleGroups)
	}
	w = doJSON(r, "GET", "/api/user/total-balance", nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)
	var total map[string]interface{}
	decodeJSON(t, w, &total)
	if len(total["groups"].([]interface{})) != 0 {
		t.Fatalf("expected deleted group to be excluded from totals, got %#v", total)
	}

	memberPage := listUserActivity(t, r, memberCookies, "?limit=10")
	if len(memberPage.Items) == 0 || memberPage.Items[0]["can_revert"].(bool) {
		t.Fatalf("expected non-admin to see a non-actionable group deletion: %#v", memberPage.Items)
	}
	w = doJSON(r, "POST", fmt.Sprintf("/api/activity/%d/revert", activityID), nil, memberCookies...)
	assertStatus(t, w, http.StatusForbidden)

	createGroup(t, r, adminCookies, "Holiday")
	w = doJSON(r, "POST", fmt.Sprintf("/api/activity/%d/revert", activityID), nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)
	var restored map[string]interface{}
	decodeJSON(t, w, &restored)
	if restored["group_name"] != "Holiday (restored)" {
		t.Fatalf("expected deterministic restored name, got %#v", restored)
	}
	detail := getGroupDetail(t, r, memberCookies, groupID)
	if detail["group"].(map[string]interface{})["name"] != "Holiday (restored)" {
		t.Fatalf("expected member access to restored group, got %#v", detail)
	}
	if expenses := listExpenses(t, r, memberCookies, groupID, ""); len(expenses) != 1 || expenses[0]["description"] != "Holiday dinner" {
		t.Fatalf("expected group expenses to return with the restored group, got %#v", expenses)
	}
	balances := getBalances(t, r, memberCookies, groupID)
	assertBalance(t, balances, adminID, 30)
	assertBalance(t, balances, memberID, -30)
}

func TestRevertExpiredExpenseReturnsGone(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)
	cookies := registerAndLogin(r, "restore-expired@test.com", "pass123", "Admin")
	groupID := createGroup(t, r, cookies, "Expired Restore")
	detail := getGroupDetail(t, r, cookies, groupID)
	userID := memberIDByEmail(t, detail, "restore-expired@test.com")
	created := createExpense(t, r, cookies, groupID, map[string]interface{}{
		"amount": 10.0, "split_type": "equal", "splits": []map[string]interface{}{{"user_id": userID}},
	})
	expenseID := int(created["expense"].(map[string]interface{})["id"].(float64))
	w := doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d/expenses/%d", groupID, expenseID), nil, cookies...)
	assertStatus(t, w, http.StatusOK)
	var deleted map[string]interface{}
	decodeJSON(t, w, &deleted)
	activityID := int(deleted["activity_id"].(float64))
	_, err := database.Exec("UPDATE expenses SET deleted_at = NOW() - INTERVAL '31 days' WHERE id = $1", expenseID)
	if err != nil {
		t.Fatal(err)
	}
	_, err = database.Exec("UPDATE group_activity SET revert_deadline = NOW() - INTERVAL '1 day' WHERE id = $1", activityID)
	if err != nil {
		t.Fatal(err)
	}

	w = doJSON(r, "POST", fmt.Sprintf("/api/activity/%d/revert", activityID), nil, cookies...)
	assertStatus(t, w, http.StatusGone)
}

func TestRetentionCleanupPurgesExpiredDeletedRecords(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)
	cookies := registerAndLogin(r, "retention-cleanup@test.com", "pass123", "Admin")
	groupID := createGroup(t, r, cookies, "Retention Active Group")
	detail := getGroupDetail(t, r, cookies, groupID)
	userID := memberIDByEmail(t, detail, "retention-cleanup@test.com")
	created := createExpense(t, r, cookies, groupID, map[string]interface{}{
		"amount": 10.0, "split_type": "equal", "splits": []map[string]interface{}{{"user_id": userID}},
	})
	expenseID := int(created["expense"].(map[string]interface{})["id"].(float64))
	w := doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d/expenses/%d", groupID, expenseID), nil, cookies...)
	assertStatus(t, w, http.StatusOK)
	var deleted map[string]interface{}
	decodeJSON(t, w, &deleted)
	activityID := int(deleted["activity_id"].(float64))

	expiredGroupID := createGroup(t, r, cookies, "Retention Expired Group")
	w = doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d", expiredGroupID), nil, cookies...)
	assertStatus(t, w, http.StatusOK)

	now := time.Now().UTC()
	if _, err := database.Exec("UPDATE expenses SET deleted_at = $1 WHERE id = $2", now.Add(-31*24*time.Hour), expenseID); err != nil {
		t.Fatal(err)
	}
	if _, err := database.Exec("UPDATE groups SET deleted_at = $1 WHERE id = $2", now.Add(-31*24*time.Hour), expiredGroupID); err != nil {
		t.Fatal(err)
	}
	service := retention.NewService(database)
	service.Now = func() time.Time { return now }
	if err := service.Cleanup(context.Background()); err != nil {
		t.Fatal(err)
	}

	var count int
	database.Get(&count, "SELECT COUNT(*) FROM expenses WHERE id = $1", expenseID)
	if count != 0 {
		t.Fatal("expected expired deleted expense to be purged")
	}
	database.Get(&count, "SELECT COUNT(*) FROM groups WHERE id = $1", expiredGroupID)
	if count != 0 {
		t.Fatal("expected expired deleted group to be purged")
	}
	var referencedExpenseID *int
	if err := database.Get(&referencedExpenseID, "SELECT expense_id FROM group_activity WHERE id = $1", activityID); err != nil {
		t.Fatal(err)
	}
	if referencedExpenseID != nil {
		t.Fatalf("expected audit activity to remain with a cleared expense reference, got %d", *referencedExpenseID)
	}
}

func TestActivityReadAndUnreadCount(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	adminCookies := registerAndLogin(r, "activity-read-admin@test.com", "pass123", "Admin")

	// Initially unread count should be 0
	w := doJSON(r, "GET", "/api/user/activity/unread-count", nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)
	var resp map[string]interface{}
	decodeJSON(t, w, &resp)
	if resp["unread_count"].(float64) != 0 {
		t.Fatalf("expected 0 unread activity items, got %.0f", resp["unread_count"].(float64))
	}

	groupID := createGroup(t, r, adminCookies, "Read Group")
	detail := getGroupDetail(t, r, adminCookies, groupID)
	adminID := memberIDByEmail(t, detail, "activity-read-admin@test.com")

	// Create an expense to generate activity
	createExpense(t, r, adminCookies, groupID, map[string]interface{}{
		"amount":      30.0,
		"description": "Admin tea",
		"paid_by":     adminID,
		"split_type":  "equal",
		"splits":      []map[string]interface{}{{"user_id": adminID}},
	})

	// Unread count should now be 1
	w = doJSON(r, "GET", "/api/user/activity/unread-count", nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)
	decodeJSON(t, w, &resp)
	if resp["unread_count"].(float64) != 1 {
		t.Fatalf("expected 1 unread activity item, got %.0f", resp["unread_count"].(float64))
	}

	// Fetch activities, verify 'is_new' is true
	page := listUserActivity(t, r, adminCookies, "?limit=10")
	if len(page.Items) != 1 { // only create expense = 1 activity item
		t.Fatalf("expected 1 activity item, got %d", len(page.Items))
	}
	for _, item := range page.Items {
		if !item["is_new"].(bool) {
			t.Fatalf("expected is_new to be true, got false")
		}
	}

	// Mark as read
	w = doJSON(r, "POST", "/api/user/activity/read", nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)

	// Unread count should now be 0
	w = doJSON(r, "GET", "/api/user/activity/unread-count", nil, adminCookies...)
	assertStatus(t, w, http.StatusOK)
	decodeJSON(t, w, &resp)
	if resp["unread_count"].(float64) != 0 {
		t.Fatalf("expected 0 unread activity items after marking as read, got %.0f", resp["unread_count"].(float64))
	}

	// Fetch activities again, verify 'is_new' is false
	page = listUserActivity(t, r, adminCookies, "?limit=10")
	for _, item := range page.Items {
		if item["is_new"].(bool) {
			t.Fatalf("expected is_new to be false after marking read, got true")
		}
	}
}
