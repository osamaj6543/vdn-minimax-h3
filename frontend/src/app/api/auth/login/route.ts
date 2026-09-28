import { NextResponse, type NextRequest } from "next/server";
import "server-only";

/** POST /api/auth/login — the credential exchange happens here, on the server.
 *
 * The browser posts email + password to our own origin; we create the Appwrite
 * session server-side and keep its secret in an encrypted httpOnly cookie. The
 * password and the Appwrite session never touch client JavaScript.
 */
import { authReadiness } from "@/lib/server/config";
import { appwriteFailure, loginWithPassword } from "@/lib/server/appwrite";
import { writeSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  const readiness = authReadiness();
  if (!readiness.ready) {
    return NextResponse.json(
      { detail: "Server-side sign-in is not configured.", problems: readiness.problems },
      { status: 503 },
    );
  }

  let body: { email?: unknown; password?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "Expected a JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  if (!email || !password) {
    return NextResponse.json(
      { detail: "Email and password are required." },
      { status: 400 },
    );
  }

  try {
    const material = await loginWithPassword(email, password);
    await writeSession({
      secret: material.secret,
      sessionId: material.sessionId,
      userId: material.userId,
    });
    return NextResponse.json({ user: material.user });
  } catch (error) {
    const failure = appwriteFailure(error);
    return NextResponse.json({ detail: failure.detail }, { status: failure.status });
  }
}
