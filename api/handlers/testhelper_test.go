package handlers_test

import (
	"bytes"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
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
	// Clean tables in correct order (respect foreign keys)
	for _, table := range []string{"expense_splits", "expenses", "settlements", "group_members", "groups", "users"} {
		database.Exec(fmt.Sprintf("DELETE FROM %s", table))
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
