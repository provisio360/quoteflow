import { NextResponse, type NextRequest } from "next/server";
import { getSessionCookie } from "better-auth/cookies";

// Central session sliding-refresh (ADR-0006: opaque server sessions, 7-day life,
// refreshed once per `updateAge`). Page guards, NavHeader and server actions all
// resolve the principal with `disableRefresh: true` because they run in contexts
// (RSC render) where writing the refreshed session cookie is illegal and throws
// an opaque `APIError: Failed to get session`. Middleware is the ONE request
// stage where a Set-Cookie is legal, so the refresh lives here.
//
// We proxy Better Auth's own /api/auth/get-session handler (a Route Handler,
// which may set cookies) and forward any Set-Cookie it emits onto the response.
// Most requests emit nothing — the cookie is only rewritten once the session
// crosses `updateAge`. We skip the round-trip entirely when no session cookie is
// present (unauthenticated traffic: /login, assets, etc.).
export async function middleware(request: NextRequest) {
  const response = NextResponse.next();

  if (!getSessionCookie(request)) return response;

  const res = await fetch(new URL("/api/auth/get-session", request.url), {
    headers: { cookie: request.headers.get("cookie") ?? "" },
  });

  // getSetCookie() preserves individual Set-Cookie headers; a plain get() would
  // comma-join them and corrupt the Expires date inside each cookie.
  for (const cookie of res.headers.getSetCookie()) {
    response.headers.append("set-cookie", cookie);
  }

  return response;
}

export const config = {
  // Run on page navigations and server-action POSTs, but never on the Better
  // Auth API itself — proxying /api/auth/get-session from middleware that also
  // matched it would recurse infinitely. Also skips Next internals and assets.
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico).*)"],
};
