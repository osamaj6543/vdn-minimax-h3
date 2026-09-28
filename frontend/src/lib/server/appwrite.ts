import "server-only";

/** Server-side Appwrite access — the only place credentials are exchanged.
 *
 * This is the Data Access Layer the Next auth guide recommends: route handlers
 * call these functions and receive **DTOs**, never raw Appwrite models, so no
 * field we have not explicitly chosen can leak to the browser.
 *
 * Two clients are used:
 *  - admin: endpoint + project + API key. Required: Appwrite only returns a
 *    session's `secret` to API-key-authenticated calls, and admin JWTs are
 *    minted with it.
 *  - session: endpoint + project + the user's session secret. Used for
 *    `account.get()` and session deletion, so permissions stay user-scoped.
 */
import { Account, AppwriteException, Client, ID, Users, type Models } from "node-appwrite";

import { appwriteApiKey, appwriteEndpoint, appwriteProject } from "./config";

/** What the browser is allowed to know about the caller. */
export interface UserDto {
  id: string;
  email: string;
  name: string;
  labels: string[];
  registeredAt: string;
}

export interface SessionMaterial {
  secret: string;
  sessionId: string;
  userId: string;
  user: UserDto;
}

export function toUserDto(user: Models.User<Models.Preferences>): UserDto {
  return {
    id: user.$id,
    email: user.email,
    name: user.name,
    labels: user.labels ?? [],
    registeredAt: user.registration,
  };
}

function adminClient(): Client {
  const client = new Client()
    .setEndpoint(appwriteEndpoint())
    .setProject(appwriteProject());
  const key = appwriteApiKey();
  if (key) client.setKey(key);
  return client;
}

function sessionClient(secret: string): Client {
  return new Client()
    .setEndpoint(appwriteEndpoint())
    .setProject(appwriteProject())
    .setSession(secret);
}

/** Exchanges credentials for an Appwrite session, server-side. */
export async function loginWithPassword(
  email: string,
  password: string,
): Promise<SessionMaterial> {
  const account = new Account(adminClient());
  const session = await account.createEmailPasswordSession({ email, password });
  if (!session.secret) {
    throw new AppwriteException(
      "Appwrite returned no session secret. This happens when the request is " +
        "not authenticated with an API key — set APPWRITE_API_KEY (scope: sessions.write).",
      500,
      "session_secret_missing",
    );
  }
  // Read the profile with the *session* client, not the API key: permissions
  // stay user-scoped and the result reflects this user only.
  const user = await new Account(sessionClient(session.secret)).get();
  return {
    secret: session.secret,
    sessionId: session.$id,
    userId: session.userId,
    user: toUserDto(user),
  };
}

/** Creates the account, then immediately signs in so the caller gets a session. */
export async function registerAccount(
  email: string,
  password: string,
  name: string,
): Promise<void> {
  await new Account(adminClient()).create({
    userId: ID.unique(),
    email,
    password,
    name,
  });
}

/** Resolves the signed-in user for a session secret, or null when it is stale. */
export async function currentUser(secret: string): Promise<UserDto | null> {
  try {
    const user = await new Account(sessionClient(secret)).get();
    return toUserDto(user);
  } catch {
    return null; // revoked/expired session
  }
}

/** Revokes the session behind this cookie (this device only). */
export async function revokeSession(secret: string): Promise<void> {
  try {
    await new Account(sessionClient(secret)).deleteSession({ sessionId: "current" });
  } catch {
    /* already revoked — sign-out must not fail on this */
  }
}

/* -------------------------------------------------------------------------- */
/* Gateway JWT                                                                */
/* -------------------------------------------------------------------------- */

/** Appwrite caps JWT lifetime at 1 hour; 15 minutes matches what the gateway
 *  expects today. Cached per session so a burst of API calls mints once. */
const JWT_DURATION_SECONDS = 900;
const JWT_REFRESH_MS = 10 * 60 * 1000;
const jwtCache = new Map<string, { jwt: string; expiresAt: number }>();

/** Mints the JWT the VDN gateway accepts (`Authorization: Bearer ...`).
 *
 * This is the whole point of the BFF: the token is created on the server, used
 * on the server, and never sent to the browser.
 */
export async function gatewayJwt(userId: string, sessionId: string): Promise<string> {
  const cached = jwtCache.get(sessionId);
  if (cached && cached.expiresAt > Date.now()) return cached.jwt;

  const key = appwriteApiKey();
  if (!key) {
    throw new AppwriteException(
      "APPWRITE_API_KEY is not set; cannot mint a gateway JWT.",
      503,
      "missing_api_key",
    );
  }
  const { jwt } = await new Users(adminClient()).createJWT({
    userId,
    sessionId,
    duration: JWT_DURATION_SECONDS,
  });
  jwtCache.set(sessionId, { jwt, expiresAt: Date.now() + JWT_REFRESH_MS });
  return jwt;
}

/** Drops a cached JWT, so sign-out cannot leave a usable token in memory. */
export function forgetGatewayJwt(sessionId: string): void {
  jwtCache.delete(sessionId);
}

/** True when Appwrite says the session behind our cookie is gone (revoked or
 *  expired) — the one failure that should end the local session. */
export function isRevokedSession(error: unknown): boolean {
  return error instanceof AppwriteException && error.code === 401;
}

/** Maps Appwrite failures onto HTTP status + a message safe to show a user. */
export function appwriteFailure(error: unknown): { status: number; detail: string } {
  if (error instanceof AppwriteException) {
    const status = error.code && error.code >= 400 ? error.code : 502;
    if (status === 401) {
      return { status: 401, detail: "Invalid email or password." };
    }
    if (status === 409) {
      return { status: 409, detail: "An account with that email already exists." };
    }
    if (status === 429) {
      return {
        status: 429,
        detail: "Too many attempts. Wait a moment and try again, or use an API key.",
      };
    }
    if (status === 403) {
      return {
        status: 403,
        detail: `${error.message} — the server API key needs the sessions.write (login) and users.write (gateway JWT) scopes.`,
      };
    }
    if (status === 503) return { status: 503, detail: error.message };
    return { status, detail: error.message || "Appwrite rejected the request." };
  }
  return {
    status: 502,
    detail: error instanceof Error ? error.message : "Unexpected auth failure.",
  };
}
