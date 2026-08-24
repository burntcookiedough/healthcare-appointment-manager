import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import React from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { apiClient, setApiAuthToken, isDemoMode } from "@/lib/api/client";
import { mockDb } from "@/mocks/handlers";
import {
  supabaseAuth,
  setStoredSession,
  clearStoredSession,
  getStoredSession,
  refreshSessionDeduplicated,
} from "@/features/auth/supabase-auth";
import { AuthProvider, useAuth } from "@/features/auth/auth-context";
import { RoleGuard } from "@/components/auth/RoleGuard";

function createTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
        staleTime: 0,
        gcTime: 0,
      },
    },
  });
}

describe("Production Authentication & Security Boundary", () => {
  const originalEnv = { ...process.env };
  const mockFetch = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    clearStoredSession();
    apiClient.reset();
    localStorage.clear();
    global.fetch = mockFetch;

    // Configure production environment by default
    process.env.NEXT_PUBLIC_DEMO_MODE = "false";
    process.env.NEXT_PUBLIC_API_BASE_URL = "https://api.caresync.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://auth.supabase.example.com";
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "test-anon-key-123";
  });

  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("1. production initialization does not call mockDb.setUserRole", async () => {
    const setUserRoleSpy = vi.spyOn(mockDb, "setUserRole");

    const qc = createTestQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <div>Protected Context</div>
        </AuthProvider>
      </QueryClientProvider>
    );

    // Give any async effects time to settle
    await act(async () => {
      await Promise.resolve();
    });

    expect(setUserRoleSpy).not.toHaveBeenCalled();
    expect(isDemoMode()).toBe(false);
  });

  it("2. production login sends the Supabase password-grant request", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "mock-access-token-abc",
        refresh_token: "mock-refresh-token-xyz",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "sub-123", email: "priya@example.com" },
      }),
    });

    const session = await supabaseAuth.signInWithPassword("priya@example.com", "securepass123");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://auth.supabase.example.com/auth/v1/token?grant_type=password",
      expect.objectContaining({
        method: "POST",
        headers: {
          apikey: "test-anon-key-123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ email: "priya@example.com", password: "securepass123" }),
      })
    );

    expect(session.access_token).toBe("mock-access-token-abc");
    expect(session.refresh_token).toBe("mock-refresh-token-xyz");
    expect(session.expires_at).toBeGreaterThan(Date.now());
  });

  it("3. registration uses POST /auth/v1/signup", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "mock-reg-token",
        refresh_token: "mock-reg-refresh",
        expires_in: 3600,
        user: { id: "sub-456", email: "newpatient@example.com" },
      }),
    });

    const result = await supabaseAuth.signUp("newpatient@example.com", "securepass123", "Priya Nair");

    expect(mockFetch).toHaveBeenCalledWith(
      "https://auth.supabase.example.com/auth/v1/signup",
      expect.objectContaining({
        method: "POST",
        headers: {
          apikey: "test-anon-key-123",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          email: "newpatient@example.com",
          password: "securepass123",
          data: { display_name: "Priya Nair", full_name: "Priya Nair" },
        }),
      })
    );

    expect(result.session?.access_token).toBe("mock-reg-token");
    expect(result.requiresConfirmation).toBe(false);
  });

  it("4. successful login calls /api/v1/me with the bearer token to determine role and profile_id", async () => {
    // 1. Supabase password grant response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "supabase-access-token-999",
        refresh_token: "supabase-refresh-token-999",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "auth-sub-999", email: "dr.rajesh@example.com" },
      }),
    });

    // 2. Backend /api/v1/me response
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        subject_id: "auth-sub-999",
        role: "doctor",
        available_roles: ["doctor"],
        profile_id: "doc-custom-real-id",
        display_name: "Dr. Rajesh Verma",
        email: "dr.rajesh@example.com",
      }),
    });

    let authContextValue: ReturnType<typeof useAuth> | null = null;
    function Consumer() {
      authContextValue = useAuth();
      return <div>Consumer Ready</div>;
    }

    const qc = createTestQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    await act(async () => {
      if (authContextValue) {
        await authContextValue.login("dr.rajesh@example.com", "securepass123");
      }
    });

    // Verify /api/v1/me was called with the Bearer token
    expect(mockFetch).toHaveBeenNthCalledWith(
      2,
      "https://api.caresync.example.com/api/v1/me",
      expect.objectContaining({
        method: "GET",
        headers: expect.objectContaining({
          Authorization: "Bearer supabase-access-token-999",
        }),
      })
    );

    // Identity is strictly authoritative from /me response
    expect(authContextValue!.user?.role).toBe("doctor");
    expect(authContextValue!.user?.profile_id).toBe("doc-custom-real-id");
    expect(authContextValue!.role).toBe("doctor");
  });

  it("5. wrong-role production users receive access denied and cannot switch persona", async () => {
    // Stored session with patient role
    setStoredSession({
      access_token: "patient-token",
      refresh_token: "patient-refresh",
      expires_in: 3600,
      expires_at: Date.now() + 3600000,
      token_type: "bearer",
      user: { id: "patient-1", email: "patient@example.com" },
    });

    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        subject_id: "patient-1",
        role: "patient",
        available_roles: ["patient"],
        profile_id: "pat-real-id-55",
        display_name: "Aarav Sharma",
        email: "patient@example.com",
      }),
    });

    const qc = createTestQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <RoleGuard allowedRoles={["doctor"]}>
            <div>Doctor Only Confidential Data</div>
          </RoleGuard>
        </AuthProvider>
      </QueryClientProvider>
    );

    // Wait for bootstrap session to resolve
    expect(await screen.findByText(/Access Denied: Role Restricted/i)).toBeInTheDocument();
    expect(screen.queryByText("Doctor Only Confidential Data")).not.toBeInTheDocument();
    // In production mode, "Switch Persona" button MUST NOT be rendered
    expect(screen.queryByText(/Switch to Doctor Persona/i)).not.toBeInTheDocument();
  });

  it("6. missing production token blocks protected requests before network dispatch", async () => {
    setApiAuthToken(null);
    clearStoredSession();

    // Calling protected endpoint without token throws 401 AUTHENTICATION_REQUIRED before fetch
    await expect(apiClient.getAppointments("patient")).rejects.toMatchObject({
      status: 401,
      error: {
        code: "AUTHENTICATION_REQUIRED",
      },
    });

    // fetch was not called for protected endpoint
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("7. a 401 response causes at most one deduplicated refresh and retry", async () => {
    setStoredSession({
      access_token: "expired-token",
      refresh_token: "valid-refresh-token",
      expires_in: 3600,
      expires_at: Date.now() - 1000, // expired
      token_type: "bearer",
      user: { id: "u-1", email: "user@example.com" },
    });
    setApiAuthToken("expired-token");

    // 1. First call to /me returns 401
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 401,
      statusText: "Unauthorized",
      json: async () => ({ error: { code: "AUTHENTICATION_REQUIRED", message: "Token expired" } }),
    });

    // 2. Token refresh request to Supabase
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        access_token: "fresh-access-token-777",
        refresh_token: "fresh-refresh-token-777",
        expires_in: 3600,
        token_type: "bearer",
        user: { id: "u-1", email: "user@example.com" },
      }),
    });

    // 3. Retried call to /me succeeds with new token
    mockFetch.mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({
        subject_id: "u-1",
        role: "patient",
        available_roles: ["patient"],
        profile_id: "pat-refreshed",
        display_name: "Refreshed User",
        email: "user@example.com",
      }),
    });

    const user = await apiClient.getMe();

    expect(user.profile_id).toBe("pat-refreshed");
    // Verify refresh request occurred
    expect(mockFetch).toHaveBeenCalledWith(
      "https://auth.supabase.example.com/auth/v1/token?grant_type=refresh_token",
      expect.objectContaining({ method: "POST" })
    );
    // Verify updated session is stored
    expect(getStoredSession()?.access_token).toBe("fresh-access-token-777");
  });

  it("8. failed refresh clears authentication and session", async () => {
    setStoredSession({
      access_token: "bad-token",
      refresh_token: "revoked-refresh-token",
      expires_in: 3600,
      expires_at: Date.now() - 1000,
      token_type: "bearer",
      user: { id: "u-1", email: "user@example.com" },
    });

    // Refresh request fails with 400
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 400,
      statusText: "Bad Request",
      json: async () => ({ error_description: "Invalid Refresh Token" }),
    });

    const refreshed = await refreshSessionDeduplicated();
    expect(refreshed).toBeNull();
    expect(getStoredSession()).toBeNull();
  });

  it("9. demo mode still supports persona switching and mockDb.setUserRole", () => {
    process.env.NEXT_PUBLIC_DEMO_MODE = "true";
    localStorage.setItem("demo_user_role", "doctor");

    const user = apiClient.setUserRole("doctor");
    expect(user.role).toBe("doctor");
    expect(user.profile_id).toBe("doc-001-rajesh");

    let authContext: ReturnType<typeof useAuth> | null = null;
    function Consumer() {
      authContext = useAuth();
      return (
        <RoleGuard allowedRoles={["doctor"]}>
          <div>Doctor Demo Screen</div>
        </RoleGuard>
      );
    }

    const qc = createTestQueryClient();
    render(
      <QueryClientProvider client={qc}>
        <AuthProvider>
          <Consumer />
        </AuthProvider>
      </QueryClientProvider>
    );

    expect(screen.getByText("Doctor Demo Screen")).toBeInTheDocument();
    expect(authContext!.isDemoMode).toBe(true);

    // Switch to admin persona
    act(() => {
      authContext!.setRole("admin");
    });
    expect(authContext!.role).toBe("admin");
    expect(authContext!.user?.profile_id).toBe("adm-001-ops");
  });
});
