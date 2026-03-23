import { createContext, useContext, ReactNode } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { getMe } from "../../api/auth";

interface User {
  id: number;
  email: string;
  name: string;
}

interface AuthContextType {
  user: User | null | undefined;
  isLoading: boolean;
  invalidate: () => void;
}

const AuthContext = createContext<AuthContextType>({
  user: undefined,
  isLoading: true,
  invalidate: () => {},
});

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const { data: user, isLoading } = useQuery<User>({
    queryKey: ["me"],
    queryFn: getMe,
    retry: false,
    staleTime: 5 * 60000,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["me"] });

  return (
    <AuthContext.Provider value={{ user: user ?? null, isLoading, invalidate }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
