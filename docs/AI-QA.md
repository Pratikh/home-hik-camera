# Home CCTV Hub — AI QA Guide

## Purpose

This document describes the **expected V5.1 browser behaviour** of the Home CCTV
Hub and the automated Playwright suite that checks it. It is the contract
between the application and its QA: a future agent reads this first, runs the
existing tests before changing anything, and treats a failing test as a
question about the application, not as a test to weaken.

Everything here was derived from the source in `src/app`, `src/components` and
`src/lib`, not from assumptions.

## QA Environment

IMPORTANT:

All automated browser QA currently targets:

- **1920x1080**
- **Chromium**

Responsive/mobile testing is intentionally **out of scope**. There are no
mobile, tablet, 1280x720 or 1440x900 tests, and no test may add one.

The suite runs against a **live hub with a real DVR**. It does not start,
restart or reconfigure the application, MediaMTX or the DVR.

## Running the application

From the project directory. MediaMTX runs in Podman; the hub runs on the host:

```bash
podman compose up -d mediamtx
npm install
npm run dev
```

`npm run dev` listens on `0.0.0.0:3000`. Open `http://127.0.0.1:3000`.

`npm run start` (after `npm run build`) serves the production bundle. Either is
valid as a QA target; `QA_BASE_URL` selects it.

## Running Playwright

```bash
npm run test:e2e          # headless, all specs
npm run test:e2e:headed   # watch the browser
npm run test:e2e:debug    # Playwright inspector
npm run test:e2e:report   # open the HTML report
```

Useful flags: `--project=chromium-desktop-1920x1080`, `--grep "AUTH-00"`,
`--workers=1`.

The suite needs the hub already running. `tests/e2e/support/global-setup.ts`
checks `QA_BASE_URL`, signs in once per role and stores the session cookies under
`tests/e2e/.auth/` (gitignored). If the hub is not reachable, the run fails
immediately with an explicit message.

## Environment variables

| Variable | Purpose |
| --- | --- |
| `QA_BASE_URL` | Hub origin. Default `http://localhost:3000`. |
| `QA_ADMIN_USERNAME` | ADMIN login used by most specs. |
| `QA_ADMIN_PASSWORD` | ADMIN password. |
| `QA_VIEWER_USERNAME` | VIEWER login, needed only for the VIEWER role tests. |
| `QA_VIEWER_PASSWORD` | VIEWER password. |

Placeholders live in `.env.example`. Put real values in a gitignored `.env.qa`
(or export them). Resolved in this order: real environment variable, `.env.qa`,
`.env.test`, `.env`.

`QA_ADMIN_*` may be omitted locally: the loader falls back to the application's
own `APP_USERNAME` / `APP_PASSWORD`. `QA_VIEWER_*` has **no fallback** — a
VIEWER must be provisioned deliberately. When it is missing, USER-004…009 and
SEC-004 report themselves as skipped; they never create a user in the
production database.

Never commit real credentials, and never print a password, cookie,
`Authorization` header or session token. Test output is passed through
`tests/e2e/support/redact.ts`, which replaces every registered credential with
`***REDACTED***` before it can reach the terminal or the HTML report.

## Application architecture

Live video:

```
Hikvision DVR --RTSP--> MediaMTX --WebRTC or HLS--> CCTV Hub (same-origin proxy) --> Browser
```

The browser never receives the RTSP address or DVR credentials. The hub proxies
WebRTC signalling (`/api/webrtc/<path>/whep`), HLS (`/api/hls/<path>/…`) and
asks MediaMTX for path status server-side.

Events and notifications:

```
Hikvision DVR --ISAPI alarm log--> CCTV Hub --SQLite--> Events / Notifications
```

SQLite (`data/events.sqlite`) holds `events`, `notification_rules`,
`notification_history`, `event_ai_results`, `app_settings`, `users`,
`auth_sessions`, `audit_logs` and `viewer_presence`. Camera display-name
overrides live in `data/cameras.json`.

## Routes

Actual routes discovered from `src/app`:

| Route | What it is |
| --- | --- |
| `/login` | Sign-in. Public. |
| `/` | **Dashboard** — four-camera live view. There is no separate `/live` route. |
| `/cameras` | Camera display names (local override vs DVR name). ADMIN. |
| `/playback` | Date/calendar, player, controls, timeline. |
| `/events` | Event list + detail panel, filters. |
| `/events/[id]` | Single event detail (server-rendered). |
| `/events/stats` | Event statistics. |
| `/notifications` | Notification history (decisions, not rules). |
| `/device` | DVR device information. |
| `/settings` | Read-only environment summary. ADMIN. |
| `/settings/users` | User management. ADMIN. |
| `/settings/notifications` | Notification rule management. ADMIN. |
| `/settings/audit-log` | Audit log. ADMIN. |
| `/settings/system` | Live hub/DVR/MediaMTX status. ADMIN. |

Authentication is enforced twice: `src/proxy.ts` (middleware) redirects page
requests without a valid session to `/login` and returns `401` for `/api/*`;
the protected layouts (`src/app/(hub)/layout.tsx`,
`src/app/(hub)/settings/layout.tsx`) re-check the session server-side.

Selected API routes: `/api/auth/login`, `/api/auth/logout`, `/api/auth/session`,
`/api/health` (public), `/api/cameras`, `/api/cameras/[id]`, `/api/dvr/status`,
`/api/dvr/info`, `/api/events*`, `/api/notifications*`,
`/api/notification-rules*`, `/api/audit`, `/api/users*`, `/api/settings`,
`/api/system/sessions`, `/api/streams/*`, `/api/webrtc/*`, `/api/hls/*`,
`/api/playback/search`, `/api/playback/recording-dates`, `/api/playback/session`.

## Roles

- **ADMIN** — everything: live, playback, events, notifications, device,
  settings, users, notification rules, audit log, system.
- **VIEWER** — live, playback, events, notifications, device. Cannot access the
  `Settings` tree, user management, notification rule management, audit log or
  system. The sidebar hides `Settings` for a VIEWER, `/settings/*` redirects to
  `/`, and admin-only API routes answer `403`.

Both roles may enable browser notifications from the header; permission is
requested only on an explicit click. Only ADMIN manages rules.

## Cameras

The hub has **four** camera slots. Ids are `1…4`; the main streams are channels
`101/201/301/401` (paths `cam{id}_main`) and the sub streams `102/202/302/402`
(paths `cam{id}_sub`). The live grid uses the sub streams.

Names are discovered at runtime, not hardcoded in tests:

1. A name saved in `data/cameras.json` (a local override), else
2. the channel name configured on the DVR, else
3. `Camera N`.

Observed names on the QA DVR at implementation time: **1 Parking**,
**2 Right Side Outside Camera**, **3 First Floor Passage**,
**4 Left Side Outside**. Treat these as data: the suite reads
`GET /api/cameras` so a rename does not break it.

## Live View expectations

- `/` renders exactly four camera tiles (`<article>`), each with a caption
  heading and a video area, laid out 2x2 without page scrolling at 1920x1080.
- Each tile contains a `<video aria-label="Live view <name>">`; the picture uses
  `object-contain` so the 704x576 sub stream is never stretched or cropped.
- A tile is either a player or an explicit status panel (`DVR offline`,
  `Camera unavailable`, `Video gateway unavailable`, …). A permanent spinner is
  a defect.
- Clicking a tile's "Open <name> full screen" overlay enters **application focus
  mode**: the clicked tile becomes a fixed, full-viewport surface, the other
  tiles and the app chrome are hidden, and an "Exit focus view for <name>"
  button appears. This is **not** the browser Fullscreen API —
  `document.fullscreenElement` must stay `null`.
- `Escape` (or the Exit button) returns to the normal grid.

## Playback expectations

- Opening `/playback` selects today in Asia/Kolkata, or the nearest day with a
  recording when today has none.
- The **calendar** is a popover anchored to the `Date` control
  (`role="dialog"`, `position: absolute`). It is absent until the control is
  used, takes no layout space, and closes on selection, outside click or
  `Escape`. It is never a permanently visible sidebar.
- **Recording availability** comes from the DVR per camera and month. Dates
  that have no recording, and all future dates, are genuinely disabled.
- Browsing to a month that has **no recordings at all** deliberately steps back
  to the nearest month that has one, so a wholly future month cannot be held on
  screen. Future dates are therefore checked inside the displayed month.
- Selecting a date loads the segments and applies the date. Re-clicking the
  already-selected day is a no-op (single-select toggle).
- The **timeline** (`region "Timeline"`) shows recording segments, event
  markers grouped by zoom, a ruler, a playhead and a zoom control (24h/6h/1h).
- **Aspect ratio**: the browser playback source is ~**704x576** (≈1.22:1), not
  16:9. The player uses `object-contain`, and the stage takes the source ratio
  from `videoWidth`/`videoHeight`. A visibly stretched or cropped picture is a
  defect.
- **Layout at 1920x1080**, top to bottom: Date/search controls → video →
  playback controls → timeline. The timeline stays inside the viewport without
  page scrolling, and there is no large empty gap between the controls and the
  timeline.
- Playback is a live RTSP-backed stream, so Play/Pause/seek restart the stream
  at the chosen time; it is not a local file.

## Events

- `/events` lists events from the hub's SQLite store with server-side filtering:
  quick filters (All / Person / Vehicle / Motion / Important), camera,
  classification, date, time range, read state, notification state and
  priority.
- This DS-7104HGHI-K1 produces **motion only**. Person and Vehicle are
  classification labels attached to a motion event, not separate event types;
  the other types in the model are not offered.
- Selecting a row fills the detail panel (`article "Event details"`) with
  camera, time, duration, type, classification, confidence and notification
  state, plus a snapshot when one exists and links to the recording and the
  full event page.
- A snapshot is either rendered from the authenticated
  `/api/events/<id>/snapshot` route or explicitly reported as unavailable.

## Notifications

- `/notifications` is **history**: every notification decision the hub made
  (`sent`, `suppressed`, `failed`) with rule name, reason and a link to the
  event. An event is stored whether or not it notified.
- Filters: date, camera, status, priority. Summary counters for
  sent/suppressed/failed are always shown.
- Rule configuration lives at `/settings/notifications` and is ADMIN-only.
- Browser permission is a separate control in the header, available to both
  roles, requested only after a click.

## Users / Permissions

- User management is `/settings/users`, reached from `Settings` (shown in the
  sidebar only to ADMIN). The Users page has the operated-by-hand set of ADMIN
  and VIEWER accounts, enable/disable, role switch, delete-with-confirmation,
  and a create form.
- Deleting or demoting the last enabled ADMIN is refused (`409`,
  "The last administrator cannot be removed.").

## Security requirements

- **Login uses POST.** The form is `method="post" action="/api/auth/login"` and
  accepts either a JSON body (hydrated React) or a form body (a native submit
  before hydration). A GET must never submit credentials.
- **The password never appears in the URL.** No `?username=`, `?password=` or
  any credential value in a query string, ever. `/login` also redirects to a
  clean `/login` if a `password` parameter arrives from an old bookmark.
- **Session cookies** are `HttpOnly`, `SameSite=Lax`, `Path=/`, 7-day expiry,
  and `Secure` according to `COOKIE_SECURE`. The cookie carries an HMAC-signed
  session id; protected routes validate that id against the database.
- **Logout revokes** the server-side session row, so a replayed token is
  rejected. Refreshing after logout does not restore access.
- **Role enforcement** is server-side: `/settings/*` redirects a VIEWER to `/`,
  and admin-only APIs answer `403`.
- Failed logins are rate-limited (8 per 15 minutes per client address). An
  invalid password is an expected `401`; tests that trigger it allow `401` in
  their diagnostics.

## Known limitations

- **VIEWER credentials are operator-supplied.** Without `QA_VIEWER_*`, the seven
  VIEWER tests skip. They were executed against a temporary `qa_viewer_tmp`
  account created and deleted during validation; the suite itself never creates
  one, because that would write to the production database.
- **The login rate limiter keys on the caller-supplied `X-Forwarded-For`
  header** (`clientIp()` in `src/app/api/auth/login/route.ts`). A client can
  rotate that header to escape the 8-attempts-per-15-minutes bucket, and the
  suite does exactly that for test isolation (one source address per test). On a
  LAN-only hub behind no proxy this is low severity, but it is a real
  defence-in-depth gap.
- **Error states SYSTEM-004 and SYSTEM-007 are fault-injected** in the browser
  (a `route.fulfill` with `500`). The application code is not changed; the test
  removes the fault and verifies recovery through the UI's Retry control.
  Loading states are exercised by delaying the real request, not by faking it.
- **The suite depends on the live DVR.** When the DVR, MediaMTX or a camera is
  unavailable, tests that need data annotate themselves with an
  `environment` note and assert the app's explicit unavailable state instead of
  failing. A broken *hub* still fails the test.
- **Bundled Chromium decoded the sub streams** (704x576, `readyState 4`) in this
  environment. If a future Chromium build cannot decode the DVR's H.264 profile,
  LIVE-006 records an environment annotation and asserts a determinate app state
  rather than a frame.
- **Audit rows and session rows are produced by exercising the hub.** Every
  login writes an `audit_logs` row and an `auth_sessions` row; a logout deletes
  the session row. A run therefore grows `audit_logs` and leaves unexpired
  session rows for the accounts it used (they lapse after 7 days). That is
  normal application behaviour and cannot be avoided by browser QA. No events,
  notification rules, notification history, camera names or accounts are
  created or changed by the suite.

## Known intentional behavior

Do not report these as defects:

- There is **no `/live` route**; the Dashboard at `/` is the four-camera live
  view.
- The camera tile overlay says **"Full screen"** but implements application
  focus mode, not the browser Fullscreen API. Playback's `Full screen` control
  *does* use the Fullscreen API — that is a different feature.
- The playback **date calendar is a popover**, so it is invisible until the
  `Date` control is used. It intentionally adds no layout height.
- Event **"Motion"** quick filter means "unclassified motion"; it maps to
  `classification=none`.
- Browsing the playback calendar to a month with **no recordings** snaps back to
  the nearest month that has one (`findNearestAvailableDate`). The calendar is
  not a free month browser by design.
- Re-clicking the already-selected calendar day does nothing.
- Playback **Download is not available** on this DVR (its API returns a private
  `IMKH` stream); the endpoint answers `501` and no UI control pretends
  otherwise.
- Because the DVR reports motion only, the event list and rule editor do not
  offer `alarm`, `line_crossing`, `intrusion`, `video_loss` or `storage_error`.
- The settings page shows the DVR password as `********`; it is masked, never
  rendered.
- `/api/health` is intentionally public and contains no credentials.

## Open observations (reported, not hidden)

These are recorded so a human can triage them. They are **not** asserted as
desired behaviour.

- **Quick-filter precedence is inconsistent.** In `EventsView.search()`, when
  the `Motion` quick filter is active it always writes `classification=none` and
  the explicit `Classification` select is ignored; with the `Person` or
  `Vehicle` quick filter active, the select *does* override the quick filter.
  The automated test exercises the supported path (quick filter `All`, then the
  select) and passes. Reproduce: `/events`, click `Motion`, set
  Classification `Vehicle`, press `Search`; the request carries
  `classification=none`.

## Test matrix

| Test ID | Spec file |
| --- | --- |
| AUTH-001 … AUTH-009 | `tests/e2e/auth.spec.ts` |
| DASH-001 … DASH-005 | `tests/e2e/dashboard.spec.ts` |
| LIVE-001 … LIVE-010 | `tests/e2e/live.spec.ts` |
| PLAY-001 … PLAY-015 | `tests/e2e/playback.spec.ts` |
| EVENT-001 … EVENT-008 | `tests/e2e/events.spec.ts` |
| NOTIF-001 … NOTIF-004 | `tests/e2e/notifications.spec.ts` |
| USER-001 … USER-009 | `tests/e2e/users.spec.ts` |
| SYSTEM-001 … SYSTEM-007 | `tests/e2e/system.spec.ts` |
| SEC-001 … SEC-008 | `tests/e2e/security.spec.ts` |

Support code lives in `tests/e2e/support/`:
`qa-env.ts` (viewport, routes, credentials), `fixtures.ts` (per-test source
address, login/logout, diagnostics), `redact.ts` (secret redaction),
`global-setup.ts` (role storage states, target preflight), `app.ts` (route map,
protected endpoints, camera discovery).

### AUTH-009 — the login regression

AUTH-009 is the guard for the reported cold-start defect: in a fresh Incognito
window one click failed and the URL became `/login?username=…&password=…`, and a
second click worked.

The test disables JavaScript in a fresh context, which reproduces the
pre-hydration window deterministically: the browser performs the form's native
submission with no React handler. It then asserts, in this order:

1. the form declares `method="post"` and `action="/api/auth/login"`;
2. exactly **one** submit occurs;
3. a successful sign-in (the server-rendered Dashboard);
4. no credential in the URL.

Verification of the guard (not part of the suite): serving the pre-fix markup —
a form with no `method` and no `action` — makes the browser issue
`GET /login?username=…&password=…&next=/`, i.e. the test fails as intended.
With the current markup it issues `POST /api/auth/login` and then `GET /`.

## Severity

- **P0** — security, data loss, or the core application is unusable.
- **P1** — a major core workflow is broken.
- **P2** — an important defect.
- **P3** — minor or cosmetic issue.

## AI QA rules

Future AI agents must:

1. Read `docs/AI-QA.md` first.
2. Run the existing Playwright tests before changing code.
3. Reproduce failures.
4. Inspect console/network evidence.
5. Fix root causes.
6. Add regression tests for confirmed bugs.
7. Never modify code merely to make tests green.
8. Never expose credentials.
9. Never modify DVR/MediaMTX unless explicitly instructed.
10. Never modify the production database during browser tests.
11. Clearly distinguish environmental limitations from application defects.
