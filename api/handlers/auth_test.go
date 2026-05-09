package handlers_test

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestRegister(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	w := doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": "test@example.com", "password": "password123", "name": "Test User",
	})
	if w.Code != http.StatusCreated {
		t.Fatalf("expected 201, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["email"] != "test@example.com" {
		t.Fatalf("expected email test@example.com, got %v", resp["email"])
	}
	if _, exists := resp["password_hash"]; exists {
		t.Fatal("password_hash should not be in response")
	}
}

func TestRegisterDuplicate(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	body := map[string]string{
		"email": "dup@example.com", "password": "password123", "name": "Test",
	}
	doJSON(r, "POST", "/api/auth/register", body)
	w := doJSON(r, "POST", "/api/auth/register", body)
	if w.Code != http.StatusConflict {
		t.Fatalf("expected 409, got %d", w.Code)
	}
}

func TestLoginSuccess(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": "login@example.com", "password": "password123", "name": "Test",
	})

	w := doJSON(r, "POST", "/api/auth/login", map[string]string{
		"email": "login@example.com", "password": "password123",
	})
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	cookies := w.Result().Cookies()
	found := false
	for _, c := range cookies {
		if c.Name == "token" && c.Value != "" {
			found = true
			if c.MaxAge != 1800 {
				t.Fatalf("expected token cookie MaxAge 1800, got %d", c.MaxAge)
			}
		}
	}
	if !found {
		t.Fatal("expected token cookie to be set")
	}
}

func TestLoginWrongPassword(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	doJSON(r, "POST", "/api/auth/register", map[string]string{
		"email": "wrong@example.com", "password": "password123", "name": "Test",
	})

	w := doJSON(r, "POST", "/api/auth/login", map[string]string{
		"email": "wrong@example.com", "password": "wrongpassword",
	})
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}

func TestMe(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	cookies := registerAndLogin(r, "me@example.com", "password123", "Me User")

	w := doJSON(r, "GET", "/api/auth/me", nil, cookies...)
	if w.Code != http.StatusOK {
		t.Fatalf("expected 200, got %d: %s", w.Code, w.Body.String())
	}

	var resp map[string]interface{}
	json.Unmarshal(w.Body.Bytes(), &resp)
	if resp["email"] != "me@example.com" {
		t.Fatalf("expected me@example.com, got %v", resp["email"])
	}
}

func TestMeWithoutAuth(t *testing.T) {
	database := setupTestDB(t)
	r := setupRouter(database)

	w := doJSON(r, "GET", "/api/auth/me", nil)
	if w.Code != http.StatusUnauthorized {
		t.Fatalf("expected 401, got %d", w.Code)
	}
}
