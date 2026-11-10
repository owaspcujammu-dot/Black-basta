import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { ApiError, api } from '../services/api';
import type { User } from '../services/types';

export interface RegisterInput {
  username: string;
  fullName: string;
  email: string;
  password: string;
  confirmPassword: string;
  teamName?: string;
}

interface AuthState {
  user: User | null;
  /** True until the first /auth/me round-trip finishes. */
  loading: boolean;
  /** `player`: team logins name the team member on this device. */
  login: (identifier: string, password: string, player?: string) => Promise<User>;
  register: (input: RegisterInput) => Promise<{ user: User; participantNumber: number; maxParticipants: number }>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  /** Local update after a solve or hint purchase, before the server push arrives. */
  patchUser: (patch: Partial<User>) => void;
  /** Set right after registration so the dashboard can show "Pirate #047 / 110". */
  welcome: { participantNumber: number; maxParticipants: number } | null;
  dismissWelcome: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [welcome, setWelcome] = useState<AuthState['welcome']>(null);

  const refresh = useCallback(async () => {
    try {
      const { user: current } = await api.get<{ user: User }>('/auth/me');
      setUser(current);
    } catch (error) {
      // 401 = not logged in, 403 = account disabled. Either way: no session.
      if (error instanceof ApiError && (error.status === 401 || error.status === 403)) setUser(null);
    }
  }, []);

  useEffect(() => {
    refresh().finally(() => setLoading(false));
  }, [refresh]);

  const login = useCallback(async (identifier: string, password: string, player?: string) => {
    const { user: loggedIn } = await api.post<{ user: User }>('/auth/login', { identifier, password, player: player || undefined });
    setUser(loggedIn);
    return loggedIn;
  }, []);

  const register = useCallback(async (input: RegisterInput) => {
    const result = await api.post<{ user: User; participantNumber: number; maxParticipants: number }>('/auth/register', input);
    setWelcome({ participantNumber: result.participantNumber, maxParticipants: result.maxParticipants });
    setUser(result.user);
    return result;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } finally {
      setUser(null);
      setWelcome(null);
    }
  }, []);

  const patchUser = useCallback((patch: Partial<User>) => setUser((current) => (current ? { ...current, ...patch } : current)), []);

  const dismissWelcome = useCallback(() => setWelcome(null), []);

  const value = useMemo(
    () => ({ user, loading, login, register, logout, refresh, patchUser, welcome, dismissWelcome }),
    [user, loading, login, register, logout, refresh, patchUser, welcome, dismissWelcome],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside <AuthProvider>');
  return context;
}
