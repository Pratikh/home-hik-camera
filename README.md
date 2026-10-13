# Home CCTV Hub

Private live view for a Hikvision DS-7104HGHI-K1 on the home network. The browser talks only to this hub. The hub talks to the DVR.

```
Hikvision DVR --RTSP--> MediaMTX --WebRTC or HLS--> this hub --> browser
```

Four camera slots. Sub streams (`102`, `202`, `302`, `402`) fill the grid. Main streams (`101`, `201`, `301`, `401`) open full screen. Playback, events, notifications, and remote access are left for a later version. The Hikvision module, the video gateway, and the web UI are separate so those features can be added beside them.

## Requirements

- macOS
- Node.js 24 (or Node 20+) and npm
- Podman Desktop. Docker Desktop is not required
- The DVR reachable from this computer on the LAN

`podman compose` on this Mac uses the `docker-compose` CLI against the Podman machine. Docker Desktop is not required. If that command fails with `docker-credential-desktop: executable file not found`, Compose is pointed at a Docker Desktop credential helper. Leave `~/.docker/config.json` as it is and run:

```bash
mkdir -p /tmp/home-cctv-docker
printf '%s\n' '{}' > /tmp/home-cctv-docker/config.json
DOCKER_CONFIG=/tmp/home-cctv-docker podman compose up -d
```

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
| `WEBRTC_ADDITIONAL_HOST` | This computer's LAN address, so phones can complete WebRTC. |
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
| `TELEGRAM_NOTIFICATIONS_ENABLED` | Deliver accepted face notifications to Telegram. Default `false`. Server-side only. |
| `TELEGRAM_BOT_TOKEN` | Telegram bot token. Read by the server; never sent to the browser or logged. |
| `TELEGRAM_CHAT_ID` | Telegram destination chat. Server-side only. |
| `TELEGRAM_FACE_NOTIFICATIONS` | Whether face detections may produce a Telegram message. Default `false`. |
| `TELEGRAM_COOLDOWN_SECONDS` | Informational only; Telegram shares the existing face notification cooldown. Default `300`. |
| `TELEGRAM_FACE_IMAGE` | Attach the full camera event snapshot to the Telegram message. Default `true`. The face crop is never sent. |
| `TELEGRAM_FACE_VIDEO` | Attach a short clip from the DVR recording. Default `true`. |
| `TELEGRAM_VIDEO_PRE_SECONDS` / `TELEGRAM_VIDEO_POST_SECONDS` | Clip window around the event. Defaults `5` + `5` = 10 seconds. |
| `TELEGRAM_VIDEO_MAX_MB` / `TELEGRAM_VIDEO_TIMEOUT_SECONDS` | Clip upload cap (`45`) and FFmpeg time limit (`30`). |
| `FFMPEG_PATH` | FFmpeg executable used for the clip conversion. Default `ffmpeg`. |

V5 introduces no new environment variables. Notification rules, quiet hours, cooldowns, and retention are configured in the UI and stored in `data/events.sqlite`.

The real `.env` is gitignored. Do not commit it.

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

From the project directory.

Containers:

```bash
podman compose up -d
podman compose ps
podman compose logs -f
podman compose down
```

Development on the host, with MediaMTX still in Podman:

```bash
podman compose up -d mediamtx
npm install
npm run dev
```

`npm run dev` listens on `0.0.0.0:3000`. Open `http://127.0.0.1:3000`.

Generate a MediaMTX file on the host without starting a container:

```bash
npm run mediamtx:config
```

That writes `mediamtx/runtime.yml`, which is gitignored and contains the RTSP source. Do not commit it.

## Phones on the LAN

1. Find this computer's LAN address (System Settings → Network, or `ipconfig getifaddr en0`).
2. Set `WEBRTC_ADDITIONAL_HOST` to that address and restart MediaMTX (`podman compose up -d --force-recreate mediamtx`).
3. On the phone, open `http://COMPUTER_LAN_IP:3000`.

WebRTC media uses UDP/TCP port `8189` on this computer. Signaling stays on port `3000`. `127.0.0.1` is always advertised so the same Mac can play WebRTC through the published port. A phone ignores `127.0.0.1` and needs `WEBRTC_ADDITIONAL_HOST`. Until that is set, a phone is offered **HLS** instead of a WebRTC attempt. HLS is a real stream from MediaMTX, proxied by the hub, with no DVR credentials in the URL.

Podman Desktop on macOS forwards published ports from the Mac. Containers reach the DVR by outbound NAT through the Mac. `network_mode: host` does not place a container on the Mac's LAN, so this compose file does not use it. If a container cannot open the DVR while `ping` from the Mac works, run the hub with `npm run dev` (that process uses the Mac network directly) and keep MediaMTX in Podman. If MediaMTX still cannot open RTSP, the Podman machine route to the LAN is the thing to fix; the UI will say the camera or gateway is unavailable.

## What you should see

- `/login` until the session cookie is set.
- `/` four camera cards, plus recent security events.
- Full screen uses the main stream. Escape or Close leaves it.
- `/cameras` renames the four tiles. Names are stored in `data/cameras.json`.
- `/device` shows whatever the DVR returns. Missing fields say "Not reported".
- `/settings` shows the host, ports, username, and `********` for the password.
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

- Use it on a trusted home LAN.
- Do not port-forward the hub or the DVR.
- Do not publish the DVR's ports in Compose. Only the hub UI (`3000`) and MediaMTX playback ports are published. The MediaMTX API stays on localhost.
- Rotate the DVR password and the hub password if they have been shared.
- Keep `.env` and `mediamtx/runtime.yml` out of git.
- DVR credentials stay in the server process and in the MediaMTX process. They are not placed in `NEXT_PUBLIC_*` variables, React props, or stream URLs.
- Event snapshots are stored under `data/events` with mode `0600` and served only through the authenticated `/api/events/<id>/snapshot` route. They are never placed in `public/`. Stored paths are resolved inside the events directory, and traversal or absolute paths are refused.
- Notification rule management and the rule test endpoint require ADMIN. Event and notification reads require a session. Role checks run on the server, and ids sent by the browser are validated rather than trusted.

## Development

```bash
npm install
npm run dev
npm test
npm run lint
npm run typecheck
npm run build
```

Unit tests mock the DVR. They do not mark a camera live.

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

## Users and remote access

The first start creates an administrator from `APP_USERNAME` and `APP_PASSWORD`. Passwords are stored with scrypt. Sessions are HTTP-only cookies checked against the database, so logging out invalidates that session without disconnecting anyone else.

Administrators can open Settings, including users, notification rules, the audit log, and system status. Viewers can use live view, playback, and events. They cannot change users, DVR settings, or notification rules. Those checks run on the server.

MediaMTX keeps one RTSP connection to the DVR per camera path and can hand that stream to more than one browser. Set `MEDIAMTX_AUTH_PASSWORD` and recreate the MediaMTX container if the published MediaMTX ports should reject anonymous viewers. The hub adds that password only on its own server-side requests. Leave it empty to keep the current LAN behavior.

Do not publish the DVR's HTTP or RTSP ports to the Internet. For access away from home, put the computer on a VPN such as Tailscale or WireGuard and open the hub through that private address. Do not port-forward ports 80, 443, or 554 on the DVR, or the MediaMTX ports.

The hub can be installed on a phone from the browser. The manifest uses standalone display. Login attempts are limited in memory on this one computer; a restart clears that limit.

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

- **Camera** — one camera or all
- **Event** — any event, person, vehicle, or unclassified motion
- **Minimum priority** — ignore events below a floor
- **Schedule** — an optional `HH:MM`–`HH:MM` window, plus optional days of the week. A window such as `22:00`–`06:00` spans midnight, so a Friday rule also covers early Saturday
- **Quiet hours** behavior (below)
- **Cooldown** — seconds between notifications for that rule

Rules are never hard-coded. The shipped defaults are examples only, and every field is editable. **Test a rule** dry-runs the engine and reports which rules would match, without storing an event or sending a notification.

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

## Users and remote access

The first start creates an administrator from `APP_USERNAME` and `APP_PASSWORD`. Passwords are stored with scrypt. Sessions are HTTP-only cookies checked against the database, so logging out invalidates that session without disconnecting anyone else.

Administrators can open Settings, including users, notification rules, the audit log, and system status. Viewers can use live view, playback, and events. They cannot change users, DVR settings, or notification rules. Those checks run on the server.

MediaMTX keeps one RTSP connection to the DVR per camera path and can hand that stream to more than one browser. Set `MEDIAMTX_AUTH_PASSWORD` and recreate the MediaMTX container if the published MediaMTX ports should reject anonymous viewers. The hub adds that password only on its own server-side requests. Leave it empty to keep the current LAN behavior.

Do not publish the DVR's HTTP or RTSP ports to the Internet. For access away from home, put the computer on a VPN such as Tailscale or WireGuard and open the hub through that private address. Do not port-forward ports 80, 443, or 554 on the DVR, or the MediaMTX ports.

The hub can be installed on a phone from the browser. The manifest uses standalone display. Login attempts are limited in memory on this one computer; a restart clears that limit.

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

Every route checks the session and the role on the server. Camera ids, event ids, rule ids, and notification ids from the browser are validated and never trusted. A viewer receives 403 on rule management, and an unauthenticated caller receives 401.

## Database

`data/events.sqlite` holds events, notification rules, notification history, and this hub's users, sessions, and audit log. V5 adds its columns and tables additively on first start: existing events are kept, priorities are backfilled once from what the DVR reported, and pre-V5 rules receive readable names. The migration is idempotent and runs automatically, so there is no separate migration command.

Indexes cover the query shapes actually used: `(camera_id, timestamp)`, `(type, timestamp)`, `(classification, timestamp)`, `(priority, timestamp)`, plus `notified`, and `notification_history` on `(event_id, rule_id)` unique, `event_id`, `rule_id`, and `created_at`.

### Podman operations

```bash
podman compose up -d          # start
podman compose ps             # status
podman compose logs -f        # logs
podman compose restart web    # restart one service
podman compose down           # stop
```

Data lives in `./data`, mounted into the container, so stopping or recreating a container does not lose events or rules.

## Hardening (V5.1)

### Backup and restore

`scripts/backup.sh` creates a timestamped, consistent backup under `./backups/<timestamp>/`:

- `database.sqlite` — events, notification rules, notification history, users, sessions, audit log. Copied through SQLite's online backup API, so it is consistent even while the hub is running.
- `events/` — event snapshots written by this hub.
- `cameras.json` — camera display names.
- `manifest.json` — what the backup contains and when it was taken.

The backup never copies `.env`, so it cannot leak DVR credentials or the session secret.

```bash
./scripts/backup.sh                                # -> ./backups/<timestamp>/
BACKUP_DIR=/path/to/backups ./scripts/backup.sh    # choose another location
```

`scripts/restore.sh` restores a backup. It refuses to run on a directory without a `manifest.json`, and refuses to run if the hub appears to be listening, so it cannot wipe live data accidentally.

```bash
podman compose down web           # stop the app first
./scripts/restore.sh ./backups/2026-10-09_103000
podman compose up -d web
```

Set `DRY_RUN=1` to preview without changing anything. A restore keeps the previous database as `data/events.sqlite.pre-restore`.

Backups intentionally exclude Hikvision DVR recordings, MediaMTX streams, `node_modules`, build output, and caches. DVR recordings live on the DVR, not in this hub.

### Sessions and cookies

Login creates a server-side session row. The cookie is HMAC-signed and carries only the session id; the protected routes validate that id against the database on every request. Logout **deletes the server-side session row**, so an old token is rejected even if the cookie itself were replayed — deleting the browser cookie alone is not relied on.

This was verified end-to-end: a token that returned 200 before logout returns 401 immediately after logout.

Cookie flags: `HttpOnly=true`, `SameSite=lax`, `Path=/`, 7-day expiry. `Secure` follows `COOKIE_SECURE`: `false` for plain HTTP on a trusted LAN, `true` in production behind HTTPS (a `Secure` cookie is dropped by the browser on `http://`, which is why it is not forced on).

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

For a bounded real-world trial you can also raise a browser notification when a face is detected: set `FACE_DETECTION_TEST_NOTIFICATIONS=true` and `FACE_DETECTION_TEST_UNTIL` to the end of your window (ISO-8601 with an offset, for example `2026-10-12T10:00:00+05:30`). It is a temporary, additive test mode — motion notifications are unchanged, notifications are anonymous ("Face detected"), the per-camera cooldown defaults to 5 minutes, and the mode stops by itself at the expiry while face detection keeps running. See [docs/Face-Detection.md](docs/Face-Detection.md) for the model's provenance, security and privacy model, measured performance, retention and the future recognition plan.

