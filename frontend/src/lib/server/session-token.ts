/** Sealed session token — AES-256-GCM over the Appwrite session material.
 *
 * Why not a signed JWT (jose/SignJWT)? This module has to run in **both**
 * runtimes: `src/proxy.ts` (Edge) opens the cookie to gate routes, and the Node
 * route handlers seal it after sign-in. Web Crypto is available in both, so one
 * implementation serves both with no dependency — and GCM gives us
 * confidentiality *and* integrity (a tampered token fails to open), which a
 * plain signed cookie would not.
 *
 * Token layout: `base64url(iv).base64url(ciphertext||tag)`.
 *
 * The token carries the Appwrite *session secret*, which is why the cookie is
 * httpOnly and why the token is encrypted: a leaked cookie value alone is not a
 * usable Appwrite credential.
 */

export interface SessionPayload {
  /** Appwrite session secret — usable as a bearer credential against Appwrite. */
  secret: string;
  /** Appwrite session id, so JWTs can be minted for this exact session. */
  sessionId: string;
  /** Appwrite user id — lets the DAL identify the caller without a round-trip. */
  userId: string;
  /** Epoch ms; mirrors the cookie expiry. */
  expiresAt: number;
}

const IV_BYTES = 12;
const HKDF_SALT = "vdn-studio-session-v1";
const HKDF_INFO = "vdn-studio aes-256-gcm";

function toBase64Url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

/** `TextEncoder.encode` is typed as `Uint8Array<ArrayBufferLike>` while Web
 *  Crypto's `BufferSource` wants a concrete `ArrayBuffer` view. The runtime
 *  objects are identical (encode always allocates), so this narrows the type. */
function encodeUtf8(value: string): Uint8Array<ArrayBuffer> {
  return new Uint8Array(new TextEncoder().encode(value));
}

function fromBase64Url(value: string): Uint8Array<ArrayBuffer> {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded + "=".repeat((4 - (padded.length % 4)) % 4));
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

/** HKDF-SHA256 from the configured secret, so a passphrase of any shape
 *  becomes a proper 256-bit AES key. */
async function deriveKey(secret: string): Promise<CryptoKey> {
  const material = await crypto.subtle.importKey(
    "raw",
    encodeUtf8(secret),
    "HKDF",
    false,
    ["deriveKey"],
  );
  return crypto.subtle.deriveKey(
    {
      name: "HKDF",
      hash: "SHA-256",
      salt: encodeUtf8(HKDF_SALT),
      info: encodeUtf8(HKDF_INFO),
    },
    material,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

export async function sealToken(
  payload: SessionPayload,
  secret: string,
): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const key = await deriveKey(secret);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    encodeUtf8(JSON.stringify(payload)),
  );
  return `${toBase64Url(iv)}.${toBase64Url(new Uint8Array(ciphertext))}`;
}

/** Returns null for anything that is not a valid, unexpired token. */
export async function openToken(
  token: string,
  secret: string,
): Promise<SessionPayload | null> {
  const parts = token.split(".");
  if (parts.length !== 2) return null;
  try {
    const key = await deriveKey(secret);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: fromBase64Url(parts[0]) },
      key,
      fromBase64Url(parts[1]),
    );
    const payload = JSON.parse(new TextDecoder().decode(plaintext)) as SessionPayload;
    if (
      typeof payload.secret !== "string" ||
      typeof payload.sessionId !== "string" ||
      typeof payload.userId !== "string" ||
      typeof payload.expiresAt !== "number" ||
      payload.expiresAt <= Date.now()
    ) {
      return null;
    }
    return payload;
  } catch {
    return null; // wrong key, tampered token, malformed base64
  }
}
