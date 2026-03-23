#!/usr/bin/env bash
# Integration tests — run against a live server on localhost:8080
# Usage: bash api/test_integration.sh
set -euo pipefail

BASE="${API_URL:-http://localhost:8080}"
PASS=0
FAIL=0

check() {
  local desc="$1" expected_code="$2" actual_code="$3" body="$4"
  if [ "$actual_code" = "$expected_code" ]; then
    echo "  PASS: $desc (HTTP $actual_code)"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: $desc — expected $expected_code, got $actual_code"
    echo "        $body"
    FAIL=$((FAIL + 1))
  fi
}

RAND=$RANDOM
EMAIL="inttest-${RAND}@example.com"
EMAIL2="inttest2-${RAND}@example.com"

echo "=== Auth ==="

BODY=$(curl -s -w "\n%{http_code}" -X POST "$BASE/api/auth/register" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"testpass123\",\"name\":\"Test User\"}")
CODE=$(echo "$BODY" | tail -1)
BODY=$(echo "$BODY" | sed '$d')
check "Register" "201" "$CODE" "$BODY"

RESP=$(curl -s -w "\n%{http_code}" -c /tmp/inttest-cookies-$RAND -X POST "$BASE/api/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"testpass123\"}")
CODE=$(echo "$RESP" | tail -1)
check "Login" "200" "$CODE" ""

RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/auth/me")
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
check "Get /auth/me" "200" "$CODE" "$BODY"

RESP=$(curl -s -w "\n%{http_code}" "$BASE/api/auth/me")
CODE=$(echo "$RESP" | tail -1)
check "Get /auth/me without cookie → 401" "401" "$CODE" ""

echo ""
echo "=== Groups ==="

RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND -X POST "$BASE/api/groups" \
  -H "Content-Type: application/json" \
  -d '{"name":"Integration Test Group"}')
CODE=$(echo "$RESP" | tail -1)
BODY=$(echo "$RESP" | sed '$d')
check "Create group" "201" "$CODE" "$BODY"
GROUP_ID=$(echo "$BODY" | python3 -c "import sys,json; print(json.load(sys.stdin)['id'])" 2>/dev/null || echo "")

RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/groups")
CODE=$(echo "$RESP" | tail -1)
check "List groups" "200" "$CODE" ""

if [ -n "$GROUP_ID" ]; then
  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/groups/$GROUP_ID")
  CODE=$(echo "$RESP" | tail -1)
  check "Get group detail" "200" "$CODE" ""

  echo ""
  echo "=== Members ==="

  curl -s -o /dev/null -X POST "$BASE/api/auth/register" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL2\",\"password\":\"testpass123\",\"name\":\"Member User\"}"

  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND -X POST "$BASE/api/groups/$GROUP_ID/members" \
    -H "Content-Type: application/json" \
    -d "{\"email\":\"$EMAIL2\"}")
  CODE=$(echo "$RESP" | tail -1)
  check "Add member" "200" "$CODE" ""

  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/groups/$GROUP_ID")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  MEMBER_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['members']))" 2>/dev/null || echo "0")
  if [ "$MEMBER_COUNT" = "2" ]; then
    echo "  PASS: Group has 2 members after add"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: Expected 2 members, got $MEMBER_COUNT"
    FAIL=$((FAIL + 1))
  fi
  echo ""
  echo "=== Expenses ==="

  # Get member user IDs
  ADMIN_UID=$(echo "$BODY" | python3 -c "import sys,json; ms=json.load(sys.stdin)['members']; print([m['user_id'] for m in ms if m['email'].startswith('inttest-${RAND}@')][0])" 2>/dev/null)
  MEMBER_UID=$(echo "$BODY" | python3 -c "import sys,json; ms=json.load(sys.stdin)['members']; print([m['user_id'] for m in ms if m['email'].startswith('inttest2-${RAND}@')][0])" 2>/dev/null)

  # Create expense with equal split
  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND -X POST "$BASE/api/groups/$GROUP_ID/expenses" \
    -H "Content-Type: application/json" \
    -d "{\"amount\":100,\"description\":\"Dinner\",\"category\":\"food\",\"split_type\":\"equal\",\"splits\":[{\"user_id\":$ADMIN_UID},{\"user_id\":$MEMBER_UID}]}")
  CODE=$(echo "$RESP" | tail -1)
  check "Create expense (equal split)" "201" "$CODE" ""

  # Create another expense
  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND -X POST "$BASE/api/groups/$GROUP_ID/expenses" \
    -H "Content-Type: application/json" \
    -d "{\"amount\":30,\"description\":\"Uber ride\",\"category\":\"transport\",\"split_type\":\"equal\",\"splits\":[{\"user_id\":$ADMIN_UID},{\"user_id\":$MEMBER_UID}]}")
  CODE=$(echo "$RESP" | tail -1)
  check "Create expense (transport)" "201" "$CODE" ""

  # List all expenses
  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/groups/$GROUP_ID/expenses")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  check "List expenses" "200" "$CODE" ""
  EXP_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$EXP_COUNT" = "2" ]; then
    echo "  PASS: Found 2 expenses"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: Expected 2 expenses, got $EXP_COUNT"
    FAIL=$((FAIL + 1))
  fi

  # Search expenses
  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/groups/$GROUP_ID/expenses?q=dinner")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  SEARCH_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$SEARCH_COUNT" = "1" ]; then
    echo "  PASS: Search found 1 expense for 'dinner'"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: Expected 1 expense for 'dinner', got $SEARCH_COUNT"
    FAIL=$((FAIL + 1))
  fi

  # Filter by category
  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/groups/$GROUP_ID/expenses?category=transport")
  CODE=$(echo "$RESP" | tail -1)
  BODY=$(echo "$RESP" | sed '$d')
  CAT_COUNT=$(echo "$BODY" | python3 -c "import sys,json; print(len(json.load(sys.stdin)))" 2>/dev/null || echo "0")
  if [ "$CAT_COUNT" = "1" ]; then
    echo "  PASS: Category filter found 1 transport expense"
    PASS=$((PASS + 1))
  else
    echo "  FAIL: Expected 1 transport expense, got $CAT_COUNT"
    FAIL=$((FAIL + 1))
  fi

  # Delete expense
  EXP_ID=$(curl -s -b /tmp/inttest-cookies-$RAND "$BASE/api/groups/$GROUP_ID/expenses" | python3 -c "import sys,json; print(json.load(sys.stdin)[0]['id'])" 2>/dev/null)
  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND -X DELETE "$BASE/api/groups/$GROUP_ID/expenses/$EXP_ID")
  CODE=$(echo "$RESP" | tail -1)
  check "Delete expense" "200" "$CODE" ""

  # Future date should be rejected
  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND -X POST "$BASE/api/groups/$GROUP_ID/expenses" \
    -H "Content-Type: application/json" \
    -d "{\"amount\":10,\"description\":\"Future\",\"date\":\"2099-01-01\",\"split_type\":\"equal\",\"splits\":[{\"user_id\":$ADMIN_UID}]}")
  CODE=$(echo "$RESP" | tail -1)
  check "Reject future date expense" "400" "$CODE" ""

  echo ""
  echo "=== Balances ==="

  # Re-create an expense for balance testing
  curl -s -o /dev/null -b /tmp/inttest-cookies-$RAND -X POST "$BASE/api/groups/$GROUP_ID/expenses" \
    -H "Content-Type: application/json" \
    -d "{\"amount\":100,\"description\":\"Balance test\",\"split_type\":\"equal\",\"splits\":[{\"user_id\":$ADMIN_UID},{\"user_id\":$MEMBER_UID}]}"

  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/groups/$GROUP_ID/balances")
  CODE=$(echo "$RESP" | tail -1)
  check "Get group balances" "200" "$CODE" ""

  echo ""
  echo "=== Settlements ==="

  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND -X POST "$BASE/api/groups/$GROUP_ID/settlements" \
    -H "Content-Type: application/json" \
    -d "{\"paid_to\":$MEMBER_UID,\"amount\":25}")
  CODE=$(echo "$RESP" | tail -1)
  check "Create settlement" "201" "$CODE" ""

  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/groups/$GROUP_ID/settlements")
  CODE=$(echo "$RESP" | tail -1)
  check "List settlements" "200" "$CODE" ""

  # Total balance
  RESP=$(curl -s -w "\n%{http_code}" -b /tmp/inttest-cookies-$RAND "$BASE/api/user/total-balance")
  CODE=$(echo "$RESP" | tail -1)
  check "Get total balance" "200" "$CODE" ""
fi

# Cleanup
rm -f /tmp/inttest-cookies-$RAND

echo ""
echo "================================"
echo "Results: $PASS passed, $FAIL failed"
if [ "$FAIL" -gt 0 ]; then
  exit 1
fi
echo "All integration tests passed!"
