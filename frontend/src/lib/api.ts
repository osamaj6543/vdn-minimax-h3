/** Typed client for the VDN gateway — through our own server, never directly.
 *
 * The browser holds no credential: it calls `/api/gateway/*` on our origin, and
 * the route handler there attaches an Appwrite JWT minted server-side from the
 * encrypted httpOnly session cookie (see src/lib/server/appwrite.ts).
 *
 * A 401 therefore means "that session is gone" — the caller signs in again
 * rather than retrying with a refreshed token, because no token is ever here.
 */
export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

const PROXY_BASE = "/api/gateway";

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers = new Headers(init.headers);
  if (init.body && !(init.body instanceof FormData) && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const response = await fetch(`${PROXY_BASE}${path}`, {
    ...init,
    headers,
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    let detail = response.statusText;
    try {
      const body = (await response.json()) as { detail?: unknown };
      detail =
        typeof body.detail === "string" ? body.detail : JSON.stringify(body.detail ?? body);
    } catch {
      /* keep statusText */
    }
    throw new ApiError(response.status, detail);
  }
  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

// ---------------- gateway endpoints ----------------

export function createT2V(body: CreateBody) {
  return request<{ job_id: string }>("/v1/video/t2v", { method: "POST", body: JSON.stringify(body) });
}
export function createI2V(body: CreateBody & { first_image: string }) {
  return request<{ job_id: string }>("/v1/video/i2v", { method: "POST", body: JSON.stringify(body) });
}
export function createL2V(body: CreateBody & { last_image: string }) {
  return request<{ job_id: string }>("/v1/video/l2v", { method: "POST", body: JSON.stringify(body) });
}
export function createFL2V(body: CreateBody & { first_image: string; last_image: string }) {
  return request<{ job_id: string }>("/v1/video/fl2v", { method: "POST", body: JSON.stringify(body) });
}
export function createRef2V(body: CreateBody & { images: string[] }) {
  return request<{ job_id: string }>("/v1/video/ref2v", { method: "POST", body: JSON.stringify(body) });
}

export interface CreateBody {
  prompt: string;
  num_frames?: number;
  num_steps?: number;
  seed?: number;
  priority?: string;
  webhook_url?: string;
}

export function listJobs(limit = 50) {
  return request<{ jobs: import("@/lib/types").JobView[] }>(`/v1/jobs?limit=${limit}`);
}

export function getJob(jobId: string) {
  return request<import("@/lib/types").JobView>(`/v1/jobs/${jobId}`);
}

export function cancelJob(jobId: string) {
  return request<import("@/lib/types").JobView>(`/v1/jobs/${jobId}`, { method: "DELETE" });
}

export async function uploadImage(file: File): Promise<string> {
  const form = new FormData();
  form.append("file", file);
  const result = await request<{ key: string }>("/v1/uploads", { method: "POST", body: form });
  return result.key;
}

/** Fetch an auth-gated artifact (mp4) as a blob URL for <video src>.
 *  Same-origin now: the session cookie authenticates the proxy hop. */
export async function fetchArtifactUrl(artifactUrl: string): Promise<string> {
  const response = await fetch(`${PROXY_BASE}${artifactUrl}`, {
    credentials: "same-origin",
    cache: "no-store",
  });
  if (!response.ok) {
    throw new ApiError(response.status, `artifact fetch failed (${response.status})`);
  }
  const blob = await response.blob();
  return URL.createObjectURL(blob);
}

// ---------------- server endpoints ----------------

export interface HealthReport {
  ok: boolean;
  /** Why the probe failed, e.g. "ECONNREFUSED". */
  cause?: string;
  /** Deployment details are only present for a signed-in caller. */
  gateway?: string;
  appwriteProject?: string;
  signedIn?: boolean;
}

/** Either the server or the shell's status pill wants to know. */
export async function checkHealth(): Promise<HealthReport> {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    if (!response.ok) return { ok: false };
    return (await response.json()) as HealthReport;
  } catch {
    return { ok: false };
  }
}
