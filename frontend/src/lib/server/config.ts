/** Server-side configuration for the auth BFF.
 *
 * Deliberately free of Node APIs (only `process.env`) so both the Edge proxy
 * and the Node route handlers can import it.
 *
 * Secrets carry no `NEXT_PUBLIC_` prefix, so Next never inlines them into the
 * client bundle. The `NEXT_PUBLIC_APPWRITE_*` / `NEXT_PUBLIC_API_BASE_URL`
 * values from the old client-side flow are still honoured as fallbacks, which
 * keeps an existing `.env` working while it is migrated.
 */

/** Our own session cookie — the Appwrite session never reaches the browser. */
export const SESSION_COOKIE = "vdn_session";

/** Our session window. Shorter than Appwrite's, and renewable (see session.ts). */
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 7;

/** Sliding renewal: re-issue the cookie once the session is older than this. */
export const SESSION_RENEW_AFTER_SECONDS = 60 * 60 * 24;

/** Minimum entropy we accept for the sealing key. */
const MIN_SESSION_SECRET_CHARS = 32;

function env(...names: string[]): string {
  for (const name of names) {
    const value = process.env[name];
    if (value && value.trim()) return value.trim();
  }
  return "";
}

export function appwriteEndpoint(): string {
  return env("APPWRITE_ENDPOINT", "NEXT_PUBLIC_APPWRITE_ENDPOINT");
}

export function appwriteProject(): string {
  return env("APPWRITE_PROJECT", "NEXT_PUBLIC_APPWRITE_PROJECT");
}

/** Server API key. Required to receive session secrets from Appwrite, and to
 *  mint gateway JWTs — see authReadiness(). */
export function appwriteApiKey(): string {
  return env("APPWRITE_API_KEY", "VDN_APPWRITE_KEY");
}

/** Where the VDN gateway lives. Server-side only: the browser now talks to
 *  /api/gateway and never to this host directly. */
export function gatewayUrl(): string {
  const raw = env("GATEWAY_URL", "VDN_GATEWAY_URL", "NEXT_PUBLIC_API_BASE_URL");
  return (raw || "http://localhost:8000").replace(/\/+$/, "");
}

export function sessionSecret(): string {
  const secret = env("SESSION_SECRET", "VDN_SESSION_SECRET");
  if (secret.length < MIN_SESSION_SECRET_CHARS) {
    throw new Error(
      `SESSION_SECRET is missing or too short (need >= ${MIN_SESSION_SECRET_CHARS} chars). ` +
        "Generate one with: node -e \"console.log(require('crypto').randomBytes(32).toString('base64url'))\"",
    );
  }
  return secret;
}

export interface AuthReadiness {
  ready: boolean;
  /** Human-readable, non-secret descriptions of what is missing. */
  problems: string[];
}

/** Why server-side sign-in cannot work yet, phrased for the UI and for 503s.
 *
 * The Appwrite API key is not optional for this flow: Appwrite only returns a
 * session's `secret` to API-key-authenticated server calls, and that secret is
 * what our cookie carries.
 */
export function authReadiness(): AuthReadiness {
  const problems: string[] = [];
  if (!appwriteEndpoint()) {
    problems.push(
      "APPWRITE_ENDPOINT is not set (e.g. https://sgp.cloud.appwrite.io/v1).",
    );
  }
  if (!appwriteProject()) {
    problems.push("APPWRITE_PROJECT is not set (the Appwrite project ID).");
  }
  if (!appwriteApiKey()) {
    problems.push(
      "APPWRITE_API_KEY is not set. Create a server key in the Appwrite console " +
        "with the sessions.write scope — Appwrite only returns session secrets to " +
        "API-key-authenticated server calls.",
    );
  }
  try {
    sessionSecret();
  } catch (error) {
    problems.push(error instanceof Error ? error.message : "SESSION_SECRET is invalid.");
  }
  return { ready: problems.length === 0, problems };
}
