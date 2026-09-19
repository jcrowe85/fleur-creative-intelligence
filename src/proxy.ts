import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { authBypassed } from "@/lib/dev-bypass";

const AUTH_COOKIE = "fleur_creative_session";

// Optimistic auth only. Next runs Proxy on every request including prefetches,
// so it must not hit the database — it just bounces requests with no session
// cookie. Whether the cookie maps to a live session is decided by the Data
// Access Layer (src/lib/dal.ts) on pages and route handlers.
export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl;

  // Local preview against a local database: let everything through. Requires
  // DEV_NO_AUTH=1 AND a localhost DATABASE_URL, so it cannot engage in
  // production even if the flag is set there by mistake.
  if (authBypassed()) return NextResponse.next();

  if (pathname.startsWith("/login") || pathname.startsWith("/api/auth/session")) {
    return NextResponse.next();
  }

  // Machine endpoints authenticate with CRON_SECRET, not the session cookie.
  // The analysis worker lives under /api/cron for exactly this reason.
  if (pathname.startsWith("/api/cron")) {
    return NextResponse.next();
  }

  // The creator studio is open: a visitor gets a guest account instead of a
  // login wall. These paths handle their own auth (guest-aware) — do not bounce
  // them to /login. The internal dashboard ("/") stays gated below.
  if (
    pathname.startsWith("/tools/creator") ||
    pathname.startsWith("/api/reference") ||
    pathname.startsWith("/api/auth/guest")
  ) {
    return NextResponse.next();
  }

  if (req.cookies.get(AUTH_COOKIE)?.value) {
    return NextResponse.next();
  }

  // API callers get a status code they can act on; only pages get bounced,
  // since redirecting a fetch() lands HTML in a JSON parse.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }

  const loginUrl = req.nextUrl.clone();
  loginUrl.pathname = "/login";
  loginUrl.search = `?from=${encodeURIComponent(pathname)}`;
  return NextResponse.redirect(loginUrl);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
