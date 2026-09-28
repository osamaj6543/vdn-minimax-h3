import { NextResponse, type NextRequest } from "next/server";

/** Server-side route guard (Next 16's Proxy — the renamed Middleware).
 *
 * This is an **optimistic** check, exactly as the Next auth guide prescribes:
 * it opens the sealed cookie and redirects, with no Appwrite round-trip, so it
 * stays cheap on every request and on prefetches. Real authorization happens in
 * the route handlers and `/api/auth/session`; if a cookie is well-formed but the
 * session was revoked upstream, that endpoint clears it and the shell returns
 * here cookie-less, so the redirect resolves after one hop instead of looping.
 */
import { SESSION_COOKIE, sessionSecret } from "@/lib/server/config";
import { openToken } from "@/lib/server/session-token";
import { PROTECTED_ROUTES } from "@/lib/nav";

const AUTH_PAGES = ["/login", "/register"];

async function readSession(request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token) return null;
  try {
    return await openToken(token, sessionSecret());
  } catch {
    return null; // unconfigured deployment: treat as signed out
  }
}

export async function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const session = await readSession(request);

  const isProtected = PROTECTED_ROUTES.some(
    (route) => pathname === route || pathname.startsWith(`${route}/`),
  );
  if (isProtected && !session) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    url.searchParams.set("next", pathname);
    return NextResponse.redirect(url);
  }

  if (session && AUTH_PAGES.includes(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/dashboard";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/jobs/:path*", "/settings/:path*", "/login", "/register"],
};
