package handlers_test

import (
	"net/http"
	"testing"

	"github.com/gin-gonic/gin"
)

func TestIntegrationCriticalAPIFlow(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	w := doJSON(r, "GET", "/api/auth/me", nil)
	assertStatus(t, w, http.StatusUnauthorized)

	registerUser(t, r, "alice.integration@test.com", "pass123", "Alice")
	registerUser(t, r, "bob.integration@test.com", "pass123", "Bob")
	registerUser(t, r, "outsider.integration@test.com", "pass123", "Outsider")

	aliceCookies := loginUser(t, r, "alice.integration@test.com", "pass123")
	bobCookies := loginUser(t, r, "bob.integration@test.com", "pass123")
	outsiderCookies := loginUser(t, r, "outsider.integration@test.com", "pass123")

	groupID := createGroup(t, r, aliceCookies, "Critical Flow Group")
	addMember(t, r, aliceCookies, groupID, "bob.integration@test.com")

	w = doJSON(r, "GET", "/api/groups/"+itoa(groupID), nil, outsiderCookies...)
	assertStatus(t, w, http.StatusForbidden)

	detail := getGroupDetail(t, r, aliceCookies, groupID)
	members := detail["members"].([]interface{})
	if len(members) != 2 {
		t.Fatalf("expected 2 group members, got %d", len(members))
	}
	aliceID := memberIDByEmail(t, detail, "alice.integration@test.com")
	bobID := memberIDByEmail(t, detail, "bob.integration@test.com")

	w = doJSON(r, "POST", "/api/groups/"+itoa(groupID)+"/expenses", map[string]interface{}{
		"amount":     100.0,
		"split_type": "exact",
		"splits": []map[string]interface{}{
			{"user_id": aliceID, "share_amount": 40.0},
			{"user_id": bobID, "share_amount": 40.0},
		},
	}, aliceCookies...)
	assertStatus(t, w, http.StatusBadRequest)

	dinner := createExpense(t, r, aliceCookies, groupID, map[string]interface{}{
		"amount":      100.0,
		"description": "Dinner",
		"category":    "food",
		"split_type":  "equal",
		"splits": []map[string]interface{}{
			{"user_id": aliceID},
			{"user_id": bobID},
		},
	})
	assertExpenseSplitCount(t, dinner, 2)

	ride := createExpense(t, r, bobCookies, groupID, map[string]interface{}{
		"amount":      30.0,
		"description": "Airport ride",
		"category":    "transport",
		"paid_by":     bobID,
		"split_type":  "equal",
		"splits": []map[string]interface{}{
			{"user_id": aliceID},
			{"user_id": bobID},
		},
	})
	assertExpenseSplitCount(t, ride, 2)

	expenses := listExpenses(t, r, aliceCookies, groupID, "")
	if len(expenses) != 2 {
		t.Fatalf("expected 2 expenses, got %d", len(expenses))
	}

	expenses = listExpenses(t, r, aliceCookies, groupID, "?q=dinner")
	if len(expenses) != 1 || expenses[0]["description"] != "Dinner" {
		t.Fatalf("expected dinner search to return Dinner only, got %#v", expenses)
	}

	expenses = listExpenses(t, r, aliceCookies, groupID, "?category=transport")
	if len(expenses) != 1 || expenses[0]["category"] != "transport" {
		t.Fatalf("expected category filter to return one transport expense, got %#v", expenses)
	}

	balances := getBalances(t, r, aliceCookies, groupID)
	assertBalance(t, balances, aliceID, 35.0)
	assertBalance(t, balances, bobID, -35.0)
	assertDebt(t, balances, bobID, aliceID, 35.0)

	settlement := createSettlement(t, r, bobCookies, groupID, aliceID, 20.0)
	if int(settlement["paid_by"].(float64)) != bobID || int(settlement["paid_to"].(float64)) != aliceID {
		t.Fatalf("expected Bob to settle with Alice, got %#v", settlement)
	}

	balances = getBalances(t, r, aliceCookies, groupID)
	assertBalance(t, balances, aliceID, 15.0)
	assertBalance(t, balances, bobID, -15.0)
	assertDebt(t, balances, bobID, aliceID, 15.0)

	w = doJSON(r, "GET", "/api/user/total-balance", nil, aliceCookies...)
	assertStatus(t, w, http.StatusOK)
	var total map[string]interface{}
	decodeJSON(t, w, &total)
	if total["total_balance"].(float64) != 15.0 {
		t.Fatalf("expected Alice total balance 15.00, got %#v", total)
	}
}

func assertExpenseSplitCount(t *testing.T, resp map[string]interface{}, expected int) {
	t.Helper()
	splits := resp["splits"].([]interface{})
	if len(splits) != expected {
		t.Fatalf("expected %d splits, got %d", expected, len(splits))
	}
}

func getBalances(t *testing.T, r *gin.Engine, cookies []*http.Cookie, groupID int) map[string]interface{} {
	t.Helper()
	w := doJSON(r, "GET", "/api/groups/"+itoa(groupID)+"/balances", nil, cookies...)
	assertStatus(t, w, http.StatusOK)

	var resp map[string]interface{}
	decodeJSON(t, w, &resp)
	return resp
}

func assertBalance(t *testing.T, resp map[string]interface{}, userID int, expected float64) {
	t.Helper()
	for _, b := range resp["balances"].([]interface{}) {
		balance := b.(map[string]interface{})
		if int(balance["user_id"].(float64)) == userID {
			if balance["balance"].(float64) != expected {
				t.Fatalf("expected user %d balance %.2f, got %.2f", userID, expected, balance["balance"].(float64))
			}
			return
		}
	}
	t.Fatalf("balance for user %d not found in %#v", userID, resp)
}

func assertDebt(t *testing.T, resp map[string]interface{}, from, to int, amount float64) {
	t.Helper()
	debts := resp["debts"].([]interface{})
	if len(debts) != 1 {
		t.Fatalf("expected 1 debt, got %d", len(debts))
	}
	debt := debts[0].(map[string]interface{})
	if int(debt["from"].(float64)) != from || int(debt["to"].(float64)) != to || debt["amount"].(float64) != amount {
		t.Fatalf("expected debt %d -> %d for %.2f, got %#v", from, to, amount, debt)
	}
}
