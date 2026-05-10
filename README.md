# splitit

[![Website](https://img.shields.io/badge/Visit-splitit-success?style=for-the-badge)](https://splitit-ecru.vercel.app/login)

**Live Demo:** [https://splitit-ecru.vercel.app/login](https://splitit-ecru.vercel.app/login)

A full-stack, Splitwise-style expense splitting application. Built for personal use and small teams to seamlessly track shared expenses, group balances, and settle up debts. 

## Features

- **Authentication:** Secure JWT-based authentication using HTTP-only cookies.
- **Groups:** Create shared spaces (e.g., "Trip to Goa", "Apartment") and manage members.
- **Expenses & Splits:** Record payments made by one member on behalf of the group. Supports Equal, Exact, and Percentage splitting strategies. Includes expense search and filtering.
- **Balances & Settlements:** Automatically calculates net balances per member and simplifies debts (greedy algorithm) to minimize the number of transactions needed to settle up.
- **Dashboard:** Recent activity feed across all user's groups with infinite scroll, plus a quick overview of overall balances and a friends section.
- **Automated Backups:** Periodic full PostgreSQL backups to S3-compatible storage.

## Tech Stack

### Frontend
- **Framework:** React with Vite (TypeScript)
- **Routing:** React Router v6
- **State Management:** TanStack Query (`@tanstack/react-query`)
- **HTTP Client:** Axios (configured with `withCredentials: true`)
- **Styling:** Tailwind CSS

### Backend
- **Language & Framework:** Go with Gin router
- **Database Access:** `jackc/pgx` + `jmoiron/sqlx`
- **Authentication:** `golang-jwt/jwt v5`, `golang.org/x/crypto/bcrypt`

### Storage
- **Database:** PostgreSQL (primary data store for users, groups, expenses, and settlements)
- **Blob Storage:** IDrive e2 / S3-compatible storage (for automated database backups)

## Hosting Details

The application is deployed using a completely free, persistent production infrastructure:
- **Frontend:** Hosted on [Vercel](https://vercel.com). Includes a reverse proxy configured via `vercel.json` to safely route API requests to the backend without CORS issues. Integrates Vercel Analytics for production monitoring.
- **Backend (API):** Hosted on [Render's](https://render.com) free tier.
- **Database:** Persistent PostgreSQL database hosted on [Neon](https://neon.tech).

## Local Development Setup

### Prerequisites
- Docker & Docker Compose
- Go 1.20+
- Node.js & npm

### 1. Database
Start the local PostgreSQL instance using Docker Compose:
```bash
cd db
docker compose up -d
```

### 2. Backend (API)
The Go API loads configuration from `.env` (e.g., `DATABASE_URL`, `JWT_SECRET`).
```bash
cd api
go run main.go
```

### 3. Frontend (Web)
The Vite dev server automatically proxies `/api` requests to `localhost:8080`.
```bash
cd web
npm install
npm run dev
```

### Stopping the Database
```bash
cd db
docker compose down
```

## Architecture Notes
- **Security:** JWTs are stored in HTTP-only cookies to mitigate XSS risks. No sensitive credentials are exposed to the frontend.
- **Database Backup:** The backend includes an in-process Go backup scheduler that runs daily (when `BACKUP_ENABLED=true`), automatically uploading gzipped `pg_dump` outputs to the configured S3-compatible storage.
