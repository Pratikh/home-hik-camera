# FRN — Frontend security, secret leakage, logging/privacy and dependency/supply chain

Read-only audit of the Home CCTV Hub at `/Users/guruswamihiremath/Desktop/projects/home-hik-camera`.
Audit date: 2026-11-03/04. Completed by the Lead after the delegated frontend auditor failed to return.

Scope: `next.config.ts`, `src/app/**` (pages, layouts, error boundary, manifest), `src/components/**`,
`src/lib/client-api.ts` and client helpers, API error responses, `package.json`/`package-lock.json`,
Dockerfiles/base images, model download scripts, `.dockerignore`, `public/`, existing security tests.

Method: source review, `npm audit` (read-only), and a **production build of a throwaway copy** of the repo
in `/tmp` (`next build` + standalone server on port 3101) to observe the real production headers,
cookie flags, middleware and client bundle. The build copy contained no `.env`, no `data/` and no
`backups/`; all dynamic requests used a throwaway database and test-only credentials. No source,
configuration, lockfile or dependency in the audited checkout was modified.

---

## Findings

### FRN-01 — MEDIUM — Production CSP permits inline scripts and omits `object-src`, `base-uri` and `form-action`
- **Component:** security headers / Content-Security-Policy
- **Location:** `next.config.ts:16-26,33-45`; verified on the production build
- **Evidence:** the emitted production header is
  `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self';
  script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'`.
  `'unsafe-inline'` in `script-src` is required by Next's inline bootstrap script because no nonce/hash
  strategy is used; `'unsafe-eval'` is correctly development-only. `object-src`, `base-uri`,
  `form-action` and `frame-src` are unset (inheriting `default-src 'self'` for object/frame, but
  `base-uri`/`form-action` are not covered by `default-src`).
- **Attack scenario:** an HTML-injection bug anywhere in the app (none found today) would be much easier
  to turn into script execution because inline scripts are allowed; a `<base href>` injection could
  retarget relative URLs, and an injected form could post to an external origin.
- **Impact:** weakens the last line of defence for a CCTV UI that renders camera names, event captions
  and notification text. No XSS sink exists in the current tree (FRN-09), so this is defense-in-depth.
- **Remediation:** move to a nonce-based `script-src 'nonce-…' 'strict-dynamic'` (Next supports reading a
  nonce from headers in the App Router), add `object-src 'none'; base-uri 'self'; form-action 'self'`,
  and drop `'unsafe-inline'` from `script-src`.
- **Status:** VERIFIED (static + production build).
- **Safe-test status:** SAFELY TESTED (isolated production build).

### FRN-02 — LOW — No HSTS and no `upgrade-insecure-requests`; the `Secure` cookie flag still depends on a header
- **Component:** response headers / cookie transport
- **Location:** `next.config.ts:33-45` (no `Strict-Transport-Security`); `src/lib/auth.ts:16-37`
- **Evidence:** production responses carry `X-Content-Type-Options`, `Referrer-Policy`,
  `X-Frame-Options`, `Permissions-Policy` and CSP, but no `Strict-Transport-Security` and no
  `upgrade-insecure-requests` directive. The session cookie is only `Secure` when `COOKIE_SECURE=true`
  or `x-forwarded-proto: https` is present (verified dynamically: plain HTTP → no `Secure`;
  `X-Forwarded-Proto: https` → `Secure`). The deployed `.env` in this checkout has `COOKIE_SECURE`
  set to a false-like value (`AUTH-05`).
- **Attack scenario:** on the HTTPS tunnel, a user who reaches the hub once over `http://<lan-ip>:3000`
  (or any downgrade path) gets no HSTS protection and can expose the session cookie if `Secure` was not
  set on that request. Cross-reference `AUTH-05`.
- **Impact:** session-theft risk on mixed HTTP/HTTPS deployments; low on a pure-HTTPS deployment where
  the tunnel always sets `X-Forwarded-Proto`.
- **Remediation:** set `COOKIE_SECURE=true` in production and add `Strict-Transport-Security:
  max-age=15552000; includeSubDomains` plus `upgrade-insecure-requests` when served over HTTPS; prefer a
  `__Host-` cookie name.
- **Status:** VERIFIED (static + production build); real tunnel header behaviour SUSPECTED.
- **Safe-test status:** SAFELY TESTED.

### FRN-03 — LOW — Sensitive JSON APIs have no explicit `Cache-Control: no-store`
- **Component:** API responses carrying CCTV metadata
- **Location:** e.g. `src/app/api/events/route.ts:38-39`, `src/app/api/faces/route.ts`,
  `src/app/api/notifications/route.ts`, `src/app/api/cameras/route.ts`, `src/app/api/dvr/*` — none sets
  `Cache-Control`. By contrast the media routes are correct: `snapshot/route.ts:27` and
  `faces/[id]/image/route.ts:45-50` send `private, no-store`; `playback/thumbnail/sprite` sends
  `private, max-age=31536000, immutable`.
- **Evidence:** dynamic responses in the isolated instance had `content-type: application/json` and no
  cache header (the Next dev/prod server does not add one for route handlers).
- **Attack scenario:** a browser heuristic cache, an intermediate corporate proxy, or a future CDN rule
  could store event/face/notification/camera JSON (camera names, event times, face counts, DVR status).
  Cloudflare, if in front of the hub, does not cache JSON by default, but relying on that is fragile.
- **Impact:** private-metadata caching in shared proxies; low likelihood, easy to fix.
- **Remediation:** add `Cache-Control: private, no-store` to authenticated JSON endpoints (a small shared
  helper), and keep `Vary: Cookie` where relevant.
- **Status:** VERIFIED (static + isolated dynamic).
- **Safe-test status:** SAFELY TESTED.

### FRN-04 — LOW — Cross-site form login is accepted (login CSRF); no Origin/CSRF token anywhere
- **Component:** `/api/auth/login`; all state-changing routes
- **Location:** `src/app/api/auth/login/route.ts:19-23,48-70,126-132`; no `Origin`/`Sec-Fetch-Site`
  checks in any route handler
- **Evidence:** the login route accepts `application/x-www-form-urlencoded` and `multipart/form-data`
  and returns `303` plus a session cookie (verified in the isolated instance with
  `Origin: https://evil.example`). `SameSite=Lax` on the session cookie protects the authenticated
  mutating endpoints from cross-site POST, but it does not prevent an attacker from *setting* a session
  cookie via the login endpoint.
- **Attack scenario:** a malicious page auto-submits a login form with the attacker's hub credentials, so
  the victim's browser silently adopts the attacker's account/session. On a single-household hub the
  attacker gains no victim data (the victim sees only the attacker's account), but the victim's later
  actions are performed under an account the attacker controls, and the victim can be stranded in a
  VIEWER account.
- **Impact:** low on this deployment; it is the only CSRF gap left once `SameSite=Lax` is considered.
- **Remediation:** require a same-origin `Origin`/`Sec-Fetch-Site` check on login and on every mutating
  handler; consider removing form-encoded login in production or adding a per-session CSRF token.
- **Status:** VERIFIED (static + isolated dynamic).
- **Safe-test status:** SAFELY TESTED (throwaway account).

### FRN-05 — LOW — 16 known vulnerabilities in the dependency tree, all in development/build tooling; production dependencies are clean
- **Component:** npm dependencies
- **Location:** `package.json:32-53`; `package-lock.json` (lockfileVersion 3)
- **Evidence:** `npm audit` → 16 (15 moderate, 1 high). The high is
  `zod < 4.6.6` (GHSA-mrhx-c7xc-m3w5, memory exhaustion, CVSS 7.5) reached through
  `eslint-plugin-react-hooks@7.1.1`; the moderates are `minimatch < 11.0.1`
  (GHSA-g3hv-75wg-m249, ReDoS via globparts) reached via `eslint`, `eslint-config-next` and
  `@typescript-eslint/*`. `npm audit --omit=dev` returns **0 vulnerabilities**: `next@16.4.2`,
  `react@19.3.1`, `react-dom@19.3.1`, `hls.js@1.7.3`, `fast-xml-parser@5.11.2`,
  `react-day-picker@10.0.2`, `server-only@0.0.1` have no known advisories at audit time.
- **Attack scenario:** the vulnerable packages run only in the lint/build toolchain on a developer or CI
  machine, not in the standalone runtime image (`Dockerfile:27-29` copies only the Next standalone
  output). A malicious glob pattern would require an attacker to control lint input.
- **Impact:** build-time/CI only; no production runtime exposure.
- **Remediation:** schedule a dev-dependency refresh (eslint 10/`typescript-eslint` update pulls fixed
  `minimatch`/`zod`); keep `npm ci` from the lockfile; add `npm audit --omit=dev` as a release gate and a
  separate informational dev audit.
- **Status:** VERIFIED (tool output, 2026-11-03).
- **Safe-test status:** SAFELY TESTED.

### FRN-06 — LOW — Container base images use mutable tags and Python runtime requirements are partially ranged
- **Component:** supply chain / reproducibility
- **Location:** `Dockerfile:5,10,17` (`node:24-alpine3.21`), `mediamtx/Dockerfile:3,5`
  (`docker.io/bluenviron/mediamtx:1.21.1`, `node:24-alpine3.21`), `face-worker/Dockerfile:14` and
  `object-worker/Dockerfile:10` (`python:3.12-slim`), `*/requirements.txt` (`numpy>=1.26,<3`)
- **Evidence:** no image is digest-pinned; `python:3.12-slim` is a floating major/minor tag; the two ONNX
  runtimes are pinned exactly (`opencv-python-headless==4.12.0.88`, `onnxruntime==1.23.2`) but `numpy` is
  a range in both runtime requirement files. Model downloads are HTTPS + hard-coded SHA-256 verified
  (positive — see `WRK-11`).
- **Attack scenario:** a compromised or re-tagged registry image silently changes the runtime of the
  camera stack between rebuilds; a range upgrade introduces an unreviewed NumPy version.
- **Impact:** supply-chain drift / reproducibility risk; no known exploited image.
- **Remediation:** pin base images by digest, pin `numpy` exactly, and rebuild/attest images on a schedule.
- **Status:** VERIFIED (static).
- **Safe-test status:** SAFELY TESTED.

### FRN-07 — LOW — The development build in the checkout contains source maps; production builds do not
- **Component:** build artifacts / information disclosure
- **Location:** `.next/dev/**` (155 `.js.map` files, including server route maps); production build
  verified separately
- **Evidence:** `find .next -name '*.map' | wc -l` → 155, all under `.next/dev`. A throwaway production
  build produced **0** `.map` files and 0 `sourceMappingURL` references, and the deployed artifact is the
  Next standalone output (`Dockerfile:27-29`), which contains none. `.next` is gitignored and
  dockerignored.
- **Attack scenario:** only if `.next/dev` or the source tree were served/deployed by mistake (e.g. a
  `next dev` instance exposed on the LAN) would server source, internal paths and logic be readable.
- **Impact:** informational; no production exposure found.
- **Remediation:** keep `next dev` bound to localhost when not needed on the LAN (`npm run dev` currently
  passes `--hostname 0.0.0.0`), and never ship `.next/dev`.
- **Status:** VERIFIED (static + production build).
- **Safe-test status:** SAFELY TESTED.

### FRN-08 — INFO — Known repository hygiene issue: `backups/` enters the Docker build context
- **Component:** `.dockerignore` / image build
- **Location:** `.dockerignore:1-17` (no `backups` entry); `Dockerfile:13` (`COPY . .` in builder)
- **Impact:** private CCTV snapshots/face crops and a copy of the database are copied into the builder
  stage and build cache (not the final runtime image — `Dockerfile:27-29`). Canonical finding: `WRK-10`.
- **Status:** VERIFIED (static). **Safe-test status:** SAFELY TESTED.

### FRN-09 — INFO — Verified absence of the common frontend injection and storage sinks
- **Component:** `src/app/**`, `src/components/**`
- **Evidence:** `grep` for `dangerouslySetInnerHTML`, `innerHTML`, `outerHTML`, `eval(`, `new Function`,
  `javascript:`, `window.open`, `target="_blank"`, `localStorage`, `sessionStorage`, `indexedDB`,
  `document.cookie`, `NEXT_PUBLIC_`, `process.env` in client components → **no matches**. A production
  client-bundle scan found **0** files containing `rtsp://`, `HIKVISION`, `TELEGRAM`, `SESSION_SECRET`,
  `MEDIAMTX_AUTH`, `api.telegram.org` or `NEXT_PUBLIC`. Server code (`.next/server`) does contain the DVR
  URL builder, as expected — it must never be shipped to the browser, and it is not.
- **Impact:** no XSS sink, no client-side secret, no browser-stored credential found.
- **Status:** VERIFIED (static + production bundle scan). **Safe-test status:** SAFELY TESTED.

### FRN-10 — INFO — Error handling does not leak stack traces or internal paths
- **Component:** API error responses + `src/app/error.tsx`
- **Evidence:** the client error boundary renders a generic message and explicitly does not display
  `error` (`src/app/error.tsx:10-15`); `ApiError` surfaces only the curated `{error}` string
  (`src/lib/client-api.ts:24-38`); isolated-instance probes returned generic bodies
  (`{"error":"Invalid date"}`, `{"error":"Authentication failed"}`, `{"error":"Face not found"}`,
  `{"error":"Backend unavailable"}`) with no stack, SQL, file path or internal host. Server logs record
  `error.name`/status only.
- **Impact:** none found; good practice.
- **Status:** VERIFIED (static + isolated dynamic). **Safe-test status:** SAFELY TESTED.

### FRN-11 — INFO — Log redaction is deliberate; residual risk is the audit log, not application logs
- **Component:** server logging
- **Evidence:** `redactTelegramSecret()` removes the bot token from anything logged or returned
  (`src/server/notifications/telegram.ts:177-181`); Telegram URLs carrying the token are never logged
  (`telegram.ts:7-8,255`); failures log error names/status, not messages, in the DVR/HLS/WebRTC/health
  paths; the thumbnail worker explicitly comments "never the URL" (`thumbnail-worker.ts:151-152`);
  event/face/object logs contain counts and coordinates only. The one `error.message` log
  (`playback/session/route.ts:89`) can only receive the curated playback errors ("gateway", "not_ready",
  "invalid playback path"), none of which contain the DVR URL. Residual: audit rows store the full
  `User-Agent` and a spoofable IP (`AUTH-04`); Telegram media job rows store event ids only.
- **Impact:** no password/token/RTSP-URL logging found.
- **Status:** VERIFIED (static). **Safe-test status:** SAFELY TESTED.

### FRN-12 — INFO — No CORS headers are emitted (safe default)
- **Evidence:** production responses contain no `Access-Control-Allow-Origin`; `fetch` calls in the app
  are same-origin with `credentials: "same-origin"` (`src/lib/client-api.ts:22`). Cross-origin browser
  reads are therefore blocked, and `SameSite=Lax` blocks cross-site credentialed writes.
- **Status:** VERIFIED (isolated production build). **Safe-test status:** SAFELY TESTED.

### FRN-13 — INFO — Third-party egress of private CCTV content by design
- **Evidence:** Telegram receives face crops/snapshots or short clips plus camera display name and IST
  timestamp (`WRK-07`); if a Cloudflare Tunnel is used instead of the documented Tailscale Funnel, all
  HTTP media also transits Cloudflare (`STR-11`).
- **Impact:** privacy exposure to third parties; documented as a feature, not a defect.
- **Remediation:** surface exactly what leaves the LAN in the notification settings UI; offer
  snapshot-only / no-audio / generic-camera-name modes; keep remote access on the private tailnet where
  possible.
- **Status:** VERIFIED (static). **Safe-test status:** NOT SAFELY TESTED (no Telegram call made).

---

## Security headers matrix (production build, verified)

| Header | Value | Assessment |
|--------|-------|------------|
| Content-Security-Policy | `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; frame-ancestors 'none'` | Good baseline; `unsafe-inline` script gap (FRN-01) |
| X-Frame-Options | `DENY` | Good (plus `frame-ancestors 'none'`) |
| X-Content-Type-Options | `nosniff` | Good |
| Referrer-Policy | `same-origin` | Good |
| Permissions-Policy | `camera=(), microphone=(), geolocation=()` | Good |
| Strict-Transport-Security | *(absent)* | FRN-02 |
| Cache-Control (`/login`) | `private, no-cache, no-store, max-age=0, must-revalidate` | Good |
| Cache-Control (JSON APIs) | *(absent)* | FRN-03 |
| Cache-Control (snapshot/face image) | `private, no-store` | Good |
| CORS | *(no ACAO)* | Good |
| `poweredByHeader` | disabled (`next.config.ts:30`) | Good |

## Dependency summary (commands run)

- `npm audit --json` → 16 advisories (15 moderate, 1 high), all dev/build tooling.
- `npm audit --omit=dev --json` → **0** advisories in production dependencies.
- `npm ls zod minimatch --depth=6` → both reached only through `eslint`/`eslint-config-next`.
- `npm audit fix` / `npm install` / any lockfile write: **not run** (audit-only).

## Verified controls

1. No XSS sink, no unsafe URL handling, no `NEXT_PUBLIC_*`, no browser storage (FRN-09).
2. Zero secrets in a production client bundle (scanned for RTSP URLs, DVR/Telegram/session/MediaMTX
   markers); no source maps in the deployed build (FRN-07/09).
3. Production CSP (minus `unsafe-inline`), `X-Frame-Options: DENY`, `frame-ancestors 'none'`, `nosniff`,
   `Referrer-Policy: same-origin`, restrictive `Permissions-Policy`, no CORS, `poweredByHeader` off.
4. Curated error messages, no stack traces/paths, generic client error boundary (FRN-10).
5. Token-aware log redaction; no credential/RTSP URL in application logs (FRN-11).
6. Media image responses are `private, no-store`; the login page is `no-store`.
7. Production dependencies have no known advisories; model downloads are HTTPS + SHA-256 verified.

## Unverified controls

- Behaviour of the real TLS terminator (Tailscale Funnel or Cloudflare Tunnel): HSTS enforcement,
  `X-Forwarded-Proto`/`X-Forwarded-For` injection, Cloudflare cache rules for JSON/media.
- Production `.env` values other than file mode/lengths.
- Browser-level CSRF behaviour against the real deployment (inferred from `SameSite=Lax`).
- Dependency advisories published after 2026-11-03.
