import "server-only";

/** Cookie-side session helpers: read, write and clear the sealed token.
 *
 * Cookies are set **on the server** with the options Next recommends
 * (httpOnly · secure · sameSite · expires · path) — see
 * node_modules/next/dist/docs/01-app/02-guides/authentication.md.
 */
import { cookies } from "next/headers";

import {
  SESSION_COOKIE,
  SESSION_RENEW_AFTER_SECONDS,
  SESSION_TTL_SECONDS,
  sessionSecret,
} from "./config";
import { openToken, sealToken, type SessionPayload } from "./session-token";

/** Opens the cookie. A missing or unusable secret reads as "no session" so an
 *  unconfigured deployment still renders the sign-in page instead of crashing. */
export async function readSession(): Promise<SessionPayload | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await openToken(token, sessionSecret());
  } catch {
    return null;
  }
}

export async function writeSession(
  material: Omit<SessionPayload, "expiresAt">,
): Promise<SessionPayload> {
  const payload: SessionPayload = {
    ...material,
    expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
  };
  const token = await sealToken(payload, sessionSecret()); // throws if unconfigured
  (await cookies()).set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(payload.expiresAt),
  });
  return payload;
}

export async function clearSession(): Promise<void> {
  (await cookies()).set(SESSION_COOKIE, "", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: new Date(0),
  });
}

/** True once a session is old enough to deserve a fresh cookie. */
export function shouldRenew(payload: SessionPayload): boolean {
  const age = SESSION_TTL_SECONDS * 1000 - (payload.expiresAt - Date.now());
  return age > SESSION_RENEW_AFTER_SECONDS * 1000;
}
