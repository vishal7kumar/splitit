package handlers_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func TestCreateGroup(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)
	cookies := registerAndLogin(r, "group@example.com", "pass123", "Group User")

	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Trip to Goa"}, cookies...)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["name"] != "Trip to Goa" {
		t.Fatalf("expected name 'Trip to Goa', got %v", resp["name"])
	}
}

func TestListGroups(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)
	cookies := registerAndLogin(r, "list@example.com", "pass123", "List User")

	doJSON(r, "POST", "/api/groups", map[string]string{"name": "Group A"}, cookies...)
	doJSON(r, "POST", "/api/groups", map[string]string{"name": "Group B"}, cookies...)

	w := doJSON(r, "GET", "/api/groups", nil, cookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}

	var groups []map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &groups)
	if len(groups) != 2 {
		t.Fatalf("expected 2 groups, got %d", len(groups))
	}
}

func TestGetGroupWithMembers(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)
	cookies := registerAndLogin(r, "detail@example.com", "pass123", "Detail User")

	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Detail Group"}, cookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))

	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	members := resp["members"].([]interface{})
	if len(members) != 1 {
		t.Fatalf("expected 1 member (creator), got %d", len(members))
	}
}

func TestAddAndRemoveMember(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	// Create admin and another user
	adminCookies := registerAndLogin(r, "admin@example.com", "pass123", "Admin")
	doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": "member@example.com", "password": "pass123", "name": "Member",
	})

	// Create group
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Test Group"}, adminCookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))

	// Add member
	w = doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/members", groupID),
		map[string]string{"email": "member@example.com"}, adminCookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for add member, got %d: %s", w.Code, w.Body.String())
	}

	// Verify 2 members
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, adminCookies...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	if len(members) != 2 {
		t.Fatalf("expected 2 members, got %d", len(members))
	}

	// Find member user ID
	var memberUserID int
	for _, m := range members {
		mm := m.(map[string]interface{})
		if mm["email"] == "member@example.com" {
			memberUserID = int(mm["user_id"].(float64))
		}
	}

	// Remove member
	w = doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d/members/%d", groupID, memberUserID), nil, adminCookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200 for remove, got %d: %s", w.Code, w.Body.String())
	}
}

func TestNonMemberCannotAccessGroup(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	ownerCookies := registerAndLogin(r, "owner@example.com", "pass123", "Owner")
	outsiderCookies := registerAndLogin(r, "outsider@example.com", "pass123", "Outsider")

	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Private"}, ownerCookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))

	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, outsiderCookies...)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}
}

func TestDeleteGroupAdminOnly(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	adminCookies := registerAndLogin(r, "deladmin@example.com", "pass123", "Admin")
	memberCookies := registerAndLogin(r, "delmember@example.com", "pass123", "Member")

	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Del Group"}, adminCookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))

	// Add member
	doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/members", groupID),
		map[string]string{"email": "delmember@example.com"}, adminCookies...)

	// Member cannot delete
	w = doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d", groupID), nil, memberCookies...)
	if w.Code != http.StatusForbidden {
		t.Fatalf("expected 403, got %d", w.Code)
	}

	// Admin can delete
	w = doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d", groupID), nil, adminCookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}
}
