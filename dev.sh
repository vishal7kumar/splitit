#!/usr/bin/env bash
# ==============================================================================
# SplitIt - Local Development Environment Script
# ==============================================================================
# Starts and manages the complete local developer stack:
#   1. PostgreSQL Docker container on port 5432 (db)
#   2. Go Gin API Server on port 8080 (api)
#   3. React Vite Web UI on port 5173 (web/ui)
#
# Usage:
#   ./dev.sh              # Start DB, API, and UI (default)
#   ./dev.sh up           # Alias for ./dev.sh
#   ./dev.sh down         # Stop DB container and terminate dev processes
#   ./dev.sh status       # Check status of local services and ports
#   ./dev.sh db           # Start only the database container
#   ./dev.sh api          # Start DB + Go API
#   ./dev.sh ui           # Start only the React UI
#   ./dev.sh --stop-db    # Start everything, and stop DB container on exit
# ==============================================================================

set -eo pipefail

PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DB_DIR="$PROJECT_ROOT/db"
API_DIR="$PROJECT_ROOT/api"
WEB_DIR="$PROJECT_ROOT/web"

# ANSI Colors
BOLD="\033[1m"
GREEN="\033[0;32m"
CYAN="\033[0;36m"
BLUE="\033[0;34m"
YELLOW="\033[0;33m"
MAGENTA="\033[0;35m"
RED="\033[0;31m"
RESET="\033[0m"

log_info() {
    echo -e "${BLUE}[INFO]${RESET} $1"
}

log_success() {
    echo -e "${GREEN}[SUCCESS]${RESET} $1"
}

log_warn() {
    echo -e "${YELLOW}[WARN]${RESET} $1"
}

log_error() {
    echo -e "${RED}[ERROR]${RESET} $1" >&2
}

API_PID=""
UI_PID=""
AUTO_STOP_DB=false

is_port_listening() {
    local port="$1"
    if command -v ss >/dev/null 2>&1; then
        if ss -tln | grep -qE ":$port\b"; then
            return 0
        fi
    fi
    if command -v lsof >/dev/null 2>&1; then
        if lsof -iTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1; then
            return 0
        fi
    fi
    return 1
}

cleanup() {
    # Disable trap to avoid recursion during shutdown
    trap - SIGINT SIGTERM EXIT

    echo ""
    log_info "Shutting down local development processes..."

    # 1. Terminate UI process tree (npm + vite)
    if [ -n "$UI_PID" ] && kill -0 "$UI_PID" 2>/dev/null; then
        pkill -P "$UI_PID" 2>/dev/null || true
        kill -TERM "$UI_PID" 2>/dev/null || true
    fi

    # 2. Terminate API process tree (go run + compiled binary)
    if [ -n "$API_PID" ] && kill -0 "$API_PID" 2>/dev/null; then
        pkill -P "$API_PID" 2>/dev/null || true
        kill -TERM "$API_PID" 2>/dev/null || true
    fi

    # 3. Ensure ports 8080 and 5173 are freed
    if command -v lsof >/dev/null 2>&1; then
        local pids
        pids=$(lsof -ti :8080,5173 2>/dev/null || true)
        if [ -n "$pids" ]; then
            kill -TERM $pids 2>/dev/null || true
            sleep 0.5
            kill -9 $pids 2>/dev/null || true
        fi
    fi

    [ -n "$API_PID" ] && wait "$API_PID" 2>/dev/null || true
    [ -n "$UI_PID" ] && wait "$UI_PID" 2>/dev/null || true

    log_success "API and UI have stopped."

    # 4. Handle DB container shutdown
    if [ "$AUTO_STOP_DB" = true ]; then
        log_info "Stopping database container..."
        (cd "$DB_DIR" && docker compose down)
        log_success "Database container stopped."
    else
        echo ""
        log_info "Database container (${CYAN}splitit-postgres${RESET}) remains running in background."
        log_info "To stop it, run: ${BOLD}./dev.sh down${RESET} (or: cd db && docker compose down)"
    fi

    exit 0
}

check_prerequisites() {
    log_info "Checking local development prerequisites..."

    # Docker
    if ! command -v docker >/dev/null 2>&1; then
        log_error "Docker is not installed. Please install Docker: https://docs.docker.com/get-docker/"
        exit 1
    fi

    if ! docker info >/dev/null 2>&1; then
        log_error "Docker daemon is not running. Please start Docker and try again."
        exit 1
    fi

    # Docker Compose
    if ! docker compose version >/dev/null 2>&1; then
        log_error "'docker compose' command not found. Please install Docker Compose v2."
        exit 1
    fi

    # Go
    if ! command -v go >/dev/null 2>&1; then
        log_error "Go is not installed. Please install Go (1.20+): https://go.dev/dl/"
        exit 1
    fi

    # Node & npm
    if ! command -v node >/dev/null 2>&1; then
        log_error "Node.js is not installed. Please install Node.js: https://nodejs.org/"
        exit 1
    fi
    if ! command -v npm >/dev/null 2>&1; then
        log_error "npm is not installed. Please install npm."
        exit 1
    fi

    # Check api/.env.local
    if [ ! -f "$API_DIR/.env.local" ]; then
        if [ -f "$API_DIR/.env.example" ]; then
            log_warn "$API_DIR/.env.local not found. Creating from .env.example..."
            cp "$API_DIR/.env.example" "$API_DIR/.env.local"
            log_success "Created $API_DIR/.env.local"
        else
            log_warn "$API_DIR/.env.local not found and no .env.example found."
        fi
    fi

    # Check web/node_modules
    if [ ! -d "$WEB_DIR/node_modules" ]; then
        log_info "web/node_modules not found. Installing frontend dependencies..."
        (cd "$WEB_DIR" && npm install)
        log_success "Frontend dependencies installed."
    fi

    log_success "Prerequisites check passed."
}

start_db() {
    log_info "Starting PostgreSQL container via docker compose..."
    (cd "$DB_DIR" && docker compose up -d)

    log_info "Waiting for PostgreSQL database to accept connections..."
    local max_retries=30
    local count=0
    until (cd "$DB_DIR" && docker compose exec -T postgres pg_isready -U postgres -d myapp >/dev/null 2>&1); do
        count=$((count + 1))
        if [ "$count" -ge "$max_retries" ]; then
            log_error "Database failed to become ready after $max_retries seconds."
            (cd "$DB_DIR" && docker compose logs postgres)
            exit 1
        fi
        sleep 1
    done

    log_success "Database is ready (splitit-postgres on port 5432)."
}

start_api() {
    log_info "Starting Go API server on port 8080..."

    # Check and clear port 8080 if lingering process exists
    if command -v lsof >/dev/null 2>&1; then
        local occupied
        occupied=$(lsof -ti :8080 2>/dev/null || true)
        if [ -n "$occupied" ]; then
            log_warn "Port 8080 was occupied by PID(s): $occupied. Releasing..."
            kill -TERM $occupied 2>/dev/null || true
            sleep 1
        fi
    fi

    (
        cd "$API_DIR"
        export APP_ENV=local
        exec go run main.go
    ) > >(sed -u "s/^/$(printf '%b' "${CYAN}[api]${RESET} ")/") 2>&1 &
    API_PID=$!
}

start_ui() {
    log_info "Starting Vite frontend server on port 5173..."

    # Check and clear port 5173 if lingering process exists
    if command -v lsof >/dev/null 2>&1; then
        local occupied
        occupied=$(lsof -ti :5173 2>/dev/null || true)
        if [ -n "$occupied" ]; then
            log_warn "Port 5173 was occupied by PID(s): $occupied. Releasing..."
            kill -TERM $occupied 2>/dev/null || true
            sleep 1
        fi
    fi

    (
        cd "$WEB_DIR"
        exec npm run dev
    ) > >(sed -u "s/^/$(printf '%b' "${MAGENTA}[ui]  ${RESET} ")/") 2>&1 &
    UI_PID=$!
}

print_banner() {
    echo ""
    echo -e "${BOLD}${GREEN}======================================================${RESET}"
    echo -e "${BOLD}       SplitIt Local Development Environment Ready    ${RESET}"
    echo -e "${BOLD}${GREEN}======================================================${RESET}"
    echo -e "  ${BOLD}➜ Frontend (UI):${RESET}  ${CYAN}http://localhost:5173${RESET}"
    echo -e "  ${BOLD}➜ Backend (API):${RESET}  ${CYAN}http://localhost:8080${RESET}"
    echo -e "  ${BOLD}➜ Database (PG):${RESET}  ${CYAN}localhost:5432${RESET} (db: ${BOLD}myapp${RESET}, user: ${BOLD}postgres${RESET})"
    echo -e "${BOLD}${GREEN}======================================================${RESET}"
    echo -e "  Press ${BOLD}Ctrl+C${RESET} to gracefully stop API and UI."
    echo -e "  (Run ${BOLD}./dev.sh down${RESET} to also stop the DB container)"
    echo ""
}

show_status() {
    echo -e "${BOLD}=== SplitIt Local Development Status ===${RESET}"
    echo ""
    echo -e "${BOLD}1. Database Container:${RESET}"
    (cd "$DB_DIR" && docker compose ps) || true
    echo ""
    echo -e "${BOLD}2. Ports & Services:${RESET}"
    if is_port_listening 5432; then
        echo -e "  • Port 5432 (Postgres): ${GREEN}Active (Listening)${RESET}"
    else
        echo -e "  • Port 5432 (Postgres): ${RED}Inactive${RESET}"
    fi

    if is_port_listening 8080; then
        echo -e "  • Port 8080 (Go API):   ${GREEN}Active (Listening)${RESET}"
    else
        echo -e "  • Port 8080 (Go API):   ${RED}Inactive${RESET}"
    fi

    if is_port_listening 5173; then
        echo -e "  • Port 5173 (React UI): ${GREEN}Active (Listening)${RESET}"
    else
        echo -e "  • Port 5173 (React UI): ${RED}Inactive${RESET}"
    fi
    echo ""
}

stop_all() {
    log_info "Stopping all local dev services..."
    if command -v lsof >/dev/null 2>&1; then
        local pids
        pids=$(lsof -ti :8080,5173 2>/dev/null || true)
        if [ -n "$pids" ]; then
            log_info "Stopping active API/UI processes ($pids)..."
            kill -TERM $pids 2>/dev/null || true
            sleep 0.5
            kill -9 $pids 2>/dev/null || true
        fi
    fi

    log_info "Stopping database container..."
    (cd "$DB_DIR" && docker compose down)
    log_success "All local development services stopped."
}

show_help() {
    cat <<EOF
SplitIt Local Development Helper

Usage: ./dev.sh [command|option]

Commands:
  up, start, (none)  Start database, Go API, and React UI in development mode
  down, stop         Stop database container and any running API/UI processes
  status             Check status of database container and ports (5432, 8080, 5173)
  db                 Start only the PostgreSQL database container
  api                Start database and Go API
  ui, web            Start only the React UI frontend
  help, -h, --help   Display this help message

Options:
  --stop-db          Automatically stop the database container when exiting with Ctrl+C

Examples:
  ./dev.sh              # Start complete dev environment
  ./dev.sh down         # Teardown database & cleanup ports
  ./dev.sh status       # Inspect running dev services
EOF
}

# Parse command-line arguments
COMMAND="${1:-up}"

case "$COMMAND" in
    up|start)
        if [ "${2:-}" = "--stop-db" ]; then
            AUTO_STOP_DB=true
        fi
        check_prerequisites
        start_db
        start_api
        start_ui
        print_banner
        trap cleanup SIGINT SIGTERM EXIT
        wait "$API_PID" "$UI_PID"
        ;;
    --stop-db)
        AUTO_STOP_DB=true
        check_prerequisites
        start_db
        start_api
        start_ui
        print_banner
        trap cleanup SIGINT SIGTERM EXIT
        wait "$API_PID" "$UI_PID"
        ;;
    down|stop)
        stop_all
        ;;
    status)
        show_status
        ;;
    db)
        check_prerequisites
        start_db
        ;;
    api)
        check_prerequisites
        start_db
        start_api
        trap cleanup SIGINT SIGTERM EXIT
        wait "$API_PID"
        ;;
    ui|web)
        check_prerequisites
        start_ui
        trap cleanup SIGINT SIGTERM EXIT
        wait "$UI_PID"
        ;;
    help|-h|--help)
        show_help
        ;;
    *)
        log_error "Unknown command: $COMMAND"
        echo ""
        show_help
        exit 1
        ;;
esac
