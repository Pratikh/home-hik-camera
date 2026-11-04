# STR — Camera / streaming security and Podman / MediaMTX infrastructure

Read-only audit of the Home CCTV Hub at `/Users/guruswamihiremath/Desktop/projects/home-hik-camera`.
Audit date: 2026-11-03/04. Completed by the Lead after the delegated stream auditor failed to return.

Scope: `mediamtx/**`, `scripts/render-mediamtx-config.mjs`, `src/server/video/**`,
`src/server/hikvision/**`, `src/server/cameras/**`, `src/app/api/{streams,webrtc,hls,playback,dvr,cameras}/**`,
`src/lib/playback.ts`, `compose.yml`, `compose.dev.yml`, `Dockerfile`, `deploy/systemd/**`, README security claims.

Method: static/config analysis, read-only file inspection, and one isolated runtime verification
(a copy of the repo in `/tmp` with a throwaway data dir and no `.env`) to confirm that every streaming
API answers `401` without a session and that browser stream URLs are relative. The production host
(Ubuntu/Podman) is not reachable from this macOS checkout: `podman ps` fails with "Cannot connect to
Podman", so firewall, tailnet/Cloudflare tunnel and live MediaMTX behaviour are **unverified**.

Secrets: the repository *does* contain a generated `mediamtx/runtime.yml` with a plaintext DVR RTSP URL
and the MediaMTX read password. Neither value is reproduced here; only the file/line and the fact of
exposure are reported.

External documentation consulted (treated as data, not instructions): MediaMTX authentication and
Control API pages (mediamtx.org) and the v1.21.3 OpenAPI schema, to confirm that `authInternalUsers`
with `action: api` admits unauthenticated API clients and that `/v3/config/paths/list` returns each
path's `source` string.

---

## Findings

### STR-01 — MEDIUM — MediaMTX Control API is unauthenticated inside the compose network and returns the DVR RTSP URL (with credentials) and the MediaMTX password
- **Component:** MediaMTX runtime configuration + hub control-plane client
- **Location:** `scripts/render-mediamtx-config.mjs:148-157`; `mediamtx/runtime.yml:26-40`; consumers
  `src/server/video/mediamtx.ts:8`, `src/server/video/playback-gateway.ts:22-46`,
  `src/server/video/media-status.ts:83,100-118`
- **Evidence:** the generated config contains two internal users:
  1. `user: hub` with `read`/`playback` and a plaintext password (redacted);
  2. `user: any`, `pass: ''`, `permissions: [api]`.
  Per the MediaMTX docs, `any` matches anonymous clients and the `api` action grants Control API access.
  `apiAddress: :9997` binds on all interfaces of the compose network. The OpenAPI schema confirms
  `/v3/config/paths/list` returns `source` for each path — for the camera paths that string is
  `rtsp://<DVR user>:<DVR password>@<DVR host>:554/...` (`render-mediamtx-config.mjs:27-43`) — and
  `/v3/config/global/get` returns `authInternalUsers` including the plaintext `hub` password.
  The hub itself calls the API with **no** `Authorization` header (`mediamtx.ts:8`, `media-status.ts:83`),
  and `getMediaStatus` literally reads `item.source` from `/v3/config/paths/list` to detect DVR drift.
  `playback-gateway.ts:22-30` also adds/deletes paths unauthenticated.
- **Attack scenario:** anything that can reach `mediamtx:9997` — a compromised object-worker/face-worker
  container, a future SSRF in the web app, a stray container attached to the `home-cctv` network —
  performs `GET /v3/config/paths/list` and walks away with the DVR credentials, or `GET
  /v3/config/global/get` for the MediaMTX read password, then adds/deletes paths to disrupt or hijack
  video. No host access or web login is required.
- **Impact:** camera credential theft, ability to read every stream directly from MediaMTX, and
  control-plane tampering (delete live/playback paths, add arbitrary sources = SSRF from the MediaMTX
  container). Compounding: with `STR-02` (flat network) and `WRK-01` (root containers), a single
  container foothold reaches this API.
- **Remediation:** delete the anonymous `any/api` user; give the hub its own API credential and send it
  (`Authorization: Basic`) from `mediamtx.ts`, `media-status.ts` and `playback-gateway.ts`; use hashed
  (`sha256:`/`argon2:`) MediaMTX credentials; optionally also restrict `api` by `ips:` to the web
  container address; put MediaMTX on an internal-only network.
- **Status:** VERIFIED (static + vendor schema). Dynamic confirmation blocked (no Podman/MediaMTX here).
- **Safe-test status:** NOT DYNAMICALLY TESTED (would require starting MediaMTX; prohibited).

### STR-02 — MEDIUM — The compose stack is one flat network; workers/MediaMTX can reach the hub, the control API, and the DVR
- **Component:** Podman Compose networking
- **Location:** `compose.yml:7-152` (no top-level `networks:` and no per-service `networks:` — every
  service joins the default `home-cctv_default` network)
- **Evidence:** the four services (`mediamtx`, `web`, `object-worker`, `face-worker`) share the default
  bridge network with unrestricted east-west traffic. The workers resolve and reach `mediamtx:8554/9997`
  by design and, like all containers, inherit host NAT egress to the DVR LAN (`192.168.1.0/24`).
  The web app (`:3000`) is reachable from every worker container.
- **Attack scenario:** a compromised worker pivots to `http://web:3000` (unauthenticated endpoints,
  login brute force), `http://mediamtx:9997` (STR-01) and the DVR directly, regardless of which service
  was compromised.
- **Impact:** removes the container boundary as a containment control; turns any single-service bug into
  a stack-wide compromise.
- **Remediation:** declare two networks — e.g. `edge` (web only) and `media` (web, mediamtx, workers) —
  with `internal: true` on the media network and no default network; restrict worker egress to the
  MediaMTX RTSP endpoint; on the host, firewall container→DVR traffic if the DVR supports an allow-list.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED.

### STR-03 — MEDIUM — Web and MediaMTX containers run as root with a writable filesystem, no capability drop, no `no-new-privileges` and no resource limits
- **Component:** container runtime hardening (web + MediaMTX). The worker side of the same issue is `WRK-01`.
- **Location:** `Dockerfile:17-33` (runner stage, no `USER`); `mediamtx/Dockerfile:5-13`; `compose.yml`
  (no `user:`, `read_only:`, `cap_drop:`, `security_opt:`, `mem_limit:`, `pids_limit:` anywhere)
- **Evidence:** neither Dockerfile declares a non-root `USER`; the web image installs `wget`/`ffmpeg` and
  the standalone Node server runs as uid 0. The deployment documentation explicitly assumes **rootful**
  Podman (`deploy/systemd/README.md:17`), so container uid 0 is host uid 0. The web container has a
  writable root filesystem and the read-write `./data` bind (`compose.yml:55-56`). No service has a
  memory or PID cap, although the host is documented as a small 4 GB server.
- **Attack scenario:** an RCE in the Next.js server or in FFmpeg (Telegram clip path) is root on the
  host under rootful Podman, and even rootless it can rewrite the whole SQLite database via `./data`.
  A memory-exhaustion bug in any service can pressure the host without a container limit stopping it.
- **Impact:** privilege escalation / host compromise amplification; availability risk on a small host.
- **Remediation:** add a non-root `USER` to both images, `user:` in compose, `read_only: true` + tmpfs
  for `/tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `mem_limit`/`pids_limit`,
  and move to rootless Podman user units (the tree already supports `home-cctv.service`, so switch the
  documented default).
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED.

### STR-04 — LOW — WebRTC ICE port 8189 is published on every host interface and is unauthenticated at the transport layer
- **Component:** MediaMTX WebRTC listener / compose port publication
- **Location:** `compose.yml:23-25`; `mediamtx/mediamtx.yml:14-15`; `scripts/render-mediamtx-config.mjs:137-142`
- **Evidence:** `ports: ["8189:8189/tcp", "8189:8189/udp"]` publishes the ICE media endpoint on all
  interfaces (only 3000 is otherwise public). ICE itself is not an authenticated protocol: MediaMTX
  answers session-scoped STUN/DTLS only for sessions created through the authenticated WHEP endpoint, so
  media cannot be joined without a valid WHEP session, but the port is discoverable and reachable.
- **Attack scenario:** port-scan fingerprinting of a home network; repeated STUN/ICE traffic against the
  listener; no path to camera data without an authenticated WHEP session.
- **Impact:** minor exposure/DoS surface, no confidentiality impact found.
- **Remediation:** bind the published port to the LAN address/subnet (`192.168.x.y:8189:8189`) rather
  than all interfaces, and/or firewall it; document that 8189 must never be tunnelled or port-forwarded.
- **Status:** VERIFIED (static/config).
- **Safe-test status:** NOT DYNAMICALLY TESTED (no containers running).

### STR-05 — LOW — DVR traffic is plaintext on the LAN (HTTP digest for ISAPI, unencrypted RTSP for video)
- **Component:** Hikvision client + MediaMTX RTSP sources
- **Location:** `src/server/hikvision/hikvision-client.ts:141` (`http://${host}:${port}${uri}`);
  `scripts/render-mediamtx-config.mjs:42` (`rtsp://...@host:554/...`)
- **Evidence:** ISAPI calls use HTTP with digest authentication, and MediaMTX pulls RTSP over TCP with no
  TLS option set (`rtspTransport: tcp` only). Digest protects the password from plaintext capture but the
  camera video/still images traverse the LAN unencrypted; the digest exchange is offline-guessable if the
  DVR password is weak (the deployed password is only 8 characters, measured by length only).
- **Attack scenario:** any host on the same LAN (compromised IoT device, guest Wi-Fi client if not
  isolated, container with host networking) can sniff camera video and snapshots, or capture a digest
  challenge/response for offline cracking.
- **Impact:** in-LAN privacy exposure; credential-cracking opportunity. The documented threat model is a
  trusted home LAN, so this is a documented-risk item, not an active remote vulnerability.
- **Remediation:** put the DVR on an isolated camera VLAN with only the hub host allowed; use a longer
  random DVR password; enable TLS on the DVR if the firmware supports it; treat 554/80 as never-public.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED (no LAN capture attempted).

### STR-06 — LOW — The generated `mediamtx/runtime.yml` persists plaintext DVR and MediaMTX credentials in the repository checkout
- **Component:** config generation / secret hygiene
- **Location:** `mediamtx/runtime.yml:29,43-89`; generator `scripts/render-mediamtx-config.mjs:175-191`;
  exclusions `.gitignore:12`, `.dockerignore:8`
- **Evidence:** `npm run mediamtx:config` (and the container entrypoint in a different location) renders
  the DVR RTSP URL with embedded credentials and the MediaMTX password into `mediamtx/runtime.yml`. The
  checkout copy is mode `0600`, is gitignored and is excluded from the Docker build context, and is not
  in git history (`git log --all -- mediamtx/runtime.yml` → empty). Nevertheless it is an unmanaged
  plaintext copy of all camera credentials sitting in the project directory, outside backups and outside
  the OS keyring.
- **Attack scenario:** any process/account with access to the checkout (or a careless `cp -r`, archive, or
  IDE sync) obtains the DVR and MediaMTX credentials; an operator may not realise the file is a secret.
- **Impact:** camera credential exposure to a local reader (same class as `WRK-04`, broader in value).
- **Remediation:** default `MEDIAMTX_CONFIG_OUT` to a runtime path outside the repo (e.g.
  `/run/home-cctv/mediamtx.yml` or `$DATA_DIR/mediamtx.yml`), keep mode 0600, document it as credential
  material, and add it to any host-backup exclude list.
- **Status:** VERIFIED (static + `ls -l`; values not printed).
- **Safe-test status:** SAFELY TESTED (read-only `ls`/`git log`).

### STR-07 — LOW — MediaMTX wildcard CORS and a catch-all publisher path
- **Component:** MediaMTX HLS/WebRTC config
- **Location:** `scripts/render-mediamtx-config.mjs:133,136,165`; `mediamtx/runtime.yml:11,14,90-91`
- **Evidence:** `hlsAllowOrigins: ['*']`, `webrtcAllowOrigins: ['*']`, and `all_others: source: publisher`.
  Because 8888/8889 are not published, this is currently unreachable from the LAN/browser; the catch-all
  publisher is inert because no user holds the `publish` permission (hub has read/playback only, `any` has
  api only).
- **Attack scenario:** if a port is ever published or tunnelled by mistake, any web origin can drive the
  HLS/WHEP endpoints; if a publish permission is ever added broadly, the catch-all path accepts arbitrary
  publishers.
- **Impact:** latent; no current exposure.
- **Remediation:** set `hlsAllowOrigins`/`webrtcAllowOrigins` to the hub origin(s) only and remove the
  `all_others` publisher unless a concrete feature needs it; keep a test that asserts 8888/8889/9997/8554
  are unpublished.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED.

### STR-08 — LOW — HLS proxy forwards the raw client query string and upstream `Set-Cookie` headers
- **Component:** `/api/hls/[path]/[[...asset]]`
- **Location:** `src/app/api/hls/[path]/[[...asset]]/route.ts:21-48`
- **Evidence:** `upstreamUrl = ${mediamtxHlsUrl}/${path}/${parts}${incoming.search}` forwards any client
  query string verbatim, and every upstream `set-cookie` is appended to the browser response. The path
  and asset allowlists and traversal checks are correct (`:15-19`), and the upstream host is fixed, so
  this is not SSRF/traversal. Forwarding a MediaMTX-issued cookie to the hub origin is unnecessary and
  couples two origins' cookie namespaces.
- **Attack scenario:** query-string abuse of MediaMTX HLS behaviour; a cookie-value clash between
  MediaMTX and the hub (the hub cookie is `cctv_session`, so a real clash is unlikely).
- **Impact:** low; hardening only.
- **Remediation:** allowlist the few query parameters HLS needs (or drop them), and strip upstream
  `Set-Cookie` unless a concrete requirement exists.
- **Status:** VERIFIED (static).
- **Safe-test status:** NOT DYNAMICALLY TESTED.

### STR-09 — INFO — WHEP session teardown is not bound to the authenticated user
- **Component:** `/api/webrtc/[path]/session/[id]` DELETE
- **Location:** `src/app/api/webrtc/[path]/session/[id]/route.ts:10-33` (also `AUTH-11`)
- **Evidence:** only the path allowlist and the id format are validated; ownership is not tracked, and the
  hub-side `location` returned by WHEP is opaque-but-guessable-format (`[A-Za-z0-9_-]{8,128}`). Any signed-in
  user who learns another session id can close it. Ids are only exposed to the session that created them,
  so discovery requires a leak or guessing.
- **Impact:** stream disruption (availability), not privacy.
- **Remediation:** map `whep session id → hub session/user` server-side and reject mismatches.
- **Status:** VERIFIED (static). **Safe-test status:** NOT DYNAMICALLY TESTED.

### STR-10 — INFO — Public `/api/health` discloses DVR/gateway/ingestion state
- **Component:** `/api/health`
- **Location:** `src/app/api/health/route.ts:12-36`; verified dynamically in the isolated instance
  (`200` unauthenticated, `{application,dvr,videoGateway,database,mediamtx,events}`)
- **Impact:** reconnaissance only; no credentials, hosts or names. Cross-reference `AUTH-12`.
- **Remediation:** keep the public probe to liveness; move the rest behind a session.
- **Status:** VERIFIED (dynamic, isolated instance). **Safe-test status:** SAFELY TESTED.

### STR-11 — INFO — Documented remote access is Tailscale Funnel, not Cloudflare Tunnel; no tunnel configuration is in the repository
- **Component:** deployment documentation / external exposure
- **Location:** `README.md:11,27,42,61-68,432-433`; no `cloudflared`/Cloudflare config file exists in the
  repo (`grep -ri cloudflare` → only a playback-mode comment/test)
- **Evidence:** the README states "Tailscale with Funnel exposing only port 3000" and gives
  `tailscale funnel --bg 3000`. If the actual deployment instead uses a Cloudflare Tunnel:
  (a) Cloudflare terminates TLS, so camera snapshots, face crops and live HLS traverse Cloudflare's
  infrastructure and are inspectable there; (b) Cloudflare Access / service tokens are not configured in
  the repo, so the hub login is the only barrier; (c) the tunnel must route only `:3000` — any extra
  ingress rule for 8189/8888/8889/9997/8554 would defeat the design; (d) the hub's `Secure` cookie and
  login rate-limit key depend on `X-Forwarded-Proto`/`X-Forwarded-For` injected by the tunnel.
- **Impact:** privacy (third-party visibility of CCTV media in transit) and configuration-drift risk.
- **Remediation:** reconcile the documentation with the real tunnel; if Cloudflare is used, configure
  Cloudflare Access (or mTLS/service tokens) in front of the hub, enforce Full (strict) TLS, route only
  3000, and verify `X-Forwarded-Proto: https` reaches the app (see `AUTH-05`); consider keeping CCTV
  access on the private tailnet and using the public tunnel only for notifications.
- **Status:** SUSPECTED for the live deployment; VERIFIED that the repo documents a different tunnel.
- **Safe-test status:** NOT DYNAMICALLY TESTED (production/tunnel state unavailable).

### STR-12 — INFO — The MediaMTX container receives the full `.env` (session secret, Telegram token, DVR credentials)
- **Component:** secret distribution
- **Location:** `compose.yml:12-13`
- **Evidence:** same pattern as `WRK-02`; MediaMTX needs only `DVR_*`/`HIKVISION_*` and
  `MEDIAMTX_AUTH_*`/`WEBRTC_ADDITIONAL_HOST`, but gets `SESSION_SECRET`, `APP_PASSWORD`,
  `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` too.
- **Impact:** compromise of the media server (which parses network video and runs an exposed WebRTC
  listener) yields the hub's session-forging secret and the Telegram bot token.
- **Remediation:** replace `env_file: .env` with a minimal explicit `environment:` block for MediaMTX.
- **Status:** VERIFIED (static). **Safe-test status:** SAFELY TESTED (names only).

---

## Port / exposure matrix

| Port | Service | Bind (compose) | Reachable from | Assessment |
|------|---------|----------------|----------------|------------|
| 3000 | Next.js hub | `3000:3000` (all interfaces) | LAN + tunnel | Intended. Session login is the barrier; see AUTH-01/05. |
| 8189/tcp+udp | MediaMTX WebRTC ICE | `8189:8189` (all interfaces) | LAN (and route if tunnelled) | STR-04: session-bound media, but discoverable. |
| 554 | DVR RTSP | not published | — | Correct, never exposed. |
| 8554 | MediaMTX RTSP | not published (dev overlay: `127.0.0.1:8554`) | compose network / host loopback in dev | Correct. |
| 8888 | MediaMTX HLS | not published (dev: `127.0.0.1:8888`) | compose network | Correct; browser uses hub proxy. |
| 8889 | MediaMTX WHEP | not published (dev: `127.0.0.1:8889`) | compose network | Correct; browser uses hub proxy. |
| 9997 | MediaMTX Control API | not published | compose network | STR-01: unauthenticated API inside the network. |
| 80 | DVR ISAPI | not published | hub container → LAN | Correct externally. |

## Verified controls (streaming / infra)

1. **Only 3000 and 8189 are published** in `compose.yml`; the dev overlay publishes 8554/8888/8889/9997
   on `127.0.0.1` only (`compose.yml:23-25,53-54`; `compose.dev.yml:16-23`).
2. **DVR/RTSP never publicly exposed:** no compose publish for 80/554/8554; MediaMTX RTSP is enabled only
   on the internal address (`scripts/render-mediamtx-config.mjs:126-127`).
3. **MediaMTX requires a read password:** the renderer refuses to start without
   `MEDIAMTX_AUTH_PASSWORD` (16+ chars) unless the explicit dev escape hatch is set
   (`render-mediamtx-config.mjs:62-79`).
4. **The browser never receives credentials or absolute MediaMTX URLs:** `/api/streams/[path]` returns
   only `mode` plus same-origin relative `/api/webrtc|hls` URLs (verified dynamically in the isolated
   instance: `{"path":"cam1_main",...,"whepUrl":null,"hlsUrl":null}` when the gateway is down);
   `/api/settings` returns `dvrPasswordMask` only; `/api/dvr/*` returns no host/username/password.
5. **The hub proxies HLS/WHEP with server-side basic auth**, fixed upstream host, strict relay-path
   allowlist and traversal rejection (`hls/.../route.ts:15-33`; `whep/route.ts:14-38`); credentials never
   reach the browser.
6. **Playback source URLs are built server-side** from config; user input is limited to camera 1-4 and
   ISO timestamps, with an 8-hour span cap — no user-controlled URL/SSRF (`playback/session/route.ts:24-87`,
   `playback-gateway.ts:48-85`).
7. **Snapshot/face image endpoints are authenticated, traversal-checked and `private, no-store`**
   (verified `401` unauthenticated in the isolated instance; `snapshot-path.ts`/`face-path.ts` contain
   the DB-stored path).
8. **Rendered MediaMTX config is 0600** inside the container (`entrypoint.sh:1-8`, `umask 077`); the host
   artifact is 0600, gitignored and dockerignored; it is not in git history.
9. **No unauthorised MediaMTX stream read was found:** read/playback require the `hub` credential that is
   only injected server-side; the anonymous user has `api` only, not `read`/`playback` (STR-01 is a
   control-plane credential leak, not a direct anonymous stream read).

## Unverified controls

- Production firewall / router port-forwarding and Tailscale Funnel or Cloudflare Tunnel routes.
- Live MediaMTX behaviour (does it log source URLs? does the API expose sources as the schema indicates?).
- `podman inspect` visibility of env vars, userns mapping, actual container users and limits.
- DVR-side lockout after repeated digest failures, and whether the DVR accepts TLS.
- Whether `X-Forwarded-For`/`X-Forwarded-Proto` are injected or overwritten by the real tunnel.
