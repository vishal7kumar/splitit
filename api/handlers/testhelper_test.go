package handlers_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"strconv"
	"testing"

	"splitit-api/db"
	"splitit-api/router"

	"github.com/gin-gonic/gin"
	"github.com/jmoiron/sqlx"
)

func init() {
	gin.SetMode(gin.TestMode)
}

func setupTestDB(t *testing.T) *sqlx.DB {
	t.Helper()
	dsn := os.Getenv("TEST_DATABASE_URL")
	if dsn == "" {
		dsn = "postgres://postgres:pass@localhost:5432/myapp_test?sslmode=disable"
	}
	database, err := db.Connect(dsn)
	if err != nil {
		t.Fatalf("Failed to connect to test database: %v", err)
	}
	if err := db.Migrate(database); err != nil {
		t.Fatalf("Failed to migrate: %v", err)
	}
	_, err = database.Exec(
		"TRUNCATE expense_comments, expense_history, expense_splits, expenses, settlements, group_members, groups, users RESTART IDENTITY CASCADE",
	)
	if err != nil {
		t.Fatalf("Failed to clean test database: %v", err)
	}
	t.Cleanup(func() { database.Close() })
	return database
}

func setupRouter(database *sqlx.DB) *gin.Engine {
	os.Setenv("JWT_SECRET", "test-secret")
	os.Setenv("ENV", "test")
	return router.Setup(database)
}

func doJSON(r *gin.Engine, method, path string, body interface{}, cookies ...*http.Cookie) *httptest.ResponseRecorder {
	var reqBody *bytes.Buffer
	if body != nil {
		b, _ := json.Marshal(body)
		reqBody = bytes.NewBuffer(b)
	} else {
		reqBody = &bytes.Buffer{}
	}
	req := httptest.NewRequest(method, path, reqBody)
	req.Header.Set("Content-Type", "application/json")
	for _, c := range cookies {
		req.AddCookie(c)
	}
	w := httptest.NewRecorder()
	r.ServeHTTP(w, req)
	return w
}

func registerAndLogin(r *gin.Engine, email, password, name string) []*http.Cookie {
	doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": email, "password": password, "name": name,
	})
	w := doJSON(r, "POST", "/api/auth/login", map[string]string{
		"email": email, "password": password,
	})
	return w.Result().Cookies()
}

func assertStatus(t *testing.T, w *httptest.ResponseRecorder, expected int) {
	t.Helper()
	if w.Code != expected {
		t.Fatalf("expected HTTP %d, got %d: %s", expected, w.Code, w.Body.String())
	}
}

func decodeJSON(t *testing.T, w *httptest.ResponseRecorder, dst interface{}) {
	t.Helper()
	if err := json.Unmarshal(w.Body.Bytes(), dst); err != nil {
		t.Fatalf("failed to decode JSON response %q: %v", w.Body.String(), err)
	}
}

func registerUser(t *testing.T, r *gin.Engine, email, password, name string) map[string]interface{} {
	t.Helper()
	w := doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": email, "password": password, "name": name,
	})
	assertStatus(t, w, http.StatusCreated)

	var user map[string]interface{}
	decodeJSON(t, w, &user)
	return user
}

func loginUser(t *testing.T, r *gin.Engine, email, password string) []*http.Cookie {
	t.Helper()
	w := doJSON(r, "POST", "/api/auth/login", map[string]string{
		"email": email, "password": password,
	})
	assertStatus(t, w, http.StatusOK)
	return w.Result().Cookies()
}

func createGroup(t *testing.T, r *gin.Engine, cookies []*http.Cookie, name string) int {
	t.Helper()
	w := doJSON(r, "POST", "/api/groups", map[string]string{"name": name}, cookies...)
	assertStatus(t, w, http.StatusCreated)

	var group map[string]interface{}
	decodeJSON(t, w, &group)
	return int(group["id"].(float64))
}

func addMember(t *testing.T, r *gin.Engine, cookies []*http.Cookie, groupID int, email string) {
	t.Helper()
	w := doJSON(r, "POST", "/api/groups/"+itoa(groupID)+"/members", map[string]string{"email": email}, cookies...)
	assertStatus(t, w, http.StatusOK)
}

func getGroupDetail(t *testing.T, r *gin.Engine, cookies []*http.Cookie, groupID int) map[string]interface{} {
	t.Helper()
	w := doJSON(r, "GET", "/api/groups/"+itoa(groupID), nil, cookies...)
	assertStatus(t, w, http.StatusOK)

	var detail map[string]interface{}
	decodeJSON(t, w, &detail)
	return detail
}

func memberIDByEmail(t *testing.T, detail map[string]interface{}, email string) int {
	t.Helper()
	members := detail["members"].([]interface{})
	for _, m := range members {
		member := m.(map[string]interface{})
		if member["email"] == email {
			return int(member["user_id"].(float64))
		}
	}
	t.Fatalf("member %s not found in group detail", email)
	return 0
}

func createExpense(t *testing.T, r *gin.Engine, cookies []*http.Cookie, groupID int, body map[string]interface{}) map[string]interface{} {
	t.Helper()
	w := doJSON(r, "POST", "/api/groups/"+itoa(groupID)+"/expenses", body, cookies...)
	assertStatus(t, w, http.StatusCreated)

	var resp map[string]interface{}
	decodeJSON(t, w, &resp)
	return resp
}

func listExpenses(t *testing.T, r *gin.Engine, cookies []*http.Cookie, groupID int, query string) []map[string]interface{} {
	t.Helper()
	path := "/api/groups/" + itoa(groupID) + "/expenses" + query
	w := doJSON(r, "GET", path, nil, cookies...)
	assertStatus(t, w, http.StatusOK)

	var expenses []map[string]interface{}
	decodeJSON(t, w, &expenses)
	return expenses
}

func getExpenseDetail(t *testing.T, r *gin.Engine, cookies []*http.Cookie, groupID, expenseID int) map[string]interface{} {
	t.Helper()
	w := doJSON(r, "GET", "/api/groups/"+itoa(groupID)+"/expenses/"+itoa(expenseID), nil, cookies...)
	assertStatus(t, w, http.StatusOK)

	var detail map[string]interface{}
	decodeJSON(t, w, &detail)
	return detail
}

func addExpenseComment(t *testing.T, r *gin.Engine, cookies []*http.Cookie, groupID, expenseID int, body string) map[string]interface{} {
	t.Helper()
	w := doJSON(r, "POST", "/api/groups/"+itoa(groupID)+"/expenses/"+itoa(expenseID)+"/comments", map[string]string{"body": body}, cookies...)
	assertStatus(t, w, http.StatusCreated)

	var comment map[string]interface{}
	decodeJSON(t, w, &comment)
	return comment
}

func createSettlement(t *testing.T, r *gin.Engine, cookies []*http.Cookie, groupID int, paidTo int, amount float64) map[string]interface{} {
	t.Helper()
	w := doJSON(r, "POST", "/api/groups/"+itoa(groupID)+"/settlements", map[string]interface{}{
		"paid_to": paidTo,
		"amount":  amount,
	}, cookies...)
	assertStatus(t, w, http.StatusCreated)

	var settlement map[string]interface{}
	decodeJSON(t, w, &settlement)
	return settlement
}

func itoa(v int) string {
	return strconv.Itoa(v)
}
