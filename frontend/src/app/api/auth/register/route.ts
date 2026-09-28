import { NextResponse, type NextRequest } from "next/server";
import "server-only";

/** POST /api/auth/register — create the account, then sign in server-side so
 *  the caller walks away with an httpOnly session like any other login. */
import { authReadiness } from "@/lib/server/config";
import {
  appwriteFailure,
  loginWithPassword,
  registerAccount,
} from "@/lib/server/appwrite";
import { writeSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIN_PASSWORD = 8;

export async function POST(request: NextRequest) {
  const readiness = authReadiness();
  if (!readiness.ready) {
    return NextResponse.json(
      { detail: "Server-side sign-up is not configured.", problems: readiness.problems },
      { status: 503 },
    );
  }

  let body: { email?: unknown; password?: unknown; name?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "Expected a JSON body." }, { status: 400 });
  }

  const email = typeof body.email === "string" ? body.email.trim() : "";
  const password = typeof body.password === "string" ? body.password : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!email || !password || !name) {
    return NextResponse.json(
      { detail: "Name, email and password are required." },
      { status: 400 },
    );
  }
  if (password.length < MIN_PASSWORD) {
    return NextResponse.json(
      { detail: `Password must be at least ${MIN_PASSWORD} characters.` },
      { status: 400 },
    );
  }

  try {
    await registerAccount(email, password, name);
    const material = await loginWithPassword(email, password);
    await writeSession({
      secret: material.secret,
      sessionId: material.sessionId,
      userId: material.userId,
    });
    return NextResponse.json({ user: material.user }, { status: 201 });
  } catch (error) {
    const failure = appwriteFailure(error);
    return NextResponse.json({ detail: failure.detail }, { status: failure.status });
  }
}
