"use client";

import React, { createContext, useContext, useEffect, useState, useCallback } from "react";
import { UserContext, UserRole } from "@/types/api";
import { apiClient, isDemoMode as checkDemoMode, setApiAuthToken } from "@/lib/api/client";
import {
  supabaseAuth,
  getStoredSession,
  setStoredSession,
  clearStoredSession,
  refreshSessionDeduplicated,
  onAuthInvalidated,
} from "./supabase-auth";

export interface AuthContextType {
  user: UserContext | null;
  role: UserRole | null;
  isLoading: boolean;
  isDemoMode: boolean;
  setRole: (role: UserRole) => void;
  login: (email: string, password: string) => Promise<UserContext>;
  register: (
    email: string,
    password: string,
    displayName?: string
  ) => Promise<{ user?: UserContext; requiresConfirmation?: boolean }>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

function isAuthenticationFailure(error: unknown): boolean {
  const typedError = error as { status?: unknown; name?: unknown };
  if (typedError?.status === 401) return true;
  return typedError?.name === "SupabaseAuthError" && typeof typedError.status === "number" && typedError.status < 500;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const isDemo = checkDemoMode();

  const bootstrapProductionSession = useCallback(async () => {
    try {
      const stored = getStoredSession();
      if (!stored) {
        setApiAuthToken(null);
        setUser(null);
        return;
      }

      let activeSession = stored;
      // If token is expired or within 30 seconds of expiring, refresh proactively
      if (activeSession.expires_at && activeSession.expires_at <= Date.now() + 30000) {
        const refreshed = await refreshSessionDeduplicated(setApiAuthToken);
        if (!refreshed) {
          clearStoredSession();
          setApiAuthToken(null);
          setUser(null);
          return;
        }
        activeSession = refreshed;
      }

      setApiAuthToken(activeSession.access_token);
      const me = await apiClient.getMe();
      setUser(me);
    } catch (err) {
      if (isAuthenticationFailure(err)) {
        clearStoredSession();
        setApiAuthToken(null);
        setUser(null);
      } else {
        setUser(null);
      }
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    // Listen for authentication invalidation events (e.g. 401 refresh failure)
    const unsubscribe = onAuthInvalidated(() => {
      if (!isDemo) {
        setUser(null);
        setApiAuthToken(null);
      }
    });

    if (isDemo) {
      let initialRole: UserRole = "patient";
      if (typeof window !== "undefined") {
        const savedRole = localStorage.getItem("demo_user_role") as UserRole;
        if (savedRole && ["patient", "doctor", "admin"].includes(savedRole)) {
          initialRole = savedRole;
        }
      }
      const initialUser = apiClient.setUserRole(initialRole);
      setUser(initialUser);
      setIsLoading(false);
    } else {
      bootstrapProductionSession();
    }

    return () => {
      unsubscribe();
    };
  }, [isDemo, bootstrapProductionSession]);

  const handleSetRole = (newRole: UserRole) => {
    if (isDemo) {
      if (typeof window !== "undefined") {
        localStorage.setItem("demo_user_role", newRole);
      }
      const updated = apiClient.setUserRole(newRole);
      setUser(updated);
    }
    // In production mode, role switching is forbidden; role is derived strictly from backend identity
  };

  const login = async (email: string, password: string): Promise<UserContext> => {
    if (isDemo) {
      const demoUser = apiClient.setUserRole("patient");
      setUser(demoUser);
      return demoUser;
    }

    setIsLoading(true);
    try {
      const session = await supabaseAuth.signInWithPassword(email, password);
      setStoredSession(session);
      setApiAuthToken(session.access_token);
      const me = await apiClient.getMe();
      setUser(me);
      return me;
    } catch (err) {
      if (isAuthenticationFailure(err)) {
        clearStoredSession();
        setApiAuthToken(null);
        setUser(null);
      } else {
        setUser(null);
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const register = async (
    email: string,
    password: string,
    displayName?: string
  ): Promise<{ user?: UserContext; requiresConfirmation?: boolean }> => {
    if (isDemo) {
      const demoUser = apiClient.setUserRole("patient");
      setUser(demoUser);
      return { user: demoUser, requiresConfirmation: false };
    }

    setIsLoading(true);
    try {
      const result = await supabaseAuth.signUp(email, password, displayName);
      if (result.session) {
        setStoredSession(result.session);
        setApiAuthToken(result.session.access_token);
        const me = await apiClient.getMe();
        setUser(me);
        return { user: me, requiresConfirmation: false };
      }
      return { requiresConfirmation: Boolean(result.requiresConfirmation) };
    } catch (err) {
      if (isAuthenticationFailure(err)) {
        clearStoredSession();
        setApiAuthToken(null);
        setUser(null);
      } else {
        setUser(null);
      }
      throw err;
    } finally {
      setIsLoading(false);
    }
  };

  const logout = async (): Promise<void> => {
    if (isDemo) {
      const defaultUser = apiClient.setUserRole("patient");
      setUser(defaultUser);
      return;
    }

    const stored = getStoredSession();
    if (stored?.access_token) {
      try {
        await supabaseAuth.signOut(stored.access_token);
      } catch {
        // Silently swallow sign-out network failures
      }
    }
    clearStoredSession();
    setApiAuthToken(null);
    setUser(null);
  };

  const currentRole: UserRole | null = user?.role || (isDemo ? "patient" : null);

  return (
    <AuthContext.Provider
      value={{
        user,
        role: currentRole,
        isLoading,
        isDemoMode: isDemo,
        setRole: handleSetRole,
        login,
        register,
        logout,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextType {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an AuthProvider");
  }
  return context;
}
