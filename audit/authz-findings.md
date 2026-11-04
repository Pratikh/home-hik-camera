# Authentication, Authorization, Sessions & API Access Control — Findings

**Target:** `/Users/guruswamihiremath/Desktop/projects/home-hik-camera` (Next.js 16.4.2 / React 19 / SQLite / MediaMTX / Podman)
**Auditor:** auth-auditor (read-only audit)
**Date:** 2026-11-03
**Method:** static analysis only. Complete read of `src/proxy.ts`, `src/lib/{auth,session,redirect,rate-limit,passwords,password-hash,config}.ts`, `src/server/auth/accounts.ts`, `src/server/http/require-user.ts`, `src/instrumentation.ts`, all 51 `src/app/api/**/route.ts`, the `(hub)` layouts/pages, `next.config.ts`, `compose.yml`, `.env.example`, and the existing auth/session/authz tests. Working tree is clean at commit `01c8b3f`.
**Constraints honoured:** no source/config/.env/database/dependency changes, no installs, no servers, no containers, no network traffic, no Telegram/camera/brute-force/DoS actions. Only `audit/authz-findings.md` was written. Secrets were never printed; `.env` was inspected for *properties only* (`APP_USERNAME` length 4, `APP_PASSWORD` length 24, `SESSION_SECRET` length 43, `TELEGRAM_BOT_TOKEN` length 46, `MEDIAMTX_AUTH_PASSWORD` length 48, mode `0600`, all values redacted).

**Production exposure model (per `README.md:11`, `README.md:25-28`, `compose.yml:53-54`):** the hub on TCP `3000` is the only public entry point, published by compose on all interfaces and additionally exposed over public HTTPS by Tailscale Funnel. The web process itself speaks plain HTTP. This matters for AUTH-01 and AUTH-05.

---

## Findings

### AUTH-01 — HIGH — Login brute-force protection is keyed on an attacker-controlled `X-Forwarded-For`, and there is no account lockout
- **Component:** login route, rate limiter
- **Location:** `src/app/api/auth/login/route.ts:14-17`, `src/app/api/auth/login/route.ts:83`, `src/lib/rate-limit.ts:5-14`
- **Evidence:** the limiter key is built from the first `X-Forwarded-For` element with no proxy allowlist and no validation:
  ```ts
  function clientIp(request: Request): string {
    const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
    return forwarded || "local";
  }
  ...
  const limit = consumeRateLimit(`login:${clientIp(request)}`, 8, 15 * 60 * 1000);
  ```
  The compose deployment publishes `3000:3000` on every interface (`compose.yml:53-54`) and the public path is Tailscale Funnel (`README.md:11`, `README.md:27`). Two consequences:
  1. Any client that reaches the hub directly on the LAN sends its own `X-Forwarded-For` and gets a fresh 8-attempt bucket per forged value.
  2. On the Funnel path the request is proxied by a Go reverse proxy, which *appends* the peer address to any client-supplied `X-Forwarded-For`; element `[0]` therefore remains the attacker-supplied value. This second half is **not dynamically verified** in this environment.
  There is no per-username bucket and no account lockout anywhere: a failed login only writes an audit row (`src/app/api/auth/login/route.ts:110-115`), and the only throttle is this in-memory per-IP bucket (`src/lib/rate-limit.ts`).
- **Attack scenario:** unauthenticated attacker on the LAN (or on the internet through the Funnel URL) sends `POST /api/auth/login` with username `home`/`admin` and iterates passwords while rotating a forged `X-Forwarded-For` per request. Every request is treated as a new client, so the 8-in-15-minutes cap never applies.
- **Impact:** unlimited online password guessing against a hub that grants live camera, recorded footage, face crops and settings. With `APP_PASSWORD` bootstrap semantics (AUTH-14) the first-run credential is the environment password, which is the weakest link on a fresh install.
- **Remediation:** derive the limiter key from the socket peer (`request.ip` / `x-real-ip` only when the request is known to arrive from the trusted proxy), ignore client-supplied `X-Forwarded-For` from untrusted sources; add a second bucket keyed on the *username* (e.g. 5 failures / 15 min / account, independent of IP) and a persistent lockout counter in SQLite that survives restart; emit a progressive delay and an audit alert after repeated failures. Consider requiring MFA for ADMIN over the Funnel path.
- **Status:** VERIFIED (static) — code path and key derivation are definite. The Funnel-specific header ordering is SUSPECTED.
- **Safe-test status:** NOT DYNAMICALLY TESTED. Suggested controlled test (Lead): 10 sequential bad logins each with a distinct `X-Forwarded-For: 198.51.100.N` → expect no `429`; then 9 bad logins with no `X-Forwarded-For` and confirm the 9th is `429` (see also AUTH-03).

---

### AUTH-02 — MEDIUM — Unauthenticated CPU exhaustion: `scryptSync` blocks the single Node event loop and the only throttle is bypassable
- **Component:** login route, password hashing
- **Location:** `src/lib/password-hash.ts:11-18` (`verifyPassword` → `scryptSync(..., { N: 16384, r: 8, p: 1 })`), `src/app/api/auth/login/route.ts:110`
- **Evidence:** `verifyPassword` runs `scryptSync` synchronously inside the request handler. It is only reached when the username exists (`if (!user || !user.enabled || !verifyPassword(...))` short-circuits on a missing user, `login/route.ts:110`), so an attacker first enumerates a valid username (AUTH-10) and then spams it. There is no queue, no concurrency cap and no per-username throttle; `MAX_SPOOFABLE` rate limiting is the only brake (AUTH-01).
- **Attack scenario:** attacker sends a few dozen concurrent `POST /api/auth/login` requests for a known username. Each request occupies the single Node.js thread for the duration of one scrypt derivation (~tens of ms at these parameters); pipelined, this keeps the loop busy and every other request (API, SSE, page render, event polling) stalls.
- **Impact:** full application unavailability for all users while the attack continues, including for the DVR event processor running in the same process. Availability only — no confidentiality/integrity impact.
- **Remediation:** use async `scrypt`/`promisify` (or a worker pool) so hashing never blocks the event loop; add a small global concurrency semaphore for password verification; add the per-username lockout from AUTH-01; consider raising `N` at the same time (AUTH-08).
- **Status:** VERIFIED (static) — synchronous scrypt in the request path and short-circuit behaviour are explicit in the code.
- **Safe-test status:** NOT DYNAMICALLY TESTED (deliberately not load-tested; the audit rules prohibit DoS testing).

---

### AUTH-03 — MEDIUM — Shared `"local"` rate-limit bucket lets one unauthenticated LAN client lock every user out of login
- **Component:** login route, rate limiter
- **Location:** `src/app/api/auth/login/route.ts:16` (`|| "local"`), `src/app/api/auth/login/route.ts:83`
- **Evidence:** when no `X-Forwarded-For` header is present the key is the constant string `"local"`, so all such clients share one 8-attempts/15-minute bucket. Direct LAN browsers reach the hub on `http://<lan-ip>:3000` (documented deployment, `README.md:137`, `README.md:391`) and normally send no `X-Forwarded-For`.
- **Attack scenario:** any unauthenticated device on the LAN posts 8 junk logins without the header (or simply with a random username). All LAN users, including the admin, then receive `429` on login for up to 15 minutes; repeat every 15 minutes for a sustained denial of access. The same single bucket also means 8 failed attempts by one legitimate user lock out the household.
- **Impact:** denial of access to the whole application for LAN users; no data exposure.
- **Remediation:** use the real socket address as the key (so each LAN device gets its own bucket), keep the limiter resilient (e.g. per-IP + per-account), return `Retry-After`, and do not collapse missing-header requests into one shared bucket.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED. Suggested controlled test: 8 bad logins with no `X-Forwarded-For`, then a 9th from a different LAN client with no header → expect `429`. This consumes the login budget for 15 minutes, so run it last.

---

### AUTH-04 — MEDIUM — Audit log has no retention and is writable pre-authentication with attacker-controlled IP and User-Agent
- **Component:** `AccountStore.writeAudit`, login failure path, SQLite schema
- **Location:** `src/app/api/auth/login/route.ts:111`, `src/server/auth/accounts.ts:250-266`, `src/server/events/event-store.ts:309-320`
- **Evidence:** every failed login inserts a row: `accounts.writeAudit({ userId: user?.id ?? null, action: "LOGIN_FAILED", resource: username, ip, userAgent })`, where `ip` comes from the spoofable header and `userAgent` is an unbounded request header. The `audit_logs` table has indexes but **no retention/pruning code exists anywhere** (`grep -rn "DELETE FROM audit_logs\|audit.*prune" src scripts` → no matches; only event retention exists in `src/server/events/retention.ts`). The rate limit that would bound the write rate is bypassable (AUTH-01).
- **Attack scenario:** (a) *Forensic poisoning:* attacker submits failed logins with forged `X-Forwarded-For` values, so the audit trail attributes them to innocent addresses; the admin's only incident-response record is untrustworthy. (b) *Storage exhaustion:* attacker sends failed logins with `User-Agent` headers near the header-size limit (16 KB) and rotating forged IPs, writing an ~16 KB `audit_logs` row per request into `data/*.sqlite` until the volume/host fills, which also stops event retention and backups.
- **Impact:** loss of audit integrity (the log is the sole forensic source for who tried what) and unbounded disk growth leading to data-dir exhaustion / service failure.
- **Remediation:** derive the logged IP the same way as the rate-limit key (trusted proxy only); cap stored `user_agent`/`resource` lengths (e.g. 200 chars) before insert; add a retention policy for `audit_logs` (e.g. 180 days) and prune it on the existing hourly maintenance timer in `src/instrumentation.ts`; rate-limit failed-login *writes* independently of the pass/fail limit.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED (would require writing rows/disk — out of scope for a read-only audit).

---

### AUTH-05 — MEDIUM — Session cookie has no `Secure` attribute in the shipped configuration, and `Secure` is decided by a client-spoofable header
- **Component:** cookie options, login/password/logout/session-revoke responses
- **Location:** `src/lib/auth.ts:16-27` (`requestUsesHttps`), `src/lib/auth.ts:29-37` (`sessionCookieOptions`), `src/app/api/auth/login/route.ts:131`, `src/app/api/auth/password/route.ts:102-105`
- **Evidence:**
  ```ts
  export function sessionCookieOptions(secure: boolean) {
    return { httpOnly: true, sameSite: "lax", secure, path: "/", maxAge: SESSION_MAX_AGE };
  }
  // call sites: sessionCookieOptions(config.cookieSecure || requestUsesHttps(request))
  ```
  `requestUsesHttps` trusts `x-forwarded-proto` unconditionally (`auth.ts:17-21`). The deployed `.env` in this checkout sets `COOKIE_SECURE` to a 5-character value consistent with `false` (values not reproduced), and `README.md:391` documents `COOKIE_SECURE=false` as intentional for HTTP on the LAN. `README.md:698-699` and `README.md:792-795` claim the cookie is "forced Secure when the request arrived over HTTPS (Funnel)", which depends entirely on the Funnel injecting `X-Forwarded-Proto: https`. If that header is missing or altered, the login response over the public HTTPS endpoint sets a **non-Secure** cookie. There is also no `__Host-` prefix, and `Path=/` means the cookie is attached to every request (including static assets).
- **Attack scenario:** (a) A hub that is simultaneously reachable on `http://<lan-ip>:3000` and on a public HTTPS Funnel issues a non-Secure cookie, so any plain-HTTP request to the LAN address (an attacker on the LAN, a malicious page that downgrades a link, an old bookmark) carries the session cookie in cleartext. (b) If the Funnel does not set `X-Forwarded-Proto`, a cookie issued on the public HTTPS origin has no `Secure` flag at all and is transmitted on any future `http://` request to that host. (c) A client can also force the *wrong* branch by sending `X-Forwarded-Proto: http`, which is only a self-inflicted failure but shows the decision is not anchored to the real transport.
- **Impact:** session theft if any plain-HTTP path to the hub is reachable, i.e. full camera/recording/account compromise for up to 7 days.
- **Remediation:** derive `Secure` from the actual connection where possible and, in the Funnel/production deployment, set `COOKIE_SECURE=true` explicitly instead of relying on the header; rename the cookie to `__Host-cctv_session` (implies `Secure`, `Path=/`, no `Domain`) in the HTTPS deployment; ignore `X-Forwarded-Proto` from untrusted peers; add `Priority=high`.
- **Status:** VERIFIED (static) for the flag logic and default; SUSPECTED for the Funnel header behaviour.
- **Safe-test status:** NOT DYNAMICALLY TESTED. Suggested controlled test: log in over plain HTTP and inspect `Set-Cookie` (expect no `Secure`); repeat with `X-Forwarded-Proto: https` (expect `Secure`) — that proves the header is trusted. Then confirm through the Funnel URL that the live response contains `Secure`.

---

### AUTH-06 — LOW — Middleware authenticates the cookie signature only; server-side session revocation is enforced only by per-route/per-layout checks
- **Component:** `src/proxy.ts`, `src/lib/auth.ts`
- **Location:** `src/proxy.ts:6-22`, `src/lib/session.ts:66-96`, `src/lib/auth.ts:39-51`, `src/app/(hub)/layout.tsx:10-12`
- **Evidence:** the middleware does exactly this:
  ```ts
  const session = secret && token ? await verifySession(token, secret) : null;
  if (session) return NextResponse.next();
  ```
  It validates HMAC + `exp` from the token and never consults `auth_sessions`. The authoritative check (`auth_sessions` row exists, user still exists/enabled, DB expiry) lives in `currentSession()` and is only reached through `requireUser`/`requireAdmin` or the two layouts. Today **every** `/api/**` handler except the intentionally public `/api/health` calls one of those guards (verified by enumerating all 51 route files, see matrix), and every page is under `(hub)/layout.tsx`, so I found **no route or page that a revoked-but-unexpired cookie can reach**. The residual risk is architectural: any future page/route that forgets `requireUser` is fully reachable with a logged-out user's cookie, and `src/proxy.test.ts` does not assert guard coverage.
- **Attack scenario:** a cookie captured before logout/password change (or from `data/` backup) remains *signature-valid* to the middleware after the DB row is deleted. If one route or page ever omits its `requireUser`/`currentSession` call — or if a new RSC page streams data before its layout's `redirect()` resolves — the revoked cookie becomes live again for that surface. The parallel layout/page render question ("does `/events/[id]` data stream before `(hub)/layout` redirects?") is **suspected / not dynamically verified**; there is no `loading.tsx` in the app, which keeps the shell = whole tree and strongly limits the window.
- **Impact:** defense-in-depth only; no exploit found in the current tree. Regression risk is high because coverage is enforced only by convention and by the hand-maintained `tests/e2e/support/app.ts` list.
- **Remediation:** validate the `auth_sessions` row in the proxy itself (Next 16 runs `proxy.ts` on the Node runtime, so SQLite is reachable) or, at minimum, add a CI test that walks `src/app/api/**/route.ts` and fails when a non-allowlisted handler lacks `requireUser`/`requireAdmin`; also call `currentSession()` inside the server component (`events/[id]/page.tsx`) rather than relying on the layout alone.
- **Status:** VERIFIED (static) for the middleware behaviour; SUSPECTED for the streaming/parallel-render exposure.
- **Safe-test status:** NOT DYNAMICALLY TESTED. Suggested controlled test: log in, copy the cookie, log out, replay the cookie against `/`, `/events/<id>` (inspect the response body for event JSON/HTML, not just the status), `/settings`, and `/api/events` — expect `307` to `/login` / `401` with no data. This directly tests both this finding and AUTH-01's session invalidation semantics.

---

### AUTH-07 — LOW — Middleware matcher exclusions are unanchored prefixes; any future route beginning with `login` or `api/health` would be silently public
- **Component:** `src/proxy.ts` matcher
- **Location:** `src/proxy.ts:38`
- **Evidence:**
  ```
  "/((?!_next/static|_next/image|_next/hmr|_next/webpack-hmr|favicon.ico|icon.svg|manifest\\.webmanifest(?=$|[/?#])|robots.txt|login|api/health|api/auth/login|api/auth/logout).*)"
  ```
  Only `manifest\\.webmanifest` is anchored (`(?=$|[/?#])`); `login`, `api/health`, `api/auth/login` and `api/auth/logout` are bare prefixes. `/api/healthanything` or `/loginfoo` would bypass the middleware entirely. Today the only routes matching those prefixes are the intended public ones (`/login`, `/api/health`, `/api/auth/login`, `/api/auth/logout`), so this is latent, not exploitable.
- **Attack scenario:** a future feature adds `/api/health-history` or `/login/support`; the author reasonably assumes the middleware covers it, and it is served unauthenticated (it would still be protected only if the handler happens to call `requireUser`).
- **Impact:** latent unauthenticated exposure of a future endpoint.
- **Remediation:** anchor every exclusion: `login(?=$|[/?#])`, `api/health(?=$|[/?#])`, `api/auth/login(?=$|[/?#])`, `api/auth/logout(?=$|[/?#])`; preferably invert to an explicit allowlist of public paths and add a test that enumerates route files and asserts each non-public one is matched by the matcher.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED. Safe test: `GET /api/healthx` and `GET /loginfoo` unauthenticated → expect `404` from the app, but they should have been `401`/`307`; confirming they are *not* `401/307` proves the prefix behaviour without touching data. (`/api/health` itself returns `200` — expected.)

---

### AUTH-08 — LOW — Password policy is length-only (8–200) with no complexity, breach or reuse check; hashing work factor is below current guidance
- **Component:** password policy, hashing
- **Location:** `src/lib/passwords.ts:8-22`, `src/lib/password-hash.ts:7,14`
- **Evidence:** `validateNewPassword` only enforces `>= 8` characters, `<= 200`, not all spaces. `hashPassword`/`verifyPassword` use `scrypt` with `N: 16384, r: 8, p: 1` (≈16 MiB, 2^14) and a 16-byte random salt, with `timingSafeEqual` — the salt, constant-time comparison and no-plaintext properties are all good, but the work factor is below the current OWASP recommendation (N=2^17, r=8, p=1, or N=2^15 with r=8, p=3). Every path shares the policy (self change `auth/password/route.ts:46`, admin reset + create `users/route.ts:30`, `users/[id]/route.ts:19`), which is the right design.
- **Attack scenario:** a guessed/stolen hash from `data/*.sqlite` or a backup is cheaper to crack than it should be, and a user-set password such as `12345678` is accepted.
- **Impact:** reduces the cost of offline cracking after a DB/backup disclosure; weak passwords weaken AUTH-01's remaining barrier.
- **Remediation:** raise scrypt cost (and re-hash on next successful login); add a length-12+ minimum, a small deny-list of common passwords, and refuse the username as password.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED (policy is unit-testable; no live action needed).

---

### AUTH-09 — LOW — No CSRF tokens or Origin/Referer validation anywhere; the entire CSRF posture rests on `SameSite=Lax`
- **Component:** all state-changing routes; cookie attributes
- **Location:** `src/lib/auth.ts:32` (`sameSite: "lax"`), `src/app/api/**` (no CSRF/Origin checks — `grep -rni "csrf\|xsrf" src` → no matches; no `Origin`/`Referer` comparison in any handler)
- **Evidence:** the only CSRF control is the cookie's `SameSite=Lax`. That is genuinely effective for `POST/PUT/PATCH/DELETE` in current browsers (cross-site form/fetch submissions do not carry a Lax cookie), which I verified by inspecting every mutating handler: all are non-GET. Two residual gaps remain: (1) the **login** endpoint accepts `application/x-www-form-urlencoded` and `multipart/form-data` (`login/route.ts:20-23`, `48-70`), so a cross-site form submit can log a victim into an attacker-controlled account ("login CSRF"), overwriting their session; (2) Lax cookies *are* sent on top-level GET navigations, and `GET /api/playback/thumbnail/index` performs real work (`requestThumbnails(...)`, `thumbnail/index/route.ts:36`), so a crafted link can make the server start DVR thumbnail extraction.
- **Attack scenario:** attacker hosts a page that auto-submits a form to `https://<hub>/api/auth/login` with the attacker's own credentials; the victim's browser stores the attacker's session cookie. The attacker now knows the victim's future actions are recorded under an account they control (limited on a single-household hub), or simply leaves the victim stranded in a restricted VIEWER account. The GET side effect lets a third party trigger playback-thumbnail generation (DVR load) whenever the victim follows a link.
- **Impact:** low on this deployment (single-household, no cross-tenant data); the concern is that the *only* CSRF control is a browser default, with no application-layer defense-in-depth.
- **Remediation:** add an `Origin`/`Sec-Fetch-Site` check on every non-GET handler (reject when `Origin` is present and not same-origin), and a per-session CSRF token for the mutating endpoints; disable form-encoded login in the deployed build or require a same-origin marker; make `/api/playback/thumbnail/index` a POST.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED. Suggested controlled test: from a different origin, submit a cross-site `POST` to `/api/events/<id>/read` and confirm no state change (browser-enforced Lax) — no credentials are involved.

---

### AUTH-10 — LOW — Username enumeration via login response timing
- **Component:** login route
- **Location:** `src/app/api/auth/login/route.ts:107-115`, `src/lib/password-hash.ts:11-18`
- **Evidence:** the response text and status are identical for unknown users, disabled users and wrong passwords (`Messages.authFailed`, `401` / `/login?error=auth`), which is good. However `scryptSync` runs **only** when the username exists and is enabled (`!user || !user.enabled || !verifyPassword(...)` short-circuits), so an unknown username returns in ~1 ms while a known one takes the scrypt time. Additionally `writeAudit` writes `resource: username` either way.
- **Attack scenario:** an attacker measures response time over a few requests to learn which usernames exist, then targets the admin account with AUTH-01/AUTH-03. It also makes AUTH-02's CPU attack possible without prior knowledge of a valid username beyond the documented `APP_USERNAME` bootstrap name.
- **Impact:** enables targeted brute force / lockout DoS and discloses account names.
- **Remediation:** perform a dummy `verifyPassword` against a fixed hash when the user is missing/disabled so both branches cost the same, and keep the audit write on both paths.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED (timing measurement is safe but noisy; the code path is unambiguous).

---

### AUTH-11 — LOW — Any authenticated user (VIEWER included) can disrupt other viewers' playback: a single global MediaMTX playback path and no per-user limits on DVR-touching endpoints
- **Component:** playback gateway, playback/WebRTC routes
- **Location:** `src/app/api/playback/session/route.ts:24-106`, `src/server/video/playback-gateway.ts:55-90`, `src/app/api/webrtc/[path]/session/[id]/route.ts:10-38`, `src/server/cameras/channels.ts:36-38`
- **Evidence:** `playbackPath()` is the constant `"playback"` and `publishPlaybackSource` stores one `currentToken` per path and deletes/re-adds the MediaMTX path on every `POST /api/playback/session`; `DELETE` closes it with any client-supplied token and `DELETE /api/webrtc/.../session/<id>` closes any MediaMTX WHEP session the caller can name (only the id format is validated, not ownership). Neither route has a rate limit. All of these are `requireUser`, so a VIEWER can call them.
- **Attack scenario:** a VIEWER account (or one stolen viewer session) repeatedly opens/closes playback for overlapping windows, breaking the admin's in-progress playback and forcing repeated DVR RTSP sessions; WHEP session deletes can drop live streams. Sustained calls load the DVR and MediaMTX.
- **Impact:** denial/stability impact on live view and playback by a lower-privileged account; no confidentiality impact.
- **Remediation:** scope playback sessions per user (token + session id ownership map) or serialise by camera and reject concurrent publishers; add small per-user rate limits to `/api/playback/session`, `/api/playback/search`, `/api/playback/recording-dates`, `/api/hls/**`, `/api/webrtc/**`; verify WHEP session ownership before deleting.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED (would disturb live streams).

---

### AUTH-12 — LOW — `/api/health` is intentionally unauthenticated and discloses deployment/DVR auth state
- **Component:** public health endpoint
- **Location:** `src/proxy.ts:38` (exclusion), `src/app/api/health/route.ts:12-36`, `src/server/health.ts:23-31`
- **Evidence:** unauthenticated `GET /api/health` returns `{ application, dvr, videoGateway, database, mediamtx, events }` where `dvr` distinguishes `connected | not_configured | disconnected` and a misconfigured app reports `503` with `application: "misconfigured"`. No secret, host, credential or username is included (verified), but the endpoint reveals whether the DVR is wired up, whether its credentials work (`auth_failed` maps to `disconnected`), and whether ingestion is running.
- **Attack scenario:** reconnaissance for an attacker who found the Funnel URL — confirms the target is a live CCTV hub, whether login is the only barrier, and whether the DVR is reachable/authenticating (useful before targeted brute force).
- **Impact:** information disclosure only; no data or credential leak.
- **Remediation:** keep the public probe minimal (e.g. liveness only) and move DVR/gateway/database/event detail behind `requireUser`/`requireAdmin` (the admin-only `/api/system/health` already covers the detailed view).
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED. Safe test: unauthenticated `GET /api/health` → observe the state fields (no credentials involved). This is also asserted by `tests/e2e/security.spec.ts:111-114`.

---

### AUTH-13 — LOW — VIEWER can read DVR hardware identifiers (`/api/dvr/info` returns model, serial, firmware, HDD/channel counts)
- **Component:** DVR info route
- **Location:** `src/app/api/dvr/info/route.ts:9-19`, `src/server/hikvision/hikvision-status.ts:58-70`
- **Evidence:** the route is `requireUser` (so VIEWER passes) and returns `device: { name, model, serialNumber, firmware, encodingVersion, hardwareVersion, webVersion, pluginVersion, channelCount, hddCount, currentDeviceTime }`. Acceptable for the "Device" page, which is in the shared nav (`src/components/layout/AppShell.tsx:23-33`), and it never includes the DVR host, username or password (verified; `maskSettings` at `src/server/settings.ts:3-13` is admin-only anyway).
- **Attack scenario:** a low-privileged or stolen viewer session exposes the recording device's serial/firmware, which is exactly what a Hikvision-focused attacker wants for targeting the DVR (the DVR is not public, but the serial/firmware narrows exploits).
- **Impact:** minor information disclosure / device fingerprinting.
- **Remediation:** return only `name`/`model`/`online` to VIEWERs and keep serial/firmware/versions on the ADMIN-only path.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED (needs a VIEWER session; the e2e suite skips when `QA_VIEWER_*` is unset — see `tests/e2e/security.spec.ts:57-58`).

---

### AUTH-14 — LOW — First-run admin comes from `APP_USERNAME`/`APP_PASSWORD` and is not forced to rotate; bootstrap INSERT is not concurrency-safe
- **Component:** bootstrap admin
- **Location:** `src/server/auth/accounts.ts:52-62`, `src/app/api/auth/login/route.ts:103`, `README.md:482`
- **Evidence:** on every login POST, before the credential check, the server calls `accounts.ensureBootstrapAdmin(config.appUsername, config.appPassword)`; it inserts an `ADMIN` row only when `users` is empty. Nothing forces a password change on first login, and `APP_PASSWORD` remains in the container environment (visible in `env` / `podman inspect`) for the life of the deployment. The `INSERT` has no `OR IGNORE`/retry, so two concurrent first-run logins can make the second throw on the `users.username` UNIQUE constraint (unhandled → `500`). Positively: `.env.example` ships **blank** `APP_USERNAME`/`APP_PASSWORD`/`SESSION_SECRET` (no default credentials — verified), and an unconfigured app fails closed (`config.appConfigured === false` → every guarded route returns `500`, middleware rejects all tokens).
- **Attack scenario:** an operator reuses a weak `APP_PASSWORD` (it is the initial admin password by design) or leaves it in `.env` after changing the password in the UI, where it remains recoverable from the host/container environment. The concurrency bug is only a one-off 500 on a fresh install.
- **Impact:** weak initial credential is the most likely path to full compromise on a fresh deployment; environment disclosure of `APP_PASSWORD` gives no ongoing access once the DB password has been changed (bootstrap no-ops when users exist) but is still an unnecessary secret exposure.
- **Remediation:** force a password change on first ADMIN login (a `must_change_password` flag), refuse a known-weak/`APP_PASSWORD`-equal password, wrap the bootstrap insert in `INSERT OR IGNORE`/try-catch, and drop `APP_PASSWORD` from the environment once the admin row exists (or document that only `users` is authoritative).
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED (first-run state is destructive to reproduce; not attempted).

---

### AUTH-15 — LOW — 7-day absolute session lifetime with no idle timeout, no re-authentication for sensitive actions, and no binding to client context
- **Component:** session lifecycle
- **Location:** `src/lib/session.ts:4` (`SESSION_TTL_MS = 7 days`), `src/lib/auth.ts:7,49`, `src/server/auth/accounts.ts:138-170,191-194`
- **Evidence:** sessions expire 7 days after creation; `touchSession` updates `last_seen_at` only and deliberately does not extend expiry (good — no sliding lifetime), but there is no idle timeout and no re-auth before sensitive operations (password change requires the current password — good; but settings, user creation, session revocation, camera names, notification rules, Telegram test do not re-authenticate). `ip_address`/`user_agent` are stored but never compared. Expired rows are pruned hourly at startup (`src/instrumentation.ts:27-35`).
- **Attack scenario:** a stolen cookie from a shared/unlocked laptop or a backup copy of `data/` is usable for up to seven days from any network; an unattended browser keeps full ADMIN capability.
- **Impact:** amplifies the impact of any cookie theft; standard for self-hosted apps but meaningful for always-on camera access.
- **Remediation:** add an idle timeout (e.g. `last_seen_at` older than 12–24 h → re-login), shorten the ADMIN session, require the current password for user-management and session-revocation actions, and optionally log/warn on IP/UA change.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED.

---

### AUTH-16 — INFO — Token claims `u`/`role` are ignored by the server and `sid` is not bound to the username
- **Component:** session token
- **Location:** `src/lib/session.ts:46-64,66-96`, `src/lib/auth.ts:39-51`
- **Evidence:** `signSession` embeds `u`, `exp`, `sid`, `role`; `verifySession` returns them, but authorization uses only `sid` (looked up in `auth_sessions`/`users`, which is the correct source of truth). Nothing compares the token's `u` with the row's `username`. This is safe as long as `SESSION_SECRET` is secret (a forged token needs a valid `sid` too), but the redundant claims invite future trust mistakes.
- **Remediation:** drop `u`/`role` from the token (or assert they match the row), and keep the DB row as the only authority. Document that `sid` alone is not a credential.
- **Status:** VERIFIED (static). **Safe-test status:** NOT DYNAMICALLY TESTED.

---

### AUTH-17 — INFO — Legacy env-credential auth helpers are dead code, yet unit tests still exercise them
- **Component:** `src/lib/passwords.ts`, `src/lib/auth.test.ts`
- **Location:** `src/lib/passwords.ts:24-51` (`safeEqual`, `credentialsMatch`, `evaluateLogin`), used only by `src/lib/auth.test.ts:2,7-15`
- **Evidence:** the real login path is `accountStore.findByUsername` + `verifyPassword` (`login/route.ts:107-115`); `grep -rn "evaluateLogin\|credentialsMatch\|safeEqual" src` finds callers only in the test file. The first `describe("login")` block in `src/lib/auth.test.ts:5-17` therefore tests a code path no request can reach and gives false assurance that "login is tested". `AppConfig.appPassword` (`src/lib/config.ts:12,115`) is likewise only used for bootstrap.
- **Remediation:** delete the dead helpers and the tests that cover them, or move them behind an explicit deprecation; add a real unit/integration test of `POST /api/auth/login` (mock `accountStore`) covering success, unknown user, disabled user, wrong password and the rate limit.
- **Status:** VERIFIED (static). **Safe-test status:** N/A.

---

### AUTH-18 — INFO — Audit trail misses several privileged actions and all authorization denials
- **Component:** audit logging coverage
- **Location:** `src/app/api/**` (compared against `AccountStore.writeAudit` call sites: `login/route.ts:111,124`, `logout/route.ts:21-27`, `auth/password/route.ts:58,87`, `auth/sessions/route.ts:60`, `users/*`, `detection/test/route.ts:58`, `settings/detection/route.ts:92`)
- **Evidence:** logged: LOGIN, LOGIN_FAILED, LOGOUT, PASSWORD_CHANGED, PASSWORD_CHANGE_FAILED, PASSWORD_RESET, USER_CREATED/UPDATED/DISABLED/DELETED, USER_SESSIONS_REVOKED, SESSIONS_REVOKED, OBJECT_DETECTION_TEST_REQUESTED, DETECTION_SETTINGS_UPDATED. **Not logged:** notification-rule create/update/delete (`notification-rules/route.ts:20-26`, `notification-rules/[id]/route.ts:58-79`), camera-name change (`cameras/[id]/route.ts:12-51`), Telegram test message send (`notifications/telegram/test/route.ts:20-38`), rule dry-run, session listing, and every `403`/`401` authorization denial. Users/admins cannot tell who changed notification behaviour or sent a Telegram message.
- **Remediation:** audit rule CRUD, camera rename and Telegram sends; audit `requireAdmin` denials at least at a sampled rate; document the audit retention policy (AUTH-04).
- **Status:** VERIFIED (static). **Safe-test status:** N/A.

---

## API route authorization matrix

Legend — **Guard:** `user` = `requireUser()` (any signed-in user), `admin` = `requireAdmin()`, `public` = no guard (intentionally reachable without a session). **CSRF:** all mutating handlers rely solely on the `SameSite=Lax` cookie (AUTH-09); "—" = GET. **RL:** in-memory rate limit (AUTH-01/03 apply to all of them). **Validation:** server-side input checks found in the handler.

| # | Route | Method(s) | Guard | Role gate | Rate limit | Input validation | Notes |
|---|-------|-----------|-------|-----------|-----------|------------------|-------|
| 1 | `/api/health` | GET | public | — | none | — | INFO disclosure (AUTH-12) |
| 2 | `/api/auth/login` | POST | public (matcher-excluded) | — | `login:<XFF>` 8/15 min | username ≤64, password 1–200 chars, `safeNext` | AUTH-01/02/03/10/14 |
| 3 | `/api/auth/logout` | POST | public (matcher-excluded); needs valid signed cookie to revoke | — | none | — | DB session deleted, cookie cleared |
| 4 | `/api/auth/session` | GET | user | any | none | — | returns username+role only |
| 5 | `/api/auth/password` | POST | user | any (self) | `password:<userId>` 5/15 min | current+new required, policy, current verified | revokes all sessions, issues new one |
| 6 | `/api/auth/sessions` | GET, DELETE | user | any (self) | DELETE 20/15 min | `scope ∈ {others, all}` | own sessions only; returns ids (useless without signature) |
| 7 | `/api/users` | GET, POST | admin | ADMIN | POST 20/15 min | username regex, password policy, role enum | creation audited |
| 8 | `/api/users/[id]` | PATCH, DELETE | admin | ADMIN | none | role/enabled/password whitelist, policy, last-admin guard | self-demotion allowed if another admin; sessions revoked on password/disable |
| 9 | `/api/users/[id]/sessions` | DELETE | admin | ADMIN | none | user must exist | revokes target's sessions |
| 10 | `/api/audit` | GET | admin | ADMIN | none | page/pageSize clamped 1–100 | audit-log read |
| 11 | `/api/system/sessions` | GET | admin | ADMIN | none | — | all sessions + presence + MediaMTX reader counts |
| 12 | `/api/system/health` | GET | admin | ADMIN | none | — | operational health |
| 13 | `/api/settings` | GET | admin | ADMIN | none | — | `maskSettings`; DVR password masked |
| 14 | `/api/settings/detection` | GET, PUT | admin | ADMIN | none | 32 KB body cap + typed validators | audited |
| 15 | `/api/notification-rules` | GET, POST | admin | ADMIN | none | `parseRuleBody` | **not audited** (AUTH-18) |
| 16 | `/api/notification-rules/[id]` | PUT, PATCH, DELETE | admin | ADMIN | none | rule-id regex, retention enum, merged-body validation | **not audited** |
| 17 | `/api/notifications/telegram/status` | GET | admin | ADMIN | none | — | booleans only; no token/chat id |
| 18 | `/api/notifications/telegram/test` | POST | admin | ADMIN | none | body ignored by design | sends a real message (AUTH-18: unaudited) |
| 19 | `/api/notifications/test` | POST | admin | ADMIN | none | typed fields | dry-run only, no insert |
| 20 | `/api/detection/status` | GET | user | any | none | — | switches/heartbeat only |
| 21 | `/api/detection/test` | POST | admin | ADMIN | none | eventId regex | writes a durable request row; audited |
| 22 | `/api/detection/test/[id]` | GET | admin | ADMIN | none | request-id regex | worker result JSON |
| 23 | `/api/cameras` | GET | user | any | none | — | DVR state, camera names/paths |
| 24 | `/api/cameras/[id]` | PATCH | admin | ADMIN | none | id range, name normaliser | **not audited** |
| 25 | `/api/dvr/status` | GET | user | any | none | — | no DVR URL/credential |
| 26 | `/api/dvr/info` | GET | user | any | none | — | device serial/firmware to VIEWER (AUTH-13) |
| 27 | `/api/events` | GET | user | any | none | query parser | all users see all events (single-tenant design) |
| 28 | `/api/events/recent` | GET | user | any | none | limit clamp 1–20 | |
| 29 | `/api/events/stats` | GET | user | any | none | range/date validation | |
| 30 | `/api/events/health` | GET | user | any | none | — | ingestion codes only |
| 31 | `/api/events/stream` | GET | user | any | none | — | SSE; no per-user connection cap (see below) |
| 32 | `/api/events/[id]` | GET | user | any | none | event-id regex | no object-level scoping (by design) |
| 33 | `/api/events/[id]/faces` | GET | user | any | none | event-id regex | face metadata for the event |
| 34 | `/api/events/[id]/read` | POST | user | any | none | event-id regex | shared read state; any user can mark any event |
| 35 | `/api/events/[id]/snapshot` | GET | user | any | none | event-id regex, DB path + `snapshotFile` containment | `private, no-store` |
| 36 | `/api/faces` | GET | user | any | none | query parser | documented: VIEWER may read face list |
| 37 | `/api/faces/[id]` | GET | user | any | none | face-id regex | no filesystem path returned |
| 38 | `/api/faces/[id]/image` | GET | user | any | none | face-id regex, DB path + `faceCropFile` containment | `private, no-store`; IDOR-by-design (single tenant) |
| 39 | `/api/hls/[path]/[[...asset]]` | GET | user | any | none | relay-path allowlist, `..`/`/`/`\` rejection | injects MediaMTX basic auth server-side |
| 40 | `/api/webrtc/[path]/whep` | POST | user | any | none | relay path, 1 MB body cap | injects MediaMTX basic auth |
| 41 | `/api/webrtc/[path]/session/[id]` | DELETE | user | any | none | relay path + id regex | no session-ownership check (AUTH-11) |
| 42 | `/api/streams/[path]` | GET | user | any | none | relay-path description | returns mode + same-origin URLs |
| 43 | `/api/streams/presence` | POST | user | any | none | relay path | writes caller's own presence row |
| 44 | `/api/playback/search` | GET | user | any | none | `parseSearchParams` | hits DVR with server creds (AUTH-11) |
| 45 | `/api/playback/recording-dates` | GET | user | any | none | camera range + month regex | cached DVR ISAPI search |
| 46 | `/api/playback/session` | POST, DELETE | user | any | none | camera enum, ISO time parse, 8 h span cap, token regex | global single playback path (AUTH-11) |
| 47 | `/api/playback/download` | GET | user | any | none | — | always `501` |
| 48 | `/api/playback/thumbnail/index` | GET | user | any | none | camera/date validation | GET side effect → DVR work (AUTH-09) |
| 49 | `/api/playback/thumbnail/sprite` | GET | user | any | none | camera/date/start validation + `spriteFile` containment | private cache |
| 50 | `/api/notifications` | GET | user | any | none | date/range/camera/status enum | notification history |
| 51 | `/api/notifications/stats` | GET | user | any | none | range enum | aggregate counts |

**Page-level guard summary:** `/login` is the only public page (`src/app/login/page.tsx`, redirects to `safeNext` when already authenticated). Every other page is under `src/app/(hub)/layout.tsx:9-13` (`appConfigured` + `currentSession()` + redirect), and `/settings/**` adds the ADMIN gate at `src/app/(hub)/settings/layout.tsx:5-7` (VIEWER → redirect `/`). No Server Actions exist (`grep -rn '"use server"' src` → none), so there is no action-specific auth surface. There is no per-user object ownership model anywhere: the only authorization boundary is `role`, and every signed-in user can read every event, snapshot, face crop and recording (documented intent in `src/app/api/faces/route.ts:21-24`, `src/app/api/events/[id]/read/route.ts:11`).

---

## Verified controls (present and correctly implemented)

1. **Every non-public API route calls a guard as its first statement** — verified by enumerating all 51 `route.ts` files (matrix above); the only unguarded handlers are `/api/health`, `/api/auth/login`, `/api/auth/logout`, all intentional.
2. **ADMIN vs VIEWER enforcement is consistent** — 22 handler invocations across 16 route files call `requireAdmin()`; `requireAdmin` re-checks the *live* role from `auth_sessions ⋈ users` (`src/server/http/require-user.ts:27-36`, `accounts.ts:150-166`), so a demoted admin loses admin access immediately.
3. **Sessions are server-side and revocable** — `auth_sessions` row + `users.enabled` + DB expiry are checked on every authenticated request (`src/lib/auth.ts:39-51`); logout deletes the row (`logout/route.ts:17-28`); password change/admin reset/disable delete every session for the user (`accounts.ts:113-120`); user delete removes sessions and presence (`accounts.ts:127-129`); expired rows are pruned at login and hourly (`login/route.ts:106`, `instrumentation.ts:27-35`).
4. **No session fixation** — login always creates a fresh `randomUUID` session id and overwrites the cookie (`login/route.ts:117-131`); the session id is never taken from client input.
5. **Token integrity** — HMAC-SHA256 over the payload, constant-time signature comparison, strict base64url alphabet check, `exp` enforced, minimum 16-char secret enforced at sign and verify (`src/lib/session.ts:25-32,52-54,71-78,88`).
6. **Password storage** — scrypt with a random 16-byte salt and `timingSafeEqual`; no plaintext anywhere; `listUsers()` strips `passwordHash` and API responses never include it (`accounts.ts:74-82`, `password-hash.ts:5-18`).
7. **Current-password required for self password change** and all sessions revoked on success (`auth/password/route.ts:57-79`).
8. **Last enabled ADMIN cannot be removed, demoted or deleted** (`accounts.ts:105-106,126`), preventing permanent lockout by a legitimate action.
9. **Seed/bootstrap credentials are not hardcoded** — `.env.example` ships blank `APP_USERNAME`/`APP_PASSWORD`/`SESSION_SECRET`; the app fails closed when unconfigured (`config.ts:118-121`, `require-user.ts:11-16`, `proxy.ts:7-9`).
10. **Open-redirect-safe `next` handling** — `safeNext` rejects `//`, `/\`, `://`, backslashes, CR/LF, `/login` (`src/lib/redirect.ts:1-7`); the login 303 uses a relative `Location` header (`login/route.ts:35-39,130`) and the client re-checks the value (`LoginForm.tsx:53-54`). No open redirect and no response-splitting path found.
11. **Media file paths are contained** — snapshots and face crops are resolved from DB-stored values through `snapshotFile`/`faceCropFile` with absolute-path, `..`, drive-letter and NUL rejection plus a prefix check (`src/lib/snapshot-path.ts:8-15`, `src/lib/face-path.ts:17-31`); no static directory serves CCTV data (`public/` only contains `robots.txt`).
12. **HLS/WHEP proxies are constrained** — path must be a known relay path, asset segments reject `..`/`/`/`\`, upstream URLs are built from server config only (no client-supplied host), MediaMTX credentials are injected server-side and never returned (`hls/.../route.ts:15-33`, `webrtc/[path]/whep/route.ts:18-38`). SSRF surface is bounded to MediaMTX with a fixed host.
13. **CSRF via cross-site POST is blocked for state-changing endpoints** by the explicit `SameSite=Lax` cookie (all mutations are non-GET) — residual gaps in AUTH-09.
14. **Secrets never reach the browser** — `client-boundary.test.ts` enforces no `DVR_PASSWORD`/`APP_PASSWORD`/`SESSION_SECRET`/`NEXT_PUBLIC_`/`rtsp://` in `src/app`/`src/components`; `/api/settings` masks the DVR password; Telegram status returns booleans only; `/api/dvr/status` excludes URLs/credentials; no `dangerouslySetInnerHTML`/`innerHTML` anywhere.
15. **CVE-2025-29927 (`x-middleware-subrequest`) is not applicable** — Next.js is 16.4.2 (`package.json`), far past the 15.2.3 fix, and `grep -rni "subrequest" node_modules/next/dist` returns no matches, i.e. this build does not honour that header.
16. **Next 16 proxy convention is correct** — `src/proxy.ts` is the file Next 16.4.2 recognises (`node_modules/next/dist/lib/constants.js:289-290` → `PROXY_FILENAME = 'proxy'`), so the middleware is not silently ignored.
17. **SQL-injection-safe auth queries** — every `auth_sessions`/`users`/`audit_logs` query is parameterised (`accounts.ts:48,53,65,70,75,90,109,111,144,153,169,173,185-186,192,210,234,253,291,298`); audit pagination is clamped (`accounts.ts:294-295`, `audit/route.ts:15-20`).
18. **No secrets in git** — `git ls-files | grep -i env` returns only `.env.example`; `.env`, `data/`, `backups/`, `tests/e2e/.auth/` and `*.onnx` are gitignored (`.gitignore`); `.env` is mode `0600`.
19. **Fail-closed error paths** — no handler returns data before its guard; every guard is the first statement; `requireUser` returns `500` (not data) when config is broken.
20. **Session ids are never accepted as credentials** — `/api/auth/sessions` exposes ids to the owning user for "this device" display, but a raw id cannot authenticate (`currentSession` requires a valid HMAC token, `auth.ts:42-48`).

## Unverified controls (could not be checked from static analysis / this environment)

1. **Tailscale Funnel header behaviour** — whether Funnel injects `X-Forwarded-Proto: https` and where it places the client IP in `X-Forwarded-For` (decides the real severity of AUTH-01 and AUTH-05). Needs the Lead's controlled request through the public URL.
2. **Production build presence of the proxy** — this checkout has only `.next/dev` artifacts (no production build). `src/proxy.ts` compiles in dev and the Next 16 convention is confirmed, but the standalone output (`Dockerfile` → `next build`) was not built or inspected, so "the deployed image contains the proxy" is assumed, not proven.
3. **Behaviour of revoked-session cookies against RSC pages** (AUTH-06) — whether `/events/[id]` data can be streamed before `(hub)/layout` redirects; requires the replay test.
4. **Deployed `.env` in production** — only the dev/checkout `.env` was measurable (lengths/mode). `SESSION_SECRET` entropy (43 chars) is adequate *if* random; `COOKIE_SECURE` is `false`-like in this checkout.
5. **Container/runtime hardening** — DB file permissions inside `./data`, process user, network namespace, `podman inspect` exposure of env vars; out of this audit's scope.
6. **MediaMTX's own auth enforcement** — the routes inject `MEDIAMTX_AUTH_PASSWORD` when set (it is set, 48 chars), but the rendered MediaMTX runtime config (`mediamtx/runtime.yml`, `scripts/render-mediamtx-config.mjs`) and anonymous-read behaviour were not exercised; `README.md:432-436` states `MEDIAMTX_ALLOW_ANONYMOUS` must stay unset.
7. **The DVR's own lockout after repeated auth failures** — `/api/playback/search` etc. reuse the server's DVR credentials; a failed DVR auth could lock the DVR account, but that behaviour is device-side.
8. **No dynamic verification of the `x-middleware-subrequest` probe** — static evidence is strong (no reference in the Next dist), but the header was not sent.

---

## Existing-test coverage: what would and would not catch these findings

Reviewed: `src/lib/auth.test.ts`, `src/lib/session.test.ts`, `src/server/auth/accounts.test.ts`, `src/server/events/v5-authorization.test.ts`, `src/app/api/auth/password-lifecycle.test.ts`, `src/app/api/**/route.test.ts` (stream, hls, webfrtc whep, telegram, notifications, detection, faces), `src/proxy.test.ts`, `src/server/security/client-boundary.test.ts`, `src/components/auth/login-security.test.ts`, `tests/e2e/security.spec.ts`, `tests/e2e/support/app.ts`.

**Would catch (regression-protected):** server-side session invalidation on password change / admin reset / disable / logout (`accounts.test.ts:36-93`, `password-lifecycle.test.ts:98-161`, `security.spec.ts:73-100`); session forgery/expiry/short-secret (`session.test.ts:6-24`); VIEWER 403 on `requireAdmin` routes (`v5-authorization.test.ts:36-58`, `security.spec.ts:57-71`); unauthenticated 401 for the *listed* API endpoints and 307 for all pages (`security.spec.ts:42-118`, `tests/e2e/support/app.ts:28-56`); HLS/WHEP anonymous rejection and traversal rejection (`hls/.../route.test.ts:59-79`, `webrtc/.../whep/route.test.ts`); password policy, hash replacement, no-hash-in-response (`accounts.test.ts`, `password-lifecycle.test.ts`); no secrets in client source (`client-boundary.test.ts`); credentials never in URLs/console (`login-security.test.ts`, `security.spec.ts:12-40,120-130`).

**Would NOT catch any of the reported findings:**
- **AUTH-01/02/03** — `accounts.test.ts:23-27` tests `consumeRateLimit` with a fixed literal key only; nothing tests `clientIp`, header trust, a per-username bucket, or missing lockout. There is no test that sends two logins with different `X-Forwarded-For`.
- **AUTH-04** — no test touches audit retention, audit row size or pre-auth writes; `listAudit` is tested only for filtering/pagination.
- **AUTH-05** — `auth.test.ts:19-37` asserts the *header-decides* behaviour as a feature and never asserts the deployed cookie actually carries `Secure`; no test inspects `Set-Cookie` from the real login route.
- **AUTH-06** — `proxy.test.ts` only asserts that the matcher *string* contains `_next/hmr` and not `|account|`/`|settings|`; it never invokes the proxy, never checks revocation, and no test asserts guard coverage for new routes.
- **AUTH-07** — `proxy.test.ts:11-16` checks three substrings; the unanchored `login`/`api/health` prefixes are untested.
- **AUTH-09** — no test asserts the absence/presence of Origin checks or CSRF tokens.
- **AUTH-10** — no timing test (expected).
- **AUTH-11** — no test for concurrent playback publishing or WHEP session ownership.
- **AUTH-12/13** — `security.spec.ts:111-114` asserts `/api/health` is *public* (i.e. blesses AUTH-12) and no test asserts which fields it may return; no test asserts what a VIEWER may see in `/api/dvr/info`.
- **AUTH-14** — bootstrap is tested only as a store unit (`accounts.test.ts:13-14`), never on the real login route with an existing user table; no forced-rotation test.
- **AUTH-16/17/18** — no test covers token claims, dead-code removal, or audit completeness.
- **Route-guard coverage gap:** every route test mocks `@/server/http/require-user` (`vi.mock(...)` in `stream-route.test.ts:12`, `telegram-route.test.ts:26`, `detection-route.test.ts:17`, `faces-api.test.ts:30`, `notifications/test/route.test.ts:9`, `whep/route.test.ts:19`), so a route that *forgets* the guard still passes its own tests. The only end-to-end guard list is hand-maintained in `tests/e2e/support/app.ts:34-67` and omits `/api/faces*`, `/api/events/stream`, `/api/events/[id]/*`, `/api/hls/*`, `/api/streams/*`, `/api/webrtc/*`, `/api/playback/session|search|thumbnail/*`, `/api/detection/*`, `/api/notifications/telegram/*`, `/api/users/[id]*`, `/api/notification-rules/[id]`, `/api/cameras/[id]` (mutations).

---

## Ranked summary

| Rank | ID | Severity | Title | Status |
|------|----|----------|-------|--------|
| 1 | AUTH-01 | HIGH | Login brute-force throttle keyed on spoofable `X-Forwarded-For`; no lockout | VERIFIED (static) |
| 2 | AUTH-02 | MEDIUM | Unauthenticated CPU exhaustion via synchronous scrypt in login | VERIFIED (static) |
| 3 | AUTH-03 | MEDIUM | Shared `"local"` bucket → global login lockout DoS | VERIFIED (static) |
| 4 | AUTH-04 | MEDIUM | Audit log unbounded + pre-auth writes with forged IP/UA | VERIFIED (static) |
| 5 | AUTH-05 | MEDIUM | Session cookie not `Secure` in shipped config; header-driven decision | VERIFIED (static) / SUSPECTED (Funnel) |
| 6 | AUTH-06 | LOW | Middleware trusts signature only; revocation enforced per route | VERIFIED (static) / SUSPECTED (streaming) |
| 7 | AUTH-07 | LOW | Unanchored middleware matcher exclusions | VERIFIED (static) |
| 8 | AUTH-08 | LOW | Length-only password policy; scrypt work factor below guidance | VERIFIED (static) |
| 9 | AUTH-09 | LOW | No CSRF tokens/Origin checks; Lax is the only control | VERIFIED (static) |
| 10 | AUTH-10 | LOW | Username enumeration by login timing | VERIFIED (static) |
| 11 | AUTH-11 | LOW | VIEWER can disrupt shared playback / WHEP sessions; no DVR-route limits | VERIFIED (static) |
| 12 | AUTH-12 | LOW | Public `/api/health` discloses DVR/gateway/DB state | VERIFIED (static) |
| 13 | AUTH-13 | LOW | VIEWER can read DVR serial/firmware via `/api/dvr/info` | VERIFIED (static) |
| 14 | AUTH-14 | LOW | Bootstrap admin from env, no forced rotation, non-atomic insert | VERIFIED (static) |
| 15 | AUTH-15 | LOW | 7-day sessions, no idle timeout, no re-auth for sensitive actions | VERIFIED (static) |
| 16 | AUTH-16 | INFO | Token `u`/`role` claims ignored; `sid` not bound to username | VERIFIED (static) |
| 17 | AUTH-17 | INFO | Dead legacy login helpers still unit-tested | VERIFIED (static) |
| 18 | AUTH-18 | INFO | Audit trail missing rule/camera/Telegram/denial events | VERIFIED (static) |

**Counts:** CRITICAL 0 · HIGH 1 · MEDIUM 4 · LOW 10 · INFO 3 (18 findings).
**No unauthenticated data-access, auth-bypass, privilege-escalation, session-fixation or IDOR path was found in the current tree**; every API handler and every page is behind a guard, ADMIN/VIEWER separation is enforced live from the database, and object-level authorization is absent by design in a single-household model. The exploitable surface is the login/rate-limit design (AUTH-01/02/03) and the cookie transport (AUTH-05).

---

## Suggested controlled dynamic tests for the Lead (no secrets, no destructive actions)

1. **Throttle bypass (AUTH-01):** 10 × `POST /api/auth/login` with a wrong password and a distinct `X-Forwarded-For: 198.51.100.<n>` header → expect `401` each time and **no `429`**. Run against the LAN address and (separately) the Funnel URL.
2. **Shared bucket / lockout (AUTH-03):** after the above, 9 × login with **no** `X-Forwarded-For` and a junk username → the 9th should be `429`. Run last: it blocks login for 15 min for header-less clients.
3. **Cookie flags (AUTH-05):** inspect `Set-Cookie` from a login over plain HTTP (expect `HttpOnly`, `SameSite=Lax`, no `Secure`), then repeat with `X-Forwarded-Proto: https` (expect `Secure`), then repeat through the Funnel URL (expect `Secure` — if absent, the claim in `README.md:698-699` is false).
4. **Revoked-cookie replay (AUTH-06):** log in, capture the cookie, log out, then replay the cookie against `/`, `/events/<valid-id>`, `/settings`, `/api/events/stream` and `/api/auth/session`; assert `307`/`401` **and** grep the response bodies for event/camera/user data.
5. **`x-middleware-subrequest` probe:** `GET /api/audit` unauthenticated with `x-middleware-subrequest: src/proxy.ts` (and `proxy`) → expect `401`, confirming CVE-2025-29927 is not exploitable on 16.4.2.
6. **Password-change invalidation:** log in twice (two contexts), change the password in one, confirm the other gets `401`; confirm the changing context still works.
7. **Role enforcement spot-check with a VIEWER:** `GET /api/audit`, `/api/users`, `/api/settings`, `/api/system/sessions` → `403`; `GET /api/dvr/info` → `200` (documents AUTH-13).
8. **Public endpoint:** unauthenticated `GET /api/health` → `200` with state fields, and confirm no credential/host strings appear in the body.
