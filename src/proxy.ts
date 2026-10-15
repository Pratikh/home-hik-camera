import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/redirect";
import { COOKIE_NAME, verifySession } from "@/lib/session";

export async function proxy(request: NextRequest) {
  const secret = process.env.SESSION_SECRET ?? "";
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = secret && token ? await verifySession(token, secret) : null;
  if (session) return NextResponse.next();

  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Authentication failed" }, { status: 401 });
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = safeNext(request.nextUrl.pathname);
  if (next !== "/") url.searchParams.set("next", next);
  return NextResponse.redirect(url);
}

export const config = {
  matcher: [
    /*
     * `manifest\.webmanifest` is public on purpose: it is a PWA manifest with no
     * secrets (name, colours, icon). Redirecting it to /login made the browser
     * parse the login HTML as JSON and report a manifest syntax error. The
     * lookahead keeps the exclusion to that exact path, so `/manifest.webmanifest.bak`
     * (or any other prefix) still requires a session.
     */
    "/((?!_next/static|_next/image|favicon.ico|icon.svg|manifest\\.webmanifest(?=$|[/?#])|robots.txt|login|api/health|api/auth/login|api/auth/logout).*)",
  ],
};
