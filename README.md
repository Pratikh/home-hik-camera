# Home CCTV Hub

Private CCTV hub for a Hikvision DS-7104HGHI-K1 on the home network. The browser talks only to this hub. The hub talks to the DVR.

```
Hikvision DVR --RTSP--> MediaMTX --WebRTC or HLS (proxied by the hub)--> browser
```

Four camera slots. Sub streams (`102`, `202`, `302`, `402`) fill the grid. Main streams (`101`, `201`, `301`, `401`) open full screen. Live view, playback, events, notification rules, browser/Telegram notifications, optional local face **detection**, users/roles, session management, backup/restore, a daily backup timer, and a Podman systemd unit are implemented. This README describes the current system; it does not promise anything that is not in the code.

**The only public entry point is the Next.js hub on port `3000`.** Tailscale Funnel must expose only that port. The DVR is never public, and MediaMTX's HLS, WHEP and API ports are internal to the compose network.

## Requirements

Development:

- macOS
- Node.js 24 (or Node 20+) and npm
- Podman Desktop. Docker Desktop is not required
- The DVR reachable from this computer on the LAN

Production:

- Ubuntu Server (tested layout: `/opt/home-cctv`)
- Podman and `podman compose`
- `sqlite3` on the host for consistent backups and restore rehearsal
- Tailscale with Funnel exposing **only** port `3000`

`podman compose` on this Mac uses the `docker-compose` CLI against the Podman machine. Docker Desktop is not required. If that command fails with `docker-credential-desktop: executable file not found`, Compose is pointed at a Docker Desktop credential helper. Leave `~/.docker/config.json` as it is and run:

```bash
mkdir -p /tmp/home-cctv-docker
printf '%s\n' '{}' > /tmp/home-cctv-docker/config.json
DOCKER_CONFIG=/tmp/home-cctv-docker podman compose up -d
```

## Production deployment (Ubuntu Server + Podman)

The production topology is deliberately small:

```
Tailscale Funnel (public HTTPS, port 3000 only)
        │
        ▼
Next.js hub (container, port 3000)
        │  server-side WHEP/HLS proxy + MediaMTX API
        ▼
MediaMTX (container, internal ports 8888/8889/9997; published ICE port 8189)
        │  RTSP client
        ▼
Hikvision DVR on the home LAN (never public)
```

- Only ports `3000` and the WebRTC media port `8189` are published. `8888`
  (HLS), `8889` (WHEP) and `9997` (API) are reachable only inside the compose
  network. The DVR's `80`/`554` are never published.
- `MEDIAMTX_AUTH_PASSWORD` is **required**; MediaMTX rejects stream reads without
  it. The hub attaches the credential on its own server-side WHEP/HLS requests.
  The password is never hard-coded, logged, or sent to the browser.
- Tailscale Funnel is configured for the hub only:

```bash
sudo tailscale funnel --bg 3000
sudo tailscale funnel status        # must show only :3000
```

Do not add Funnel rules for `554`, `8188`, `8189`, `8554`, `8888`, `8889`,
`9997`, or the DVR's address.

Layout on the server:

```text
/opt/home-cctv/
├── compose.yml            # production stack
├── compose.dev.yml        # loopback-only ports for host development
├── .env                   # secrets; mode 0600, never committed
├── data/                  # SQLite, events, face crops, thumbnails
├── backups/               # daily backups first, then 7 retained
├── deploy/systemd/        # boot + backup units
└── scripts/               # backup/restore/verify/cleanup
```

Install and start (details in [deploy/systemd/README.md](deploy/systemd/README.md)):

```bash
cd /opt/home-cctv
sudo chown root:root .env && sudo chmod 600 .env
sudo apt-get install -y sqlite3
sudo install -m 644 deploy/systemd/home-cctv.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/home-cctv-backup.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/home-cctv-backup.timer /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now home-cctv.service
sudo systemctl enable --now home-cctv-backup.timer

# Only when FACE_DETECTION_ENABLED=true:
sudo install -m 644 deploy/systemd/home-cctv-face-worker.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now home-cctv-face-worker.service
```

Never copy `.env` into an image, a backup, or git. The `.env.example` file
contains placeholders only.

## macOS and Podman

1. Install [Podman Desktop](https://podman-desktop.io/) and start the Podman machine (`podman machine start`).
2. Confirm the tools:

```bash
node -v
npm -v
podman --version
podman compose version
```

3. Copy the environment file and edit it:

```bash
cp .env.example .env
openssl rand -base64 32
```

Put the random string in `SESSION_SECRET`. Set `APP_USERNAME` and `APP_PASSWORD` to the login you want for this hub. Set `DVR_HOST` to the DVR address. If a password contains `$`, write it as `$$` in `.env` so Compose does not treat it as interpolation. `npm run dev` reads the file directly and does not need the doubled dollar sign; if you use both, prefer a password without `$`.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `DVR_HOST` | DVR LAN address. `HIKVISION_IP` is also accepted. |
| `DVR_HTTP_PORT` | ISAPI/HTTP port. Default `80`. |
| `DVR_RTSP_PORT` | RTSP port. Default `554`. |
| `DVR_USERNAME` / `DVR_PASSWORD` | DVR user. Also `HIKVISION_USERNAME` / `HIKVISION_PASSWORD`. |
| `APP_USERNAME` / `APP_PASSWORD` | Hub login. Required. Nothing is hardcoded. |
| `SESSION_SECRET` | Signs the session cookie. Required, 16+ characters. |
| `COOKIE_SECURE` | `false` for HTTP on a home LAN. `true` only behind HTTPS. |
| `MEDIAMTX_API_URL` | Default `http://127.0.0.1:9997` for `npm run dev`. Compose points this at the `mediamtx` service. |
| `MEDIAMTX_WHEP_URL` | WebRTC signaling. Default `http://127.0.0.1:8889`. |
| `MEDIAMTX_HLS_URL` | HLS fallback. Default `http://127.0.0.1:8888`. |
| `MEDIAMTX_AUTH_USER` | MediaMTX read user. Default `hub`. |
| `MEDIAMTX_AUTH_PASSWORD` | **Required.** MediaMTX read credential, 16+ characters. Generate with `openssl rand -base64 32`. Never reuse another secret. |
| `MEDIAMTX_ALLOW_ANONYMOUS` | Development-only escape hatch. Never set `true` in production. |
| `WEBRTC_ADDITIONAL_HOST` | This computer's LAN address, so phones can complete WebRTC. A `127.0.0.1` candidate is always added. |
| `VIDEO_DEV_PLACEHOLDER` | `true` shows a labeled placeholder. Default off. |
| `EVENT_POLL_INTERVAL_MS` | How often the DVR alarm log is polled. Default `5000`. |
| `EVENT_RETENTION_DAYS` | Days of this hub's own events to keep. `0` is forever. Default `30`. Also editable at `/settings/notifications`. |
| `AI_ENABLED` | Records the DVR's own person/vehicle label in `event_ai_results`. Default off. Runs no vision model. |
| `EVENT_DEV_MOCK` | Development-only event fixtures. Ignored when `NODE_ENV=production`. |
| `DATA_DIR` | Camera display names, events database, and event snapshots. Default `./data` (gitignored). |
| `FACE_DETECTION_ENABLED` | Local, offline face **detection** on event snapshots. Default `false`. Detection only — no recognition. |
| `FACE_DETECTION_CONFIDENCE` | Detections below this score are discarded. Default `0.60`. |
| `FACE_DETECTION_MAX_FACES` | Highest-confidence faces kept per snapshot. Default `10`. |
| `FACE_DETECTION_TEST_NOTIFICATIONS` | Temporary face-notification test mode. Default `false`. Additive; never identifies anyone. |
| `FACE_DETECTION_TEST_NOTIFICATION_COOLDOWN_SECONDS` | Per-camera cooldown for the test notification. Default `300`. |
| `FACE_DETECTION_TEST_UNTIL` | ISO-8601 expiry with a timezone offset, e.g. `2026-10-12T10:00:00+05:30`. Empty or invalid means test notifications stay off. |
| `TELEGRAM_NOTIFICATIONS_ENABLED` | Master Telegram switch. Default `false`. Server-side only. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token. Read by the server; never sent to the browser or logged. |
| `TELEGRAM_CHAT_ID` | Telegram destination chat. Server-side only. |
| `TELEGRAM_FACE_NOTIFICATIONS` | Whether face detections may produce a Telegram message. Default `false`. Independent of the rule-event channel. |
| `TELEGRAM_EVENT_NOTIFICATIONS` | Whether an accepted Notification Rule decision (a matching camera event) may produce a Telegram message. Default `false`. Rule matching, priority, schedule, quiet hours, cooldown and duplicate protection are decided before Telegram is called. |
| `TELEGRAM_COOLDOWN_SECONDS` | Informational only; Telegram shares the existing face notification cooldown. Default `300`. |
| `TELEGRAM_EVENT_IMAGE` | Attach the full camera event snapshot to the Telegram message, for faces and for accepted rule events. Default `true`. `TELEGRAM_FACE_IMAGE` is the older name and still works. The face crop is never sent. |
| `TELEGRAM_FACE_VIDEO` | Attach a short clip from the DVR recording. Default `true`. |
| `TELEGRAM_VIDEO_PRE_SECONDS` / `TELEGRAM_VIDEO_POST_SECONDS` | Clip window around the event. Defaults `5` + `5` = 10 seconds. |
| `TELEGRAM_VIDEO_MAX_MB` / `TELEGRAM_VIDEO_TIMEOUT_SECONDS` | Clip upload cap (`45`) and FFmpeg time limit (`30`). |
| `FFMPEG_PATH` | FFmpeg executable used for the clip conversion. Default `ffmpeg`. |
| `PLAYBACK_THUMBNAIL_ENABLED` | Generate timeline hover previews in the background. Default `true`. |
| `PLAYBACK_THUMBNAIL_INTERVAL_SECONDS` | Seconds between preview frames. Default `30`. |
| `MAX_THUMBNAIL_WORKERS` | Extraction concurrency. Clamped to `1` by this DVR. |
| `PLAYBACK_THUMBNAIL_RETENTION_DAYS` | Days of generated sprites to keep. `0` disables pruning. Default `14`. |

Notification rules, quiet hours, cooldowns, and retention are configured in the UI and stored in `data/events.sqlite`. Operational tunables that are **not** app settings: `BACKUP_DIR` and `BACKUP_RETENTION` for `scripts/backup.sh` (defaults `./backups` and `7`).

The real `.env` is gitignored. Never commit it, and keep it private on the host:

```bash
sudo chown root:root /opt/home-cctv/.env
sudo chmod 600 /opt/home-cctv/.env
```

It contains the DVR password, the session signing secret, the Telegram bot token and the MediaMTX read password. Do not put any of them in `.env.example`, source, a container image, a log line, or a backup.

## Finding the DVR IP

The DVR sits behind the extender:

```
Internet → main router → Wi-Fi → TP-Link Archer C64 → Ethernet → Hikvision DVR
```

The computer and phones may be on the main router. The hub still works when the extender is bridging that LAN. It cannot reach the DVR when the extender is doing its own NAT.

1. On the main router's DHCP client list, look for a Hikvision or DS-7104 entry.
2. On the DVR's local monitor: Configuration → Network → Basic Settings → TCP/IP, and note the IPv4 address, mask, and gateway.
3. From this computer:

```bash
ping DVR_IP
curl -I http://DVR_IP
```

`ping` should get replies. `curl` should show an HTTP response from the DVR web UI (often `401` or a redirect). That confirms ISAPI/HTTP is reachable. It does not log you in.

If the computer is `192.168.0.x` and the DVR is `192.168.1.x`, they are on different subnets. Check the Archer C64 operation mode. Range extender / access point mode keeps one subnet. Router mode creates a second NAT, and clients on the main router will not open the DVR. Also turn off AP isolation / client isolation on the C64 and the main router.

## Configuring the DVR

Use the DVR's own web page at `http://DVR_IP` or the local monitor. This hub does not use Hik-Connect.

- Configuration → Network → Basic Settings → TCP/IP: reserve a stable address (DHCP reservation on the router is enough).
- Configuration → Network → Advanced Settings → Integration Protocol: enable ISAPI/HTTP and RTSP on port `554`.
- Configuration → System → User Management: a local user with live view permission. The hub uses that user with HTTP digest.
- Configuration → Video/Audio → Video: set each sub-stream to **H.264**. Browsers decode H.264 in WebRTC and HLS. H.265 will not play in Chrome even when the connection succeeds.
- Leave cloud platform access off. Do not forward ports `80`, `554`, `8000`, or `3000` on the main router.

## Start the hub

Production is started by systemd (see [Production deployment](#production-deployment-ubuntu-server--podman)).
Manual control from the project directory:

```bash
npm run stack:up        # podman compose up -d   (web + mediamtx)
podman compose ps
podman compose logs -f
npm run stack:down      # podman compose down
```

If `podman compose` fails with `docker-credential-desktop: executable file not found`,
use the workaround described under [Requirements](#requirements):

```bash
DOCKER_CONFIG=/tmp/home-cctv-docker npm run stack:up
```

Both services use `restart: unless-stopped`, so a crashed container comes back on
its own (`podman inspect home-cctv-web-1 --format '{{.RestartCount}}'`). Note that
`podman stop`/`podman kill` is an *explicit* stop, which that policy deliberately
does not undo — use `podman start`, `npm run stack:up`, or `systemctl start home-cctv` afterwards.

The production compose file publishes only the hub (`3000`) and the WebRTC media
port (`8189`). For development on the host, with MediaMTX still in Podman:

```bash
npm run mediamtx:up     # compose.yml + compose.dev.yml, loopback-only ports
npm install
npm run dev
```

`compose.dev.yml` adds `127.0.0.1:8888`, `127.0.0.1:8889` and
`127.0.0.1:9997` so a host process can reach MediaMTX. It never binds those
ports to the LAN. `npm run dev` listens on `0.0.0.0:3000`; open
`http://127.0.0.1:3000`.

### Changing the DVR address or credentials needs a *recreate*, not a restart

Compose captures `.env` when a container is **created**. MediaMTX renders its
stream sources from that environment at every start, so after changing
`HIKVISION_IP` / `HIKVISION_USERNAME` / `HIKVISION_PASSWORD` (or the `DVR_*`
equivalents):

```bash
# Development on this host:
npm run mediamtx:up     # recreates the container so it re-reads .env

# Production (systemd):
sudo systemctl reload home-cctv
# or: cd /opt/home-cctv && podman compose up -d --force-recreate mediamtx
```

The same applies after changing `MEDIAMTX_AUTH_PASSWORD`, `MEDIAMTX_AUTH_USER`
or `WEBRTC_ADDITIONAL_HOST`. `podman restart` / `podman start` keep the old
environment and the cameras stay blank while `/api/health` still reports
`mediamtx: ok`. The hub now detects this:
`GET /api/dvr/status` reports `media.drift: true` and the log prints
`[media] MediaMTX is pulling from a different DVR address…`.


Generate a MediaMTX file on the host without starting a container:

```bash
npm run mediamtx:config
```

That writes `mediamtx/runtime.yml`, which is gitignored and contains the RTSP source. Do not commit it.

## Phones on the LAN

1. Find this computer's LAN address (System Settings → Network, or `ipconfig getifaddr en0`).
2. Set `WEBRTC_ADDITIONAL_HOST` to that address and restart MediaMTX (`podman compose up -d --force-recreate mediamtx`).
3. On the phone, open `http://COMPUTER_LAN_IP:3000`.

WebRTC media uses UDP/TCP port `8189` on this computer. Signaling stays on port `3000`: the browser posts its SDP offer to the hub, the hub forwards it to MediaMTX, and the hub rewrites the session URL back to a same-origin path. `127.0.0.1` is always advertised so the same machine can play WebRTC through the published port. A phone ignores `127.0.0.1` and needs `WEBRTC_ADDITIONAL_HOST`. Until that is set, a phone is offered **HLS** instead of a WebRTC attempt. HLS is a real stream from MediaMTX, proxied by the hub, with no DVR credentials in the URL.

In production, allow inbound TCP/UDP `8189` from the LAN only (and never from
the Internet). Port `8189` carries ICE media for a session the authenticated hub
already created; it is not an API and cannot start a stream by itself.
Tailscale Funnel exposes only `3000`. A remote browser reached through Funnel
therefore uses the proxied HLS fallback unless it also has a private route to
`8189` (for example the same Tailscale tailnet). This is expected and is not a
security workaround.

Podman Desktop on macOS forwards published ports from the Mac. Containers reach the DVR by outbound NAT through the Mac. `network_mode: host` does not place a container on the Mac's LAN, so this compose file does not use it. If a container cannot open the DVR while `ping` from the Mac works, run the hub with `npm run dev` (that process uses the Mac network directly) and keep MediaMTX in Podman. If MediaMTX still cannot open RTSP, the Podman machine route to the LAN is the thing to fix; the UI will say the camera or gateway is unavailable.

## What you should see

- `/login` until the session cookie is set.
- `/` four camera cards, plus recent security events.
- Full screen uses the main stream. Escape or Close leaves it.
- `/cameras` renames the four tiles. Names are stored in `data/cameras.json`.
- `/device` shows whatever the DVR returns. Missing fields say "Not reported".
- `/account` changes your own password and manages your sessions.
- `/settings` shows the host, ports, username, and `********` for the password.
- `/settings/users` (ADMIN) creates users, resets passwords, and signs out sessions.
- `/settings/system` (ADMIN) shows application, database, DVR, MediaMTX, face-worker, thumbnail, storage, backup and retention status.
- `/events` filters stored events; `/events/<id>` shows one with its snapshot.
- `/notifications` shows every notification decision.
- `/events/stats` shows counts by range and camera.

Messages you can trust:

| Situation | Message |
| --- | --- |
| `DVR_HOST` empty or credentials incomplete | DVR not configured |
| DVR does not answer | DVR offline |
| DVR rejects the user | DVR authentication failed |
| MediaMTX API does not answer | Video gateway unavailable |
| A channel reports no signal | Camera unavailable |
| WebRTC fails and HLS plays | WebRTC unavailable. Live via HLS. |
| Placeholder env is on | Development placeholder |

`GET /api/health` is public and returns `application`, `dvr`, and `videoGateway`. It does not include credentials. Wrong DVR passwords are cached for about a minute so the hub does not lock the DVR user with constant retries.

## Playback

Open **Playback**, choose a camera and a date, then choose **Search recordings**. The hub asks the DVR, through ISAPI `ContentMgmt/search`, for hard-disk segments on that camera's main track (`101`, `201`, `301`, `401`). Times on the page are India time (`Asia/Kolkata`). This DVR labels search times with a trailing `Z` even though they are local wall-clock times, and the hub keeps that convention when it opens a playback stream.

Playback is not a file in the browser. The server opens an RTSP playback URL on the DVR and MediaMTX republishes it as WebRTC, with HLS as the fallback, the same way live view works. Play, pause, and seek restart that stream at the chosen time. The browser never receives the RTSP address or the DVR password.

A full day can be several long segments. Search returns the segment list only. Video moves when a segment or a point on the timeline is selected.

**Download** is not available. This DVR's download API returns a private `IMKH` stream (`Content-Type: Opaque/data`), not an MP4 or other file a browser can save. The button explains that. A later version can add download if the DVR can export a standard container, or if a converter such as FFmpeg is added on purpose. Do not turn the private stream into a fake file.

`PLAYBACK_DEV_MOCK=true` shows sample segments for interface work. It is ignored when `NODE_ENV=production`.

## Troubleshooting

**DVR offline**

```bash
ping DVR_IP
curl -I http://DVR_IP
```

Check the C64 mode and that both devices share a route. Confirm the DVR IP in `.env`, then restart.

**RTSP**

On the DVR, RTSP must be enabled. From a machine that can route to the DVR:

```bash
ffprobe -rtsp_transport tcp "rtsp://USER:PASSWORD@DVR_IP:554/Streaming/Channels/102"
```

Use your own user and password in that command. Do not paste it into a ticket. Sub-stream paths are `102`, `202`, `302`, `402`. If `ffprobe` fails, MediaMTX cannot invent a picture. The card stays on "Stream unavailable" or "Camera unavailable".

**WebRTC**

- Set `WEBRTC_ADDITIONAL_HOST` to this computer's LAN IP and recreate MediaMTX.
- Allow UDP `8189` on the Mac firewall for incoming connections from phones.
- Podman on macOS is better at TCP than UDP. MediaMTX also listens for ICE on TCP `8189`. If WebRTC still fails, the player switches to HLS and says so.
- H.265 streams can connect and still show no picture in Chrome. A live check of this DVR's sub-streams reported H.265 video and G.711 audio. This Mac displayed them. Set each sub-stream (and the main stream, if full screen should play everywhere) to H.264 for phones and browsers without HEVC.

**Video gateway unavailable**

```bash
podman compose ps
podman compose logs mediamtx
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:9997/v3/paths/list
```

`200` means the API is up. The API port is bound to `127.0.0.1` only.

**Hub login**

`APP_USERNAME`, `APP_PASSWORD`, and `SESSION_SECRET` must be set. The login page lists the missing names. The session cookie is HTTP-only. `COOKIE_SECURE=false` is intentional for HTTP on the LAN. A `Secure` cookie would be dropped by the browser on `http://`.

**No browser notifications**

Check, in order: the browser granted permission (click **Enable notifications** at `/settings/notifications`), the rule is enabled, the event's priority meets the rule's minimum, the current time is inside the rule's schedule, quiet hours are not suppressing it, and the rule's cooldown has elapsed. Then confirm in `/notifications` whether the decision was `sent` or `suppressed`; the reason is recorded for every suppressed decision. A notification is only delivered while the hub is open in a tab or installed PWA window. Background push is not implemented and is explained above.

**Every event is suppressed by cooldown**

That is the cooldown working. Lower the rule's `cooldownSeconds`, or set it to `0` for no cooldown. Continuous motion still stores an event per DVR message; only the notification is throttled.

**Snapshots say unavailable**

The event has no stored JPEG. Legacy events ingested before V5 have no snapshot. For new events, confirm the DVR still answers the still-picture endpoint:

```bash
curl --digest -u USER:PASSWORD -o /tmp/snap.jpg -w "%{http_code} %{content_type}\n" \
  "http://DVR_IP/ISAPI/Streaming/channels/102/picture"
```

`200 image/jpeg` means the DVR is serving pictures. The hub validates the JPEG header and writes nothing if the response is not a JPEG, so a DVR that refuses the endpoint leaves the event without a snapshot rather than storing a broken file.

**Rules do not fire**

Use **Test a rule** at `/settings/notifications`. It reports which rules match a sample event and why others do not, without storing anything. Remember that a rule with a `22:00`-`06:00` schedule is inactive during the day, and a rule limited to one camera ignores the others.

**Statistics look wrong**

Statistics range over whole Asia/Kolkata calendar days, so "today" means 00:00–23:59:59 India time, not the last 24 hours. "Motion" counts unclassified motion only, so person and vehicle events are not counted twice.

## Security

- Use it on a trusted home LAN or through Tailscale. Do not port-forward the hub or the DVR on the router.
- **Public surface:** only the hub on `3000`, and only through Tailscale Funnel. The compose file publishes `8189` for WebRTC ICE and nothing else; `8888` (HLS), `8889` (WHEP) and `9997` (API) are internal. The DVR's `80`/`554` are never published. `554`, `8888`, `8889`, `9997` and the DVR address must never appear in a Funnel rule or router port-forward.
- **MediaMTX authentication is required.** `MEDIAMTX_AUTH_PASSWORD` (16+ characters) is rendered into MediaMTX at container start. Anonymous read is available only with the explicit development flag `MEDIAMTX_ALLOW_ANONYMOUS=true`; the container refuses to start without a password otherwise. Do not set that flag in production.
- **DVR credentials** stay in the server process and in the MediaMTX process. They are never in `NEXT_PUBLIC_*` variables, React props, browser URLs, API responses, or logs. MediaMTX's rendered runtime config is created with mode `0600` inside the container.
- **`.env`** is gitignored, never copied into an image or backup, and must be mode `0600` (`chmod 600 /opt/home-cctv/.env`). Treat the DVR password, `SESSION_SECRET`, Telegram token and MediaMTX password as independent secrets; do not reuse them.
- **Password storage:** scrypt with a random salt. Plaintext passwords are never stored, logged, or returned. API responses never include `passwordHash`; the Users and Settings pages mask the DVR password.
- **Password lifecycle:** a signed-in user can change their own password at `/account`; an ADMIN can reset another user's password at `/settings/users`. Either action revokes every existing session for that user (self-change issues a fresh session to the current browser). Session rows are checked against the database on every request; logout deletes the row.
- **Sessions:** a user can list and revoke their own sessions; an ADMIN can revoke another user's sessions. Expired sessions are pruned at startup, hourly, on login, and when session lists are read. Active sessions are never deleted by pruning.
- **Files:** event snapshots are stored under `data/events` with mode `0600` and served only through the authenticated `/api/events/<id>/snapshot` route. They are never placed in `public/`. Face crops have the same rule. Stored paths are resolved inside their configured directory; traversal, absolute paths and symlinks are refused. Backups are written with `umask 077`.
- **Authorization:** notification rule management, user management, settings and `/api/system/health` require ADMIN. Event and notification reads require a session. Role checks run on the server, and ids sent by the browser are validated rather than trusted.
- **Health data:** the public `/api/health` endpoint is intentionally small. Detailed operational data (queue counts, storage, backups, worker status) is on the ADMIN-only `/api/system/health`; neither returns passwords, tokens, DVR credentials, session tokens or filesystem paths.

## Development

```bash
npm install
npm run dev
npm test
npm run test:face        # uses .venv-face/bin/python when present
npm run lint
npm run typecheck
npm run build
```

Unit tests mock the DVR. They do not mark a camera live. The Playwright suite
needs a running hub and ADMIN credentials (`.env` or `.env.qa`), and reports
VIEWER tests as skipped when `QA_VIEWER_*` is absent.

### Reconnect and fullscreen differences

Two video paths re-establish their stream deliberately differently, and that is intentional:

- **Live View** retries with a growing delay (2s, then 4s). A camera being temporarily out of reach recovers without a storm of requests.
- **Playback** retries a handshake up to 3 times with a fixed 500ms delay. Playback is user-initiated (a seek or a date change), so a quick local retry is more appropriate than a long backoff.

Fullscreen also differs by design: Live View uses an in-app overlay (`FullscreenViewer`) that hides the rest of the page and restores body scroll on close, while Playback uses the browser's native `requestFullscreen()`. Both are kept; native fullscreen is used where the video is the whole point and the overlay where the surrounding controls matter more.

## Layout

- `src/server/hikvision` — ISAPI client
- `src/server/video` — MediaMTX health and HLS rewrite
- `src/server/cameras` — channel map and display names
- `src/server/events` — ingestion, normalization, rule engine, snapshots, event store
- `src/app/api` — browser-facing HTTP
- `mediamtx/` — image entrypoint and a credential-free template

Playback search and the timeline live in `src/server/hikvision/hikvision-playback.ts` and `/playback`. Event ingestion lives in `src/server/events/event-processor.ts`, the notification rule engine is `src/server/events/rule-engine.ts`, and snapshot capture is `src/server/events/snapshot.ts`. Priority ranking is `src/lib/priority.ts` and timeline marker grouping is `src/lib/timeline-markers.ts`.

## Users, passwords and sessions

The first start creates an administrator from `APP_USERNAME` and `APP_PASSWORD`. Passwords are stored with scrypt. Sessions are HTTP-only cookies checked against the database on every request, so logging out invalidates that session without disconnecting anyone else.

Administrators can open Settings, including users, notification rules, the audit log, and system status. Viewers can use live view, playback, events, and their own `/account` page. They cannot change users, DVR settings, notification rules, or open `/settings/*`. Those checks run on the server.

**Change your own password:** `/account` → *Change password*. The current password is required; the new password follows the same minimum (8 characters, 200 maximum) as user creation. On success every session for that user is revoked and a fresh cookie is issued to the current browser, so a previously captured token cannot be replayed.

**Admin reset:** `/settings/users` → *Reset password* on the target row. This stores a new scrypt hash and revokes all of that user's sessions. The Users page also has *Sign out sessions* for a single user. The audit log records `PASSWORD_CHANGED`, `PASSWORD_RESET`, `PASSWORD_CHANGE_FAILED`, `SESSIONS_REVOKED` and `USER_SESSIONS_REVOKED` without any password or hash.

**Session management:** `/account` lists the caller's own active sessions (marked *This device*), can sign out every other session, or sign out everywhere. `/settings/system` shows active-session counts. Expired sessions are pruned automatically; active sessions are never removed by pruning.

Remote access is through Tailscale. Put the server on the tailnet and expose only the hub:

```bash
sudo tailscale funnel --bg 3000
sudo tailscale funnel status
```

Never expose the DVR or MediaMTX. A remote browser without a private route to `8189` uses the hub's proxied HLS fallback; that is expected. The hub can be installed on a phone from the browser; the manifest uses standalone display. Login attempts are limited in memory on this one computer; a restart clears that limit.

## Events

The hub polls the DVR alarm log (`ISAPI/ContentMgmt/logSearch`) on `EVENT_POLL_INTERVAL_MS` (default 5 seconds). It stores motion start/stop pairs in `data/events.sqlite`. Person and vehicle are classifications on a motion event when the DVR's `additionInformation` says `Human` or `Vehicle`. Confidence is left empty because this DVR does not send a score.

On this DS-7104HGHI-K1 the alarm log contained motion only. Line crossing, intrusion, video loss, storage errors, and external alarm inputs are not written to that log, so the events page does not offer them. Cloud messages such as Ezviz offline are ignored.

`/events` lists and filters stored events. **View recording** opens `/playback` at that camera, date, and time. The playback timeline shows the same events as markers. New events arrive in the browser over a server-sent stream, not by polling.

## Smart events and notifications (V5)

The DVR detects; this hub organizes, filters, correlates, and notifies. `AI_ENABLED` only records the label the DVR already sent into `event_ai_results`; it runs no vision model by itself. The only local inference in the project is the optional, off-by-default **face detection** worker described in [Face detection](#face-detection-detection-only) below — it never identifies anyone.

### Event flow

```
DVR alarm log
   ↓  poll every EVENT_POLL_INTERVAL_MS
Normalize + dedupe (unique dedupe_key)
   ↓
Store event (priority derived)
   ↓
Rule engine: camera / event / classification / priority / schedule / days
   ↓
Quiet hours + cooldown
   ↓
notification_history (unique event + rule)
   ↓
SSE → browser notification, dashboard, event list
   ↓
Snapshot capture (best effort) → /events/<id> → View recording → /playback
```

### Event priority

`LOW`, `NORMAL`, `HIGH`, `CRITICAL`. Priority is stored with the event and derived from what the DVR reported:

| Event | Priority |
| --- | --- |
| Person | HIGH |
| Vehicle | NORMAL |
| Unclassified motion | NORMAL |
| Intrusion | CRITICAL |
| Video loss, storage error, alarm, line crossing | HIGH |

Only HIGH and CRITICAL count as **Important**, which drives the dashboard feed and the Important quick filter. A rule may raise an event's priority through `minimumPriority`; nothing marks everything critical, and a rule can never lower a priority another rule raised.

### Notification rules

Rules are edited at **/settings/notifications** (ADMIN only). A rule combines:

- **Cameras** — a multi-select checkbox group. Select any combination, or
  **All cameras**; unchecking one camera clears “All cameras”, and selecting
  every camera checks it again. At least one camera is required; an empty
  selection is never treated as “all”.
- **Events** — a multi-select checkbox group: Person, Vehicle, and Motion
  (unclassified motion). At least one is required.
- **Minimum priority** — ignore events below a floor
- **Schedule** — an optional `HH:MM`–`HH:MM` window, plus optional days of the week. A window such as `22:00`–`06:00` spans midnight, so a Friday rule also covers early Saturday
- **Quiet hours** behavior (below)
- **Cooldown** — seconds between notifications for that rule

Rules are never hard-coded. The shipped defaults are examples only, and every field is editable. **Test a rule** dry-runs the engine and reports which rules would match, without storing an event or sending a notification.

Camera and event selections are stored as JSON arrays in `notification_rules.camera_ids` and `notification_rules.event_types`. Existing single-value rows are backfilled idempotently from `camera_id` / `event_type` / `classification` on startup; their matching behavior is unchanged. The legacy columns remain in sync for older queries. See [docs/Rule-Multi-Select.md](docs/Rule-Multi-Select.md).

### Quiet hours

Quiet hours never mean "ignore the event". The event is always stored, and a rule decides what happens during its quiet window:

| Behavior | Result |
| --- | --- |
| `notify` | Notify anyway (useful for person or intrusion at night) |
| `suppress` | Store the event, do not notify (default) |
| `store_only` | Store the event, never notify for this rule |

An event is never deleted because its notification was suppressed.

### Cooldown

A cooldown prevents notification spam. A person walking around for ten minutes produces one event stream, not a hundred notifications. With `cooldownSeconds = 300`, a rule notifies about once every five minutes however many events arrive, and each suppressed decision is recorded with the reason.

### Duplicate notification protection

Notification identity is deterministic: **event ID + rule ID**, enforced by a unique index on `notification_history`. The same combination is recorded once, no matter how often the DVR message is re-read. This is durable across polling overlap, API retries, application restarts, and browser reconnects, because the guard is the database and not memory. An event that matches no rule records a single decision with the reason "No notification rule matched".

### Snapshots

When a new event is ingested the hub requests a still picture from the DVR (`/ISAPI/Streaming/channels/<subChannel>/picture`), validates the JPEG header, and writes it to `DATA_DIR/events/<yyyy>/<mm>/<dd>/<camera>-<eventId>.jpg` with mode `0600`. Verified on this DS-7104HGHI-K1: 704×576 JPEG.

Snapshots are served only through `/api/events/<id>/snapshot`, which requires a session. The path is resolved inside `DATA_DIR/events` and traversal or absolute paths are rejected. Snapshots are never placed in a public directory. If the DVR does not return a picture, the event simply has no snapshot and the page says **Snapshot unavailable**; an image is never fabricated.

### Event history, statistics, and retention

- `/events` — server-side filtering by camera, classification, date, time, important, read state, and notification state, with pagination and quick filters. The browser never downloads a day of events to filter locally.
- `/events/<id>` — detail page with snapshot, priority, and **View recording**, which opens `/playback?camera=…&date=…&time=…`.
- `/notifications` — notification history with filters for date, camera, status (sent / suppressed / failed), and priority.
- `/events/stats` — totals and per-camera activity for today, yesterday, last 7 days, and last 30 days, from real rows only.

Retention (`EVENT_RETENTION_DAYS`, default 30, or `0` for forever; also editable per install) deletes **this hub's own rows only** — events, their snapshot files, and notification history. It never deletes Hikvision DVR recordings, MediaMTX recordings, or user accounts. Cutoffs are formatted in Asia/Kolkata, and stored timestamps carry the `+05:30` offset, so a cutoff cannot delete today's events early.

### Timezone

Asia/Kolkata is used everywhere: event display, rule schedules, quiet hours, cooldown windows, playback timestamps, statistics ranges, and retention. Weekday matching is evaluated in Kolkata, so schedules do not shift with the server's local zone.

### Browser and PWA notifications

Browser notifications use the standard Notification API. Permission is requested only after an explicit click on **Enable notifications**; it is never requested on page load. Clicking a notification opens `/events/<id>`.

**Known limitation:** true background push is not implemented. A service worker push subscription requires a push service, which would mean a cloud dependency, and this project stays local-first. Notifications therefore arrive **while the hub is open in a browser tab or an installed PWA window** and the SSE connection is live. A closed browser, a locked phone, or a suspended tab will not receive a notification. This was not tested as a background push and is not claimed to work.

Delivered notifications depend on the browser being open, permission being granted, a matching enabled rule, the rule's schedule, quiet hours, and cooldown. A notification is only claimed as delivered when the hub records `status = sent` in `/notifications`.

## V5 API

| Method | Route | Role |
| --- | --- | --- |
| GET | `/api/events` | any signed-in user |
| GET | `/api/events/<id>` | any signed-in user |
| POST | `/api/events/<id>/read` | any signed-in user |
| GET | `/api/events/<id>/snapshot` | any signed-in user |
| GET | `/api/events/recent?important=true` | any signed-in user |
| GET | `/api/events/stats?range=today\|yesterday\|7d\|30d` | any signed-in user |
| GET | `/api/notifications` | any signed-in user |
| GET | `/api/notifications/stats` | any signed-in user |
| GET | `/api/notification-rules` | ADMIN |
| POST | `/api/notification-rules` | ADMIN |
| PUT/PATCH | `/api/notification-rules/<id>` | ADMIN |
| DELETE | `/api/notification-rules/<id>` | ADMIN |
| POST | `/api/notifications/test` | ADMIN |
| POST | `/api/auth/password` | any signed-in user (own password) |
| GET | `/api/auth/sessions` | any signed-in user (own sessions) |
| DELETE | `/api/auth/sessions` | any signed-in user (`scope: others\|all`) |
| PATCH | `/api/users/<id>` | ADMIN (role, enabled, password reset) |
| DELETE | `/api/users/<id>/sessions` | ADMIN (revoke that user's sessions) |
| GET | `/api/system/health` | ADMIN (operational health) |

Every route checks the session and the role on the server. Camera ids, event ids, rule ids, and notification ids from the browser are validated and never trusted. A viewer receives 403 on rule management, and an unauthenticated caller receives 401. `/api/health` is the only intentionally public endpoint; `/api/system/health` is ADMIN-only and adds worker, backup, storage and retention state.

## Database

`data/events.sqlite` holds events, notification rules, notification history, and this hub's users, sessions, and audit log. V5 adds its columns and tables additively on first start: existing events are kept, priorities are backfilled once from what the DVR reported, and pre-V5 rules receive readable names. The migration is idempotent and runs automatically, so there is no separate migration command.

Indexes cover the query shapes actually used: `(camera_id, timestamp)`, `(type, timestamp)`, `(classification, timestamp)`, `(priority, timestamp)`, plus `notified`, and `notification_history` on `(event_id, rule_id)` unique, `event_id`, `rule_id`, and `created_at`. V5.2 adds `auth_sessions(expires_at)`, `auth_sessions(user_id)`, the single-row `face_worker_heartbeat` table, and the multi-select columns `notification_rules.camera_ids` / `notification_rules.event_types`. All migrations are additive and idempotent; no command is required, and existing notification rules are preserved and backfilled.

### Podman operations

```bash
podman compose up -d          # start
podman compose ps             # status
podman compose logs -f        # logs
podman compose restart web    # restart one service
podman compose down           # stop
```

Data lives in `./data`, mounted into the container, so stopping or recreating a container does not lose events or rules.

## Operations

Boot, status and logs on the production host:

```bash
systemctl status home-cctv.service --no-pager
systemctl is-enabled home-cctv.service
systemctl reload home-cctv                 # recreate containers after a .env change
journalctl -u home-cctv -n 100 --no-pager
podman compose -f /opt/home-cctv/compose.yml ps
podman logs --tail 100 home-cctv-web-1
podman logs --tail 100 home-cctv-mediamtx-1
curl -fsS http://127.0.0.1:3000/api/health
```

Day-to-day checks:

| What | Command / place |
| --- | --- |
| Application, DVR, MediaMTX, face worker, thumbnails, storage, last backup | `/settings/system` (ADMIN) or `GET /api/system/health` |
| Active sessions | `/account`, `/settings/system` |
| Login and password events | `/settings/audit-log` |
| Backup result | `journalctl -u home-cctv-backup -n 50`, `data/backup-status.json` |
| Backup timer | `systemctl list-timers home-cctv-backup.timer` |
| Face worker | `systemctl status home-cctv-face-worker`, `podman logs home-cctv-face-worker-1` |
| Orphan snapshots | `./scripts/cleanup-orphan-snapshots.sh --dry-run` |
| Restore rehearsal | `./scripts/verify-backup.sh ./backups/<timestamp>` |

If the admin System page says **face detection is enabled but the worker is not
processing jobs**, check, in order: `FACE_DETECTION_ENABLED=true` in `.env`;
the model exists at `face-worker/models/face_detection_yunet_2023mar.onnx`; the
`home-cctv-face-worker.service` is enabled (or the container is running); and the
worker log names a database, model or path error. When detection is disabled the
page says so and does not raise a warning.

If the hub reports `mediamtx: offline`, check `podman logs home-cctv-mediamtx-1`.
If MediaMTX starts but closes immediately, its rendered config was rejected:
usually `MEDIAMTX_AUTH_PASSWORD` is missing or shorter than 16 characters. The
container log names the problem without printing the password.

If every login fails while the DVR is fine, confirm `.env` is readable by the
service and `SESSION_SECRET` is at least 16 characters. If the browser is on
HTTPS (Funnel) the session cookie is marked `Secure` automatically.

Container logs are rotated by Compose (`json-file`, 10 MB × 3 per service).
SQLite keeps a bounded WAL (`journal_size_limit`), thumbnails expire after
`PLAYBACK_THUMBNAIL_RETENTION_DAYS`, face-worker batch/concurrency settings
are bounded by `FACE_DETECTION_BATCH_SIZE`, and FFmpeg clip files are removed
after upload or after 30 minutes if a crash left them behind.

## Hardening (V5.2)

### Backup

`scripts/backup.sh` creates a timestamped, consistent backup under
`./backups/<timestamp>/`:

- `database.sqlite` — events, notification rules, notification history, users,
  sessions, audit log, face rows. Copied through SQLite's online backup API, so
  it is consistent while the hub is running.
- `events/` — event snapshots written by this hub.
- `face-crops/` — detected-face crops, when the directory exists.
- `cameras.json` — camera display names.
- `manifest.json` — what the backup contains and when it was taken.

The backup is built in a hidden staging directory and renamed into place only
after `PRAGMA quick_check` passes. A failed run leaves no partial backup and never
overwrites an existing one. A lock directory prevents overlapping runs. The
newest `BACKUP_RETENTION` complete backups are kept (default **7**); only
directories with a `manifest.json` are eligible for deletion. The script writes
`data/backup-status.json` for the admin System page and exits non-zero on
failure.

`sqlite3` is required; a plain file copy can miss WAL pages. On Ubuntu:
`sudo apt-get install -y sqlite3`.

```bash
./scripts/backup.sh                                # -> ./backups/<timestamp>/
BACKUP_DIR=/path/to/backups ./scripts/backup.sh    # choose another location
BACKUP_RETENTION=14 ./scripts/backup.sh            # keep more copies
```

Automated daily backups:

```bash
sudo systemctl enable --now home-cctv-backup.timer
systemctl list-timers home-cctv-backup.timer
```

The backup never copies `.env`, so it cannot leak DVR credentials, the session
secret or the MediaMTX password. Thumbnails are generated cache and are excluded;
DVR recordings live on the DVR and are excluded too.

### Restore rehearsal and restore

Rehearse a backup **without touching live data**. The script copies the backup
database to a temporary directory, runs `PRAGMA integrity_check`,
`foreign_key_check`, verifies the expected tables and users, and checks that every
stored snapshot and face-crop reference resolves inside the backup:

```bash
./scripts/verify-backup.sh ./backups/2026-10-09_103000
echo $?          # 0 only when every check passed
```

It returns non-zero on failure and never opens or overwrites
`data/events.sqlite`.

To restore:

```bash
sudo systemctl stop home-cctv
./scripts/restore.sh ./backups/2026-10-09_103000
sudo systemctl start home-cctv
```

`restore.sh` runs `verify-backup.sh` first, refuses to run while the hub is
listening, stages every copy, and moves the previous database, snapshots and face
crops aside as `*.pre-restore-<timestamp>` rather than deleting them. The old WAL
and SHM files are moved with the old database so they cannot replay against the
restored file. Set `DRY_RUN=1` to preview. `.env` is not part of a backup; restore
it separately with mode `0600`.

### Session and cookie lifecycle

Login creates a server-side session row. The cookie is HMAC-signed and carries
only the session id; protected routes validate that id against the database on
every request. Logout **deletes the server-side session row**, so an old token is
rejected even if the cookie were replayed. Changing or resetting a password
revokes every session for that user; "sign out other sessions" keeps only the
requesting session.

Expired rows are pruned at startup, hourly, on login, and when a session list is
read. The prune is `DELETE ... WHERE expires_at <= now`, so an active session is
never removed.

Cookie flags: `HttpOnly=true`, `SameSite=lax`, `Path=/`, 7-day expiry. `Secure`
follows `COOKIE_SECURE` and is forced when the request arrived over HTTPS (for
example through Tailscale Funnel).

### Operational health

`GET /api/system/health` (ADMIN) reports application, SQLite, DVR, MediaMTX,
event ingestion, the face-worker heartbeat and queue, the thumbnail worker,
storage, the last successful backup, retention, and active sessions. Unknown
checks are reported as `unknown`, never as healthy. It never returns passwords,
Telegram tokens, session tokens, DVR credentials, or filesystem paths.

`/settings/system` renders the same data and raises a clear warning when
`FACE_DETECTION_ENABLED=true` but the worker has no recent heartbeat. When
detection is disabled, no error is shown. The face worker writes a single
`face_worker_heartbeat` row every cycle (including idle cycles), so a stopped
worker is visible instead of silently accumulating a queue.

The public `/api/health` endpoint keeps its small shape for external probes.

### Snapshot orphan cleanup

`scripts/cleanup-orphan-snapshots.sh` removes generated snapshots under
`data/events/` that no `events.snapshot_path` references. It only considers the
generated name pattern (`<yyyy>/<mm>/<dd>/<camera>-evt_<24 hex>.jpg`), does not
follow or delete symlinks, refuses to run if the database is unreadable, and
supports a dry run:

```bash
./scripts/cleanup-orphan-snapshots.sh --dry-run
./scripts/cleanup-orphan-snapshots.sh
```

The same sweep runs in the hub's hourly retention pass, so a crash between a
snapshot write and the database update does not leave a file forever. Face crops
already have their own retention sweep in the same pass.

### Browser notification permission

Any authenticated user — ADMIN and VIEWER alike — can enable browser notifications from an "Enable notifications" control in the app header. Permission is requested only after an explicit click, never on page load. Notification **rule** management remains ADMIN-only.

### Supported event types

This DS-7104HGHI-K1 produces **motion only**. Person and vehicle are not separate event types; they are a classification label the DVR attaches to a motion event. The remaining types in the model (`alarm`, `line_crossing`, `intrusion`, `video_loss`, `storage_error`) are recognized for DVRs that report them but are **not produced by this unit**, so they are not offered in the event list or the rule editor. The rule editor rejects rules that target an unsupported type.

### Playback download

Download is **not available**. This DVR's download API returns a private `IMKH` stream (`Content-Type: Opaque/data`), not a browser-savable MP4. The playback page states this instead of showing a button that fails. The `/api/playback/download` endpoint returns `501` and is not wired to a broken UI control.

### Face detection (detection only)

Optional and **off by default**. When `FACE_DETECTION_ENABLED=true`, a separate local worker (`face-worker/`) analyses **existing event snapshots** — never the live stream and never the H.265 recordings — with OpenCV's YuNet model on the CPU, and stores what it finds in `event_faces` plus JPEG crops under `data/face-crops/`. Everything is offline: no cloud AI, no image upload.

It reports **that** a face is present and where it is. It does **not** recognise anyone: no embeddings, no matching, and every detected face is **Unassigned**. `/faces` lists detections; `/events/<id>` shows them for one event.

```bash
python3 face-worker/scripts/download_model.py      # once, 232 KB, MIT, checksum-verified
FACE_DETECTION_ENABLED=true python3 face-worker/worker.py
```

Set `FACE_DETECTION_ENABLED`, `FACE_DETECTION_CONFIDENCE` (default `0.60`) and `FACE_DETECTION_MAX_FACES` (default `10`) in `.env`.

Telegram can receive the same accepted notification (server-side only, with an ADMIN *Send Telegram Test* button on `/settings/notifications`). It shares the one decision, so the cooldown, duplicate protection and expiry are unchanged. A real detection also carries the full camera snapshot and a ~10 second clip cut from the DVR's own recording (H.265 converted to H.264 MP4 by FFmpeg, which the container image includes; text and snapshot still work without it). The face crop is not sent to Telegram. The clip is generated in the background and its temporary file is deleted after upload.

The same Telegram delivery is available for ordinary camera events, not only faces: with `TELEGRAM_EVENT_NOTIFICATIONS=true` an event that a Notification Rule accepts is also sent to Telegram. The rule decision is made and recorded first (camera, event type, priority, schedule, quiet hours, cooldown, duplicate protection), and only then is Telegram called, so a Telegram failure never suppresses the browser notification or changes the history. `TELEGRAM_FACE_NOTIFICATIONS` and `TELEGRAM_EVENT_NOTIFICATIONS` are independent channels behind the `TELEGRAM_NOTIFICATIONS_ENABLED` master switch. Rule events use the same attachment switches (`TELEGRAM_EVENT_IMAGE`, `TELEGRAM_FACE_VIDEO`): the message is followed by the full camera snapshot and the short clip, queued through the same durable background worker so a slow DVR search or FFmpeg never delays event ingestion.

For a bounded real-world trial you can also raise a browser notification when a face is detected: set `FACE_DETECTION_TEST_NOTIFICATIONS=true` and `FACE_DETECTION_TEST_UNTIL` to the end of your window (ISO-8601 with an offset, for example `2026-10-12T10:00:00+05:30`). It is a temporary, additive test mode — motion notifications are unchanged, notifications are anonymous ("Face detected"), the per-camera cooldown defaults to 5 minutes, and the mode stops by itself at the expiry while face detection keeps running. See [docs/Face-Detection.md](docs/Face-Detection.md) for the model's provenance, security and privacy model, measured performance, retention and the future recognition plan.

