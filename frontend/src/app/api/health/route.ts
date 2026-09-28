import { NextResponse } from "next/server";
import "server-only";

/** GET /api/health — reachability probe for the shell's status pill.
 *
 * Mirrors the gateway's own unauthenticated `/healthz`, and reports *why* it is
 * down (`cause`: ECONNREFUSED, ENOTFOUND, …) rather than just a boolean.
 * Deployment details (the gateway address, the Appwrite project) are only
 * disclosed to a signed-in caller; a failure code is not sensitive and is what
 * makes the pill useful.
 */
import { appwriteProject, gatewayUrl } from "@/lib/server/config";
import { probeGateway } from "@/lib/server/gateway";
import { readSession } from "@/lib/server/session";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const probe = await probeGateway();
  if (!probe.ok) {
    const session = await readSession();
    return NextResponse.json({
      ok: false,
      cause: probe.cause,
      ...(session ? { gateway: gatewayUrl(), appwriteProject: appwriteProject() } : {}),
    });
  }

  const session = await readSession();
  if (!session) return NextResponse.json({ ok: true });
  return NextResponse.json({
    ok: true,
    gateway: gatewayUrl(),
    appwriteProject: appwriteProject(),
    signedIn: true,
  });
}

