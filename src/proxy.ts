import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { safeNext } from "@/lib/redirect";
import { COOKIE_NAME, verifySession } from "@/lib/session";

/**
 * Paths that do not require a session. The middleware now runs for them too so
 * they still receive the per-request Content-Security-Policy nonce; the auth
 * decision below simply lets them through.
 */
const PUBLIC_PATHS = new Set(["/login", "/api/auth/login", "/api/auth/logout", "/api/health"]);

/**
 * A fresh, unguessable nonce per document request.
 *
 * CSP nonces do not need to be cryptographically secret to be effective (they
 * only have to be unguessable to an attacker injecting markup), but a 128-bit
 * random value costs nothing and avoids any reuse concern.
 */
function createNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/g, "");
}

/**
 * The policy for this request.
 *
 * Production removes `'unsafe-inline'` from `script-src` and relies on the nonce
 * Next reads from this same header (it extracts the nonce and adds it to its
 * framework/flight scripts). `'strict-dynamic'` then authorises the chunks those
 * signed scripts load. `style-src` keeps `'unsafe-inline'` because Next inlines
 * critical CSS without a nonce.
 *
 * Development keeps `'unsafe-inline' 'unsafe-eval'` because Turbopack's HMR
 * runtime needs `eval`; the development server is not the production surface.
 */
export function contentSecurityPolicy(
  nonce: string,
  isDev: boolean = process.env.NODE_ENV !== "production",
): string {
  const scriptSrc = isDev ? "'self' 'unsafe-inline' 'unsafe-eval'" : `'self' 'nonce-${nonce}' 'strict-dynamic'`;
  return [
    "default-src 'self'",
    `script-src ${scriptSrc}`,
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "media-src 'self' blob:",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join("; ");
}

function withPolicy(response: NextResponse, policy: string): NextResponse {
  response.headers.set("Content-Security-Policy", policy);
  return response;
}

export async function proxy(request: NextRequest) {
  const nonce = createNonce();
  const policy = contentSecurityPolicy(nonce);

  // Next reads the nonce from the request's CSP header (see
  // get-script-nonce-from-header in the framework) and applies it to the
  // scripts it emits. Forward the modified headers, and send the same policy to
  // the browser.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.set("content-security-policy", policy);
  const passThrough = (): NextResponse =>
    withPolicy(NextResponse.next({ request: { headers: requestHeaders } }), policy);

  const pathname = request.nextUrl.pathname;
  if (PUBLIC_PATHS.has(pathname)) return passThrough();

  const secret = process.env.SESSION_SECRET ?? "";
  const token = request.cookies.get(COOKIE_NAME)?.value;
  const session = secret && token ? await verifySession(token, secret) : null;
  if (session) return passThrough();

  if (pathname.startsWith("/api/")) {
    return withPolicy(NextResponse.json({ error: "Authentication failed" }, { status: 401 }), policy);
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";
  const next = safeNext(request.nextUrl.pathname);
  if (next !== "/") url.searchParams.set("next", next);
  return withPolicy(NextResponse.redirect(url), policy);
}

export const config = {
  matcher: [
    /*
     * Static assets and the PWA manifest are excluded: they are not documents and
     * the manifest must stay readable without a session (see README). The login
     * page and the public auth/health endpoints are matched on purpose so they
     * also receive the per-request CSP nonce; `PUBLIC_PATHS` above lets them
     * through without a session.
     *
     * The HMR paths are excluded because they are a WebSocket upgrade. Running
     * them through this middleware returns a normal HTTP response, the handshake
     * fails, and in development the client never finishes hydrating. They do not
     * exist in the production build.
     */
    "/((?!_next/static|_next/image|_next/hmr|_next/webpack-hmr|favicon.ico|icon.svg|manifest\\.webmanifest(?=$|[/?#])|robots.txt).*)",
  ],
};
