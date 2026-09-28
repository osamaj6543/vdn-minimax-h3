import { NextResponse, type NextRequest } from "next/server";
import "server-only";

/** /api/gateway/* — the only path from the browser to the VDN gateway.
 *
 * The route handler resolves the sealed cookie server-side, mints (or reuses) an
 * Appwrite JWT, and forwards the call with `Authorization: Bearer …`. The token
 * and the session secret never leave the server, and the browser never needs to
 * know the gateway's address.
 *
 * Bodies are buffered rather than streamed: the gateway reads uploads fully
 * anyway, and buffering avoids Node's `duplex: 'half'` requirements for
 * streaming request bodies. Responses (mp4 artifacts included) are streamed
 * straight back.
 */
import { gatewayUrl } from "@/lib/server/config";
import { appwriteFailure, gatewayJwt, isRevokedSession } from "@/lib/server/appwrite";
import { describeFailure, unreachableDetail } from "@/lib/server/gateway";
import { clearSession, readSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Only headers we mean to forward — never Cookie/Authorization/host. */
const FORWARD_REQUEST_HEADERS = ["content-type", "accept", "idempotency-key"];
const FORWARD_RESPONSE_HEADERS = [
  "content-type",
  "content-length",
  "content-disposition",
  "accept-ranges",
  "etag",
  "last-modified",
];

async function handle(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const { path } = await context.params;
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ detail: "Not signed in." }, { status: 401 });
  }

  const target = `${gatewayUrl()}/${path.join("/")}${request.nextUrl.search}`;
  const headers = new Headers();
  for (const name of FORWARD_REQUEST_HEADERS) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }

  let jwt: string;
  try {
    jwt = await gatewayJwt(session.userId, session.sessionId);
  } catch (error) {
    // Appwrite refusing the session is the one case that should sign the user
    // out; a missing API key or scope is an operator problem, so it is reported
    // as-is without touching the session.
    if (isRevokedSession(error)) {
      await clearSession();
      return NextResponse.json(
        { detail: "Session expired. Sign in again." },
        { status: 401 },
      );
    }
    const failure = appwriteFailure(error);
    return NextResponse.json({ detail: failure.detail }, { status: failure.status });
  }
  headers.set("Authorization", `Bearer ${jwt}`);

  const init: RequestInit = {
    method: request.method,
    headers,
    cache: "no-store",
    redirect: "manual",
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    init.body = await request.arrayBuffer();
  }

  let upstream: Response;
  try {
    upstream = await fetch(target, init);
  } catch (error) {
    const cause = describeFailure(error);
    // One line in the server log, so a 502 in the request log is explainable
    // without a debugger.
    console.error(`[gateway] ${request.method} ${target} failed: ${cause}`);
    return NextResponse.json(
      { detail: unreachableDetail(cause), cause, gateway: gatewayUrl() },
      { status: 502 },
    );
  }

  // A 401 from the gateway means it refused the token *we* minted — i.e. its own
  // Appwrite settings do not match the project this app signs in against. The
  // user's session is still good, so it is deliberately left intact; signing
  // them out here would loop them through the login page for an infra reason.
  if (upstream.status === 401) {
    console.error(
      `[gateway] ${request.method} ${target} rejected the server-minted JWT (401) — ` +
        "check the gateway's VDN_APPWRITE_* settings",
    );
    return NextResponse.json(
      {
        detail:
          "The gateway rejected the token minted by this server. On the gateway, set " +
          "VDN_APPWRITE_ENABLED=1 with VDN_APPWRITE_PROJECT, VDN_APPWRITE_ENDPOINT " +
          "(same region as this app) and VDN_APPWRITE_KEY — otherwise it only accepts X-API-Key.",
        cause: "gateway_rejected_token",
      },
      { status: 401 },
    );
  }

  const responseHeaders = new Headers();
  for (const name of FORWARD_RESPONSE_HEADERS) {
    const value = upstream.headers.get(name);
    if (value) responseHeaders.set(name, value);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    headers: responseHeaders,
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
