'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { apiRequest, setOnAuthFailure } from '@/lib/api';
import {
  clearStoredTokens,
  decodeAccessToken,
  readStoredTokens,
  writeStoredTokens,
  type DecodedAccessToken,
  type StoredTokens,
  type UserRole,
} from '@/lib/auth-storage';

export interface AuthUser {
  id: string;
  email: string;
  role: UserRole;
  tenantId: string | null;
}

export interface LoginInput {
  email: string;
  password: string;
}

interface AuthContextValue {
  user: AuthUser | null;
  status: 'loading' | 'authenticated' | 'anonymous';
  login: (input: LoginInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function userFromToken(decoded: DecodedAccessToken): AuthUser {
  return {
    id: decoded.sub,
    email: decoded.email,
    role: decoded.role,
    tenantId: decoded.tenantId,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [status, setStatus] = useState<AuthContextValue['status']>('loading');

  // Hydrate from localStorage on mount.
  useEffect(() => {
    const tokens = readStoredTokens();
    if (!tokens) {
      setStatus('anonymous');
      return;
    }
    const decoded = decodeAccessToken(tokens.accessToken);
    if (!decoded) {
      clearStoredTokens();
      setStatus('anonymous');
      return;
    }
    setUser(userFromToken(decoded));
    setStatus('authenticated');
  }, []);

  // Wire up the api client → AuthProvider auth-failure channel.
  useEffect(() => {
    setOnAuthFailure(() => {
      clearStoredTokens();
      setUser(null);
      setStatus('anonymous');
    });
    return () => setOnAuthFailure(null);
  }, []);

  const login = useCallback(async (input: LoginInput) => {
    const tokens = await apiRequest<StoredTokens>('/auth/login', {
      method: 'POST',
      body: input,
      unauthenticated: true,
    });
    writeStoredTokens(tokens);
    const decoded = decodeAccessToken(tokens.accessToken);
    if (!decoded) throw new Error('Login response did not contain a valid access token');
    setUser(userFromToken(decoded));
    setStatus('authenticated');
  }, []);

  const logout = useCallback(async () => {
    const tokens = readStoredTokens();
    if (tokens) {
      try {
        await apiRequest<void>('/auth/logout', {
          method: 'POST',
          body: { refreshToken: tokens.refreshToken },
          unauthenticated: true,
        });
      } catch {
        // Logout is best-effort — we always clear local state.
      }
    }
    clearStoredTokens();
    setUser(null);
    setStatus('anonymous');
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ user, status, login, logout }),
    [user, status, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside an <AuthProvider>');
  return ctx;
}
