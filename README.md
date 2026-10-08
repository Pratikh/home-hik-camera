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
| `DATA_DIR` | Camera display names. Default `./data` (gitignored). |

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
- `/` four camera cards.
- Full screen uses the main stream. Escape or Close leaves it.
- `/cameras` renames the four tiles. Names are stored in `data/cameras.json`.
- `/device` shows whatever the DVR returns. Missing fields say "Not reported".
- `/settings` shows the host, ports, username, and `********` for the password.

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

## Security

- Use it on a trusted home LAN.
- Do not port-forward the hub or the DVR.
- Do not publish the DVR's ports in Compose. Only the hub UI (`3000`) and MediaMTX playback ports are published. The MediaMTX API stays on localhost.
- Rotate the DVR password and the hub password if they have been shared.
- Keep `.env` and `mediamtx/runtime.yml` out of git.
- DVR credentials stay in the server process and in the MediaMTX process. They are not placed in `NEXT_PUBLIC_*` variables, React props, or stream URLs.

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

## Layout

- `src/server/hikvision` — ISAPI client
- `src/server/video` — MediaMTX health and HLS rewrite
- `src/server/cameras` — channel map and display names
- `src/app/api` — browser-facing HTTP
- `mediamtx/` — image entrypoint and a credential-free template

Playback search and the timeline live in `src/server/hikvision/hikvision-playback.ts` and `/playback`. Event ingestion lives in `src/server/events`.

## Users and remote access

The first start creates an administrator from `APP_USERNAME` and `APP_PASSWORD`. Passwords are stored with scrypt. Sessions are HTTP-only cookies checked against the database, so logging out invalidates that session without disconnecting anyone else.

Administrators can open Settings, including users, notification rules, the audit log, and system status. Viewers can use live view, playback, and events. They cannot change users, DVR settings, or notification rules. Those checks run on the server.

MediaMTX keeps one RTSP connection to the DVR per camera path and can hand that stream to more than one browser. Set `MEDIAMTX_AUTH_PASSWORD` and recreate the MediaMTX container if the published MediaMTX ports should reject anonymous viewers. The hub adds that password only on its own server-side requests. Leave it empty to keep the current LAN behavior.

Do not publish the DVR's HTTP or RTSP ports to the Internet. For access away from home, put the computer on a VPN such as Tailscale or WireGuard and open the hub through that private address. Do not port-forward ports 80, 443, or 554 on the DVR, or the MediaMTX ports.

The hub can be installed on a phone from the browser. The manifest uses standalone display. Login attempts are limited in memory on this one computer; a restart clears that limit.

## Events

The hub polls the DVR alarm log (`ISAPI/ContentMgmt/logSearch`) on `EVENT_POLL_INTERVAL_MS` (default 5 seconds). It stores motion start/stop pairs in `data/events.sqlite`. Person and vehicle are classifications on a motion event when the DVR's `additionInformation` says `Human` or `Vehicle`. Confidence is left empty because this DVR does not send a score.

On this DS-7104HGHI-K1 the alarm log contained motion only. Line crossing, intrusion, video loss, storage errors, and external alarm inputs are not written to that log, so the events page does not offer them. The log also has no event snapshot, so snapshots stay unavailable instead of using a live picture. Cloud messages such as Ezviz offline are ignored.

`/events` lists and filters stored events. **View recording** opens `/playback` at that camera, date, and time. The playback timeline shows the same events as markers. The dashboard shows today's counts and the latest events. New events arrive in the browser over a server-sent stream, not by polling.

Browser notifications use the Notification API. Person is on by default. Vehicle and unclassified motion are off. Quiet hours default to 23:00–07:00 India time and only suppress notifications; the event is still stored. Rules and retention are edited at `/settings/notifications`. Retention (`EVENT_RETENTION_DAYS`, default 30, or 0 for forever) deletes this hub's rows only.

`AI_ENABLED` defaults to false. Turning it on records the DVR classification in `event_ai_results`. It does not download or run a vision model. `EVENT_DEV_MOCK` is ignored in production.
