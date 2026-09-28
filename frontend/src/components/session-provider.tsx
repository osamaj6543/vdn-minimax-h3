"use client";

/** Session context: who the *server* says you are, plus the auth actions.
 *
 * Nothing here can read the session: the cookie is httpOnly, so `/api/auth/*`
 * is the only way in or out. That is the point — an XSS bug in this app can no
 * longer exfiltrate a session or mint a gateway token.
 */
import { createContext, useCallback, useContext, useEffect, useState } from "react";

import {
  fetchSession,
  login as authLogin,
  logout as authLogout,
  register as authRegister,
} from "@/lib/auth-client";
import type { User } from "@/lib/types";

interface SessionContextValue {
  user: User | null;
  loading: boolean;
  /** False when the server is missing its auth env (see login page notice). */
  configured: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, name: string) => Promise<void>;
  logout: () => Promise<void>;
}

const SessionContext = createContext<SessionContextValue | null>(null);

export function SessionProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      const session = await fetchSession();
      setUser(session.user);
      setConfigured(session.configured);
      setLoading(false);
    };
    void load();
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    const { user: signedIn } = await authLogin(email, password);
    setUser(signedIn);
  }, []);

  const register = useCallback(async (email: string, password: string, name: string) => {
    const { user: created } = await authRegister(email, password, name);
    setUser(created);
  }, []);

  const logout = useCallback(async () => {
    await authLogout();
    setUser(null);
  }, []);

  return (
    <SessionContext.Provider value={{ user, loading, configured, login, register, logout }}>
      {children}
    </SessionContext.Provider>
  );
}

export function useSession(): SessionContextValue {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error("useSession must be used inside <SessionProvider>");
  }
  return context;
}
