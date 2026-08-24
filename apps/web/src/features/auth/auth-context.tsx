"use client";

import React, { createContext, useContext, useEffect, useState } from "react";
import { UserContext, UserRole } from "@/types/api";
import { apiClient } from "@/lib/api/client";

interface AuthContextType {
  user: UserContext | null;
  role: UserRole;
  isLoading: boolean;
  setRole: (role: UserRole) => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserContext | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    // Read cached demo role if stored, otherwise default to patient
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
  }, []);

  const handleSetRole = (newRole: UserRole) => {
    if (typeof window !== "undefined") {
      localStorage.setItem("demo_user_role", newRole);
    }
    const updated = apiClient.setUserRole(newRole);
    setUser(updated);
  };

  const currentRole: UserRole = user?.role || "patient";

  return (
    <AuthContext.Provider
      value={{
        user,
        role: currentRole,
        isLoading,
        setRole: handleSetRole,
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
