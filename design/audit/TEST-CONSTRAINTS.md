# TEST CONSTRAINTS — what the redesign must not break

**Auditor:** test-auditor (task-3) · **Date:** 2026-11-04 · **Mode:** READ-ONLY
**Scope:** the current test suites of Home CCTV Hub, read statically so the visual redesign can be planned against them.

- No test file was modified. No application file was modified. **Neither suite was executed** (the Lead runs QA).
- Sources read: all 16 Playwright specs (`tests/e2e/*.spec.ts`, **111 test cases**), all support code
  (`tests/e2e/support/*.ts`), `playwright.config.ts`, `vitest.config.ts`, all 72 Vitest files
  (`src/**/*.test.ts`), plus `docs/AI-QA.md`, `UI-QA-REPORT.md`, `audit/*.md`.
- Where a constraint comes from a *rendered-markup* assertion I say **FAILS**; where a Vitest test only
  asserts local constants (so it cannot fail when a class changes) I say **documents**.

> **How to read this file:** §3–§7 are the contract. §8 is the run recipe. §10 is the checklist to
> work from. Anything labelled **requires test update** means "do not do it — the redesign would need
> an e2e edit, and editing tests is out of scope".
>
> Companion (not a substitute): `design/audit/API-INVENTORY.md` inventories routes/APIs/data; this file
> inventories what the **tests** hold fixed.

---

## 1. Suite shape (facts that bound the redesign)

| | Vitest | Playwright |
|---|---|---|
| Command | `npm test` (`vitest run`) | `npm run test:e2e` (`playwright test`) |
| Files | 72 × `src/**/*.test.ts` | 16 × `tests/e2e/*.spec.ts` + 5 support files |
| Cases | **813** `it()` in 205 `describe()` blocks (pure logic + markup) | **111** `test()` (see §1.1) |
| Environment | **node** (no jsdom, no `@testing-library`). Render assertions use `renderToStaticMarkup` from `react-dom/server` | Chromium only, **exactly 1920×1080**, single worker, `fullyParallel:false`, retries 1 (`QA_RETRIES` overrides) |
| What it sees | markup strings and pure functions only — **no layout, no paint, no browser** | real rendering, geometry (`boundingBox`), `getComputedStyle`, network, console |
| Timeouts | default | test 60 s, expect 10 s, action 15 s, navigation 30 s |

**Consequence:** visual work is "free" only where it stays inside the existing roles/labels and keeps the
measured geometry in §5. Class-token changes can fail Vitest (§5.2) and geometry changes fail Playwright (§5.1).

### 1.1 Case counts (for impact sizing)

| Spec | Cases | Spec | Cases |
|---|---|---|---|
| `playback.spec.ts` | 19 | `faces.spec.ts` | 8 |
| `live.spec.ts` | 10 | `events.spec.ts` | 8 |
| `users.spec.ts` | 9 | `security.spec.ts` | 8 |
| `auth.spec.ts` | 9 | `telegram.spec.ts` | 7 |
| `system.spec.ts` | 7 | `detection.spec.ts` | 5 |
| `dashboard.spec.ts` | 5 | `notifications.spec.ts` | 4 |
| `account.spec.ts` | 4 | `public-assets.spec.ts` | 3 |
| `face-notify.spec.ts` | 3 | `notification-rules.spec.ts` | 2 |
| | | **Total** | **111** |

Currently **10 of 111 skip** in this workspace (§8.2): 8 VIEWER cases + 2 rule-mutation cases.

---

## 2. Route map and protection contract

`tests/e2e/support/app.ts` is the route authority (`ROUTES`). **Renaming or moving any of these breaks QA.**

| URL | Page heading (`h1`) asserted | Notes |
|---|---|---|
| `/login` | — (labels asserted instead) | unauthenticated entry |
| `/` | `Dashboard` | **is** the live view; there is no `/live` route |
| `/cameras` | — | nav label is **`Camera setup`** |
| `/playback` | `CCTV Playback` | deep links: `?camera=1..4&date=YYYY-MM-DD&time=HH:MM[:SS]` |
| `/events` | `Events` | filters are **not** in the URL (known observation, AI-QA) |
| `/events/stats` | — | must stay protected (SEC-003) |
| `/faces` | `Detected Faces` | |
| `/notifications` | `Notification history` | |
| `/device` | — | nav label `Device` |
| `/account` | `Account` | |
| `/settings` | — | must render DVR password mask `********` (SEC-002) |
| `/settings/users` | `Users` | ADMIN only |
| `/settings/notifications` | `Notification rules` | ADMIN only |
| `/settings/detection` | `Object detection` | ADMIN only |
| `/settings/audit-log` | `Audit log` | ADMIN only |
| `/settings/system` | `System` | ADMIN only |

- **SEC-003:** every URL above except `/login`, requested anonymously with `maxRedirects:0`, must answer **HTTP 307** with `Location` **starting with `/login`**. (PUBLIC-003 also accepts 302/307 for `/`, but 307 satisfies both.)
- **ADMIN-only pages** (VIEWER must be redirected to `/`): `/settings/users`, `/settings/notifications`, `/settings/system`, `/settings/audit-log`, `/settings`.
- **Public assets:** `/manifest.webmanifest` (200, `content-type: application/manifest+json`, JSON body with `name`, `start_url:"/"`), `/icon.svg`, `/robots.txt` (200, anonymous). `/manifest.webmanifest.bak` must **not** be public (302/307). `/api/health` must stay the only public API (200); `/api/faces` anonymous = 401.
- **Auth flow:** login posts **to `/api/auth/login` only**; a successful login lands on `/`; logout posts `/api/auth/logout` then `/login`; every credential-free URL invariant is asserted (no `username|password|passwd|pwd` query params).

---

## 3. MUST KEEP — shared shell (present on every screen)

| # | Constraint | Asserted by |
|---|---|---|
| 3.1 | A `banner` landmark containing the text **`Home CCTV`** | DASH-002 |
| 3.2 | `main` landmark visible | DASH-001 |
| 3.3 | **One** accessible `navigation` named **`Primary` per viewport** with links named exactly `Dashboard`, `Camera setup`, `Playback`, `Events`, `Faces`, `Notifications`, `Device`, `Settings` | DASH-002 |
| 3.4 | Active link carries `aria-current="page"` | DASH-002 |
| 3.5 | Mobile/desktop nav duplication is hidden with **`display:none`**, never `opacity`/`visibility`/`sr-only` (a11y-tree role selectors must resolve to one match — see §6.3) | DASH-002, LIVE-007, USER-005 |
| 3.6 | A `button` accessible name exactly **`Log out`** (`.first()`); clicking it ends at `/login` and the session is revoked | DASH-002, fixtures `qa.logout`, AUTH/SEC |
| 3.7 | An `Account` link to `/account` (not asserted as a link name, but `/account` must be reachable in-shell) | ACCT-001 |
| 3.8 | VIEWER session: nav has **no `Settings` link** (`toHaveCount(0)`) | USER-005 |
| 3.9 | No external resources: CSP is `default-src 'self'`, `img-src 'self' data: blob:`, `connect-src 'self'`, no `font-src` override. A web font/CDN image/icon font from another origin is **blocked → console error → every `diag.expectClean()` fails** | next.config.ts + all specs |
| 3.10 | Header status lamp text is **not** asserted (no e2e check of `Connected`/`Offline`/`Checking`); its words may change — only the live-tile determinate-state rule applies (§5.1 LIVE-006) | — |

---

## 4. MUST KEEP — per-screen inventory

Exact strings are copy-paste sensitive (whitespace matters for regexes). `getByRole`/`getByLabel` match is
case-insensitive and whitespace-normalised, substring unless `exact:true`.

### 4.1 Login (`/login`)

| Kind | Exact |
|---|---|
| Label | `Username` (exact), `Password` (exact) |
| Button | `Sign in` (text switches to `Signing in` while pending) |
| Form attrs | `method` matching `/post/i`, `action` **exactly** `/api/auth/login`; hidden field `name="next"`; inputs `name="username"`, `name="password"`; password input `type="password"` |
| Error | `role="alert"` containing `/Authentication failed/i` |
| Behaviour | exactly **one** `POST /api/auth/login` per click; works with **JavaScript disabled** (native form POST → server-rendered Dashboard); never navigates to a query string with credentials |
| Related route text (Vitest reads the source file) | `src/app/api/auth/login/route.ts` must keep `export async function POST`, no `GET`, `application/x-www-form-urlencoded`, `request.formData()`, `response.headers.set("location", path)`, `/login?error=auth` |

### 4.2 Dashboard / live view (`/`)

| Kind | Exact |
|---|---|
| `h1` | `Dashboard` |
| Tiles | one `<article>` per camera (count from `GET /api/cameras`); each has `h2` with the camera's real name |
| Region | `role="region"` name **`Recent security events`** (may not contain extra `<article>` elements) |
| Tile controls | button `Open <camera name> full screen`; overlay text `Full screen`; tile buttons/status text `Start video`, `Retry` (matched by trimmed `textContent`), `[role="status"]` inside the tile |
| No extra articles | `page.locator("article")` count must equal camera count → **no `<article>` anywhere else on `/`** |

### 4.3 Focus mode (same route, camera tile)

| Kind | Exact |
|---|---|
| Entry | button `Open <name> full screen` |
| Container | `article` with `aria-label="<name> focus view"`; must be **≥1900 × ≥1060 px** at 1920×1080 |
| Other tiles | their `h2` and `Open … full screen` button are **hidden** (`display:none`, so the WebRTC session is not torn down) |
| Exit | button `Exit focus view for <name>` (visible text `Exit`); `Escape` also exits |
| Chrome | `navigation` `Primary`, `banner`, `aside` hidden; `document.fullscreenElement === null` (no Fullscreen API) |

### 4.4 Playback (`/playback`) — the most constrained screen

| Kind | Exact |
|---|---|
| `h1` | `CCTV Playback` (compact `PageIntro`) |
| Region | `role="region"` name **`Playback`** = player section |
| Search | button `/Search recordings\|Searching recordings/` |
| Date trigger | the **only** `button[aria-haspopup="dialog"]` on the page; `aria-expanded` `"false"`/`"true"`; `textContent.trim()` **exactly `YYYY-MM-DD`** (icons must stay text-free) |
| Date popover | `role="dialog"` name **`Choose playback date`**; computed `position` **`absolute`**; opening it must change the first `<form>` height by **< 4 px**; contains `Previous month` / `Next month` buttons, a 4-digit year, text `Recording available`; **≥ 28** day buttons whose `aria-label` matches `/— (recording available\|no recording)$/` |
| Day labels | `` `${en-GB long date} — recording available` `` / `` `${…} — no recording` `` (em dash U+2014). e.g. `9 October 2026 — recording available`. Future days and days without recordings carry a real **`disabled`** attribute; clicking an available day closes the popover (`count 0`) and sets the trigger text to that date |
| First form | the filter `<form>` must remain the **first** `<form>` in the document (PLAY-003 measures it) |
| Player controls | buttons `Seek backward 15 seconds`, `/Play\|Pause/`, `Seek forward 15 seconds`, `/Mute\|Unmute/`, `Full screen`; slider `Volume` |
| Video | element with accessible name **`Recording playback`** (exactly one); `object-fit: contain`; element and its `parentElement` stage ratio within 4 % of the decoded source ratio; source is the **704×576 H.264 substream** |
| Timeline region | `role="region"` name **`Timeline`** containing `h2` `Timeline`, in the 1080 px viewport |
| Timeline slider | `role="slider"` aria-label **`Recording timeline. Use the arrow keys to seek.`**, `aria-valuenow`, `aria-valuetext` = `HH:MM:SS`; click and arrow keys seek (value changes) |
| Segments | `span[title]` inside the Timeline region, count > 0 when recordings exist; `title` contains both clock times (`08:00–12:00` style) |
| Event markers | `button` whose `aria-label` **contains the literal lowercase `priority`** (`Person detected, 15:28:25, High priority`, optionally `, N events`) |
| Zoom | `role="group"` name `Timeline scale`, buttons `24h`/`6h`/`1h` with `aria-pressed` |
| Hover preview | `role="tooltip"` name **`/^Preview at /`** (i.e. `aria-label` = `Preview at HH:MM:SS`); when a generated frame exists an inner `role="img"` whose `style` contains **`/api/playback/thumbnail/sprite`**; otherwise caption text plus one of `/Preview generating\|Preview unavailable\|Pause to preview\|No recording/i` |
| Leave page | nav link `Dashboard` (PLAY-016 tears the DVR session down this way) |

### 4.5 Events (`/events`)

| Kind | Exact |
|---|---|
| `h1` / region | `Events`; `role="region"` name **`Event list`** containing `/\\d+ events/` |
| List DOM | items are `<li>` each containing a `<button>` (`li button` first is clickable) |
| Filters | input labelled `Date` (`fill()` — a real input); button `Search`; quick-filter **buttons** `Person`, `Motion`, `All` (exact); selects labelled `Priority` (`HIGH`), `Classification` (`vehicle`), also `Camera` / `Notification state` |
| Query contract | `GET /api/events?…&priority=HIGH`, `…&classification=person`, `…&classification=none`, `…&classification=vehicle` |
| Detail | `role="article"` name **`Event details`**; must contain the words `Camera`, `Time`, `Duration`, `Type`, `Classification`, `Confidence`, **`Notified`**; links `View recording` (→ `/playback?…`) and `Open details` (→ `/events/<id>`); `img[alt^="Snapshot for"]`; fallback text **`Snapshot not available`** |

### 4.6 Detected Faces (`/faces`) and event-detail faces

| Kind | Exact |
|---|---|
| `h1` | `Detected Faces` |
| States | permanently `loading` is a failure; must resolve to **`Face detection is disabled.`** *or* **`No detected faces for this period.`** *or* cards |
| Cards | `<article>` count = faces; contain `Unassigned`, `NN% confidence`, `img src="/api/faces/<id>/image"` (never `data:` or a `face-crops` path), link `View event` → `/events/<eventId>`; card with no crop says **`Face image unavailable`** and has no `<img>`; cards may show the camera name |
| Counters | `/N detected faces/`, `/N snapshot\(s\) queued/`; **no** counter at all when disabled (no `0 detected faces`) |
| Filters | button `/Apply filters\|Loading/`; labels `Camera` (`2`), `Assignment` (`false`), `Minimum confidence` (`0.8`) → query `camera=2&assigned=false&minConfidence=0.8&page=1` |
| Test-notification status | `role="status"` containing `Face test notifications active until`, `12 Oct 2026, 10:00:00`, `cooldown 5 minutes / camera`; absent when expired/disabled |
| Event detail panel | `role="region"` name **`Detected faces`** + `h2` `Face Detection` + `1 face detected` + `Confidence: 72%` + `Unassigned` + crop img; **whole section absent** when API says disabled (and no `faces detected` / `Face Detection` text anywhere) |
| Back link | `Back to events` |

### 4.7 Notification history (`/notifications`)

| Kind | Exact |
|---|---|
| `h1` | `Notification history` |
| Rows | `ul li article` (rows are `<article>` inside `<li>`); each row shows `Sent` or `Failed` |
| Filters | labels `Date`, `Status` (values `sent`, `failed`); button `/Apply filters\|Loading/` |
| Empty | **`No notifications for this period.`** |
| Counters | `/Sent\\s+\\d+/`, `/Suppressed\\s+\\d+/`, `/Failed\\s+\\d+/` — **whitespace-separated, no colon** (`Sent: 5` would fail) |
| Permission control | exactly **one** button `Enable notifications` (it lives in the header); **no** permission request on load; exactly **one** after the click; then `CCTV notifications allowed.` or `Notifications were not allowed.` in `role="status"`; unsupported browsers show `This browser does not support notifications.` |

### 4.8 Notification rules (`/settings/notifications`) + Telegram

| Kind | Exact |
|---|---|
| `h1` | `Notification rules` |
| Editor | button `New rule`; `<form>` containing the text `New rule` / `Edit rule`; input placeholder **`Camera 2 Person Night Alert`**; `role="group"` names **`Camera`** and **`Event`**; checkboxes `All cameras` (checked by default on a new rule), each camera name, `Person`, `Vehicle`, `Motion` |
| Actions | buttons `Save rule`, `Cancel`, per-row `Edit`; notices **`Rule created.`**, **`Rule saved.`** |
| Validation | `role="alert"` **`Select at least one camera.`** / **`Select at least one event.`** |
| Row | rule name + selected camera names + `Person, Vehicle` inside an `<li>` |
| Delete | `role="alertdialog"` (`aria-label="Confirm delete rule"`) — cancel path only |
| Telegram | button `/Send Telegram Test\|Sending/`; `data-testid="telegram-status"` containing `Telegram:`, `Enabled`, `Snapshot: On`, `Video: On (10s, 5s before)`, `FFmpeg: found` / `FFmpeg: not found`; success text **`Telegram test message sent.`**; server refusal text rendered verbatim (e.g. `/Telegram notifications are disabled/`) |
| Privacy | body text must not contain `api.telegram.org`, `bot_token`, or a `NNNNNN:token` pattern; status text likewise |

### 4.9 Object detection (`/settings/detection`)

| Kind | Exact |
|---|---|
| `h1` | `Object detection` |
| `data-testid` | `detection-enabled`, `person-confidence` (value `70`), `vehicle-confidence` (`70`), `base-fps` (`1`), `detection-source` (`ai_only`), `detection-worker-status`, `detection-test-button`, `detection-save`, `camera-1-enabled`…`camera-4-enabled`, `camera-2-person-global`, `camera-2-person-confidence` |
| Status text | `/Running\|Stopped\|Disabled\|Overloaded\|Error\|Not running/` and `YOLOX-Nano` |
| Notices | `/Saved\\. The detection worker/`; `Detection is off.` |
| Behaviour | values survive `page.reload()`; save round-trips through `GET/PUT /api/settings/detection` (shape `{settings, cameras[]}` with `cameraId`) |

### 4.10 Users (`/settings/users`)

`h1` `Users`; first `<ul>` lists every username as exact text and contains `/ADMIN|VIEWER/`; heading
`Create user` + labels `Username`/`Password`/`Role` + button `Create user`; each `ul > li` row has
`Delete` (and `Disable`); delete confirmation is `role="alertdialog"` containing **`cannot be undone`**,
with `Cancel` that dismisses it and issues **no** `DELETE`.

### 4.11 Account (`/account`)

`h1` `Account`; `h2` `Change password`; labels `Current password`, `New password` (exact), `Confirm new
password`; button `Change password`; texts `/Signed-in sessions/`, **`This device`**; error alerts
`Current password is incorrect.` and `/do not match/`; mismatched local validation must make **zero**
`POST /api/auth/password`; body text must not match `/cctv_session|Bearer\\s/`.

### 4.12 Audit log (`/settings/audit-log`)

`h1` `Audit log`; button `Filter`; label `User`; list `<li>` **or** **`No audit entries yet.`**;
transient **`Loading audit log...`**; failure (injected 500) shows **`Unable to load audit log.`** +
`Retry`, and Retry recovers.

### 4.13 System (`/settings/system`)

`h1` `System`; `/Application:/`, `/Active sessions:/`; transient **`Loading system status...`**; failure
(injected 500 on `/api/system/sessions`) shows **`Unable to load system status.`** + `Retry` + recovery.

---

## 5. Layout and geometry contracts

### 5.1 Measured by Playwright (real browser — these fail on pixels)

| Test | Invariant in plain words |
|---|---|
| **PLAY-003** | Calendar is a popover: `position:absolute`, and opening it must not grow the filter form by ≥4 px (no layout displacement, no permanent sidebar). |
| **PLAY-012** | The picture is never stretched or cropped: `object-fit:contain`; the `<video>` box and its parent stage keep the decoded source ratio (704×576 ≈ 1.22:1, tolerance 4 %). A 16:9 box that letterboxes the sub-stream would fail the stage check if the element matches the element ratio but not source. |
| **PLAY-013** | Vertical order on one 1080 px screen: filters form → player region → control row (`Full screen`) → timeline; the timeline ends ≤ 1082 px; `document.documentElement.scrollHeight ≤ innerHeight + 2` (the page itself must not scroll). |
| **PLAY-014** | Gap between the bottom of the control row and the top of the timeline is **≥ 0 and < 120 px** (no dead space, no overlap). |
| **PLAY-015** | Timeline bottom ≤ 1082 px regardless of video sizing. |
| **PLAY-016** | Clicking a recorded fraction of the timeline starts real H.264 sub-stream playback: decoded frames = **704×576**, `currentTime` advances, no `MediaError`; leaving via the `Dashboard` link must unmount the player (`region "Playback"` count 0) so the DVR session is released. |
| **PLAY-017** | A 25-step hover sweep across the timeline triggers **≤ 12** preview requests, all of them `/api/playback/thumbnail/(index\|sprite)`, all < 500; hovering must **never** change the slider's `aria-valuenow`. |
| **PLAY-018** | The preview is per-instant, not one cached frame: two different generated instants produce different sprite style strings; the caption clock is within 90 s of the frame; an instant with nothing generated shows **no** `role="img"` and a caption within 3 min of the pointer. |
| **PLAY-019** | The marker/hover popovers must be out-of-flow: hovering a marker changes neither the slider's `y` nor its `height` by more than 2 px. While crossing a marker (13 pointer moves) the tooltip must never disappear (polled every 16 ms → 0 gaps), the caption must advance with the pointer, ≤ 2 preview requests may occur, and clicking the marker must still seek. |
| **LIVE-003** | Each dashboard tile is > 300 px wide and > 180 px tall at 1920×1080. |
| **LIVE-004** | The video area is the **first `:scope > div` child** of every `<article>`; it is > 120 px tall and the caption remainder is < 120 px (the video must not collapse into a caption strip). |
| **LIVE-007** | Focus mode covers the viewport: `article[aria-label="<name> focus view"]` ≥ 1900×1060; other tiles and the `Primary` nav hidden; **no** Fullscreen API. |
| **LIVE-006** | Every tile reaches a determinate state within 30 s: `video.readyState ≥ 2`, or a non-empty `[role="status"]` inside the tile, or a button whose trimmed text is `Start video` or `Retry`. No infinite spinner. |
| **DASH-003** | `article` count on `/` equals the camera count (no other `<article>` on the dashboard). |

### 5.2 Encoded by Vitest (static markup / pure functions)

**These fail if the rendered class strings or DOM change** — they are the tightest restyling constraints.

`src/components/playback/playback-layout.test.ts` (renders `PlaybackPlayer` and `PageIntro`):

- Player section keeps `flex min-w-0 flex-col md:min-h-0 md:flex-1`, frame keeps `md:aspect-auto`,
  `md:flex-1`, `md:min-h-0` → *the player flexes into the height left by the timeline instead of deriving
  a 16:9 height from its width* (the old bug pushed the timeline off-screen).
- Stage keeps `relative h-full max-h-full w-full max-w-full` + `items-center justify-center` → *the picture
  sits centred in a box that can take the stream's own ratio*.
- `object-contain` present; `object-fill` and `object-cover` absent → *never distort, never crop*.
- Clock keeps `mt-2 font-mono text-base` and must not become `mt-3 font-mono text-lg`; controls row keeps
  exactly `<div class="mt-2">` → *compact vertical rhythm*.
- `PageIntro compact` has no `mb-4` and keeps `text-base font-semibold`; the default variant keeps `mb-4`
  and `text-lg` → *only the playback intro is compact; other pages are unchanged*.

`src/components/playback/playback-timeline.test.ts` (renders `PlaybackTimeline`):

- Gap track keeps `bg-black/50`; segments keep `bg-online`; per-segment hairline `inset -1px 0 0` (exactly
  3 occurrences for 3 segments) and a `<span>` with `title` containing both times → *one element per
  recording, gaps visible, no summarising away*.
- Track height stays `height:20px` → *thin track, not a large block*.
- Legend is derived, not fixed: no `Motion recording`/`Alarm recording`/`Critical event` when absent;
  `Recording` shown when segments exist; no `Grouped` / `Event (high)` implementation words.
- Slider: `role="slider"`, `tabindex="0"`, `aria-valuetext="15:28:00"`; group `aria-label="Timeline scale"`;
  `aria-pressed="true"` / `"false"` on zoom buttons.
- Marker label keeps the shape `Person detected, 15:28:25, High priority` (and `N events` for a group).
- Playhead keeps the token `shadow-[0_0_6px_rgba(62,224,199,0.8)]`; its time label is clamped to
  `left: 0–100 %` → *the label never leaves the track*.

`src/components/playback/playback-calendar.test.ts` (renders `PlaybackCalendar`):

- Keeps React DayPicker modifier classes `rdp-recorded`, `rdp-selected`, `rdp-disabled` (so styling still
  applies); day label phrases `— recording available` / `— no recording`; `aria-label="Previous month"` /
  `"Next month"`; `Checking recordings...` while loading; legend `Recording available` / `No recording`
  always present → *availability is never colour-only*; recorded dates enabled, no-recording and future
  dates really `disabled`.

`src/components/playback/date-picker-field.test.ts` (renders `DatePickerField`):

- Closed state renders **no calendar** (`rdp-app`, `rdp-month` absent), `aria-expanded="false"`,
  `aria-haspopup="dialog"`, a real `<button type="button">`, no `type="date"`, label text `Date`, and keeps
  showing `YYYY-MM-DD` even when availability failed → *the field is one line of chrome, never a column*.

`src/components/auth/login-security.test.ts` (renders `LoginForm` **and reads `src/app/api/auth/login/route.ts`**):

- Form keeps `method="post"`, `action="/api/auth/login"`, hidden `name="next"`, `name="username"`,
  `name="password"` with `type="password"`, no credentials in the action URL; route file keeps the literals
  listed in §4.1. → *a cold, un-hydrated click can never serialise the password into the URL*.

**These only document intent (they assert local constants/self-contained math, so a class change cannot fail
them — but the behaviour is still enforced by the Playwright rows above):**

| File | Invariant in plain words |
|---|---|
| `src/lib/camera-grid-layout.test.ts` | 2×2 grid fits 1920/1440/1366/1280/1024 tall viewports without page scroll; chrome above the grid is 140–180 px; grid height `max(22rem, calc(100dvh - var(--app-grid-chrome)))`; tiles keep a 1.1–2.6 width/height ratio; below `lg` the grid may stack and scroll; the media query must live in CSS (`@media (min-width: 64rem)`), not a Tailwind `lg:` variant on a hand-written utility. |
| `src/lib/camera-focus-mode.test.ts` | Focused tile `fixed inset-0 z-50 …bg-black`; its video area `flex-1 basis-0`; other tiles `hidden` (still mounted → stream continuity); shell header/aside/nav `hidden`; main loses `px-3 pt-4`; z-order 50 > 40 (mobile nav) > 30 (header); grid video area `aspect-video` + `lg:aspect-auto`; explicit exit control name containing `Exit` and the camera name; `Escape` exits; body scroll restored. |
| `src/lib/date-popover.test.ts` | Popover is **340 px** wide with a **12 px** edge gap, shrinks only when the viewport cannot fit it, flips to right-alignment near the right edge, and is clamped so `left ≥ 12` and `left + width ≤ viewport − 12` for every tested width. |
| `src/lib/timeline-density.test.ts` | `msPerPixel`, `groupWindowMs` (group more on a narrow bar), `resolveGroupMs` floor 15 s / ceiling 1 h, `percentOf` clamps 0–100, `clampLabelCenter` keeps a whole label inside; zoom 24 h/6 h/1 h narrows the range and centres the playhead, clamped to the day. |
| `src/lib/timeline-markers.test.ts` | Markers are offsets from the Kolkata day start; events grouped within a 2-minute window (zoom-aware, wider at 24 h), strongest priority kept, classified label preferred, chronological order, `2 events` tooltip text. |
| `src/lib/timeline.test.ts` | Segment → percent geometry (08:15–09:45 = 34.375 % / 6.25 % on a 24 h bar), adjacency (`touch`/`gap`/`overlap`), lane assignment, midnight clipping, 4-hour ticks, hit-testing `recordingAt`. |
| `src/lib/playback-thumbnail.test.ts` | 24 tiles × 30 s per 12-minute sprite sheet; tile position never leaves the sheet; nearest-frame matching with a tolerance and **no fallback to a distant frame** (the "frozen 11:52 image" bug). |
| `src/lib/playback-date.test.ts`, `useRecordingDates.test.ts`, `playback.test.ts`, `notification-permission.test.ts` | Default date is today in Asia/Kolkata; a user-chosen date is kept; closest-day fallback; autoplay newest recording; permission control is hydration-safe (`SERVER_SNAPSHOT === "default"`) so `/login` cannot reload-loop. |
| `src/server/security/client-boundary.test.ts` | Every `.ts/.tsx` under `src/components` and `src/app` must **not** contain `DVR_PASSWORD`, `HIKVISION_PASSWORD`, `APP_PASSWORD`, `SESSION_SECRET`, `rtsp://`, `NEXT_PUBLIC_` (even in a comment) — and `maskSettings().dvrPasswordMask` must stay `********`. |

Non-UI Vitest (routes, stores, auth, workers, HLS, playback server, ops) is unaffected by styling; it only
matters if the redesign changes API shapes (§6).

---

## 6. Runtime and coupling contracts

### 6.1 Clean-diagnostics contract (111 `expectClean()` calls across 15 of the 16 specs)

`diag.expectClean()` fails on **any** of:

1. `page.on("pageerror")` — any uncaught exception;
2. a `console` message of type **error** (this includes React hydration mismatch warnings, which are
   console errors → **a hydration mismatch on any redesigned page fails QA**);
3. a `requestfailed` (except Chromium's `ERR_ABORTED`, which navigation causes);
4. any HTTP response **≥ 400**, unless the status is in the test's allow-list.

Reported allow-lists (nothing else is excused):

| Status | Where it is expected |
|---|---|
| `401` | login/logout specs (AUTH-004/005/006, SEC-005/006) |
| `400` | ACCT-002 (wrong current password) |
| `403` | VIEWER specs (SEC-004, ACCT-004, USER-007/008/009) |
| `500` | SYSTEM-004/007 (fault-injected) |
| `404, 409, 502` | PLAY-017/018/019 (thumbnail endpoints while frames are missing/generating) |
| `409` | TELEGRAM-UI-003 |

Practical implications: no 404 for a missing icon/font/image, no `/api/...` poll returning 4xx on a
redesigned page, no double-fetch that 401s after logout, **no hydration warnings** (server/client markup
must match: no `Date.now()`, `Math.random()`, `window`, or `Notification.permission` in the first render).

### 6.2 API coupling (the tests mock or discover these; changing them breaks specs)

| Contract | Used by |
|---|---|
| `GET /api/cameras` → `{cameras:[{id,name,online,mainChannel,subChannel,mainPath,subPath}], dvr, videoGateway}` — at least one camera; `.length` is the expected tile/article count | every live/dashboard/playback spec |
| `GET /api/playback/recording-dates?camera=&month=YYYY-MM` → `{dates:[YYYY-MM-DD]}` | playback specs + `dvr-mock.ts` route |
| `GET /api/playback/search?camera=&date=&startTime=&endTime=` → `{recordings:[…]}` | playback + mock (`date` query param read) |
| `GET /api/events?camera=&date=&startTime=&endTime=&pageSize=100` (+ `priority`, `classification`) → `{events,…}` | events + playback mock |
| `GET /api/playback/thumbnail/index?camera=&date=&focus=` → `{buckets:[{start,version,frames[]}], progress:{generated}}` | PLAY-018 (reads through `page.request`, so the URL and JSON shape are hard-coded) |
| Thumbnail URLs must stay under **`/api/playback/thumbnail/(index|sprite)`** | PLAY-017 regex |
| `GET /api/dvr/status` → `{dvr,message,videoGateway,media,checkedAt}` | `dvr-mock.ts` (playback offline banner path) |
| `GET /api/auth/session` → 200 `{username,role:"ADMIN"\|"VIEWER"}` when signed in, 401 otherwise | fixtures |
| `GET /api/events/recent?limit=N` → `{events:[{id,timestamp,…}]}` | events/faces/notifications helpers |
| `GET /api/faces` → `{enabled,total,page,pageSize,processing,faces[],testNotifications}`; `GET /api/faces/<id>/image`; `GET /api/events/<id>/faces` → `{enabled,eventId,status,faces[]}` | faces/face-notify fixtures |
| `GET /api/system/health` (loading state), `GET /api/system/sessions`, `GET /api/audit`, `GET /api/users`, `GET /api/settings`, `GET /api/settings/detection` (PUT), `GET /api/notification-rules` (POST/DELETE for RULE-UI), `POST /api/notifications/telegram/test`, `GET /api/notifications/telegram/status`, `POST /api/auth/login`, `POST /api/auth/logout`, `POST /api/auth/password` | various |
| **401** for the 22 protected endpoints in `tests/e2e/support/app.ts§PROTECTED_API`; **403** for the 7 in `§ADMIN_ONLY_API` | SEC-007, SEC-004 |
| Playback deep link `/playback?camera=1..4&date=YYYY-MM-DD&time=HH:MM[:SS]` is produced by `eventPlaybackHref` and consumed by `PlaybackPage` | `src/server/events/v5-timezone-and-input.test.ts` (Vitest) |

### 6.3 DOM-shape assumptions (not roles — raw locators that break quietly)

- `page.locator("article")` count semantics: dashboard tiles, faces cards. Do not introduce `<article>` anywhere else on those routes.
- `playback`: `page.locator("form").first()` = filter form; `button[aria-haspopup="dialog"]` = **unique** Date trigger; `span[title]` = timeline segments; `button[aria-label*="priority"]` = event markers (page-wide!).
- `events`: `li button` = event rows; `img[alt^="Snapshot for"]`.
- `notifications`: `ul li article` = rows.
- `users`: `ul` (first) = user list; `ul > li` = rows; `ul > li:last` = the row used for the delete-confirmation check.
- `system`/`audit log`: `li` count as "has entries".
- Live tiles: `article > div` (first child) = video area; `[role="status"]` inside the tile = determinate message.
- `getByRole` uses the accessibility tree: elements hidden with `display:none` are excluded. Two visible `Primary` navs or two visible `Log out` buttons would break strict-mode resolution — hide the duplicate for real, not visually.

---

## 7. Skips, environment and preconditions

### 7.1 Environment resolution (`tests/e2e/support/qa-env.ts`)

- `QA_BASE_URL` — default `http://localhost:3000`. The hub must already be running; `globalSetup` probes `/login` and aborts with a clear message if it is not.
- `QA_ADMIN_USERNAME` / `QA_ADMIN_PASSWORD` — fall back to the app's own `APP_USERNAME` / `APP_PASSWORD`.
- `QA_VIEWER_USERNAME` / `QA_VIEWER_PASSWORD` — **no fallback**. Missing → 8 cases skip (§7.2).
- Values are read from the real environment, then `.env.qa`, `.env.test`, `.env`. Only the `QA_*` keys are copied; DVR credentials are never loaded.
- Session cookies are created once by `globalSetup` into `tests/e2e/.auth/admin.json` and `viewer.json` (gitignored); per-test `X-Forwarded-For` avoids the 8-logins-per-15-minutes limiter.
- In this workspace there is no `.env.qa` and no `QA_*` key, so: admin login comes from `APP_USERNAME`/`APP_PASSWORD`; **VIEWER specs skip**.

### 7.2 Cases that skip (never treat a skip as a pass)

| Condition | Skipped cases |
|---|---|
| `QA_VIEWER_*` absent | `SEC-004`, `ACCT-004`, `USER-004`…`USER-009` (**8**) |
| `QA_ALLOW_RULE_MUTATIONS` not `1` | `RULE-UI-001`, `RULE-UI-002` (**2**) — these mutate rules and require a disposable `DATA_DIR` |
| DVR/MediaMTX off | No test skips, but some annotate themselves `environment` and assert a determinate UI state instead (PLAY-009/010/016/017/018/019, LIVE-005/006, FACE-UI-001/003/007/008, EVENT-005/006/007). A broken **hub** still fails. |

### 7.3 QA commands (run by the Lead, not by this audit)

```bash
npm run typecheck                     # tsc --noEmit — cheapest gate
npm run lint                          # eslint .
npm test                              # Vitest, node env, 72 files, no browser
npx playwright test                   # all 111 cases; hub must be running
npx playwright test --grep "PLAY-01[345]"      # targeted geometry
npx playwright test tests/e2e/playback.spec.ts # one file
npx playwright test --project=chromium-desktop-1920x1080 --workers=1
npm run test:e2e:report               # open playwright-report/
```

Preconditions: hub up (`npm run dev` or `npm run start`), MediaMTX up for live tiles, real DVR for
PLAY-016 (704×576 H.264 sub-stream), `.env.qa` (or exported `QA_*`) for viewer cases,
`QA_ALLOW_RULE_MUTATIONS=1` + disposable `DATA_DIR` for RULE-UI. Never start/stop servers from QA, never
point the suite at production data for RULE-UI.

**Fastest meaningful gate after the redesign:** `npm run typecheck` → `npm test` (markup tests are the
cheapest way to catch a broken playback/calendar/login layout) → Playwright `playback.spec.ts` +
`live.spec.ts` + `dashboard.spec.ts` + `auth.spec.ts` (these cover most geometry, shell and auth contracts).

---

## 8. Known UI issues — do not regress, and do not "fix" by breaking a test

From `UI-QA-REPORT.md` (2026-10-09) and the read-only audits (`audit/*.md`), with current-code status:

| ID | Issue | Status in the tree today | Redesign note |
|---|---|---|---|
| UI-001 | Mobile bottom-nav labels overlap 320–430 px | fixed-ish (`min-w-0 truncate`, 8 columns) | Do not remove `truncate`/`min-w-0`; do not add a 9th item without checking 320 px. |
| UI-002 | Header status clipped, `Log out` wraps, 320 px horizontal scroll | fixed (`shrink-0`, `whitespace-nowrap`, `truncate`) | Keep `shrink-0` on actions; status lamp is the only thing allowed to compress. |
| UI-003 | Desktop `Log out` ~2900 px down long pages | **fixed** — `aside` is now `md:sticky md:top-0 md:h-dvh` with an internal scroll | Do not revert the sidebar to `position: static`; the fix is not covered by any e2e test, so it can silently regress. |
| UI-004 | Playback error state: no reason, no retry, live-looking controls | guard exists (Retry + `Start video`) | Keep the error path determinate; PLAY-016/019 tolerate the 404/409/502 thumbnail states only. |
| UI-005/006 | Events 0-result message / stale detail panel | open | Not test-covered by e2e; if touched, keep `Event details` article and `li button` rows. |
| UI-010 | Timeline markers 12–14 px and overlapping; individual events unselectable | partially mitigated (marker grouping + zoom-aware windows + `p-2` hit area) | **Fixing this is expected in the redesign.** Keep: markers are `<button>`, `aria-label` contains `priority`, grouping count still exposed, and the PLAY-019 invariants (popover must not shift the timeline, preview must not flicker across a marker). |
| UI-011 | "Live" badge overlaps DVR timestamp | open | Cosmetic; no test pins it. |
| UI-013 | Delete confirmation is a far-away banner; Escape does not dismiss | pattern still inline `role="alertdialog"` | Users spec requires `role="alertdialog"` containing `cannot be undone` + working `Cancel` with no DELETE. |
| UI-014 | Button sizes inconsistent across pages | open | Safe to standardise; control **accessible names** must not change. |
| UI-015 | Notification status colour-only | open | Safe to add badges/icons; keep the words `Sent`/`Failed` (asserted per row). |
| — | Login error not announced (`aria-live`/`aria-invalid`/focus) | partially: `role="alert"` + `tabIndex=-1` now | Safe to improve; keep `role="alert"` with `/Authentication failed/i`. |
| — | Quick-filter precedence quirk (Motion overrides Classification) | open, documented as *not* desired | Tests only exercise the supported path; do not rely on the quirk. |
| — | Events filters not preserved in URL | open observation | Playback deep links *are* URL-based (§2) — do not apply the same "drop the URL" change to `/playback`. |

From `audit/*.md`, non-UI but relevant: no new client module may import server-only secrets
(`client-boundary.test.ts` string scan, §5.2); the CSP allows only same-origin assets; no new XSS/inline-HTML
sink should be introduced (a `dangerouslySetInnerHTML` for an icon sprite is a regression).

---

## 9. Redesign checklist

### 9.1 Safe to restyle (no test knows about it)

- Colours, spacing scale, radii, shadows, gradients, borders, typography sizes/weights (except the four
  exact class tokens listed in §5.2 and the `bg-online`/`bg-black/50`/`20px` track tokens).
- Card/panel surfaces, hover states, focus rings, icon shapes (SVG is text-free), empty-state illustration
  markup, skeleton shapes.
- DOM nesting **inside** an existing named container, as long as the container keeps its role/aria-label and
  the measured geometry (§5.1) survives.
- Reordering content within a screen **only** where §5.1 order is not asserted (e.g. within the events
  filter grid), and adding new non-interactive explanatory copy.
- Adding new visual affordances that do not change accessible names, counts of `article`/`li`/`form`
  locators, or the number of `Primary` navs / `Log out` buttons in the a11y tree.
- Fixing UI-010 marker size/hit area, UI-014 button scale, UI-015 status badges, UI-011 badge placement.

### 9.2 Requires keeping text / labels / roles / testids (must not change)

Every string in §3 and §4, plus: `data-testid` names (§4.9, `telegram-status`), `role` values
(`region/article/dialog/alertdialog/alert/status/tooltip/slider/group/banner/navigation/main`), `aria-label`
values (esp. `Playback`, `Timeline`, `Event list`, `Event details`, `Detected faces`, `Recent security
events`, `Choose playback date`, `Recording playback`, `Recording timeline. Use the arrow keys to seek.`,
`Timeline scale`, `Primary`, `Open <name> full screen`, `Exit focus view for <name>`, `<name> focus view`),
`aria-expanded`, `aria-valuenow/-valuetext`, `aria-current="page"`, `title` on segments, em-dash day labels,
`method`/`action` on the login form, the `********` mask, and the exact request URLs/shapes in §6.2.

### 9.3 Requires a test update — **avoid**

| Change | What breaks |
|---|---|
| Rename a route, nav label (`Camera setup`!), page `h1`, or move a page | DASH-002, all route specs, SEC-003 |
| Add a second visible `Primary` nav / `Log out` button / article on a counted screen | strict-mode violations, DASH-003/LIVE-002/PLAY-019 |
| Change the Date trigger's text away from bare `YYYY-MM-DD`, or make the calendar a fixed/inline panel | PLAY-002/003/007 |
| Replace the calendar with a custom widget that drops `aria-label` day phrases, `Previous month`/`Next month`, or real `disabled` | PLAY-004/005/006, Vitest calendar |
| Change the timeline markup: segments not `span[title]`, markers not `button[aria-label*="priority"]`, slider role/label/`aria-valuenow` | PLAY-008/009/010/016/017/019 |
| Change preview tooltip: not `role="tooltip"` named `Preview at …`, not `role="img"` with sprite `background-image`, or start requesting a new thumbnail URL | PLAY-017/018 |
| Reorder the page so the filter form is not first, or let the popover displace layout | PLAY-003/013/014 |
| Make the video `cover`/`fill`, or give the player a width-derived 16:9 box | PLAY-012/013/015, Vitest layout |
| Change the H.264 substream choice or the video's `aria-label` | PLAY-012/016 |
| Rename `Sent`/`Suppressed`/`Failed` counters to `Sent: N` | NOTIF-002 |
| Turn any current text into an image/canvas (nav labels, status text, confidence counters) | all getByText/getByRole name assertions |
| Change API query param names, thumbnail endpoints, or JSON shapes | §6.2 mocks and helpers |
| Introduce an external font/icon CDN | CSP → console error → every `expectClean()` |
| Any hydration mismatch (time/random/window in initial render) | console error → every `expectClean()`; plus the `/login` reload loop guard |

### 9.4 Highest-risk constraints (ranked for the Lead)

1. **Playback vertical budget** on one 1080 px screen — order filters → player → controls → timeline; gap to
   timeline 0–120 px; timeline bottom ≤ 1082 px; page must not scroll (PLAY-013/014/015). The player must
   flex (`md:flex-1 md:min-h-0`, no 16:9 from width) and the timeline must stay thin (20 px track token).
2. **Playback calendar is a 340 px absolutely-positioned popover** whose trigger text is exactly
   `YYYY-MM-DD` and whose day buttons keep `aria-label "<en-GB date> — recording available|no recording"`
   with real `disabled` (PLAY-003/004/005/006, Vitest calendar + date-picker).
3. **Timeline semantics**: `span[title]` segments, `button[aria-label*="priority"]` markers, slider role +
   exact label + `aria-valuenow`, hover preview `role="tooltip"` named `Preview at …` that never seeks and
   never appears in flow (PLAY-008/009/010/016/017/018/019; Vitest timeline).
4. **Video fidelity**: `object-fit:contain`, stage hugs the 704×576 substream ratio, H.264 substream, no
   `MediaError` (PLAY-012/016; Vitest `object-contain`, absent `object-cover/fill`).
5. **Diagnostics-clean**: no console errors, no hydration warnings, no ≥400 responses outside the
   allow-lists, no failed requests (all specs). Also no credential in URL/console/DOM.
6. **Role/label stability**: `Primary` nav (one per viewport, exact 8 labels, `aria-current`), `banner`
   `Home CCTV`, `Log out`, page `h1`s, `region` names (`Playback`, `Timeline`, `Event list`, `Event
   details`, `Detected faces`, `Recent security events`), focus-mode labels.
7. **Counted locators**: `article` count on `/` and `/faces`; `ul li article` notification rows; `li button`
   event rows; first `<form>` on `/playback`; `li` counts on audit/system/users.
8. **Login form contract**: POST + `/api/auth/login`, hidden `name="next"`, works with JS disabled, exactly
   one submit (AUTH-001/002/006/009, Vitest login-security).
9. **API/query contracts** used by mocks and deep links (§6.2) — especially
   `/api/playback/recording-dates|search|thumbnail/(index|sprite)` and `/api/cameras` shape.
10. **CSP-safe assets only** (same-origin / data / blob) and no forbidden strings in client source
    (`rtsp://`, `*_PASSWORD`, `SESSION_SECRET`, `NEXT_PUBLIC_`).

---

## 10. One-line summary

The redesign may change the **look** freely, but it must keep: the 16 routes and 8 nav labels, every `h1`
and named `region`/`article`, the login POST form, the playback Date popover contract, the timeline
slider/marker/preview semantics and 20 px track token, `object-fit:contain`, the 1080 px playback vertical
budget, the pixel/geometry numbers in §5, every string in §4, the API/query contracts in §6.2, CSP-safe
assets, and a console/network-clean page (§6.1).
