import { NextResponse } from "next/server";
import "server-only";

/** POST /api/auth/logout — revoke the Appwrite session, drop the cached JWT and
 *  clear the cookie. Always succeeds from the browser's point of view. */
import { forgetGatewayJwt, revokeSession } from "@/lib/server/appwrite";
import { clearSession, readSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  const session = await readSession();
  if (session) {
    forgetGatewayJwt(session.sessionId);
    await revokeSession(session.secret);
  }
  await clearSession();
  return NextResponse.json({ ok: true });
}
