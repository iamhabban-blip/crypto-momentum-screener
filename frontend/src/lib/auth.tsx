import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { login as apiLogin, logout as apiLogout, refreshSession, sessionUser, setSignedOutHandler, type Role, type User } from "./api";

interface AuthState {
  user: User | null;
  ready: boolean;
  signIn: (email: string, password: string) => Promise<void>;
  signOut: () => Promise<void>;
  can: (role: Role) => boolean;
}

const rank: Record<Role, number> = { viewer: 0, analyst: 1, admin: 2 };
const Ctx = createContext<AuthState>(null as unknown as AuthState);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSignedOutHandler(() => setUser(null));
    // Restore the session from the httpOnly refresh cookie, if there is one.
    refreshSession().then((ok) => { if (ok) setUser(sessionUser); }).finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (email: string, password: string) => { setUser(await apiLogin(email, password)); }, []);
  const signOut = useCallback(async () => { await apiLogout(); setUser(null); }, []);
  const can = useCallback((role: Role) => !!user && rank[user.role] >= rank[role], [user]);

  return <Ctx.Provider value={{ user, ready, signIn, signOut, can }}>{children}</Ctx.Provider>;
}

export const useAuth = () => useContext(Ctx);
