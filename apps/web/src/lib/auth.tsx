'use client';

import { createContext, useContext, useEffect, useState, ReactNode } from 'react';

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: 'ADMIN' | 'FINANCIAL' | 'VIEWER';
  organizationId: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  ready: boolean;
  setSession: (user: AuthUser, accessToken: string, refreshToken: string) => void;
  clear: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const raw = window.localStorage.getItem('user');
    if (raw) {
      try {
        setUser(JSON.parse(raw));
      } catch {
        window.localStorage.clear();
      }
    }
    setReady(true);
  }, []);

  const setSession = (u: AuthUser, accessToken: string, refreshToken: string) => {
    window.localStorage.setItem('user', JSON.stringify(u));
    window.localStorage.setItem('accessToken', accessToken);
    window.localStorage.setItem('refreshToken', refreshToken);
    setUser(u);
  };

  const clear = () => {
    window.localStorage.removeItem('user');
    window.localStorage.removeItem('accessToken');
    window.localStorage.removeItem('refreshToken');
    setUser(null);
  };

  return (
    <AuthContext.Provider value={{ user, ready, setSession, clear }}>{children}</AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth deve ser usado dentro de AuthProvider');
  return ctx;
}
