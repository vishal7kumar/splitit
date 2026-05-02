import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "./features/auth/useAuth";
import { AppRouter } from "./router";
import { Analytics } from "@vercel/analytics/react";
import "./index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <AuthProvider>
        <AppRouter />
        {import.meta.env.PROD && <Analytics />}
      </AuthProvider>
    </QueryClientProvider>
  </StrictMode>
);
