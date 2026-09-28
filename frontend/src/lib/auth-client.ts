/** Browser-side auth calls — thin wrappers over our own /api/auth routes.
 *
 * No SDK, no tokens: the client posts credentials to the server and afterwards
 * only ever learns its identity from `/api/auth/session`.
 */
import type { User } from "@/lib/types";

export class AuthError extends Error {
  status: number;
  /** Present on 503: exactly which server env vars are missing. */
  problems: string[];

  constructor(status: number, message: string, problems: string[] = []) {
    super(message);
    this.status = status;
    this.problems = problems;
  }
}

interface AuthResponse {
  user: User;
}

async function post<T>(path: string, body?: unknown): Promise<T> {
  const response = await fetch(path, {
    method: "POST",
    credentials: "same-origin",
    cache: "no-store",
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const payload = (await response.json().catch(() => ({}))) as {
    detail?: string;
    problems?: string[];
  } & Partial<T>;
  if (!response.ok) {
    throw new AuthError(
      response.status,
      payload.detail ?? response.statusText ?? "Request failed",
      payload.problems ?? [],
    );
  }
  return payload as T;
}

export function login(email: string, password: string) {
  return post<AuthResponse>("/api/auth/login", { email, password });
}

export function register(email: string, password: string, name: string) {
  return post<AuthResponse>("/api/auth/register", { email, password, name });
}

export function logout() {
  return post<{ ok: boolean }>("/api/auth/logout");
}

/** Who the server thinks we are. `user: null` means signed out. */
export async function fetchSession(): Promise<{ user: User | null; configured: boolean }> {
  try {
    const response = await fetch("/api/auth/session", {
      credentials: "same-origin",
      cache: "no-store",
    });
    if (!response.ok) return { user: null, configured: true };
    const payload = (await response.json()) as { user: User | null; configured?: boolean };
    return { user: payload.user, configured: payload.configured ?? true };
  } catch {
    return { user: null, configured: true };
  }
}
