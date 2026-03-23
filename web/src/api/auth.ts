import api from "../lib/axios";

export function login(email: string, password: string) {
  return api.post("/api/auth/login", { email, password });
}

export function logout() {
  return api.post("/api/auth/logout");
}

export function register(email: string, password: string, name: string) {
  return api.post("/api/auth/register", { email, password, name });
}

export function getMe() {
  return api.get("/api/auth/me").then((r) => r.data);
}
