import { NextResponse } from "next/server";
import "server-only";

/** GET /api/auth/session — who is signed in, according to the server.
 *
 * The browser asks this instead of holding a session: the cookie is httpOnly,
 * so this endpoint is the only way the UI can learn its identity. A session
 * Appwrite no longer accepts is dropped here, and the cookie slides forward
 * once it is a day old.
 */
import { authReadiness } from "@/lib/server/config";
import { currentUser } from "@/lib/server/appwrite";
import { clearSession, readSession, shouldRenew, writeSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const readiness = authReadiness();
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ user: null, configured: readiness.ready });
  }

  const user = await currentUser(session.secret);
  if (!user) {
    await clearSession(); // revoked or expired upstream
    return NextResponse.json({ user: null, configured: readiness.ready });
  }

  if (shouldRenew(session)) {
    await writeSession({
      secret: session.secret,
      sessionId: session.sessionId,
      userId: session.userId,
    });
  }

  return NextResponse.json({ user, configured: readiness.ready });
}
