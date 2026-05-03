package handlers_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"
	"testing"
)

func TestGroupBalances(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies1 := registerAndLogin(r, "bal1@test.com", "pass123", "Alice")
	doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": "bal2@test.com", "password": "pass123", "name": "Bob",
	})

	// Create group and add Bob
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Balance Test"}, cookies1...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))
	doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/members", groupID),
		map[string]string{"email": "bal2@test.com"}, cookies1...)

	// Get member IDs
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies1...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	var aliceID, bobID int
	for _, m := range members {
		mm := m.(map[string]interface{})
		if mm["email"] == "bal1@test.com" {
			aliceID = int(mm["user_id"].(float64))
		} else {
			bobID = int(mm["user_id"].(float64))
		}
	}

	// Alice pays 100, split equally
	doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/expenses", groupID), map[string]interface{}{
		"amount": 100.0, "description": "Dinner", "split_type": "equal",
		"splits": []map[string]interface{}{{"user_id": aliceID}, {"user_id": bobID}},
	}, cookies1...)

	// Check balances
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d/balances", groupID), nil, cookies1...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)

	balances := resp["balances"].([]interface{})
	if len(balances) != 2 {
		t.Fatalf("expected 2 balances, got %d", len(balances))
	}

	// Alice should have +50 (paid 100, owes 50), Bob should have -50
	for _, b := range balances {
		bb := b.(map[string]interface{})
		uid := int(bb["user_id"].(float64))
		bal := bb["balance"].(float64)
		if uid == aliceID && bal != 50.0 {
			t.Fatalf("expected Alice balance +50, got %.2f", bal)
		}
		if uid == bobID && bal != -50.0 {
			t.Fatalf("expected Bob balance -50, got %.2f", bal)
		}
	}

	// Debts: Bob owes Alice 50
	debts := resp["debts"].([]interface{})
	if len(debts) != 1 {
		t.Fatalf("expected 1 debt, got %d", len(debts))
	}
	debt := debts[0].(map[string]interface{})
	if int(debt["from"].(float64)) != bobID {
		t.Fatal("expected Bob as debtor")
	}
	if debt["amount"].(float64) != 50.0 {
		t.Fatalf("expected debt amount 50, got %.2f", debt["amount"].(float64))
	}
}

func TestSettlement(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies1 := registerAndLogin(r, "sett1@test.com", "pass123", "Alice")
	cookies2 := registerAndLogin(r, "sett2@test.com", "pass123", "Bob")

	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Settle Test"}, cookies1...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))
	doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/members", groupID),
		map[string]string{"email": "sett2@test.com"}, cookies1...)

	// Get Alice's ID
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies1...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	var aliceID int
	for _, m := range members {
		mm := m.(map[string]interface{})
		if mm["email"] == "sett1@test.com" {
			aliceID = int(mm["user_id"].(float64))
		}
	}

	// Bob settles with Alice
	w = doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/settlements", groupID),
		map[string]interface{}{"paid_to": aliceID, "amount": 25.0}, cookies2...)
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	// List settlements
	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d/settlements", groupID), nil, cookies1...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d", w.Code)
	}
	var settList []interface{}
	json.Unmarshal(w.Body.Bytes(), &settList)
	if len(settList) != 1 {
		t.Fatalf("expected 1 settlement, got %d", len(settList))
	}

	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d/activity", groupID), nil, cookies1...)
	assertStatus(t, w, http.StatusOK)
	var activity []map[string]interface{}
	decodeJSON(t, w, &activity)
	if len(activity) != 1 {
		t.Fatalf("expected 1 settlement activity, got %d", len(activity))
	}
	entry := activity[0]
	if entry["action"] != "settlement" {
		t.Fatalf("expected settlement activity, got %#v", entry)
	}
	if entry["expense_id"] != nil {
		t.Fatalf("expected settlement activity to have no expense_id, got %#v", entry["expense_id"])
	}
	summary := entry["summary"].(string)
	for _, want := range []string{"Bob", "Alice", "25.00", "settle up"} {
		if !strings.Contains(summary, want) {
			t.Fatalf("expected settlement activity summary to contain %q, got %q", want, summary)
		}
	}
}

func TestFutureDateExpenseRejected(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies := registerAndLogin(r, "future@test.com", "pass123", "Future")
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": "Future Test"}, cookies...)
	var group map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &group)
	groupID := int(group["id"].(float64))

	w = doJSON(r, "GET", fmt.Sprintf("/api/groups/%d", groupID), nil, cookies...)
	var detail map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &detail)
	members := detail["members"].([]interface{})
	uid := int(members[0].(map[string]interface{})["user_id"].(float64))

	w = doJSON(r, "POST", fmt.Sprintf("/api/groups/%d/expenses", groupID), map[string]interface{}{
		"amount": 50.0, "description": "Future expense", "date": "2099-01-01",
		"split_type": "equal", "splits": []map[string]interface{}{{"user_id": uid}},
	}, cookies...)
	if w.Code != http.StatusBadRequest {
		t.Fatalf("expected 400 for future date, got %d: %s", w.Code, w.Body.String())
	}
}

func TestTotalBalance(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies := registerAndLogin(r, "total@test.com", "pass123", "Total")
	w := doJSON(r, "GET", "/api/user/total-balance", nil, cookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["total_balance"].(float64) != 0 {
		t.Fatalf("expected 0 total balance for new user, got %v", resp["total_balance"])
	}
}

func TestFriendsBundleAndSettleAcrossGroups(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	aliceCookies := registerAndLogin(r, "friends-alice@test.com", "pass123", "Alice")
	bobCookies := registerAndLogin(r, "friends-bob@test.com", "pass123", "Bob")

	groupOneID := createGroup(t, r, aliceCookies, "Friends One")
	groupTwoID := createGroup(t, r, aliceCookies, "Friends Two")
	addMember(t, r, aliceCookies, groupOneID, "friends-bob@test.com")
	addMember(t, r, aliceCookies, groupTwoID, "friends-bob@test.com")

	detailOne := getGroupDetail(t, r, aliceCookies, groupOneID)
	aliceID := memberIDByEmail(t, detailOne, "friends-alice@test.com")
	bobID := memberIDByEmail(t, detailOne, "friends-bob@test.com")

	createExpense(t, r, aliceCookies, groupOneID, map[string]interface{}{
		"amount":      100.0,
		"description": "Group one dinner",
		"paid_by":     aliceID,
		"split_type":  "equal",
		"splits": []map[string]interface{}{
			{"user_id": aliceID},
			{"user_id": bobID},
		},
	})
	createExpense(t, r, aliceCookies, groupTwoID, map[string]interface{}{
		"amount":      60.0,
		"description": "Group two cab",
		"paid_by":     bobID,
		"split_type":  "equal",
		"splits": []map[string]interface{}{
			{"user_id": aliceID},
			{"user_id": bobID},
		},
	})

	w := doJSON(r, "GET", "/api/user/friends", nil, aliceCookies...)
	assertStatus(t, w, http.StatusOK)
	var friends []map[string]interface{}
	decodeJSON(t, w, &friends)
	if len(friends) != 1 {
		t.Fatalf("expected 1 friend, got %d", len(friends))
	}
	if friends[0]["total_balance"].(float64) != 20.0 {
		t.Fatalf("expected bundled balance +20, got %#v", friends[0]["total_balance"])
	}
	if len(friends[0]["groups"].([]interface{})) != 2 {
		t.Fatalf("expected 2 group breakups, got %#v", friends[0]["groups"])
	}

	w = doJSON(r, "POST", fmt.Sprintf("/api/user/friends/%d/settle", bobID), nil, aliceCookies...)
	assertStatus(t, w, http.StatusCreated)
	var settlements []map[string]interface{}
	decodeJSON(t, w, &settlements)
	if len(settlements) != 2 {
		t.Fatalf("expected 2 per-group settlements, got %d", len(settlements))
	}

	w = doJSON(r, "GET", "/api/user/friends", nil, aliceCookies...)
	assertStatus(t, w, http.StatusOK)
	decodeJSON(t, w, &friends)
	if friends[0]["total_balance"].(float64) != 0.0 {
		t.Fatalf("expected bundled balance to settle to 0, got %#v", friends[0]["total_balance"])
	}

	w = doJSON(r, "GET", "/api/user/friends", nil, bobCookies...)
	assertStatus(t, w, http.StatusOK)
	decodeJSON(t, w, &friends)
	if friends[0]["total_balance"].(float64) != 0.0 {
		t.Fatalf("expected reciprocal bundled balance to settle to 0, got %#v", friends[0]["total_balance"])
	}
}
