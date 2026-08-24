/**
 * Dependency-free browser client for Supabase Auth using native fetch.
 * Implements signup, password login, token refresh, and logout against GoTrue:
 * - POST /auth/v1/signup
 * - POST /auth/v1/token?grant_type=password
 * - POST /auth/v1/token?grant_type=refresh_token
 * - POST /auth/v1/logout
 *
 * Security & Architecture Note:
 * In this client prototype, authentication sessions are stored in localStorage.
 * For production SSR environments with server middleware, httpOnly cookie sessions
 * are recommended to mitigate token access in browser scripts.
 */

export interface SupabaseUser {
  id: string;
  email?: string;
  user_metadata?: {
    display_name?: string;
    full_name?: string;
    [key: string]: unknown;
  };
  created_at?: string;
}

export interface SupabaseAuthSession {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  expires_at: number; // UTC epoch in milliseconds
  token_type: string;
  user: SupabaseUser;
}

export interface SupabaseAuthResult {
  session: SupabaseAuthSession | null;
  user: SupabaseUser | null;
  requiresConfirmation?: boolean;
}

export class SupabaseAuthError extends Error {
  code: string;
  status: number;

  constructor(message: string, code = "AUTH_ERROR", status = 400) {
    super(message);
    this.name = "SupabaseAuthError";
    this.code = code;
    this.status = status;
  }
}

export const AUTH_STORAGE_KEY = "care_sync_supabase_session";

export function getStoredSession(): SupabaseAuthSession | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as SupabaseAuthSession;
    if (parsed && parsed.access_token && parsed.refresh_token) {
      return parsed;
    }
    return null;
  } catch {
    return null;
  }
}

export function setStoredSession(session: SupabaseAuthSession | null): void {
  if (typeof window === "undefined") return;
  try {
    if (!session) {
      localStorage.removeItem(AUTH_STORAGE_KEY);
    } else {
      localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(session));
    }
  } catch {
    // Ignore storage quota or disabled storage errors
  }
}

export function clearStoredSession(): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    localStorage.removeItem("supabase_access_token");
    localStorage.removeItem("demo_user_role");
  } catch {
    // Ignore errors
  }
}

function getSupabaseConfig(): { url: string; anonKey: string } {
  const url = (process.env.NEXT_PUBLIC_SUPABASE_URL || "").replace(/\/$/, "");
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";
  if (!url || !anonKey) {
    throw new SupabaseAuthError(
      "Supabase configuration is missing. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.",
      "CONFIG_MISSING",
      500
    );
  }
  return { url, anonKey };
}

async function handleSupabaseResponse<T>(res: Response): Promise<T> {
  if (!res.ok) {
    let msg = `Authentication request failed (${res.status})`;
    let code = "AUTH_ERROR";
    try {
      const errJson = await res.json();
      msg =
        errJson.error_description ||
        errJson.msg ||
        errJson.message ||
        errJson.error ||
        msg;
      code = errJson.error_code || errJson.code || errJson.error || code;
    } catch {
      // JSON parse error fallback
    }
    throw new SupabaseAuthError(msg, code, res.status);
  }

  if (res.status === 204) {
    return undefined as unknown as T;
  }
  return res.json() as Promise<T>;
}

export const supabaseAuth = {
  /**
   * Register a new user with email and password.
   * POST {SUPABASE_URL}/auth/v1/signup
   */
  signUp: async (
    email: string,
    password: string,
    displayName?: string
  ): Promise<SupabaseAuthResult> => {
    const { url, anonKey } = getSupabaseConfig();
    const endpoint = `${url}/auth/v1/signup`;

    const body: Record<string, unknown> = {
      email,
      password,
    };
    if (displayName) {
      body.data = { display_name: displayName, full_name: displayName };
    }

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(body),
    });

    const data = await handleSupabaseResponse<{
      access_token?: string;
      refresh_token?: string;
      expires_in?: number;
      token_type?: string;
      user?: SupabaseUser;
      id?: string;
    }>(res);

    if (data.access_token && data.refresh_token && data.user) {
      const expiresIn = data.expires_in || 3600;
      const session: SupabaseAuthSession = {
        access_token: data.access_token,
        refresh_token: data.refresh_token,
        expires_in: expiresIn,
        expires_at: Date.now() + expiresIn * 1000,
        token_type: data.token_type || "bearer",
        user: data.user,
      };
      return { session, user: data.user, requiresConfirmation: false };
    }

    const userObj = data.user || (data.id ? (data as unknown as SupabaseUser) : null);
    return {
      session: null,
      user: userObj,
      requiresConfirmation: true,
    };
  },

  /**
   * Log in with email and password.
   * POST {SUPABASE_URL}/auth/v1/token?grant_type=password
   */
  signInWithPassword: async (
    email: string,
    password: string
  ): Promise<SupabaseAuthSession> => {
    const { url, anonKey } = getSupabaseConfig();
    const endpoint = `${url}/auth/v1/token?grant_type=password`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ email, password }),
    });

    const data = await handleSupabaseResponse<{
      access_token: string;
      refresh_token: string;
      expires_in?: number;
      token_type?: string;
      user: SupabaseUser;
    }>(res);

    const expiresIn = data.expires_in || 3600;
    const session: SupabaseAuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: expiresIn,
      expires_at: Date.now() + expiresIn * 1000,
      token_type: data.token_type || "bearer",
      user: data.user,
    };

    return session;
  },

  /**
   * Refresh an expired session using the refresh token.
   * POST {SUPABASE_URL}/auth/v1/token?grant_type=refresh_token
   */
  refreshSession: async (refreshToken: string): Promise<SupabaseAuthSession> => {
    const { url, anonKey } = getSupabaseConfig();
    const endpoint = `${url}/auth/v1/token?grant_type=refresh_token`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: anonKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ refresh_token: refreshToken }),
    });

    const data = await handleSupabaseResponse<{
      access_token: string;
      refresh_token: string;
      expires_in?: number;
      token_type?: string;
      user: SupabaseUser;
    }>(res);

    const expiresIn = data.expires_in || 3600;
    const session: SupabaseAuthSession = {
      access_token: data.access_token,
      refresh_token: data.refresh_token,
      expires_in: expiresIn,
      expires_at: Date.now() + expiresIn * 1000,
      token_type: data.token_type || "bearer",
      user: data.user,
    };

    return session;
  },

  /**
   * Log out and revoke session.
   * POST {SUPABASE_URL}/auth/v1/logout
   */
  signOut: async (accessToken: string): Promise<void> => {
    const { url, anonKey } = getSupabaseConfig();
    const endpoint = `${url}/auth/v1/logout`;

    const res = await fetch(endpoint, {
      method: "POST",
      headers: {
        apikey: anonKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    await handleSupabaseResponse<void>(res);
  },
};

let activeRefreshPromise: Promise<SupabaseAuthSession | null> | null = null;

/**
 * Deduplicated token refresh helper.
 * When multiple API requests encounter 401 simultaneously, they join a single in-flight refresh.
 */
export async function refreshSessionDeduplicated(
  onTokenRefreshed?: (token: string | null) => void
): Promise<SupabaseAuthSession | null> {
  if (activeRefreshPromise) {
    return activeRefreshPromise;
  }

  const stored = getStoredSession();
  if (!stored || !stored.refresh_token) {
    clearStoredSession();
    if (onTokenRefreshed) onTokenRefreshed(null);
    return null;
  }

  activeRefreshPromise = (async () => {
    try {
      const refreshed = await supabaseAuth.refreshSession(stored.refresh_token);
      setStoredSession(refreshed);
      if (onTokenRefreshed) onTokenRefreshed(refreshed.access_token);
      return refreshed;
    } catch {
      clearStoredSession();
      if (onTokenRefreshed) onTokenRefreshed(null);
      return null;
    } finally {
      activeRefreshPromise = null;
    }
  })();

  return activeRefreshPromise;
}
