import type { NextConfig } from "next";

const extraOrigins = (process.env.DEV_ALLOWED_ORIGINS ?? "")
  .split(",")
  .map((item) => item.trim())
  .filter(Boolean);

/**
 * Static security headers.
 *
 * The Content-Security-Policy is **not** set here: it is generated per request
 * in `src/proxy.ts` so that a fresh nonce can be embedded in both the policy and
 * Next's inline scripts (`script-src 'nonce-…' 'strict-dynamic'` in production).
 * A static CSP from this file would be sent in addition to the nonce policy and
 * the browser would intersect both, which would either block Next's scripts or
 * force `'unsafe-inline'` back in.
 *
 * HSTS is intentionally omitted: it is only safe once the production HTTPS
 * deployment and domain behaviour have been verified (see README/Security).
 */
const nextConfig: NextConfig = {
  output: "standalone",
  poweredByHeader: false,
  reactStrictMode: true,
  ...(extraOrigins.length > 0 ? { allowedDevOrigins: extraOrigins } : {}),
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
