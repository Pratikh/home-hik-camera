# Home CCTV Hub — Full Security Audit Report

**Target:** `/Users/guruswamihiremath/Desktop/projects/home-hik-camera`
**Revision audited:** branch `main`, commit `01c8b3f` (2026-10-30), working tree unchanged apart from this `audit/` directory
**Audit window:** 2026-11-03 → 2026-11-04 (Asia/Kolkata)
**Nature:** READ-ONLY application + infrastructure security audit. No source, configuration, `.env`, database, dependency or infrastructure was modified. No fix was implemented.
**Supporting evidence files:** [`audit/authz-findings.md`](authz-findings.md) (18 findings), [`audit/worker-data-findings.md`](worker-data-findings.md) (13 findings), [`audit/streaming-findings.md`](streaming-findings.md) (12 findings), [`audit/frontend-deps-findings.md`](frontend-deps-findings.md) (13 findings).

---

## Scope, method and limitations

**Architecture verified from the repository** (not assumed): Next.js 16.4.2 / React 19.3.1 hub on Node 24, SQLite (`data/events.sqlite`, WAL) via `node:sqlite`, MediaMTX 1.21.1 (RTSP → HLS/WebRTC) + Hikvision DS-7104 DVR, optional Python face worker (OpenCV YuNet) and object worker (YOLOX-Nano), Telegram Bot API notifications, Podman Compose, Ubuntu systemd deployment. The repository documents **Tailscale Funnel** as the remote-access mechanism; no Cloudflare Tunnel configuration exists in the tree (see STR-11).

**Methods**
1. Full source review of 261 files under `src/`, both Python workers, all Dockerfiles/compose/systemd units and the operational scripts.
2. Read-only inspection of the live SQLite database (`sqlite3 -readonly`, schema and row counts only), filesystem modes, backups, and git history.
3. **Controlled dynamic verification** on an isolated copy of the repository in `/tmp` with a throwaway database, no `.env`, no DVR credentials, Telegram disabled and a fake MediaMTX URL — first the dev server on `127.0.0.1:3100`, then a real `next build` + standalone production server on `127.0.0.1:3101`. This exercised middleware, login/session/role flows, rate-limiting behaviour, UNauthenticated access to every API and page, and the production headers/cookies. No production data, camera, DVR or Telegram endpoint was touched.
4. `npm audit` (read-only) against the lockfile; no installs/updates.
5. Cross-checks against the MediaMTX authentication/Control-API documentation and OpenAPI schema (external data, used only to validate configuration semantics).

**Limitations (explicitly unverified, see §E)**
- The production Ubuntu host, Podman containers/state, firewall/router rules, Tailscale/Cloudflare tunnel routes, SSH config and the real `.env` are **not reachable** from this macOS checkout (`podman ps` → "Cannot connect to Podman"). Any production-only control is marked unverified.
- MediaMTX was never started, so its runtime logging of RTSP source URLs is suspected, not proven.
- No destructive/DoS/brute-force testing was performed; timing/enumeration and rate-limit observations used a throwaway account and a bounded number of requests.
- A 13-hour gap occurred mid-audit; all evidence was re-validated against the unchanged working tree.

**Secret handling:** no secret value is reproduced in this report or the appendices. The checkout contains a real `.env` (mode 0600) and a generated `mediamtx/runtime.yml` (mode 0600) holding DVR/MediaMTX credentials; only their existence, file/line and length properties are reported. The audit did not read, copy or transmit their values.

---

## A. Executive summary

**Overall condition: reasonably well-built application security, materially weaker deployment/operations security.**

The Next.js layer is better than typical hobby CCTV projects. Every one of the 51 API route handlers is guarded server-side (`requireUser` or `requireAdmin`) as its first statement; ADMIN/VIEWER is enforced live from SQLite; sessions are server-side and revocable on logout, password change, admin reset, disable and delete; tokens are HMAC-SHA256 with constant-time comparison; passwords use scrypt with random salts; all SQL is parameterised; snapshot/face-crop/sprite paths are containment-checked and served only through authenticated, `no-store` routes; the login redirect is not open-redirectable; there are no XSS sinks, no `NEXT_PUBLIC_` secrets, no browser-stored credentials, and a scan of a production client bundle found zero DVR/Telegram/session/MediaMTX markers. In the isolated production build, unauthenticated requests to all 33 protected endpoints returned `401`, every page redirected to `/login`, the `x-middleware-subrequest` bypass did not work (Next 16.4.2), a VIEWER received `403` on all admin endpoints, a password change revoked the other sessions, and a logged-out cookie was rejected server-side.

The serious risks are at the edges of that application layer:

1. **The login barrier is weaker than it looks.** The brute-force throttle keys on a client-supplied `X-Forwarded-For` header and there is no per-account lockout (AUTH-01). **Dynamically confirmed:** 12 consecutive wrong-password attempts with distinct forged headers were all accepted (`401`, never `429`), while 9 attempts from one IP correctly hit `429`. Any client that can reach port 3000 directly (the compose file publishes `3000:3000` on every interface) can therefore guess passwords without limit, against an admin account whose initial password is the `APP_PASSWORD` environment value.
2. **Containers are not a security boundary here.** The web, MediaMTX and both workers run as **root**, under a deployment that documents **rootful Podman**, with the entire `./data` directory (SQLite with every password hash, session row and face crop) mounted read-write, and the full `.env` — including `SESSION_SECRET`, the Telegram bot token and the DVR password — injected into **every** service (WRK-01, WRK-02, STR-12). A single worker or media-server compromise is host root and full application takeover.
3. **MediaMTX's control plane is unauthenticated inside the compose network.** The generated config grants anonymous clients the `api` action, and MediaMTX's API returns path `source` strings — i.e. the DVR RTSP URL with its embedded credentials — plus the MediaMTX read password (STR-01). Combined with a flat compose network (STR-02), any container foothold reads the camera credentials without a web login.
4. **Privacy/retention and credential-at-rest gaps.** The database, WAL and data directories are world-readable (`0644`/`0755`) while the media files are deliberately `0600` (WRK-04); retention never prunes object-detection tracks, audit logs, presence or test requests (WRK-03); backups contain private face crops and the full credential-bearing database with no per-file integrity hashes, and `backups/` is missing from `.dockerignore` (WRK-10).
5. **Defence-in-depth edges:** session cookie not `Secure` in the shipped configuration (AUTH-05), no CSRF token and a login endpoint that accepts cross-site form posts (FRN-04/AUTH-09), a CSP that still allows inline scripts (FRN-01), no HSTS (FRN-02), and a public `/api/health` that discloses DVR/gateway state (AUTH-12).

No CRITICAL finding was identified: no unauthenticated data access, no authentication bypass, no privilege escalation, no IDOR, no SQL/command injection, no path traversal, no SSRF, and no secret in the browser bundle was found in the current tree. The system is not "secure by default", but its exploitable surface is concentrated in login throttling, deployment hardening and secret distribution rather than in the application's authorization logic.

---

## B. Security scorecard

Scores are comparative engineering judgements for **this deployment model** (single-household, production-like home server), not a formal certification and not comparable across projects.

| Category | Score | Rationale |
|---|---|---|
| **Authentication** | **6 / 10** | Strong primitives (scrypt, HMAC, server-side sessions, fixation-free, revocation on all credential events, fail-closed bootstrap). Loses points for the spoofable-IP throttle and missing account lockout (AUTH-01), synchronous scrypt on the event loop (AUTH-02), shared rate-limit bucket (AUTH-03), cookie transport (AUTH-05) and bootstrap-admin rotation (AUTH-14). |
| **Authorization** | **8 / 10** | Every API handler and page is guarded; ADMIN/VIEWER is read live from the DB; last-admin protection; no object-level model is needed in a single-household deployment. Loses points for single-tenant by design (expected) and unaudited privileged mutations. |
| **API security** | **7 / 10** | No SQLi/injection/traversal/SSRF found; inputs validated and pagination clamped; IDs validated; generic errors. Weak on rate limits for DVR-touching routes (AUTH-11), no CSRF/Origin checks (AUTH-09), and no per-user stream authorization because there is only one data plane. |
| **Camera & streaming security** | **6 / 10** | Excellent exposure hygiene (only 3000 + ICE 8189 published, DVR/RTSP never public, browser receives only relative URLs, server-side MediaMTX auth injection, authenticated/traversal-safe media routes). Undermined by the unauthenticated MediaMTX API exposing DVR credentials (STR-01), flat network (STR-02), and plaintext LAN transport (STR-05). |
| **Face/object worker security** | **4 / 10** | No network service/ports (good), path handling and SQL are sound, secrets are env-only and never returned, model downloads are hash-verified. But root containers + rw host mounts + full `.env` + no memory/dimension limits = least privilege is absent (WRK-01/02/08). |
| **Telegram security** | **7 / 10** | Token stays server-side, is never returned/logged, is redacted defensively, status endpoint returns booleans and is ADMIN-only, temp clips are deleted. Loses points for face-crop/clip/audio/camera-name egress (WRK-07), 0644 temp clip permissions (WRK-06) and unaudited sends. |
| **Database security** | **6 / 10** | Parameterised SQL everywhere, WAL/busy-timeout/foreign-keys handled, backups 0700/0600 with an online-backup + integrity check, secrets not stored in the DB. Loses points for world-readable DB/WAL (WRK-04), retention gaps (WRK-03), a stale 0644 DB copy (WRK-05) and no backup tamper-evidence (WRK-10). |
| **Frontend security** | **7 / 10** | No XSS sinks, no client secrets, no source maps in production, no CORS, strong clickjacking/referrer/permissions headers, generic errors. Loses points for inline-script CSP (FRN-01), no HSTS (FRN-02), missing `no-store` on JSON (FRN-03) and login CSRF (FRN-04). |
| **Infrastructure security** | **4 / 10** | Port publishing is disciplined and documented, restart policies/healthchecks/log rotation exist, `.env` is 0600 and systemd units are sane. But root containers, rootful Podman, flat network, no capability/no-new-privileges/read-only/resource limits, shared host data mounts, and a documented tunnel that differs from the stated deployment (STR-03, STR-02, WRK-01, STR-11). |
| **Dependency security** | **7 / 10** | Production runtime dependencies have **0** known advisories; lockfile v3 committed; `npm ci` in the image; model downloads are HTTPS + SHA-256 verified. Loses points for 16 dev-tooling advisories (build-only), mutable base-image tags and ranged NumPy pins (FRN-05/06). |
| **Privacy & logging** | **6 / 10** | Application logs are disciplined (no tokens, passwords, RTSP URLs; error names/status only), error responses are clean, and retention removes event media. Loses points for unpruned audit/telemetry metadata (WRK-03/AUTH-04), world-readable DB (WRK-04), Telegram/Cloudflare egress (WRK-07/STR-11) and 7-day sessions with no idle timeout (AUTH-15). |

---

## C. Vulnerability register

Sorted by severity. Every finding below carries the required fields; full per-finding write-ups (evidence excerpts, attack narrative, test status) are in the four appendix files. Status legend: **V** = verified statically/observed; **V-D** = verified dynamically in the isolated instance; **S** = suspected (deployment-dependent); **U** = could not safely verify.

### C.1 CRITICAL
**None identified.** No unauthenticated data access, auth bypass, privilege escalation, SQL/command injection, path traversal, SSRF or public DVR/RTSP exposure was found.

### C.2 HIGH

#### AUTH-01 — HIGH — Login brute-force protection is keyed on an attacker-controlled `X-Forwarded-For`, and there is no account lockout
- **Component:** login route / rate limiter. **Location:** `src/app/api/auth/login/route.ts:14-17,83`; `src/lib/rate-limit.ts:5-14`.
- **Evidence:** `clientIp()` takes the first `X-Forwarded-For` element with no proxy allowlist; the only throttle is `consumeRateLimit("login:"+ip, 8, 15 min)`. The hub is published as `3000:3000` on all interfaces (`compose.yml:53-54`) and exposed through a tunnel. No per-username bucket, no persistent lockout, no delay. **Dynamically confirmed:** 12 wrong-password attempts with distinct `X-Forwarded-For` values → 12 × `401`, zero `429`.
- **Attack scenario:** unauthenticated attacker on the LAN (or via the tunnel if the proxy preserves the client's first XFF element) iterates passwords while rotating a forged header; the bucket never triggers.
- **Impact:** unlimited online password guessing against a hub that grants live cameras, recordings, face crops and settings. The bootstrap admin password is `APP_PASSWORD` (AUTH-14), so a fresh install's weakest link is remotely guessable.
- **Remediation:** key the limiter on the socket peer/trusted-proxy-derived address; add a per-username + per-account persistent counter (SQLite) with progressive delay/lockout; alert on repeated failures; consider MFA for ADMIN over the tunnel.
- **Status:** **V** (LAN) / **S** (tunnel header ordering). **Tested:** SAFELY TESTED (isolated instance).

#### WRK-01 — HIGH — Containers (hub + both workers) run as root with read-write host bind mounts; rootful Podman is the documented production default
- **Component:** container runtime configuration. **Location:** `compose.yml:83-93,133-140`; `face-worker/Dockerfile:14-34`; `object-worker/Dockerfile:10-38`; `Dockerfile:17-33`; `deploy/systemd/README.md:17`.
- **Evidence:** no `USER` in any image; `./data` mounted read-write into web and both workers; `./object-worker/models` read-write; no `user:`, `read_only:`, `cap_drop`, `security_opt`, `no-new-privileges`, `mem_limit` or `pids_limit` anywhere. The production documentation requires "Rootful Podman with `podman compose` available to root", so container uid 0 is host uid 0.
- **Attack scenario:** code execution in a worker (media/model parsers) or the web/ffmpeg path becomes host root under rootful Podman; even rootless, the attacker can rewrite the live SQLite DB (users, roles, sessions, audit trail) via `./data`.
- **Impact:** full host/application compromise; integrity loss of all CCTV and account data.
- **Remediation:** non-root `USER` and `user:`; rootless Podman/user units; `read_only` + tmpfs; `cap_drop: [ALL]`; `no-new-privileges`; memory/PID limits; give workers a dedicated DB (or read-only attach) instead of the whole data directory.
- **Status:** **V**. **Tested:** read-only inspection only.

### C.3 MEDIUM

#### AUTH-02 — MEDIUM — Unauthenticated CPU exhaustion: synchronous `scryptSync` blocks the single Node event loop; throttle is bypassable
- **Component:** login/password hashing. **Location:** `src/lib/password-hash.ts:11-18`; `login/route.ts:110`.
- **Evidence:** `verifyPassword` calls `scryptSync` (N=16384) inside the request handler; it is reached whenever the username exists (short-circuit on missing users enables timing enumeration, AUTH-10). No queue/concurrency cap; the only brake is AUTH-01's bypassable bucket.
- **Impact:** full application unavailability while a few dozen concurrent requests for a known username keep the event loop busy (also stalls the DVR event processor in the same process). Availability only.
- **Remediation:** async `scrypt`/worker pool + global verification semaphore + per-username lockout.
- **Status:** **V**. **Tested:** not load-tested (DoS prohibited).

#### AUTH-03 — MEDIUM — Shared `"local"` rate-limit bucket lets one unauthenticated LAN client lock every LAN user out of login
- **Component:** login rate limiter. **Location:** `login/route.ts:16,83`.
- **Evidence:** with no `X-Forwarded-For`, the key is the constant `"local"`; normal LAN browsers send no XFF, so every LAN client shares 8 attempts / 15 min. Dynamically confirmed on the isolated instance: 9 attempts from the same key → the 9th `429`.
- **Impact:** denial of login for the whole household; repeatable every 15 minutes. No data exposure.
- **Remediation:** use the real socket address per client; never collapse missing-header requests into one bucket.
- **Status:** **V-D** (bucket behaviour) / **V** (key derivation). **Tested:** safely.

#### AUTH-04 — MEDIUM — Audit log has no retention and is writable pre-authentication with attacker-controlled IP and User-Agent
- **Component:** audit log. **Location:** `login/route.ts:111`; `src/server/auth/accounts.ts:250-266`; no `DELETE FROM audit_logs` anywhere.
- **Evidence:** each failed login inserts `LOGIN_FAILED` with the spoofable IP and the raw `User-Agent`, unbounded. **Dynamically confirmed:** a failed login with an 8,000-byte User-Agent and forged `X-Forwarded-For: 203.0.113.77` produced an `audit_logs` row with `length(user_agent)=8000` and the forged IP stored verbatim. 1,731 rows exist in the current DB and nothing prunes them.
- **Impact:** forensic poisoning (attacker chooses the IPs attributed to their attempts) and unbounded disk growth (16 KB/request with AUTH-01 bypass) that can exhaust the data volume and stop retention/backups.
- **Remediation:** trusted-proxy IP derivation; cap stored UA/resource length; add audit retention; rate-limit failed-login writes; withhold/filter pre-auth rows from the UI until validated.
- **Status:** **V-D**. **Tested:** safely (throwaway DB).

#### AUTH-05 — MEDIUM — Session cookie is not `Secure` in the shipped configuration, and `Secure` is decided by a client-spoofable header
- **Component:** cookie options. **Location:** `src/lib/auth.ts:16-37`; `login/route.ts:131`.
- **Evidence:** `sessionCookieOptions(secure)` with `secure = config.cookieSecure || requestUsesHttps(request)`; `requestUsesHttps` trusts `x-forwarded-proto` unconditionally. The deployed `.env` sets `COOKIE_SECURE` to a false-like value (README:391 documents `false` as intentional for HTTP LAN use). Dynamically confirmed: plain HTTP login → no `Secure`; `X-Forwarded-Proto: https` → `Secure`.
- **Impact:** a cookie issued over HTTPS can be transmitted if any plain-HTTP path to the hub is used (LAN IP, downgrade, missing header at the proxy); session theft for up to 7 days.
- **Remediation:** set `COOKIE_SECURE=true` in production; use a `__Host-` prefix; ignore/strip client-supplied `X-Forwarded-*`; verify the real tunnel always injects `X-Forwarded-Proto: https`.
- **Status:** **V** (flag logic) / **S** (tunnel). **Tested:** dynamic flag behaviour verified.

#### WRK-02 — MEDIUM — Every container (including both workers and MediaMTX) receives the full `.env`, exposing `SESSION_SECRET`, the Telegram token and DVR/MediaMTX/APP credentials
- **Component:** secret distribution. **Location:** `compose.yml:12-13,43-44,83-84,133-134`.
- **Evidence:** all four services use `env_file: .env`. The workers never read `SESSION_SECRET`, `TELEGRAM_*`, `HIKVISION_*` or `APP_PASSWORD`; MediaMTX needs only a subset. Any `podman inspect` or `/proc/1/environ` read yields everything.
- **Impact:** worker/media-server compromise escalates to admin-session forgery (SESSION_SECRET), full Telegram bot takeover, and direct DVR access.
- **Remediation:** per-service minimal `environment:` blocks; rotate SESSION_SECRET/Telegram token/DVR password if this compose file has ever run in production.
- **Status:** **V**. **Tested:** names/lengths only.

#### WRK-03 — MEDIUM — Retention does not cover object-detection tracks, audit logs, presence or test requests
- **Component:** data lifecycle. **Location:** `src/server/events/retention.ts:80-133`; `event-store.ts:1606-1609`; no `DELETE` for those tables anywhere.
- **Evidence:** event snapshots/crops/history are pruned, but `object_detection_tracks` (no FK to events), `audit_logs`, `object_detection_test_requests` and `viewer_presence` grow forever. Current DB: 100 tracks, 1,731 audit rows, 3 test requests, 9 presence rows.
- **Impact:** a permanent, UI-invisible history of who/where/when plus PII (IPs, user agents), contrary to the operator's retention expectation; unbounded backup growth.
- **Remediation:** add retention for those tables; FK/cascade or explicit cleanup for tracks; document an audit-log retention exception.
- **Status:** **V** (static + read-only counts). **Tested:** safely.

#### WRK-04 — MEDIUM — Live DB/WAL/SHM and data directories are world-readable (0644/0755), exposing password hashes, session rows and audit PII
- **Component:** SQLite filesystem permissions. **Location:** `data/events.sqlite*` (0644), `data/` (0755); creation `src/server/events/event-store.ts:1729-1730` with no mode/chmod.
- **Evidence:** `ls -l` shows `-rw-r--r--` DB + 4.2 MB WAL + SHM and `drwxr-xr-x` data/events/face-crops/telegram-clips, inconsistent with the deliberate `0600` for snapshots/crops, `0600` backup-status and `0700` backups. Rootful Podman makes these root-owned 0644 on the host; the systemd README hardens only `.env`.
- **Impact:** any local account/process reads scrypt password hashes, session ids/IPs/UA, audit history and event metadata, and can see snapshot filenames via 0755 directories.
- **Remediation:** create with `0700`/`0600`, `chmod` after open, `UMask=0077` in units, document `chmod -R go-rwx data/`.
- **Status:** **V** (static + `ls`). **Tested:** safely.

#### STR-01 — MEDIUM — MediaMTX Control API is unauthenticated inside the compose network and returns the DVR RTSP URL (with credentials) and the MediaMTX password
- **Component:** MediaMTX config + hub control-plane client. **Location:** `scripts/render-mediamtx-config.mjs:148-157`; `mediamtx/runtime.yml:26-40`; `src/server/video/mediamtx.ts:8`; `media-status.ts:83,100-118`; `playback-gateway.ts:22-46`.
- **Evidence:** `user: any / pass: '' / permissions: [api]` grants anonymous Control API access; `apiAddress: :9997` is on the compose network. MediaMTX's OpenAPI schema confirms `/v3/config/paths/list` returns each path's `source` (the camera paths embed `rtsp://user:password@DVR`) and `/v3/config/global/get` returns `authInternalUsers` including the plaintext `hub` password. The hub itself calls the API with no credentials.
- **Attack scenario:** any container on the compose network (compromised worker, SSRF, stray container) reads DVR credentials or the MediaMTX password, then reads/tampers camera paths without a web login.
- **Impact:** camera credential theft + media-plane control; enables direct DVR access outside the hub.
- **Remediation:** remove the anonymous `api` user; give the hub a credential and send it; hash MediaMTX credentials; restrict `api` by source IP; internal-only network.
- **Status:** **V** (static + vendor schema). **Tested:** no MediaMTX started.

#### STR-02 — MEDIUM — The compose stack is one flat network; workers/MediaMTX can reach the hub, the control API and the DVR
- **Component:** Podman Compose networking. **Location:** `compose.yml` (no `networks:` definitions).
- **Evidence:** all four services share the default bridge with unrestricted east-west traffic; workers reach `mediamtx:8554/9997` and `web:3000` by design and inherit host NAT to the DVR LAN.
- **Impact:** removes the container boundary as containment; any single-service bug becomes a stack-wide compromise (chains with WRK-01/02 and STR-01).
- **Remediation:** split `edge`/`media` networks with `internal: true`; restrict worker egress to MediaMTX; firewall container→DVR where possible.
- **Status:** **V**. **Tested:** static.

#### STR-03 — MEDIUM — Web and MediaMTX containers run as root, writable filesystem, no capability/no-new-privileges/resource limits
- **Component:** container hardening (web + MediaMTX; worker equivalent is WRK-01). **Location:** `Dockerfile:17-33`; `mediamtx/Dockerfile:5-13`; `compose.yml` (no hardening keys).
- **Evidence:** no `USER`, no `read_only`, no `cap_drop`, no `security_opt`, no `mem_limit`/`pids_limit`; rootful Podman documented; web mounts `./data` read-write and ships `wget`/`ffmpeg`.
- **Impact:** RCE in Next.js/FFmpeg = host root under the documented model; unbounded resource use can exhaust a 4 GB host.
- **Remediation:** as WRK-01, applied to web and MediaMTX too.
- **Status:** **V**. **Tested:** static.

#### FRN-01 — MEDIUM — Production CSP permits inline scripts and omits `object-src`, `base-uri` and `form-action`
- **Component:** CSP/headers. **Location:** `next.config.ts:16-26,33-45`; verified production header.
- **Evidence:** `script-src 'self' 'unsafe-inline'` (no nonce/hash); `object-src`, `base-uri`, `form-action` unset; `'unsafe-eval'` correctly dev-only.
- **Impact:** any future HTML-injection bug is materially easier to exploit; `<base>`/form hijacking not constrained. No XSS sink exists today (FRN-09), so this is defense-in-depth.
- **Remediation:** nonce-based `script-src 'nonce-…' 'strict-dynamic'`, add `object-src 'none'; base-uri 'self'; form-action 'self'`.
- **Status:** **V-D** (isolated production build). **Tested:** safely.

### C.4 LOW

| ID | Title | Location | Impact | Remediation | Status |
|---|---|---|---|---|---|
| AUTH-06 | Middleware validates only the HMAC cookie, not the DB session; revocation relies on per-route/layout guards | `src/proxy.ts:6-22`; `src/app/(hub)/layout.tsx:10-12` | No exploit today (all 51 handlers guarded); a future route/page that forgets a guard would be reachable with a revoked cookie | Validate the session row in the proxy or add a CI guard-coverage test | V |
| AUTH-07 | Matcher exclusions are unanchored prefixes (`login`, `api/health`, …) | `src/proxy.ts:38` | Latent: a future `/api/health*` or `/login…` route would be silently public | Anchor each exclusion (`login(?=$|[/?#])`) or invert to an explicit public allowlist | V-D (`/api/healthx` → 404 not 401) |
| AUTH-08 | Password policy is length-only (8–200); scrypt work factor below current guidance | `src/lib/passwords.ts:8-22`; `password-hash.ts:7,14` | Weak user-chosen passwords; cheaper offline cracking after DB/backup disclosure | Min 12+, deny-list, re-hash with N=2^17 on next login | V |
| AUTH-09 | No CSRF tokens or Origin/Referer checks; CSRF posture rests on `SameSite=Lax`; login accepts form posts | `src/lib/auth.ts:32`; `login/route.ts:19-23` | Login CSRF; any future state-changing GET would be CSRF-able | Origin/Sec-Fetch-Site checks; CSRF token; make GET side-effect-free | V-D (form login accepted cross-origin) |
| AUTH-10 | Username enumeration via login timing (scrypt only runs for existing users) | `login/route.ts:107-115` | Enables targeted brute force/lockout | Dummy hash verification for unknown users | V-D (≈35 ms vs ≈3 ms) |
| AUTH-11 | Any authenticated user can disrupt others' playback/WHEP sessions; no per-user limits on DVR-touching endpoints | `playback/session/route.ts:24-106`; `playback-gateway.ts:55-90`; `webrtc/.../session/[id]/route.ts` | Availability/stability impact from a VIEWER account | Per-user playback ownership, rate limits, ownership-checked WHEP delete | V |
| AUTH-12 | Public `/api/health` discloses DVR/gateway/DB/ingestion state | `src/app/api/health/route.ts:12-36`; `proxy.ts:38` | Reconnaissance only; no secrets | Keep liveness only; move detail to ADMIN endpoint | V-D |
| AUTH-13 | VIEWER can read DVR model/serial/firmware/hardware identifiers | `src/app/api/dvr/info/route.ts:9-19`; `hikvision-status.ts:58-70` | Device fingerprinting for a Hikvision-focused attacker | Return serial/firmware to ADMIN only | V |
| AUTH-14 | Bootstrap admin comes from `APP_USERNAME`/`APP_PASSWORD`, no forced rotation; non-atomic insert | `src/server/auth/accounts.ts:52-62`; `login/route.ts:103` | Weak initial credential is the likeliest full-compromise path; one-off 500 race on first run | Force password change; refuse weak/equal APP_PASSWORD; `INSERT OR IGNORE` | V |
| AUTH-15 | 7-day absolute sessions, no idle timeout, no re-auth for sensitive actions, no client-context binding | `src/lib/session.ts:4`; `accounts.ts:138-194` | Stolen cookie usable for up to 7 days | Idle timeout; shorter ADMIN sessions; step-up re-auth for user/session/Telegram actions | V |
| WRK-05 | Stale 0644 `events.sqlite.corrupt-20261017-194428` copy with 2 users and 388 sessions | `data/events.sqlite.corrupt-20261017-194428` | Unmanaged second copy of hashes/session/IP history readable locally | Delete/quarantine to a 0600 managed path; document disposition | V |
| WRK-06 | Telegram temp clips written 0644 in a 0755 directory | `src/server/notifications/event-clip.ts:391-393,652-655` | Local users can read up to 30 min of clip video/audio before deletion | `mkdir(…,{mode:0o700})`, pre-create 0600 output, shorten stale window | V |
| WRK-07 | Face crops/snapshots, clips with audio and camera display names are uploaded to Telegram | `telegram-media.ts:264-343`; `telegram.ts:121-141`; `event-clip.ts:194-231` | Third-party cloud holds identifying household imagery/audio; camera name is a location hint | Document egress in UI; prefer full snapshot; audio-free/name-free modes; local Bot API option | V |
| WRK-08 | No pixel/dimension bound before OpenCV decode; no container memory limits (decompression bomb / OOM) | `face-worker/pipeline.py:117-124`; `object-worker/worker.py:287-295`; `snapshot.ts:10,62-63`; compose | Worker OOM/crash; host memory pressure on a 4 GB box | Reject images above a pixel budget; add `mem_limit`/`pids_limit` | V (exploitability needs a crafted file in DATA_DIR) |
| WRK-09 | Backup verify/restore accept symlinks; snapshot serving resolves lexically (no `realpath`) | `scripts/verify-backup.sh:114-149`; `scripts/restore.sh:97-147`; `src/lib/snapshot-path.ts:8-15` | A tampered backup restored by an operator can turn an authenticated snapshot request into arbitrary file read | Reject symlinks in verify/restore; `lstat`/`realpath` containment in the server | V (not safely tested) |
| WRK-10 | Backups contain private media + credential material with no hash/signature; `backups/` not in `.dockerignore` | `scripts/backup.sh:143-191`; `verify-backup.sh:73-151`; `.dockerignore:1-17`; `Dockerfile:13` | Tampered backup passes verification; private CCTV data copied into build context/cache | SHA-256 manifest + optional HMAC; add `backups` to `.dockerignore` | V |
| STR-04 | WebRTC ICE 8189 published on all interfaces, unauthenticated at transport | `compose.yml:23-25`; `mediamtx.yml:14-15` | Discoverable media port; DoS surface; no media join without authenticated WHEP | Bind to LAN address/subnet or firewall | V |
| STR-05 | DVR traffic plaintext on LAN (HTTP digest ISAPI, unencrypted RTSP) | `hikvision-client.ts:141`; `render-mediamtx-config.mjs:42` | LAN sniffing of camera video/snapshots; offline digest cracking | Isolate camera VLAN; longer DVR password; TLS if supported | V |
| STR-06 | Generated `mediamtx/runtime.yml` persists plaintext DVR + MediaMTX credentials in the checkout | `mediamtx/runtime.yml:29,43-89` (0600, gitignored, dockerignored) | Local readers/copies obtain all camera credentials | Render to a runtime path outside the repo; document as credential material | V |
| STR-07 | MediaMTX wildcard CORS and catch-all publisher path | `render-mediamtx-config.mjs:133,136,165`; `runtime.yml:11,14,90-91` | Latent if 8888/8889/8554 ever exposed; publisher permission not granted today | Restrict origins; remove `all_others` unless needed | V |
| STR-08 | HLS proxy forwards raw query string and upstream `Set-Cookie` | `src/app/api/hls/[path]/[[...asset]]/route.ts:21-48` | Query abuse / cookie-namespace coupling; no traversal/SSRF (allowlist correct) | Allowlist query params; strip upstream `Set-Cookie` | V |
| FRN-02 | No HSTS / `upgrade-insecure-requests`; `Secure` still header-dependent | `next.config.ts:33-45`; `src/lib/auth.ts:16-37` | Downgrade/session-cookie exposure on mixed HTTP/HTTPS | `COOKIE_SECURE=true` in prod; add HSTS + `upgrade-insecure-requests` | V-D |
| FRN-03 | Authenticated JSON APIs lack `Cache-Control: no-store` | events/faces/notifications/cameras/dvr route handlers | Private metadata may be cached by browser/proxy | Add `private, no-store` via a shared helper | V-D |
| FRN-04 | Cross-site form login accepted (login CSRF) | `login/route.ts:19-23,48-70,126-132` | Victim logged into attacker's account; actions recorded under attacker account | Origin check + CSRF token on login/mutations | V-D |
| FRN-05 | 16 dev-tooling advisories (incl. high `zod` GHSA-mrhx-c7xc-m3w5); production deps clean | `package.json`/lockfile; `npm audit` | Build/CI only; runtime image unaffected | Dev-dependency refresh; gate releases on `npm audit --omit=dev` | V |
| FRN-06 | Mutable base-image tags (no digests); ranged NumPy pins | Dockerfiles; `requirements.txt` | Supply-chain drift between rebuilds | Digest-pin images; exact-pin NumPy | V |
| FRN-07 | Dev build in the checkout contains 155 source maps (production build: 0) | `.next/dev/**` | Disclosure only if dev output is served/deployed; `npm run dev` binds 0.0.0.0 | Bind dev to localhost; never ship `.next/dev` | V |

### C.5 INFO

| ID | Observation | Location | Recommendation | Status |
|---|---|---|---|---|
| AUTH-16 | Token `u`/`role` claims ignored; `sid` not bound to username (safe today) | `src/lib/session.ts:46-96`; `src/lib/auth.ts:39-51` | Drop redundant claims or assert they match the DB row | V |
| AUTH-17 | Legacy env-credential helpers are dead code but still unit-tested | `src/lib/passwords.ts:24-51`; `src/lib/auth.test.ts:5-17` | Remove dead code; add real login-route tests | V |
| AUTH-18 | Audit trail misses rule CRUD, camera rename, Telegram sends and all 401/403 denials | `src/app/api/**` vs `writeAudit` call sites | Extend audit coverage | V |
| WRK-11 | Partial pinning; object worker downloads its model at container start (HTTPS + pinned SHA-256, verified) | `object-worker/docker-entrypoint.sh:10-12`; `download_model.py`; Dockerfiles | Provision model on host; digest-pin base images | V |
| WRK-12 | SUSPECTED: RTSP URLs with credentials may appear in OpenCV/FFmpeg/MediaMTX logs | worker/mediamtx logging | Use MediaMTX read credentials without embedded DVR creds where possible; verify live logs | S |
| WRK-13 | No SQL injection: all queries parameterised; only constant identifiers in PRAGMA/ALTER | `event-store.ts:603-612`; `accounts.ts` | Keep dynamic identifiers internal-only | V |
| STR-09 | WHEP session teardown not bound to the authenticated user | `webrtc/.../session/[id]/route.ts:10-33` | Map session→user server-side | V |
| STR-10 | Public `/api/health` discloses deployment state | `src/app/api/health/route.ts` | Liveness only | V-D |
| STR-11 | Repository documents **Tailscale Funnel**; stated deployment uses **Cloudflare Tunnel**; no tunnel config in repo | `README.md:11,27,42,61-68` | Reconcile docs; if Cloudflare, add Access/mTLS, Full-strict TLS, route only 3000, verify `X-Forwarded-Proto` | S |
| STR-12 | MediaMTX container receives the full `.env` | `compose.yml:12-13` | Minimal per-service environment | V |
| FRN-08 | `backups/` enters Docker build context (builder stage/cache, not final image) | `.dockerignore`; `Dockerfile:13` | Add `backups` (canonical: WRK-10) | V |
| FRN-09 | No XSS sinks, no browser storage, no `NEXT_PUBLIC_*`; production bundle scan: 0 secret markers | `src/**`; isolated production build | Keep the client-boundary test | V-D |
| FRN-10 | Errors expose no stack traces/internal paths; client error boundary is generic | `src/app/error.tsx:10-15`; `src/lib/client-api.ts` | Keep | V-D |
| FRN-11 | Deliberate log redaction; bot token never logged; errors log names/status; residual = audit UA/IP | `telegram.ts:177-181`; logging grep | Extend redaction to audit fields (AUTH-04) | V |
| FRN-12 | No CORS headers emitted (safe default) | production responses | Keep | V-D |
| FRN-13 | Telegram (and, if used, Cloudflare) receive private CCTV content by design | `telegram-media.ts`; tunnel | Surface egress in UI; prefer private tailnet for media | V |

**Register counts:** CRITICAL 0 · HIGH 2 · MEDIUM 11 · LOW 27 · INFO 16 → **56 findings** (some appendix entries cross-reference each other; the count above is the de-duplicated register).

---

## D. Verified security controls

Controls that were actually read **and** (where safe) exercised, not merely assumed:

1. **Complete API guard coverage.** All 51 `route.ts` handlers enumerated; the only unguarded ones are `/api/health`, `/api/auth/login`, `/api/auth/logout` (intentional). Every other handler calls `requireUser`/`requireAdmin` as its first statement.
2. **Dynamic unauthenticated-access test on the isolated production build:** all 33 protected API endpoints returned `401`; `/`, `/events`, `/faces`, `/cameras`, `/settings`, `/playback`, `/account`, `/settings/users` returned `307` to `/login` with no data; only `/login`, `/api/health`, `/manifest.webmanifest`, `/robots.txt`, `/icon.svg` are public.
3. **No middleware bypass:** path-as-is traversal variants, encoded paths, double slashes, uppercase paths, `x-middleware-subrequest` variants and `x-forwarded-host` spoofing all failed to reach data (`401`/`307`/`404`); Next 16.4.2 does not honour `x-middleware-subrequest` (CVE-2025-29927 N/A), and `src/proxy.ts` is the correct Next 16 filename. The proxy is present and active in the **production** build (verified: `ƒ Proxy (Middleware)` + live redirects).
4. **ADMIN/VIEWER enforcement, live from the database:** a dynamically created VIEWER got `403` on `/api/users`, `/api/settings`, `/api/system/health`, `/api/audit`, `/api/system/sessions`, `/api/notification-rules`, `/api/notifications/telegram/status`, `/api/settings/detection`, and on all four tested admin mutations; promotion to ADMIN took effect on the existing session immediately, and demotion to VIEWER removed access immediately.
5. **Server-side revocable sessions:** logout deletes the row (old cookie → `401`); password change revoked all other sessions and reissued the current one (**dynamically verified**: second session → `401`, changing session → `200`); admin reset/disable/delete revoke sessions; expired rows are pruned hourly; no session fixation (fresh `randomUUID` on every login).
6. **Token and password cryptography:** HMAC-SHA256 with constant-time signature comparison, strict base64url parsing, `exp` enforcement, minimum 16-char secret; scrypt (N=16384, r=8, p=1) with 16-byte random salt and `timingSafeEqual`; no plaintext password anywhere; `passwordHash` stripped from API responses.
7. **Password-change authorisation:** current password required for self-change, rate-limited; ADMIN reset is role-gated; the last enabled ADMIN cannot be deleted/demoted/disabled.
8. **No hardcoded/default credentials:** `.env.example` ships blank `APP_USERNAME`/`APP_PASSWORD`/`SESSION_SECRET`; the app fails closed when unconfigured; `.env` is gitignored, mode 0600, untracked (`git log` shows it was never committed); `mediamtx/runtime.yml` never committed.
9. **Open-redirect safety:** `safeNext` rejects `//`, `/\`, `://`, backslashes and CR/LF; login uses a relative `Location`; the client re-validates the redirect (`dynamically: form login with `next` produced a relative 303`).
10. **CCTV media protection:** no static directory serves CCTV data (`public/` has only `robots.txt`); snapshots and face crops are stored `0600`, served only through authenticated routes with DB-stored-path containment, `private, no-store`; face crop paths are never returned by JSON; snapshot/face/sprite traversal attempts return `404`/`400`.
11. **Streaming exposure hygiene:** only `3000` and MediaMTX ICE `8189` are published; DVR `80`/`554`, MediaMTX `8554`/`8888`/`8889`/`9997` are never published (dev overlay is loopback-only); MediaMTX refuses to start without a 16+ char read password; the browser receives only same-origin relative stream URLs; HLS/WHEP proxies inject MediaMTX auth server-side and never return it.
12. **SSRF bounded:** all upstream URLs are built from server config; HLS/WHEP/playback accept only allowlisted relay paths/camera ids/timestamps; no user-controlled host reaches `fetch`; no SQL/command injection or path traversal found in the reviewed routes (all SQL parameterised; dynamic identifiers are compile-time constants).
13. **CSRF baseline:** all mutating endpoints are non-GET and the session cookie is `SameSite=Lax`, which blocks cross-site credentialed POST/PUT/PATCH/DELETE in current browsers (residual login-CSRF gap FRN-04).
14. **Security headers (production build):** CSP with `frame-ancestors 'none'`, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, `Referrer-Policy: same-origin`, restrictive `Permissions-Policy`, `poweredByHeader` disabled, no CORS headers, login page `no-store`.
15. **No frontend secret/XSS surface:** no `dangerouslySetInnerHTML`/`innerHTML`/`eval`/`javascript:`/`window.open`, no `localStorage`/`sessionStorage`/`document.cookie`, no `NEXT_PUBLIC_*`; production client bundle scan found 0 occurrences of `rtsp://`, `HIKVISION`, `TELEGRAM`, `SESSION_SECRET`, `MEDIAMTX_AUTH`, `api.telegram.org`; 0 source maps in the deployed build.
16. **Logging hygiene:** bot token never logged (dedicated redaction helper); errors log names/status only; no RTSP URL or credential in application logs; curl-verified error responses are generic with no stack/path.
17. **Telegram access control:** `/api/notifications/telegram/status` and `/test` are ADMIN-only (VIEWER `403` verified); status returns booleans only (no token/chat id); `/api/settings` masks the DVR password; `/api/dvr/*` returns no host/username/password.
18. **Secrets not stored in the database:** `app_settings` holds operational keys only; no Telegram token/chat id or DVR/MediaMTX credential in SQLite (schema + key inventory verified read-only).
19. **Backup hygiene (partial):** `backups/` is 0700, files 0600, `.env` excluded, SQLite online backup + `quick_check` + atomic promotion, seven-copy retention; the backup DB contains no tokens/chat ids/secrets.
20. **Production dependencies:** `npm audit --omit=dev` → 0 advisories; `npm ci` in the image; model downloads use HTTPS + hard-coded SHA-256 verification before write.

---

## E. Unverified controls

These could not be proven from this checkout and should be confirmed on the production host (listed so the report is not read as stronger than it is):

1. **Production host/Podman state** — running containers, userns mapping, actual `podman inspect` output, image digests, healthcheck history, restart behaviour (`podman ps` unavailable in this environment).
2. **Firewall/router/NAT** — that only 3000 is forwarded/published externally, that 8189 is LAN-only, and that 80/554/8554/8888/8889/9997 are blocked at the host firewall.
3. **Tunnel configuration** — the real Tailscale Funnel or Cloudflare Tunnel routes and header injection (`X-Forwarded-Proto`, `X-Forwarded-For`); the repository documents Tailscale Funnel while the stated deployment uses Cloudflare (STR-11).
4. **Live MediaMTX behaviour** — whether its `info` logs print source URLs with embedded credentials (WRK-12); whether the Control API indeed returns `source`/`authInternalUsers` as the schema indicates (STR-01 is static+schema verified only).
5. **SSH daemon configuration and host hardening** (fail2ban, unattended-upgrades, sysctl, AppArmor) — not present in the repo and not reachable.
6. **Production `.env` values** — only lengths/mode/booleans were measured; entropy of secrets and production `COOKIE_SECURE`/retention settings are unverified.
7. **DVR-side behaviour** — lockout after repeated failures, TLS support, firmware vulnerabilities (CVE matching for the DVR was out of scope).
8. **Python dependency CVEs** — `pip-audit`/`trivy`/`osv-scanner` are not installed and were not installed; no CVE claim is made for the worker dependency set (only pinning observations).
9. **Backup restore rehearsal** — not executed (would modify data); symlink/integrity findings are static.
10. **Browser CSRF semantics and Cloudflare caching** — inferred from standards/configuration, not measured against the real edge.
11. **DoS resistance** — deliberately not load-tested; AUTH-02's impact is reasoned, not measured.
12. **Post-2026-11-03 advisories** — dependency audit is a point-in-time snapshot.

---

## F. Recommended remediation plan

### Immediate (critical/high — do first)

1. **Fix login throttling and add lockout (AUTH-01/02/03/10).** Derive the key from the socket/trusted proxy only; add a persistent per-username counter (5 failures → progressive delay, then lock for 15 min); use async scrypt or a worker pool; verify the dummy-hash timing equalisation. *(Application change; test on a copy first.)*
2. **Rotate secrets and stop broadcasting them (WRK-02, STR-12).** Replace `env_file: .env` with per-service minimal `environment:` blocks. Rotate `SESSION_SECRET`, the Telegram bot token, the DVR password and the MediaMTX password if the current components have ever run with the shared env. Rotating `SESSION_SECRET` logs everyone out — expected.
3. **Harden containers and drop the rootful default (WRK-01, STR-03, STR-02).** Non-root `USER`, rootless Podman user units, `read_only`, `cap_drop: [ALL]`, `no-new-privileges`, memory/PID limits, and two networks (`edge`/`media`, media `internal: true`). This is the single highest-leverage change after login.
4. **Authenticate the MediaMTX Control API (STR-01).** Remove the anonymous `any/api` user; give the hub a dedicated API user + password used by `mediamtx.ts`, `media-status.ts` and `playback-gateway.ts`; use hashed MediaMTX credentials; restrict `api` by `ips:`.
5. **Fix local credential exposure (WRK-04, STR-06, WRK-05).** `chmod -R go-rwx data/`, create DB/dirs with 0600/0700 (and `UMask=0077` in units), move the rendered MediaMTX config out of the repo, and quarantine/delete the stale corrupt DB copy.
6. **Set the cookie transport for production (AUTH-05, FRN-02).** `COOKIE_SECURE=true` when served through the tunnel; add HSTS + `upgrade-insecure-requests`; verify the tunnel injects `X-Forwarded-Proto: https` before relying on it.

### Short term (medium)

7. **Retention and audit integrity (WRK-03, AUTH-04, AUTH-18).** Add retention for `object_detection_tracks`, `audit_logs`, `object_detection_test_requests`, `viewer_presence`; cap stored User-Agent/IP length; audit rule CRUD/camera rename/Telegram sends and 401/403 denials; treat audit rows as security data.
8. **CSRF and cookie hardening (AUTH-09, FRN-04, AUTH-15).** Origin/`Sec-Fetch-Site` checks on all mutations and login; per-session CSRF token; idle timeout and step-up re-auth for user management, session revocation and Telegram test.
9. **CSP hardening (FRN-01).** Nonce-based scripts, `object-src 'none'`, `base-uri 'self'`, `form-action 'self'`.
10. **Sensitive caching and egress disclosure (FRN-03, WRK-07/13).** `Cache-Control: private, no-store` on authenticated JSON; surface in Settings exactly what Telegram uploads (image/clip/audio/camera name); add audio-free/name-free modes.
11. **Backup integrity and build hygiene (WRK-10, FRN-08).** SHA-256 manifest (optionally HMAC) in every backup, verified by `verify-backup.sh`; reject symlinks in restore/verify; add `backups`, `object-worker/models`, `test-results`, `playwright-report`, `audit` to `.dockerignore`.
12. **Worker resource bounds (WRK-08).** Pixel-budget check before decode; `mem_limit`/`pids_limit`; treat oversized images as deterministic failures.
13. **DVR/MediaMTX credential handling (WRK-12, STR-05).** Verify live MediaMTX/worker logs never contain the RTSP URL; isolate the camera VLAN; use a longer DVR password; consider TLS if the DVR supports it.

### Long term (low/hardening)

14. Anchor middleware exclusions or invert to an explicit public allowlist; add a CI test that every non-public route handler calls a guard (AUTH-06/07).
15. Bind the proxy to DB-backed session validation, or at minimum document the convention and test it (AUTH-06).
16. Strengthen password policy (min 12 + deny-list + username check) and raise scrypt cost with re-hash-on-login (AUTH-08).
17. Force bootstrap-admin rotation; refuse `APP_PASSWORD`-equal passwords; make the bootstrap insert idempotent (AUTH-14).
18. Reduce VIEWER data exposure (`/api/dvr/info` serial/firmware; playback-ownership) (AUTH-11/13).
19. Pin base images by digest, exact-pin NumPy, add image scanning to CI (FRN-05/06).
20. Reconcile the tunnel documentation and, if Cloudflare is used, add Cloudflare Access/mTLS and keep camera media on the private tailnet (STR-11).
21. Keep `npm run dev` bound to localhost; never deploy `.next/dev` (FRN-07).
22. Consider encrypting backups at rest and documenting backup custody as credential material (WRK-10).

---

## G. Security regression tests to add

The existing suites are good at unit-level auth primitives but mock `@/server/http/require-user` everywhere, so a route that forgets its guard still passes. Add:

1. **Route-guard coverage test (static):** walk `src/app/api/**/route.ts`, assert every exported handler references `requireUser`/`requireAdmin` unless the file is on an explicit public allowlist (`health`, `auth/login`, `auth/logout`). Fail CI on a new unguarded route.
2. **Middleware matcher test:** assert the matcher matches every non-public route file and that exclusions are anchored (`/api/healthx` and `/loginfoo` must not be excluded). Assert `x-middleware-subrequest` has no effect.
3. **Rate-limit tests:** unit-test the key derivation with/without trusted proxy headers; integration-test that 9 attempts from one key → `429`, that rotating `X-Forwarded-For` from an untrusted peer does **not** reset the bucket, and that a per-username lockout triggers after N failures across different IPs.
4. **Login route integration tests** (mock `accountStore`): success, unknown user, disabled user, wrong password, oversized username/password, form vs JSON, cookie attributes (`HttpOnly`, `SameSite=Lax`, `Secure` when HTTPS header), `next` sanitisation, and equal response time for unknown vs known user.
5. **Session lifecycle integration tests:** logout → old cookie rejected; password change → other sessions rejected and current reissued; admin reset/disable/delete → target sessions rejected; role demotion takes effect on an existing session.
6. **Authorization matrix test:** for each route, assert unauthenticated → `401`/`307`; VIEWER → `403` on every admin route; and assert no response body contains event/face/camera data on the unauth path (status-only tests can miss data leakage).
7. **Media/media-path tests:** snapshot/face/sprite requests with `..`, absolute paths, encoded traversal, symlinked files and unknown ids → 404/400; assert `Cache-Control: private, no-store` on every media response.
8. **CSRF tests:** a cross-origin form POST to login (and a cross-site JSON POST to a mutating endpoint) must be rejected once the Origin check lands; assert all mutating handlers are non-GET.
9. **Header/cookie snapshot test:** assert the production header set (CSP without `unsafe-eval`, `frame-ancestors 'none'`, HSTS when enabled, no CORS) via a request to the built app.
10. **Secret-boundary tests:** extend `client-boundary.test.ts` to reject `TELEGRAM_BOT_TOKEN`, `MEDIAMTX_AUTH_PASSWORD`, `HIKVISION_PASSWORD`, `rtsp://`, `api.telegram.org` and any `NEXT_PUBLIC_` in `src/app`/`src/components`; add a post-build scan of `.next/static` for those markers and for `*.map` files.
11. **Log-redaction tests:** capture the logger and assert failed Telegram/DVR/HLS/WebRTC paths never include a token, RTSP URL or password; assert audit rows truncate User-Agent.
12. **Backup tests:** assert `verify-backup.sh` fails on a symlinked snapshot, on a missing file, on a corrupted DB and on a mismatched SHA-256 manifest; assert `restore.sh --dry-run` rejects a backup containing symlinks.
13. **Query/DB tests:** fuzz `parseEventListQuery`/`parseSearchParams`/face queries for out-of-range pagination and injection strings; assert parameterised SQL (no interpolation of user values).
14. **Config tests:** assert `renderMediamtxConfig` never emits an anonymous `api`/`read` user when a password is configured, and refuses to start without one; assert `MEDIAMTX_ALLOW_ANONYMOUS` is rejected in `NODE_ENV=production`.
15. **Docker/CI checks:** assert published ports are exactly `3000` + `8189` in `compose.yml` and that `compose.dev.yml` binds loopback only; assert Dockerfiles contain a non-root `USER`; assert `.dockerignore` excludes `backups`, `data`, `.env`, models and test artifacts.

---

## H. Final verdict

Conservative assessment, based on verified behaviour plus the documented deployment model:

| Use case | Verdict | Reasoning |
|---|---|---|
| **Local LAN use** | **Acceptable with conditions** | The app layer is solid (all routes guarded, no injection, no traversal, private media, revocable sessions). Conditions: fix the login throttle/lockout (AUTH-01), run rootless + non-root containers, restrict the DB/data permissions, and accept that LAN traffic to the DVR is plaintext (STR-05) and that any LAN device can reach `:3000`/`:8189`. |
| **Remote access through Cloudflare Tunnel** | **Not yet recommended** | Only the login protects the hub, and the login is brute-forceable without limit (AUTH-01). The session cookie's `Secure` flag depends on a forwarded header (AUTH-05), there is no HSTS (FRN-02), and the repository's documented tunnel is Tailscale Funnel, not Cloudflare (STR-11). Also note Cloudflare terminates TLS and can inspect CCTV media in transit; no Cloudflare Access/mTLS is configured. Remediate AUTH-01/05/09 + FRN-02 and add an edge identity layer before exposing this publicly. |
| **Multiple authenticated users** | **Conditional** | ADMIN/VIEWER separation is enforced live and correctly; sessions are revocable. But the authorization model is single-tenant by design: every authenticated VIEWER can see **every** camera, event, snapshot, face crop and recording, and can disrupt shared playback/WHEP sessions (AUTH-11). If "multiple users" means "household members who may all see everything", this is acceptable; if it means per-person camera restrictions, the model does not support it. |
| **Face and object detection** | **Acceptable for a trusted camera source; not least-privilege** | Detection is local, models are hash-verified, no worker network service exists, and face images are private and authenticated. But workers run as root with the full `.env` and a read-write mount of all application data (WRK-01/02), retention does not cover detection metadata (WRK-03), and there is no dimension/memory bound on decoded images (WRK-08). Acceptable only if the camera/DVR is trusted and the host is single-purpose; harden before enabling on a shared host. |
| **Production-like home deployment** | **Not yet "secure by default"; fixable** | The application is close to production quality; the deployment is not. The highest-value changes are: login throttling + lockout, non-root/rootless containers with minimal secrets, authenticated MediaMTX API + network segmentation, file permissions, and cookie/HSTS hardening. None of these require architectural redesign, and none was implemented in this audit. |

**Bottom line:** the project is **not** safe to expose to the internet today — the login can be brute-forced without limit and a single container compromise is effectively total. It is a solid LAN-only system once the immediate items in §F are applied, and it can become a defensible remote-accessible multi-user CCTV hub after the short-term items. This verdict is deliberately conservative: passing unit tests (the suite is extensive) does not change it, and several of the controls the README claims are only partially true in the shipped configuration (tunnel type, cookie `Secure`, "DVR credentials never logged" — the last is *suspected* to fail inside MediaMTX logs, not verified).

---

## Appendix — exact tools and commands used

**Environment:** macOS dev checkout; production Ubuntu/Podman not reachable (`podman ps` → connection refused). Node v24.21.0, npm, Python 3.14.8, sqlite3, curl, git. `pip-audit`, `osv-scanner`, `trivy`, `gitleaks`, `semgrep` are **not installed** and were not installed.

**Read-only inspection**
- `git status --short`, `git log --oneline -10`, `git ls-files`, `git log --all -- .env|mediamtx/runtime.yml` (secret-history check)
- `read`/`grep`/`glob` tools over `src/**`, `face-worker/**`, `object-worker/**`, Dockerfiles, compose, systemd units, scripts, docs
- `find`, `ls -l`, `stat`, `awk`/`sed` (env variable **names** and lengths only; no values printed), `wc`
- `sqlite3 -readonly data/events.sqlite ".tables"`, `select name,sql from sqlite_master`, `select count(*)`, `select key from app_settings` (no row values containing secrets were read)
- read-only inspection of `backups/2026-10-21_204205/` (manifest, permissions, file counts)

**Dependency/supply chain**
- `npm audit --json` → 16 advisories (dev tooling)
- `npm audit --omit=dev --json` → 0 production advisories
- `npm ls zod minimatch --depth=6`
- `node -e "require('./package-lock.json')"` version extraction; `grep '^FROM'` over Dockerfiles; requirements inspection

**Controlled dynamic verification (isolated copy, no production data)**
- `rsync` of the repo to `/tmp/cctv-audit/runtime` and `/tmp/cctv-audit/build`, excluding `.env`, `data/`, `backups/`, `.git`, `node_modules` (then copy-on-write `cp -cR node_modules`)
- `next dev --port 3100 --hostname 127.0.0.1` with `APP_*`/`SESSION_SECRET`/`DATA_DIR` test overrides, Telegram off, fake MediaMTX URLs, no DVR credentials
- `next build` + standalone `node server.js` on `127.0.0.1:3101` (production headers/cookies/middleware/bundle)
- `curl` probes: 33 unauthenticated API endpoints, 13 page routes, path-traversal/encoding bypass variants, `x-middleware-subrequest` variants, login rate-limit tests (8 same-IP vs 12 rotated-XFF), login timing comparison, cookie-flag checks (HTTP vs `X-Forwarded-Proto: https`), VIEWER authorization matrix, logout and password-change session revocation, form-login CSRF probe
- Production bundle scan: `find .next/static -name '*.map'`, `grep -rl` for `rtsp://`, `HIKVISION`, `TELEGRAM`, `SESSION_SECRET`, `MEDIAMTX_AUTH`, `api.telegram.org`, `NEXT_PUBLIC`
- Both isolated servers were shut down afterwards; the `/tmp` copies contained test-only credentials and were not part of the repository.

**External sources (data only):** MediaMTX authentication and Control API documentation (mediamtx.org) and the v1.21.3 `openapi.yaml` (used to confirm `any/api` semantics and that path configs expose `source`).

**No changes were made to application code, configuration, `.env`, database, dependencies or infrastructure.** The only files created are the four evidence files and this report under `audit/`.
