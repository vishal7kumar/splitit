# Project Context for Claude Code

This file gives Claude Code full context about the project decisions made during
planning. Read this before making any suggestions or writing any code.

---

## Project type

Web SaaS app — personal/prototype scale to start, targeting growth to small team.
Heavy read workload on structured data.

---

## Tech stack

### Frontend
- **React** with **Vite** (TypeScript template)
- **React Router v6** for routing
- **TanStack Query** (`@tanstack/react-query`) for server state
- **Axios** for HTTP, configured with `withCredentials: true` for cookie auth
- **Tailwind CSS** for styling

### Backend
- **Go** with **Gin** (or Chi) as the HTTP router
- **golang-jwt/jwt v5** for JWT signing and verification
- **golang.org/x/crypto/bcrypt** for password hashing
- **jackc/pgx** + **jmoiron/sqlx** for Postgres access
- **joho/godotenv** for local env config
- **aws/aws-sdk-go-v2** for S3 (files only, not structured data)

### Storage
- **PostgreSQL** — primary database for all structured data (users, records, etc.)
  - Use Supabase or Neon for hosted Postgres in prototype; Docker locally
- **S3 (or Cloudflare R2)** — blob/file storage only (uploads, exports, avatars)
  - S3 is NOT used as a database. No querying across S3 objects.
- **Redis** — optional, add only when caching or rate limiting is needed

---

## Auth approach

JWT stored in **HTTP-only cookies** (not localStorage). This is the chosen pattern — do not suggest localStorage or Authorization header approaches.

### Flow
1. User POSTs email + password to `POST /auth/login`
2. Go handler looks up user in Postgres, compares bcrypt hash
3. On success: signs a JWT (HS256, 15min expiry) and sets it as an HTTP-only cookie
4. React sends `credentials: "include"` on every request — cookie is automatic
5. Go middleware validates the JWT on every protected route and sets user in context

### Cookie settings (production)
```go
http.SetCookie(w, &http.Cookie{
    Name:     "token",
    Value:    signed,
    HttpOnly: true,
    Secure:   true,
    SameSite: http.SameSiteStrictMode,
    Path:     "/",
})
```

### Go backend endpoints needed
- `POST /auth/login` — verify password, issue cookie
- `POST /auth/logout` — clear cookie
- `GET  /auth/me` — return current user (used by React's useAuth hook)

---

## Frontend folder structure

```
src/
├── api/              # all axios calls, one file per resource
│   ├── auth.ts
│   └── users.ts
├── components/       # shared, stateless UI components
│   ├── Button.tsx
│   └── Input.tsx
├── features/         # self-contained feature modules
│   ├── auth/
│   │   ├── LoginPage.tsx
│   │   └── useAuth.tsx   # AuthContext + useAuth hook
│   └── dashboard/
│       └── DashboardPage.tsx
├── hooks/            # shared custom hooks
├── layouts/          # page shells
│   ├── AppLayout.tsx     # sidebar/nav for authenticated pages
│   └── AuthLayout.tsx    # centered layout for login/signup
├── lib/
│   └── axios.ts          # axios instance with baseURL + interceptors
├── router/
│   └── index.tsx         # route definitions + ProtectedLayout guard
└── main.tsx
```

**Rules:**
- `api/` only talks to the Go backend, no business logic
- `features/` modules never import from each other
- `components/` has no business logic or API calls

---

## Axios instance

```ts
// src/lib/axios.ts
import axios from "axios";

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL,
  withCredentials: true,
});

api.interceptors.response.use(
  res => res,
  err => {
    if (err.response?.status === 401) window.location.href = "/login";
    return Promise.reject(err);
  }
);

export default api;
```

---

## Auth context

```tsx
// src/features/auth/useAuth.tsx
import { createContext, useContext } from "react";
import { useQuery } from "@tanstack/react-query";
import api from "@/lib/axios";

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const { data: user, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: () => api.get("/auth/me").then(r => r.data),
    retry: false,
    staleTime: 5 * 60000,
  });
  return (
    <AuthContext.Provider value={{ user, isLoading }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
```

---

## Route structure

```
/               → LandingPage       (public)
/login          → LoginPage         (public)
/dashboard      → DashboardPage     (protected)
/settings       → SettingsPage      (protected)
/item/:id       → DetailPage        (protected)
```

`ProtectedLayout` wraps all authenticated routes — it calls `useAuth()` and
redirects to `/login` if no user is present.

---

## Vite config — dev proxy

```ts
// vite.config.ts
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      "/api": {
        target: "http://localhost:8080",
        changeOrigin: true,
      },
    },
  },
});
```

In dev, all `/api/*` calls go to the Go server. No CORS config needed locally.

---

## Environment variables

```bash
# .env.development
VITE_API_URL=http://localhost:8080

# .env.production
VITE_API_URL=https://api.yourdomain.com
```

Go backend uses `.env` via `godotenv`:
```bash
DATABASE_URL=postgres://user:pass@localhost:5432/myapp
JWT_SECRET=your-secret-here
PORT=8080
```

**Never put JWT_SECRET or DATABASE_URL in the frontend `.env`.**

---

## Local dev setup

```bash
# Start Postgres via Docker
docker run --name myapp-db \
  -e POSTGRES_PASSWORD=pass \
  -e POSTGRES_DB=myapp \
  -p 5432:5432 \
  -d postgres:16

# Start Go backend
cd api && go run main.go

# Start React frontend
cd web && npm run dev
```

---

## Backend folder structure (Go)

```
api/
├── main.go
├── .env
├── go.mod
├── handlers/
│   ├── auth.go
│   └── users.go
├── middleware/
│   └── auth.go        # JWT validation middleware
├── models/
│   └── user.go
├── db/
│   └── db.go          # pgx connection setup
└── router/
    └── router.go      # Gin route registration
```

---

## Build order (recommended)

1. Go: Postgres connection + users table migration
2. Go: `POST /auth/login`, `POST /auth/logout`, `GET /auth/me`
3. Go: JWT middleware wired to a test protected route
4. React: Axios instance + AuthProvider + useAuth hook
5. React: LoginPage + ProtectedLayout routing
6. React: Dashboard shell (just a header + "you're logged in")
7. First real feature (whatever the core value prop is)

Get the full auth loop working end-to-end before building any feature UI.

---

## What NOT to do

- Do not store JWTs in localStorage (XSS risk)
- Do not use S3 as a queryable database
- Do not add Redis until there's a concrete need
- Do not import between `features/` modules — go through shared `api/` or `hooks/`
- Do not put secrets in frontend `.env` files

