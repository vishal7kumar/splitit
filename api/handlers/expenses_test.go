package handlers_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
)

func setupGroupWithMembers(t *testing.T) (*http.Cookie, int, int, int) {
	t.Helper()
	database := setupTestDB(t)
	r := setupRouter(database)

	// Register two users
	cookies := registerAndLogin(r, "exp-admin@test.com", "pass123", "Admin")
	doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": "exp-member@test.com", "password": "pass123", "name": "Member",
	})

	// Create group
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Expense Test Group"}, cookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))

	// Add second member
	doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/members", groupID),
		map[string]string{"email": "exp-member@test.com"}, cookies...)

	// Get user IDs
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	var adminID, memberID int
	for _, m := range members {
		mm := m.(map[string]interface{})
		if mm["email"] == "exp-admin@test.com" {
			adminID = int(mm["user_id"].(float64))
		} else {
			memberID = int(mm["user_id"].(float64))
		}
	}

	// Return first cookie only for simplicity
	return cookies[0], groupID, adminID, memberID
}

func TestCreateExpenseEqualSplit(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies := registerAndLogin(r, "eq-admin@test.com", "pass123", "Admin")
	doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": "eq-member@test.com", "password": "pass123", "name": "Member",
	})
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "EQ Group"}, cookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))
	doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/members", groupID),
		map[string]string{"email": "eq-member@test.com"}, cookies...)

	// Get member IDs
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	var ids []int
	for _, m := range members {
		ids = append(ids, int(m.(map[string]interface{})["user_id"].(float64)))
	}

	body := map[string]interface{}{
		"amount":      100.0,
		"description": "Dinner",
		"category":    "food",
		"split_type":  "equal",
		"splits":      []map[string]interface{}{{"user_id": ids[0]}, {"user_id": ids[1]}},
	}

	w = doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/expenses", groupID), body, cookies...)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	splits := resp["splits"].([]interface{})
	if len(splits) != 2 {
		t.Fatalf("expected 2 splits, got %d", len(splits))
	}
	for _, s := range splits {
		share := s.(map[string]interface{})["share_amount"].(float64)
		if share != 50.0 {
			t.Fatalf("expected 50.00 share, got %.2f", share)
		}
	}
}

func TestCreateExpenseExactSplit(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies := registerAndLogin(r, "ex-admin@test.com", "pass123", "Admin")
	doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": "ex-member@test.com", "password": "pass123", "name": "Member",
	})
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "EX Group"}, cookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))
	doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/members", groupID),
		map[string]string{"email": "ex-member@test.com"}, cookies...)

	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	id0 := int(members[0].(map[string]interface{})["user_id"].(float64))
	id1 := int(members[1].(map[string]interface{})["user_id"].(float64))

	body := map[string]interface{}{
		"amount":      100.0,
		"description": "Exact dinner",
		"split_type":  "exact",
		"splits": []map[string]interface{}{
			{"user_id": id0, "share_amount": 70.0},
			{"user_id": id1, "share_amount": 30.0},
		},
	}

	w = doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/expenses", groupID), body, cookies...)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}
}

func TestExactSplitMismatch(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies := registerAndLogin(r, "mis-admin@test.com", "pass123", "Admin")
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Mis Group"}, cookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))

	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	id0 := int(members[0].(map[string]interface{})["user_id"].(float64))

	body := map[string]interface{}{
		"amount":     100.0,
		"split_type": "exact",
		"splits":     []map[string]interface{}{{"user_id": id0, "share_amount": 80.0}},
	}
	w = doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/expenses", groupID), body, cookies...)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400, got %d: %s", w.Code, w.Body.String())
	}
}

func TestListExpensesWithSearch(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies := registerAndLogin(r, "search@test.com", "pass123", "Searcher")
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Search Group"}, cookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))

	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	uid := int(members[0].(map[string]interface{})["user_id"].(float64))

	// Create two expenses
	for _, desc := range []string{"Dinner at restaurant", "Uber ride"} {
		doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/expenses", groupID), map[string]interface{}{
			"amount": 50.0, "description": desc, "split_type": "equal",
			"splits": []map[string]interface{}{{"user_id": uid}},
		}, cookies...)
	}

	// List all
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d/expenses", groupID), nil, cookies...)
	var all []interface{}
	json.Unmarshal(w.Body.Bytes(), &all)
	if len(all) != 2 {
		t.Fatalf("expected 2 expenses, got %d", len(all))
	}

	// Search for "dinner"
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d/expenses?q=dinner", groupID), nil, cookies...)
	var filtered []interface{}
	json.Unmarshal(w.Body.Bytes(), &filtered)
	if len(filtered) != 1 {
		t.Fatalf("expected 1 expense matching 'dinner', got %d", len(filtered))
	}
}

func TestDeleteExpense(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies := registerAndLogin(r, "del-exp@test.com", "pass123", "Deleter")
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Del Exp Group"}, cookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))

	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	uid := int(members[0].(map[string]interface{})["user_id"].(float64))

	w = doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/expenses", groupID), map[string]interface{}{
		"amount": 25.0, "description": "To delete", "split_type": "equal",
		"splits": []map[string]interface{}{{"user_id": uid}},
	}, cookies...)
	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	expense := resp["expense"].(map[string]interface{})
	expenseID := int(expense["id"].(float64))

	w = doJSON(r, "DELETE", fmt.Sprintf("/api/groups/%d/expenses/%d", groupID, expenseID), nil, cookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	// Verify deleted
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d/expenses", groupID), nil, cookies...)
	var list []interface{}
	json.Unmarshal(w.Body.Bytes(), &list)
	if len(list) != 0 {
		t.Fatalf("expected 0 expenses after delete, got %d", len(list))
	}
}
