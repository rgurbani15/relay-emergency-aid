import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { api } from "./api";

export interface User { id: string; role: "coordinator" | "merchant" | "resident"; name: string; email: string; merchantId: string | null; residentId: string | null }
interface AuthCtx { user: User | null; demoMode: boolean; ready: boolean; signIn: (role: User["role"], userId?: string) => Promise<User>; signOut: () => Promise<void> }
const Ctx = createContext<AuthCtx>(null as never);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [demoMode, setDemoMode] = useState(true);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    api.get("/api/auth/me").then((r) => { setUser(r.user); setDemoMode(r.demoMode); }).catch(() => {}).finally(() => setReady(true));
  }, []);
  const signIn = useCallback(async (role: User["role"], userId?: string) => {
    const r = await api.post("/api/auth/demo", { role, userId });
    setUser(r.user);
    return r.user as User;
  }, []);
  const signOut = useCallback(async () => { try { await api.post("/api/auth/logout"); } finally { setUser(null); } }, []);
  const value = useMemo(() => ({ user, demoMode, ready, signIn, signOut }), [user, demoMode, ready, signIn, signOut]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
export const useAuth = () => useContext(Ctx);
export const homeFor = (role: User["role"]) => (role === "coordinator" ? "/app/overview" : role === "merchant" ? "/merchant" : "/resident");
