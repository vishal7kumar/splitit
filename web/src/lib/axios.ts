import axios from "axios";

const api = axios.create({
  withCredentials: true,
});

api.interceptors.response.use(
  (res) => res,
  (err) => {
    const url = err.config?.url || "";
    if (err.response?.status === 401 && !url.includes("/auth/login") && !url.includes("/auth/me")) {
      window.location.href = "/login";
    }
    return Promise.reject(err);
  }
);

export default api;
