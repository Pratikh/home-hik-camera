# Home CCTV Hub — Route / Component / API / Data-Model Inventory

**Task:** task-1 — read-only audit for the visual redesign.
**Repo:** `/Users/guruswamihiremath/Desktop/projects/home-hik-camera`
**Method:** source inspection only (`read`/`grep`/`glob`, read-only `sqlite3` schema/row counts, line counts). No app code, `.env`, `package.json`, servers, tests or containers were touched.
**App:** Next.js 16 App Router (`next@^16.4.2`, React 19), Tailwind CSS **v4 CSS-first** (no `tailwind.config.*`; tokens live in `src/app/globals.css` `@theme`), Node runtime, `node:sqlite` (`DatabaseSync`), standalone output.
**Snapshot:** 2026-11-04. `data/events.sqlite`: 7,571 events, 10,650 notification-history rows, 348 faces, 2 users, 1 notification rule, 1,737 audit rows.

This document is the contract for the redesign: **Section 7** says what may be restyled, what must be preserved, and **Section 8** lists the concrete risks.

---

## 0. Numbers at a glance

| Thing | Count | Where |
| --- | --- | --- |
| Page routes | **17** (16 under `(hub)` + `/login`) | `src/app` |
| Layouts | 3 (`root`, `(hub)`, `(hub)/settings`) + 2 error boundaries + 1 PWA manifest | `src/app` |
| API route modules | **51**, exposing **59 HTTP handlers** (36 GET, 12 POST, 3 PATCH, 2 PUT, 6 DELETE) | `src/app/api` |
| UI component/hook modules | **42** non-test (36 UI + 6 hooks), plus 6 co-located Vitest tests | `src/components` |
| Shared library modules | **29** non-test, plus 24 Vitest tests | `src/lib` |
| Server modules | **43** non-test, plus 39 Vitest tests | `src/server` |
| `src/app` files | 85 (routes, layouts, pages, APIs, CSS, icons) | `src/app` |
| SQLite tables | 21 (+ `sqlite_sequence`) | `data/events.sqlite` |
| Auth roles | `ADMIN`, `VIEWER` | `src/server/auth/accounts.ts` |
| Design tokens | 10 colours + 2 fonts + 3 chrome heights | `src/app/globals.css` |

Stack facts that constrain the design system: single dark theme (`color-scheme: dark`), no component library, no icon package (inline SVG only), no external fonts/CDN (CSP `default-src 'self'`, `style-src 'self' 'unsafe-inline'`), all times rendered in **Asia/Kolkata** even though the server may be UTC.

---

## 1. Route inventory (`src/app`)

### 1.1 Nesting

```
src/app/layout.tsx            root: <html lang="en"><body class="min-h-dvh overflow-x-hidden bg-bg font-sans text-ink antialiased">
│                             metadata: title "Home CCTV", template "%s · Home CCTV", robots noindex. force-dynamic.
├── src/app/error.tsx         global client error boundary (full-page "Something went wrong" + retry)
├── src/app/not-found.tsx     global 404 (link back to dashboard)
├── src/app/manifest.ts       /manifest.webmanifest — PUBLIC (name/short_name/start_url/colours #080b10)
├── src/app/icon.svg          /icon.svg — PUBLIC (also the manifest icon + `<Mark>` source of truth)
├── src/app/login/page.tsx    standalone; owns its own <main>; NO AppShell
└── src/app/(hub)/layout.tsx  auth guard: !config.appConfigured → redirect /login; !currentSession() → redirect /login
    │                         renders <AppShell> (client: CameraFocusProvider + sidebar/header/nav/SSE notifier)
    ├── page.tsx                        /
    ├── cameras/page.tsx                /cameras
    ├── playback/page.tsx               /playback        (server: parses searchParams)
    ├── events/page.tsx                 /events          (server: passes todayInKolkata())
    ├── events/[id]/page.tsx            /events/<id>     (server: reads EventStore directly)
    ├── events/stats/page.tsx           /events/stats
    ├── faces/page.tsx                  /faces
    ├── notifications/page.tsx          /notifications   (server: passes todayInKolkata())
    ├── device/page.tsx                 /device
    ├── account/page.tsx                /account
    └── settings/layout.tsx             ADMIN guard: !session → /login; role !== ADMIN → redirect /
        ├── settings/page.tsx           /settings
        ├── settings/users/page.tsx     /settings/users
        ├── settings/notifications/page.tsx  /settings/notifications
        ├── settings/detection/page.tsx      /settings/detection
        ├── settings/audit-log/page.tsx      /settings/audit-log   (client page, no component file)
        └── settings/system/page.tsx         /settings/system      (client page, no component file)
```

Request gate: `src/proxy.ts` (Next 16 "proxy" middleware) verifies the signed `cctv_session` cookie for everything except `_next/static`, `_next/image`, `_next/hmr`, `favicon.ico`, `icon.svg`, `manifest.webmanifest`, `robots.txt`, `/login`, `/api/health`, `/api/auth/login`, `/api/auth/logout` (`src/proxy.ts:24-39`). Unauthenticated `/api/*` → JSON 401; other paths → 302 `/login?next=…` (site-local `next` only, `safeNext`).

### 1.2 Page routes

| # | Route | File | Kind | Role | Purpose | Data source |
| --- | --- | --- | --- | --- | --- | --- |
| 1 | `/` | `src/app/(hub)/page.tsx` → `DashboardView` | client view, server shell | any signed-in | 4-camera live grid + inline camera focus mode + "Recent security events" panel | `/api/cameras` (poll 15 s), `/api/streams/*`, `/api/events/recent`, `/api/events/stats` |
| 2 | `/cameras` | `…/cameras/page.tsx` → `CamerasView` | client | any signed-in **page**, ADMIN for the write | Rename channels 1-4 (local override of the DVR channel name), show channel/stream map + online state | `GET /api/cameras`, `PATCH /api/cameras/:id` |
| 3 | `/playback` | `…/playback/page.tsx` → `PlaybackView` | **server page** + big client view | any signed-in | DVR recording search for one camera/day, date popover with availability, player, zoomable timeline with event markers + hover thumbnails | `/api/cameras`, `/api/playback/recording-dates`, `/api/playback/search`, `/api/events`, `/api/playback/session`, thumbnail index/sprite |
| 4 | `/events` | `…/events/page.tsx` → `EventsView` | server `Suspense` + client | any signed-in | Filter/search stored events (quick filters + 7 advanced filters), list + inline detail panel, pagination | `GET /api/events`, `/api/cameras`, snapshot `<img>` |
| 5 | `/events/[id]` | `…/events/[id]/page.tsx` | **server component** | any signed-in | One event: snapshot (+ AI bbox overlay), faces, DVR/detector metadata, "View recording" deep link | `openEventStore()` directly (no fetch), `/api/events/:id/faces`, `/api/faces/:id/image`, POST `/api/events/:id/read` |
| 6 | `/events/stats` | `…/events/stats/page.tsx` → `EventStatsView` | client | any signed-in | Counts for today/yesterday/7 d/30 d + per-camera bar chart | `GET /api/events/stats?range=…`, `/api/cameras` |
| 7 | `/faces` | `…/faces/page.tsx` → `FacesView` | client | any signed-in | Gallery of detected faces (gallery, **not** recognition: every face is "Unassigned"), filters, processing counters, test-notification status | `GET /api/faces`, `/api/faces/:id/image`, `/api/cameras` |
| 8 | `/notifications` | `…/notifications/page.tsx` → `NotificationsView` | server `Suspense` + client | any signed-in | Notification-decision history (sent/suppressed/failed) with day/camera/status/priority filters + per-day counters | `GET /api/notifications`, `/api/cameras` |
| 9 | `/device` | `…/device/page.tsx` → `DeviceView` | client | any signed-in | Read-only DVR identity: model, serial, firmware, encoders, channels, HDDs, device time | `GET /api/dvr/info` (poll 15 s) |
| 10 | `/account` | `…/account/page.tsx` → `AccountView` | client | any signed-in | Own password change (revokes other sessions), own session list, "sign out other/everywhere" | `/api/auth/session`, `/api/auth/sessions`, `POST /api/auth/password` |
| 11 | `/settings` | `…/settings/page.tsx` → `SettingsView` | client | **ADMIN** | Read-only env summary (DVR host/ports/user/masked password, WebRTC host, placeholder flag) + status lamps + links to settings children | `GET /api/settings` (poll 15 s) |
| 12 | `/settings/users` | `…/settings/users/page.tsx` → `UsersView` | client | **ADMIN** | Create users, enable/disable, switch role, reset password, revoke sessions, delete (last-admin protected) | `GET/POST /api/users`, `PATCH/DELETE /api/users/:id`, `DELETE /api/users/:id/sessions` |
| 13 | `/settings/notifications` | `… → NotificationRules` | client | **ADMIN** | Notification-rule CRUD (multi-camera × multi-event selection, priority floor, schedule, days, quiet hours + behaviour, cooldown), retention picker, rule tester, Telegram test + status, enable-browser-notifications | `/api/notification-rules*`, `PUT /api/notification-rules/retention`, `POST /api/notifications/test`, `/api/notifications/telegram/*`, `/api/cameras` |
| 14 | `/settings/detection` | `… → DetectionSettings` | client | **ADMIN** | Live object detection config: master switch, person/vehicle thresholds, per-camera overrides, AI FPS/queue limits, disappearance/min-duration, detection source, worker heartbeat/metrics, on-demand detection test (polls the worker) | `GET/PUT /api/settings/detection`, `POST /api/detection/test`, `GET /api/detection/test/:id`, `/api/cameras` |
| 15 | `/settings/audit-log` | `…/settings/audit-log/page.tsx` (client page) | client | **ADMIN** | Audit rows (sign-ins, account changes), user/action/date filter, pagination | `GET /api/audit` |
| 16 | `/settings/system` | `…/settings/system/page.tsx` (client page) | client | **ADMIN** | Operational health: app/db/DVR/MediaMTX/ingestion flags, warnings, face worker + queue, thumbnail worker, storage, backups, retention, MediaMTX paths/drift, active sessions + per-camera viewers | `GET /api/health`, `GET /api/system/health`, `GET /api/system/sessions` |
| 17 | `/login` | `src/app/login/page.tsx` + `LoginForm` | **server page** | public | Sign in (JSON fetch when hydrated, native form POST fallback). Redirects away if already signed in; rejects `?password=` in URLs; shows config errors | `POST /api/auth/login` |

Notes that matter to a redesign:

* `dynamic = "force-dynamic"` is set on the root layout, `(hub)` layout and most data pages — no static caching to worry about.
* `/events/[id]` and `/playback` are the only screens that read the DVR/database **on the server**; everything else is a client page fetching JSON.
* `/events/stats`, `/settings/audit-log`, `/settings/system` have no dedicated component file (JSX lives in the page). There is no `/live`, `/settings/telegram`, `/notifications/rules` route — the live view *is* `/` and rules live under `/settings/notifications`.
* The sidebar/footer nav is 8 items (`src/components/layout/AppShell.tsx:23-33`); `Settings` is filtered out for non-admins (`:139`). The mobile bottom bar is `grid-cols-8` (`:228`) even though a VIEWER sees 7 items.

### 1.3 Role matrix (what a VIEWER can and cannot do)

| Capability | VIEWER | ADMIN | Enforced by |
| --- | --- | --- | --- |
| Live view, focus mode, playback, events, stats, faces, notifications, device, account | ✅ | ✅ | `(hub)/layout.tsx` |
| See `/settings`, `/settings/*` | ❌ redirect `/` | ✅ | `settings/layout.tsx:4-8` |
| See `/cameras` page | ✅ (page renders) | ✅ | hub layout only |
| Save a camera name (`PATCH /api/cameras/:id`) | ❌ **403 in UI** | ✅ | `requireAdmin` (`src/app/api/cameras/[id]/route.ts:13`) — **page/API mismatch, see risk R5** |
| Read `/api/settings`, detection settings, audit, system health, users, rules | ❌ 403 | ✅ | `requireAdmin` |
| Create/edit/delete notification rules, run rule tester, Telegram test | ❌ 403 | ✅ | `requireAdmin` |
| Enable *browser* notification permission | ✅ | ✅ | client-only (`NotificationPermissionButton`) |
| Change own password / revoke own sessions | ✅ | ✅ | `requireUser` (`/api/auth/password`, `/api/auth/sessions`) |
| Mark an event read | ✅ | ✅ | `requireUser` |
| Trigger object-detection test | ❌ 403 | ✅ | `requireAdmin` |

Public surface: `GET /api/health`, `POST /api/auth/login`, `POST /api/auth/logout`, `/login`, `/manifest.webmanifest`, `/icon.svg`, `/favicon.ico`, `/robots.txt`.

---

## 2. Component inventory (`src/components`)

42 non-test modules (36 UI components + 6 hooks; plus 6 co-located Vitest test files). All are `"use client"` except `Mark.tsx`, `PriorityBadge.tsx` and imports from `src/lib`. There is no state library: local `useState` + `fetch` + one React context (camera focus).

### 2.1 Shared primitives (`src/components/ui`)

| Module | Exports | Renders | Used by |
| --- | --- | --- | --- |
| `States.tsx` | `MessagePanel` | black full-bleed panel with centred message (`role="status"`) | LivePlayer, CameraTile |
| | `FrameSkeleton` | `animate-pulse bg-[#151b24]` frame placeholder | LivePlayer, PlaybackPlayer, DashboardView |
| | `ErrorBanner` | bordered card + optional "Try again" | DashboardView, CamerasView, DeviceView, SettingsView |
| | `PageIntro` | `<h1>` + muted detail; `compact` variant for viewport-fit pages | 16 call sites (every screen except login/error/404) |
| `StatusLamp.tsx` | `StatusLamp` | dot + label; `compact` maps long DVR labels to short ones for the mobile header and keeps the full label for AT | AppShell, CameraTile, CamerasView, DeviceView, SettingsView (9 usages) |
| `Mark.tsx` | `Mark` | the app logo SVG (4 rounded squares), **hard-coded hex colours** `#171e28/#3ee0c7/#8ef0e2` | AppShell, login page |

### 2.2 Composition per screen

| Screen | Components (render tree) |
| --- | --- |
| App shell (all hub pages) | `AppShell` → `CameraFocusProvider` → `AppShellInner`: `<aside>` logo+nav+Account+Logout, `<header>` logo/`StatusLamp`/`Clock`/`NotificationPermissionButton`/mobile Account+Logout, `<EventNotifier/>` (SSE), `<main>`, mobile bottom nav. Renders `hidden` chrome while a camera is focused (`useCameraFocus`) |
| `/` Dashboard | `DashboardView` → 4 × `CameraTile` → `LivePlayer` (+ `MessagePanel`/`FrameSkeleton`), `RecentEvents` → `PriorityBadge`; focus overlay uses the same `CameraTile` (same LivePlayer instance) |
| `/cameras` | `CamerasView` → per-camera `<article>` card: labelled input + Save + "Use DVR name", `StatusLamp`, `<dl>` channel/main/sub/stream |
| `/playback` | `PlaybackView` → `PlaybackFilters` → `DatePickerField` → `PlaybackCalendar` (react-day-picker, custom `classNames` + `labels`), `PlaybackPlayer` → `PlaybackControls`, `PlaybackTimeline` → `TimelineHoverPreview` + `MarkerTooltip` + `Legend`, hooks `useRecordingDates`, `useTimelineThumbnails`, `useElementWidth`, `useHoverCapable` |
| `/events` | `EventsView` → quick-filter pill group, 7-field filter form, event list buttons (`PriorityBadge`), `EventDetail` (snapshot `<img>`, `<dl>`, links), duplicated pagination |
| `/events/[id]` | server page → `PageIntro`, `MarkReadOnView`, `PriorityBadge`, `SnapshotPanel` (bbox overlay), `EventFacesPanel` (crop `<img>`s), `<dl>` metadata, 3 link-buttons |
| `/events/stats` | `EventStatsView` → range segmented buttons, `Metric` tiles, per-camera bars |
| `/faces` | `FacesView` → filter form, counters, test-mode line, `FaceCard` grid (crop `<img>`, "Unassigned", confidence, time, "View event"), pagination |
| `/notifications` | `NotificationsView` → 4-field filter form, per-day stats line, `NotificationRow` (local `StatusBadge` pill + `PriorityBadge`), pagination |
| `/device` | `DeviceView` → `StatusLamp` card, 11-row `<dl>` grid |
| `/account` | `AccountView` → who-am-I line, change-password form, session list + revoke buttons |
| `/settings` | `SettingsView` → 3 × `StatusLamp`, 7-row `<dl>`, text-link sub-nav |
| `/settings/users` | `UsersView` → user rows with 6 inline actions, inline reset-password form (`useEscapeToDismiss`), inline delete confirm (`role="alertdialog"`), create-user form |
| `/settings/notifications` | `NotificationRules` → toolbar (enable notifications / New rule / `TelegramTestButton`), rule list, inline delete confirm, `RuleForm` (checkboxes, weekday pills, times, cooldown), retention card, `RuleTester` |
| `/settings/detection` | `DetectionSettings` → local `Section`/`Toggle`/`NumberField`/`ConfidenceField` primitives, worker status panel, per-camera blocks, FPS selects, diagnostics test, sticky save bar (`fixed inset-x-0 bottom-0`) |
| `/settings/audit-log` | client page → filter form, log list, pagination |
| `/settings/system` | client page → warning banners, `dl` summary, four `<section>` cards (face/thumbnail/storage+backup/retention+MediaMTX), sessions section |
| `/login` | server page → `Mark`, config-error list **or** `LoginForm` (autofocus error, native POST fallback) |

### 2.3 Duplicated patterns (design-system opportunity)

Quantified with `grep` over `src/components` + `src/app`:

| Pattern | Duplication | Where |
| --- | --- | --- |
| Card surface `rounded-xl border border-line bg-card` | **20 files** | every screen; the single most repeated visual |
| Primary button `bg-teal px-4 text-sm font-semibold` + on-teal text | **16 sites**; on-teal text is `text-[#08110f]` in 13 places and `text-black` in 4 (`LoginForm`, `error.tsx`) | EventsView, PlaybackFilters, CamerasView, NotificationRules, UsersView, AccountView, DetectionSettings, audit-log, login |
| Form control `h-11 w-full rounded-lg border border-line bg-card px-3` | **19 sites** | filter bars (events/notifications/faces/playback) |
| Form control `border border-line bg-bg px-3` (inside cards) | **29 variants** | rule form, users, account, detection, cameras |
| Pagination block (Previous / "Page X of Y" / Next) | **4 near-identical copies** | `EventsView.tsx:327-333`, `NotificationsView.tsx:131-137`, `FacesView.tsx:219-241`, `settings/audit-log/page.tsx:93-99` |
| Filter form grid `grid gap-3 sm:grid-cols-2 xl:grid-cols-4` | 2 exact + 2 variants (`xl:grid-cols-5`, custom `PlaybackFilters`) | events, notifications, faces, playback |
| Warning text `text-sm text-warn` + ad-hoc Retry button | **14 sites**, three different Retry button paddings | system, audit, faces, detection, events, rules |
| Loading state | 3 idioms: `FrameSkeleton`, `<p className="text-sm text-muted">Loading…</p>`, disabled-button label ("Searching…", "Saving…", "Loading…") | everywhere |
| Empty state | ≥6 phrasings, some from `Messages`, some inline ("No audit entries yet.", "No status available.", "Select an event.") | everywhere |
| Badges | `PriorityBadge` (shared) but **two more** local pills: `StatusBadge` in `NotificationsView.tsx:153` and plain coloured `<span>`s for Enabled/Disabled (`UsersView`, `NotificationRules`, `DetectionSettings` `STATUS_TONE`) | events/notifications/users/rules/detection |
| Status colour mapping | `StatusLamp` tone logic re-implemented in `DashboardView.tileMessage`, `CamerasView` inline ternaries, `DetectionSettings.STATUS_TONE`, `FaceCard` text | 5+ places |
| Camera-name fetching | shared `useCameraNames` (module-scope cache) **plus 4 hand-rolled `/api/cameras` fetches + local `name()` helpers** | `EventsView:57`, `NotificationsView:25`, `EventStatsView:24`, `FacesView:43` |
| Inline authenticated images | 4 `<img>` with `eslint-disable @next/next/no-img-element` — **cannot** become `next/image` (optimizer fetches without the session cookie) | SnapshotPanel, EventsView, EventFacesPanel, FaceCard |
| Destructive confirm | inline card + Cancel/Delete, `useEscapeToDismiss`, `role="alertdialog"`; duplicated in `UsersView:163` and `NotificationRules:268` | users, rules |
| Relative time formatting | one-off `relativeTime()` in `RecentEvents` | dashboard only |

Design-system implication: a `Card`, `Button` (primary/secondary/danger/ghost), `Field`/`Input`/`Select`, `Badge` (priority/status/role), `Pagination`, `EmptyState`, `ErrorState`, `Skeleton`, `ConfirmInline` set would remove most of the duplication above without touching behaviour.

### 2.4 Dead / unused UI and stale docs

| Item | Evidence | Recommendation |
| --- | --- | --- |
| `/api/playback/download` returns **501 forever**; `downloadAvailable:false` in the search response is never rendered; `Messages.downloadUnavailable` has no UI consumer | `src/app/api/playback/download/route.ts:8-12`, `src/lib/recording.ts:102-105` | keep endpoint, do not design a download button; if a download affordance is designed it must be a "not available" state |
| `camN_main` **main streams are never played** by the UI: `CameraTile` always passes `camera.subPath` (also in focus mode). Main path/channel are only *displayed* on `/cameras`. `README.md` ("Full screen uses the main stream") is **stale** | `CameraTile.tsx:70`, `DashboardView.tsx:74` | do not build a "main stream" toggle expecting existing support; `/api/streams/camN_main` would work but was never exercised |
| `pb1…pb4` MediaMTX playback paths in `describePlaybackPath` are unreachable: `playbackPath()` hard-codes `"playback"` | `channels.ts:36-62` | no UI dependency; leave alone |
| Unused exports: `shouldSurfaceOnDashboard` (`rule-engine.ts:152`), `priorityRankOf` (`event-store.ts:1240`), test-only cache resets (`resetCameraNameCache`, `clearAvailabilityCache`) | grep shows 0 non-test callers | ignore |
| Unused message keys: `noRecordingAtTime`, `previewBusy`, `previewLoading`, `facesDetected`, `notificationsDefault` | `src/lib/messages.ts` | do not surface |
| `people` + `person_face_references` tables exist, 0 rows — face recognition is explicitly out of scope; every face is "Unassigned" by design | `src/lib/faces.ts:6-16` | never design "known person" affordances |
| `event_ai_results` table written only when `AI_ENABLED=true`; there is no screen for AI results | `event-processor.ts:130-142` | do not design an AI-results surface |
| Page `src/app/(hub)/settings/system/page.tsx` uses plain `<div>` grids (`Application: ok`) instead of the `dl` card pattern used elsewhere | `:109-117` | prime redesign candidate (no behaviour to preserve beyond text) |

---

## 3. API inventory (`src/app/api`)

### 3.1 Conventions

* Every handler: `export const dynamic = "force-dynamic"; export const runtime = "nodejs"` (SSE/streaming proxied through Node).
* Auth is centralised: `requireUser()` → 401 `{error:"Authentication failed"}` (500 `{error}` if the app config is invalid) and `requireAdmin()` → 403 `{error:"Authentication failed"}` (`src/server/http/require-user.ts`). The middleware already 401s unauthenticated `/api/*`.
* Errors are always `{ "error": string }`; success is a plain JSON object or `204`.
* Client wrapper `api<T>()` sends `credentials:"same-origin"`, `cache:"no-store"`, and on **401 redirects to `/login`** (`src/lib/client-api.ts:16-31`). A 403 therefore stays on the page — which is how the `/cameras` VIEWER mismatch surfaces.
* No CSRF token: same-origin cookie + `SameSite=Lax` + JSON content type is the model. Do not add cross-origin fetches in a redesign.
* ID formats validated server-side: event `evt_[a-f0-9]{24}`, face `face_[a-f0-9]{24}`, rule `rule-*`, detection test `odt_[a-f0-9]{16}`, camera `1-4`, date `YYYY-MM-DD`, clock `HH:MM`.

### 3.2 Endpoint table

Roles: **U** = any signed-in user, **A** = ADMIN only, **P** = public.
Consumers are the screens from §1.2. Response types are in `src/lib/api-types.ts` unless noted.

#### Auth & account

| Method | Path | Role | Input | Response | Consumers |
| --- | --- | --- | --- | --- | --- |
| POST | `/api/auth/login` | P | JSON `{username,password,next}` **or** form-encoded (native submit) | `{ok:true,redirect,role}` + `Set-Cookie cctv_session`; 303 + relative `Location` for form posts; 401/429/500 `{error}`; redirects carry only reason codes `?error=auth\|rate\|config` | `/login` |
| POST | `/api/auth/logout` | P | – | `{ok:true}` + cookie cleared; writes `LOGOUT` audit | AppShell |
| GET | `/api/auth/session` | U | – | `{username, role}` | AppShell (nav gating), AccountView |
| GET | `/api/auth/sessions` | U | – | `{sessions:[{id,createdAt,lastSeenAt,expiresAt,ipAddress,userAgent,current}]}` | AccountView |
| DELETE | `/api/auth/sessions` | U | `{scope:"others"\|"all"}` | `{ok,revoked}`; clears cookie when `all`; rate-limited 20/15 min | AccountView |
| POST | `/api/auth/password` | U | `{currentPassword,newPassword}` | `{ok, sessionsRevoked}` (+ fresh cookie) or `{ok:true,message}` if re-signing failed; 400 on wrong current password (deliberately **not** 401); rate-limited 5/15 min | AccountView |

#### Users (admin)

| Method | Path | Role | Input | Response | Consumers |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/users` | A | – | `{users:[{id,username,role,enabled,createdAt,updatedAt,lastLoginAt}]}` (never `passwordHash`) | UsersView |
| POST | `/api/users` | A | `{username,password,role}` | 201 `{user}`; 400 policy; 409 duplicate; rate-limited 20/15 min | UsersView |
| PATCH | `/api/users/:id` | A | any of `{enabled,role,password}` | `{ok:true}`; 404; 409 `last_admin`; password/enable revokes that user's sessions | UsersView |
| DELETE | `/api/users/:id` | A | – | **204**; 404; 409 `last_admin`; also deletes sessions + presence | UsersView |
| DELETE | `/api/users/:id/sessions` | A | – | `{ok,revoked}`; clears cookie if revoking yourself | UsersView |

#### Audit / system (admin)

| Method | Path | Role | Input | Response | Consumers |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/audit` | A | `?user&action&date&page&pageSize≤100` | `{logs:[{id,username,action,resource,createdAt}], total, page, pageSize}` | `/settings/audit-log` |
| GET | `/api/system/health` | A | – | `SystemHealthBody` (application, database{events,users}, dvr, mediamtx{status,reachable,drift,message,paths[]}, events{ingestion,lastPoll,lastError}, faceDetection{enabled,worker,queue…}, thumbnails, storage, backups, retention, sessions, warnings[]) | `/settings/system` |
| GET | `/api/system/sessions` | A | – | `{activeSessions, liveViewers, sessions:[{id,username,role,lastSeenAt}], cameras:[{id,path,appViewers,mediamtxReaders}]}` | `/settings/system` |
| GET | `/api/health` | **P** | – | `{application:"ok"\|"misconfigured", dvr, videoGateway, database, mediamtx, events}`; HTTP 200 or 503 | `/settings/system`, ops probes; deliberately no credentials |

#### Cameras / DVR / device

| Method | Path | Role | Input | Response | Consumers |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/cameras` | U | – | `{dvr, dvrMessage, videoGateway, cameras:[{id,name,online,mainChannel,subChannel,mainPath,subPath}]}` | Dashboard, Cameras, Playback, Events, Stats, Faces, Notifications, prediction hooks |
| PATCH | `/api/cameras/:id` | **A** | `{name}` or `{useDvrName:true}` | `{id,name}`; 400 invalid name; 404 bad id | CamerasView |
| GET | `/api/dvr/status` | U | – | `{dvr, message, videoGateway, media:{reachable,drift,message,paths[{path,cameraId,kind,ready,tracks,bytesReceived}]}, checkedAt}` | AppShell header lamp (poll 15 s — **every** hub page) |
| GET | `/api/dvr/info` | U | – | `{dvr, message, videoGateway, device:{name,model,serialNumber,firmware,encodingVersion,hardwareVersion,webVersion,pluginVersion,channelCount,hddCount,currentDeviceTime}\|null, checkedAt}` | DeviceView |

#### Events

| Method | Path | Role | Input | Response | Consumers |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/events` | U | `?camera&type&classification(person\|vehicle\|none)&date&startTime&endTime&page&pageSize≤100&important&notified&read&priority` (Kolkata day bounds; any invalid value → 400) | `EventListResponse {events:CctvEvent[], total, page, pageSize}` | EventsView, PlaybackView (markers, `pageSize=100`) |
| GET | `/api/events/:id` | U | – | `{event}`; 404 for bad/unknown id | (available; detail page reads the store directly) |
| POST | `/api/events/:id/read` | U | `{read?:boolean}` (default true) | `{event}` | MarkReadOnView |
| GET | `/api/events/:id/snapshot` | U | – | `image/jpeg` bytes, `Cache-Control: private, no-store`; 404 `{error}` | EventsView, SnapshotPanel `<img>` |
| GET | `/api/events/:id/faces` | U | – | `{enabled, eventId, status:"PENDING"\|"PROCESSING"\|"COMPLETED"\|"FAILED"\|"NONE", faces:[{id,eventId,personId,confidence,x,y,width,height,hasCrop}]}`; `enabled:false` when the feature flag is off | EventFacesPanel |
| GET | `/api/events/recent` | U | `?limit≤20&important=true` | `{events:CctvEvent[]}` (important = priority HIGH/CRITICAL, indexed) | RecentEvents |
| GET | `/api/events/stats` | U | `?range=today\|yesterday\|7d\|30d` or legacy `?date=` | `EventStatsResponse = {date,total,person,vehicle,motion,critical,high,cameras[{cameraId,total}]} + {range,start,end,days}` | RecentEvents, EventStatsView |
| GET | `/api/events/health` | U | – | `{ingestion:"running"\|"stopped", lastPoll, lastError, stored, aiEnabled}` | (diagnostic; no screen) |
| GET | `/api/events/stream` | U | – | **SSE**: first frame `event: status` + `{running}`; then `data: {"notify":boolean,"event":{…cameraName},"face"?:{eventId,cameraId,cameraName,faces,maxConfidence}}`; `: ping` every 20 s | AppShell `EventNotifier` (global) |

#### Notifications & rules

| Method | Path | Role | Input | Response | Consumers |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/notifications` | U | `?date&startTime&endTime&camera&status(sent\|suppressed\|failed)&priority&page&pageSize≤100` | `{notifications:NotificationRecord[], total, page, pageSize, date, stats:{sent,suppressed,failed}}` | NotificationsView |
| GET | `/api/notifications/stats` | U | `?range` | `{range,start,end,days,sent,suppressed,failed}` | (no screen currently) |
| GET | `/api/notification-rules` | **A** | – | `{rules:NotificationRule[], retentionDays}` | NotificationRules |
| POST | `/api/notification-rules` | **A** | full rule body (id ignored, server generates `rule-<uuid>`) | 201 `{rule}`; 400 invalid | NotificationRules |
| PUT/PATCH | `/api/notification-rules/:id` | **A** | partial rule (merge with existing; **dropping legacy fields when arrays absent**) | `{rule}`; 404; 400 | NotificationRules (PUT save, PATCH enable toggle) |
| PUT/PATCH | `/api/notification-rules/retention` | **A** | `{retentionDays:"0\|7\|14\|30\|60\|90"}` | `{retentionDays}`; 400 | NotificationRules retention picker (**special-case id, not a rule**) |
| DELETE | `/api/notification-rules/:id` | **A** | – | **204**; 404 | NotificationRules |
| POST | `/api/notifications/test` | **A** | `{cameraId, type, classification, time?, date?, priority?}` | `{evaluatedAt, matched, priority, notify, message, decisions:[{ruleId,ruleName,notify,reason}], ruleCount}` — dry run, writes nothing | RuleTester |
| GET | `/api/notifications/telegram/status` | **A** | – | `TelegramMediaStatusResponse` (booleans + durations + ffmpeg availability; never token/chat id) | TelegramTestButton |
| POST | `/api/notifications/telegram/test` | **A** | body ignored | `{ok:true,message}` or `{ok:false,reason,error}` (503/409/502) | TelegramTestButton |

#### Faces

| Method | Path | Role | Input | Response | Consumers |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/faces` | U | `?camera&date&assigned(true\|false)&minConfidence&eventId&page&pageSize≤60` | `{enabled, faces:[DetectedFace + cameraId/eventTimestamp/eventType/eventClassification], total, page, pageSize, processing:{pending,processing,completed,failed}, testNotifications:{enabled,active,until,cooldownSeconds,reason}}`; **200 with `enabled:false`** and empty list when the feature is off | FacesView |
| GET | `/api/faces/:id` | U | – | `{face}`; 404 bad id / disabled feature / unknown | (available; no screen) |
| GET | `/api/faces/:id/image` | U | – | `image/jpeg`, `private, no-store`; 404 | FaceCard, EventFacesPanel |

#### Playback, streaming, detection

| Method | Path | Role | Input | Response | Consumers |
| --- | --- | --- | --- | --- | --- |
| GET | `/api/playback/search` | U | `?camera&date&startTime&endTime` (validated) | `PlaybackSearchResponse {camera,cameraName,date,startTime,endTime,recordings:[{id,camera,startTime,endTime,type,label}], downloadAvailable:false, downloadMessage}`; 400/409/502/503 with typed failure messages | PlaybackView |
| GET | `/api/playback/recording-dates` | U | `?camera&month=YYYY-MM` | `{camera, month, dates:string[], source:"dvr"\|"mock"}`; failure is 409/502/503 (never "empty month") | `useRecordingDates` → DatePickerField/PlaybackCalendar |
| POST | `/api/playback/session` | U | `{camera, startTime, endTime, token}` (ISO with offset; span clamped to 8 h) | `PlaybackSessionResponse {path:"playback", mode, message, whepUrl, hlsUrl, startTime, endTime}`; 400/409/502/503 | PlaybackPlayer |
| DELETE | `/api/playback/session` | U | `?camera&token` | **204** (closes the MediaMTX playback source) | PlaybackPlayer cleanup |
| GET | `/api/playback/download` | U | – | **501** `{error:"Download is not available for this recording."}` | none |
| GET | `/api/playback/thumbnail/index` | U | `?camera&date&focus=epochMs` | `ThumbnailIndex {camera,date,interval,tile{width,height,cols,rows},buckets:[{start,frames[],version}],progress:{generated,expected,generating}}`; `private, no-store`; reports focus so the generator prioritises it | `useTimelineThumbnails` (poll 6 s while generating) |
| GET | `/api/playback/thumbnail/sprite` | U | `?camera&date&start&v=version` | `image/jpeg` sprite sheet, `private, max-age=31536000, immutable` + ETag/304; 400/404 | `useTimelineThumbnails` → `TimelineHoverPreview` |
| GET | `/api/streams/:path` | U | path ∈ `cam1_sub…cam4_sub`, `cam1_main…cam4_main` | `StreamResponse {path, channel, mode:"webrtc"\|"hls"\|"placeholder"\|"unavailable", message, whepUrl, hlsUrl}` — mode decided server-side from DVR/gateway state **and the request Host** | LivePlayer |
| POST | `/api/streams/presence` | U | `{path}` | `{ok:true}`; records a 30 s presence heartbeat (feeds `/api/system/sessions` live-viewer counts) | LivePlayer (every 20 s while active) |
| POST | `/api/webrtc/:path/whep` | U | raw SDP offer body ≤1 MB | SDP answer + `Location: /api/webrtc/:path/session/:id` (rewritten to same-origin); 400/404/502/503 | LivePlayer `startWhep`, PlaybackPlayer |
| DELETE | `/api/webrtc/:path/session/:id` | U | – | **204**; best-effort upstream close | LivePlayer/PlaybackPlayer cleanup (`keepalive`) |
| GET | `/api/hls/:path/[[...asset]]` | U | any asset (`index.m3u8` default) | HLS playlist (rewritten to hub-relative URLs) or segment bytes; `no-store`; rejects `..`, `\`, `/`; caps playlist 1 MB / segment 20 MB | LivePlayer/PlaybackPlayer (hls.js or native) |
| GET | `/api/settings` | **A** | – | `SettingsResponse {dvrHost,dvrHttpPort,dvrRtspPort,dvrUsername,dvrPasswordMask:"********",webrtcAdditionalHost,videoDevPlaceholder,backend:"Connected",dvr,dvrMessage,videoGateway}` | SettingsView |
| GET | `/api/settings/detection` | **A** | – | `DetectionSettingsResponse {settings, cameras[], worker, workerFresh, model{name,version,license,file,inputSize,sizeMb,rawClasses}, detectionSources[]}` | DetectionSettings |
| PUT | `/api/settings/detection` | **A** | `{settings, cameras[]}` (validated; ≤32 KB) | same as GET; 400 with `errors[]`; 413 | DetectionSettings |
| GET | `/api/detection/status` | U | – | `DetectionStatusResponse {enabled, monitoredCameras, personConfidence, vehicleConfidence, worker, workerFresh, model}` | (available; no screen consumes it — README/ops) |
| POST | `/api/detection/test` | **A** | `{eventId?}` (defaults to newest snapshot event) | 202 `{id:"odt_…", eventId, status:"pending"}`; 404 when no snapshot; queues a durable worker job | DetectionSettings |
| GET | `/api/detection/test/:id` | **A** | – | `DetectionTestResponse {id,eventId,cameraId,status,result,createdAt,updatedAt}`; polled 1 s × 20 | DetectionSettings |

Request/response shapes for every shared type are in `src/lib/api-types.ts` (316 lines) — treat that file as the machine-readable schema.

---

## 4. Data models (`data/events.sqlite`)

### 4.1 Database facts

* One SQLite file for **everything**: events, rules, history, users, sessions, audit, faces, detection settings, presence, worker heartbeats. Shared by the Next server, the local **face worker** and the **object worker** (separate processes).
* Opened by `openEventStore()` (`src/server/events/event-store.ts:1739-1765`): `journal_mode=WAL`, `busy_timeout=5000`, `foreign_keys=ON`, `synchronous=NORMAL`, `journal_size_limit=64 MB`, `wal_autocheckpoint=1000`. Store instances are cached per `dataDir`.
* Schema is created idempotently (`SCHEMA` const, `:105-430`) and migrated additively on every boot by `migrate()` (`:616-708`): `ALTER TABLE … ADD COLUMN` only when missing; one-time backfills are guarded by `app_settings` markers (`v5_priority_backfilled`, `v5_rule_names_backfilled`).
* Storage layout beside it: `data/cameras.json` (name overrides), `data/face-crops/`, `data/events/` (snapshots), `data/thumbnails/`, `data/telegram-clips/`, `data/backup-status.json`.

### 4.2 Tables (21)

| Table | Purpose | Key fields | Rows (now) |
| --- | --- | --- | --- |
| `events` | one row per stored detection/event | `id` (`evt_…`), `dedupe_key UNIQUE`, `camera_id`, `type`, `classification`, `timestamp` (Kolkata ISO), `end_timestamp`, `confidence`, `snapshot_path`, `recording_start/end`, `source` (`hikvision`\|`object-detection-worker`), `metadata` JSON, `priority`, `notified`, `read_at` | 7,571 |
| `notification_rules` | rule engine input (admin-managed) | `id` (`rule-…`), `name`, `enabled`, **legacy** `camera_id`/`event_type`/`classification`, **arrays** `camera_ids`/`event_types` (JSON text), `minimum_priority`, `schedule_start/end`, `days_of_week` (csv), `quiet_hours_start/end`, `quiet_hours_behavior`, `cooldown_seconds` | 1 |
| `notification_history` | every rule decision | `id`, `event_id`, `rule_id`, `rule_name`, `camera_id`, `priority`, `status` (`sent`\|`suppressed`\|`failed`), `reason`, `created_at`, `event_timestamp`; **UNIQUE(event_id, IFNULL(rule_id,''))** = the duplicate guard | 10,650 |
| `users` | accounts | `id`, `username UNIQUE`, `password_hash` (scrypt), `role` (`ADMIN`\|`VIEWER`), `enabled`, `created_at/updated_at`, `last_login_at` | 2 |
| `auth_sessions` | server-side session records (cookie holds signed `{sessionId,role}` only) | `id`, `user_id`, `expires_at` (epoch ms), `created_at`, `last_seen_at`, `ip_address`, `user_agent` | 9 |
| `audit_logs` | security/audit trail (bounded fields) | `id`, `user_id`, `action`, `resource`, `metadata` JSON, `ip_address`, `user_agent`, `created_at`; actions include `LOGIN`, `LOGIN_FAILED`, `LOGOUT`, `PASSWORD_CHANGED`, `PASSWORD_CHANGE_FAILED`, `PASSWORD_RESET`, `USER_CREATED/UPDATED/DISABLED/DELETED`, `SESSIONS_REVOKED`, `USER_SESSIONS_REVOKED`, `DETECTION_SETTINGS_UPDATED`, `OBJECT_DETECTION_TEST_REQUESTED` | 1,737 |
| `viewer_presence` | live-viewer heartbeat | `(user_id, path)` PK, `seen_at` epoch ms (30 s freshness) | 9 |
| `app_settings` | key/value store: retention override, ingestion status, worker status, migration markers, face-test cursor/window | `key`, `value` (strings) | 17 |
| `event_faces` | face DETECTION results (no identity) | `id` (`face_…`), `event_id` FK→events CASCADE, `person_id` FK→people SET NULL (**always null today**), `confidence`, `x,y,width,height`, `crop_path`, `detector`, `model`, `detection_index`, `created_at`; **UNIQUE(event_id, detection_index)** | 348 |
| `face_processing` | per-event detection job state | `event_id` PK/FK, `status` (`PENDING`\|`PROCESSING`\|`COMPLETED`\|`FAILED`), `attempts`, `faces_found`, `detector`, `model`, `error`, `started_at`, `finished_at`, timestamps | 4,898 |
| `face_worker_heartbeat` | single-row liveness of the Python worker | `id=1`, `last_seen_at`, `poll_interval_ms`, `pid`, `status`, `detail` | 1 |
| `people` | reserved for a future people/recognition model | `id`, `name`, `notes`, timestamps | 0 |
| `person_face_references` | reserved (embeddings column never written) | `id`, `person_id` FK CASCADE, `image_path`, `embedding BLOB`, `embedding_model` | 0 |
| `telegram_media_jobs` | durable outbox for Telegram media (crop/clip) | `id` autoincrement, `event_id UNIQUE`, `camera_id/name`, `faces`, `max_confidence`, `event_timestamp`, `snapshot_path`, `status`, `attempts`, `detail`, `channel`, `next_attempt_at`, `classification`, `confidence`, `clip_timestamp` | 31 |
| `object_detection_settings` | single-row AI config (admin) | `id=1`, `enabled`, `person_enabled/confidence`, `vehicle_enabled/confidence`, `base_fps`, `active_fps`, `max_fps`, `motion_boost`, `activity_timeout_s`, `disappearance_timeout_s`, `max_concurrent`, `queue_size`, `min_event_duration_s`, `detection_source` (`ai_only`\|`dvr_only`\|`both`) | 1 |
| `object_detection_camera_settings` | per-camera AI overrides | `camera_id` PK, `enabled`, `person_enabled`, `person_confidence` (null = use global), `vehicle_enabled`, `vehicle_confidence` | 4 |
| `object_detection_tracks` | tracked objects written by the object worker | `id`, `camera_id`, `classification`, `raw_class`, `confidence`, `threshold`, `x,y,w,h`, `first_seen`, `last_seen`, `detection_count`, `snapshot_path`, `event_id` (join back to events = "ingested" marker), `status`, `detector`, `model` | 100 |
| `object_worker_heartbeat` | single-row AI worker health | `id=1`, `status`, `detail`, `metrics` JSON, `updated_at` | 1 |
| `object_detection_test_requests` | on-demand detection-test job/result | `id` (`odt_…`), `event_id`, `camera_id`, `snapshot_path`, `status`, `result` JSON, timestamps | 3 |
| `login_throttle` | per-IP/user failure counters for login lockout | `(key_type,key)` PK, `failures`, `window_started_at`, `locked_until`, `lock_level`, `last_failure_at` | (n/a) |
| `event_ai_results` | legacy/optional AI classification results (`AI_ENABLED`) | `id`, `event_id`, `provider`, `label`, `confidence`, `metadata`, `created_at` | (n/a, not surfaced) |
| `sqlite_sequence` | internal AUTOINCREMENT counter | — | — |

Indexes that a redesign must not invalidate (query shapes): `events(camera_id,timestamp)`, `(type,timestamp)`, `(classification,timestamp)`, `(priority,timestamp)`, `notified`, `notification_history(event_id,rule_id)` unique + `created_at`, `auth_sessions(expires_at)`/`(user_id)`, `event_faces(event_id)`/`(person_id)`, `face_processing(status)`, `object_detection_tracks(status,updated_at)`.

### 4.3 Model rules worth knowing before restyling data displays

* **Event identity/dedupe**: `dedupe_key = cameraId|type|timestamp|classification` (`lib/events.ts:374-381`). Repeat DVR alarm-log pages cannot double-insert.
* **Priority** is stored, not derived at read time: `defaultPriority()` (`lib/priority.ts:36-43`): intrusion→CRITICAL; video-loss/storage/alarm/line-crossing/person→HIGH; vehicle/unclassified motion→NORMAL. Rules may only *raise* an event's priority (`rule-engine.ts:63`).
* **Event type reality**: this DVR only emits `motion`; `person`/`vehicle` are *classifications* of motion. `SUPPORTED_EVENT_TYPES` is `["motion"]` and the rule UI offers only Person/Vehicle/Motion (`lib/events.ts:9-39,112`). Don't design screens for alarm/line-crossing/intrusion/video-loss/storage on this hardware.
* **Notification rules are dual-shaped**: arrays `cameraIds`/`eventTypes` are authoritative; legacy `cameraId`/`eventType`/`classification` are kept in sync for old queries and are the fallback when arrays are absent (`lib/events.ts:41-97`, `event-store.ts:718-733` and `:1251-1308`). An **empty** selection means "match nothing", never "all". The settings UI must keep both in sync when saving (already handled by the local `withSelection()` helper in `components/events/NotificationRules.tsx:69-76`).
* **Schedule/quiet-hours semantics** (all Asia/Kolkata): overnight windows when `start > end`; a Friday 23:00–06:00 window also covers Saturday early morning (`scheduleDayMatches`); empty `daysOfWeek` = every day; quiet hours only change *notification*, never storage; behaviours `notify` / `suppress` / `store_only`; cooldown is per rule, measured over `notification_history` sent rows.
* **Faces are detection-only**: `person_id` always null, `people` empty; UI copy "Unassigned" is contractual. Face-crop files are only ever served through `/api/faces/:id/image`.
* **Read state** is global per event (`read_at`), not per user.
* **Retention** deletes hub rows/files only (events, notification history, snapshots, face crops) — never DVR recordings, MediaMTX paths or users (`event-processor.ts:214-263`, `server/events/retention.ts`). `retention_days` override lives in `app_settings`, fallback `EVENT_RETENTION_DAYS` (default 30).

---

## 5. Functional map per screen (what a user can actually do)

Legend: ⟳ polling, ⚡ SSE/live, ⇅ mutation.

### `/` Dashboard
* See 4 tiles with camera name, sub-channel, online lamp. Tile states: skeleton → live video → "Start video" gesture → "Retry" on error; per-tile messages for DVR offline/not-configured/auth-failed, gateway down, camera unavailable.
* ⟳ `GET /api/cameras` every 15 s (+ window focus refresh); ⟳ `GET /api/dvr/status` from the shell every 15 s on every page.
* Click a tile → **in-app focus mode** (fixed full-viewport tile, shell chrome hidden, "Exit" + Escape, status lamp, mute). No browser Fullscreen API, no remount, no renegotiation. Uses the **sub** stream.
* "Recent security events" card: ⟳ initial load + ⚡ refresh on `cctv-event`; today's counts line; 5 important events with relative time; links to `/events/stats` and `/events`.
* ⚡ Global SSE notifier (AppShell) raises browser Notifications for events where the server decided `notify:true`, and for face-test notifications ("Face detected", never a name). Clicking a notification navigates to `/events/<id>`.

### `/cameras`
* See DVR/gateway status lamp and each channel's online state, channel numbers, stream ids, and computed "ready/gateway down/camera unavailable" text.
* ⇅ Rename a channel (local override in `data/cameras.json`, validated 1-32 chars, letters/numbers/space/`._'()-`); ⇅ "Use DVR name" clears the override. Save button shows per-card notice ("Saved", error text).
* One-shot fetch on mount (no polling).

### `/playback`
* Pick camera (names from `/api/cameras`; fallback `Camera N`), open the **date popover** (calendar constrained to dates with a recording and not future; per-month availability fetched on demand and session-cached; error state has "Try again"), edit from/to times, "Search recordings".
* Auto-load on camera/date change; if the day has nothing, the date is auto-corrected to the nearest recorded date **within the visible month** (unless arriving from an event, which must never re-route — that shows "Recording not found for this event.").
* Player: play/pause, ±15 s (restarts the stream at a new time), mute, volume slider, browser fullscreen for the frame, space/←/→/F shortcuts, clock read-out driven by a 250 ms local timer, "ended" state at recording end.
* Timeline: 24 h/6 h/1 h zoom, draggable playhead (one seek per gesture on release), recording segments coloured by type, event markers grouped by available pixel width with priority tones + counts, hover tooltip with event details ("Click to jump"), hover frame preview from pre-generated sprites (with generating/no-recording/unavailable states), legend, arrow-key seeking (`role="slider"`).
* Deep link from events: `/playback?camera=N&date=YYYY-MM-DD&time=HH:MM:SS` (server validates all three; `time` starts playback at the covering recording).

### `/events`
* Quick filter pills: All / Person / Vehicle / Motion / Important (important = HIGH+CRITICAL, server-side).
* Advanced filters: camera, classification (person/vehicle/unclassified), date, from/to, read state, notification state, priority. Active filters expose "Clear filters". Server-side paging (20/page) — never client-side filtering of a day.
* Result list: title, priority badge, "New" (unread), camera name, notified marker, HH:MM. Selecting a row drives the inline detail panel (snapshot from the authenticated route, duration, type, classification, confidence, notified; "View recording" → playback deep link; "Open details" → `/events/<id>`).
* `?focus=<eventId>` from a deep link selects that event when it is in the result page.
* ⚡ On the default unfiltered today view, a new SSE event refreshes the list.
* Empty state distinguishes "no events for this period" from "no events match your filters".

### `/events/[id]`
* Server-rendered event detail; invalid/unknown id → 404 page. Shows title, camera name, time, priority, snapshot (with stored AI bounding box + confidence/class label overlay), face crops when detection is enabled (hidden entirely when disabled — never "0 faces"), and a metadata `<dl>` including detector/model/raw class/threshold/track when the event came from the object detector.
* ⇅ Marks the event read on view (best effort).
* Links: "View recording" (playback deep link), "Back to events", "Notification history".

### `/events/stats`
* Range selector today/yesterday/7 d/30 d; total/person/vehicle/motion/high/critical metric tiles; per-camera bar chart (max-normalised); explanatory footnote about Kolkata-time windows and no double counting.

### `/faces`
* When face detection is disabled: a single explanatory card, no gallery, no error.
* Otherwise: camera/date/assignment/min-confidence filters, total + queue/failure counters, temporary test-notification banner (until + per-camera cooldown), paginated grid of face cards ("Unassigned", confidence, camera, time, "View event"), empty state.

### `/notifications`
* Per-day sent/suppressed/failed counters; filters date, camera, status, priority; paginated decision rows with rule name, reason, priority/status pills, and "Open event" link. Explains that events are stored regardless of notification.

### `/device`
* ⟳ DVR status lamp + 11 identity rows, "Not reported" for missing fields; one-shot skeleton then refresh every 15 s.

### `/account`
* See signed-in user/role; ⇅ change own password (validated ≥8, revokes all sessions then re-issues a cookie for this browser); see own sessions ("This device", IP, created/last active, UA) and ⇅ "Sign out other sessions" / "Sign out everywhere".

### `/settings` (ADMIN)
* ⟳ Read-only env values (password shown as `********`), backend/DVR/gateway lamps, text links to the 5 settings sub-pages.

### `/settings/users` (ADMIN)
* Create user (username 2-32 `[A-Za-z0-9._-]`, password policy, role); per-row: enable/disable, switch role, reset password (inline form), sign out sessions, delete (inline confirm; Escape dismisses). Server rejects removing the last enabled admin (409).

### `/settings/notifications` (ADMIN)
* Request browser-notification permission; create/edit/delete rules; enable/disable toggle; retention picker (Forever/7/14/30/60/90); "Test a rule" dry-run with per-rule decisions; Telegram test + read-only media status.
* Rule form: name, multi-camera selection (All toggle + per-camera checkboxes, max-h scroll), event selection (Person/Vehicle/Motion), minimum priority, active-from/to times, weekday pills, quiet-hours from/to + behaviour, cooldown seconds, enabled. Client-side guards when camera/event selection is empty.

### `/settings/detection` (ADMIN)
* Master switch + worker status/metrics (last report, inference ms, FPS, queue depth, dropped frames, today's detections), person/vehicle global switches + confidence sliders, per-camera enable/person/vehicle + "use global threshold" overrides, base/active/max FPS selects, motion boost + activity timeout, max concurrent inference, queue size, disappearance timeout, minimum event duration, detection source (ai_only/dvr_only/both with descriptions), "Run detection test" (queues for the worker, polls up to 20 s, shows detections or an error), sticky "Save settings" bar. Everything is validated again server-side; invalid saves change nothing.

### `/settings/audit-log` (ADMIN)
* Filter by user/action/date; paginated (25) list of action + username + resource + Kolkata timestamp; empty/error/retry states.

### `/settings/system` (ADMIN)
* Read-only health: warning list (aggregated), face-detection worker warning, face worker state + queue, thumbnails (enabled/worker/queued/last run/disk bytes/last error), storage free/total/%, backup last success/age/status, retention status + last pass counters, MediaMTX reachability/paths/drift, sessions + per-camera app viewers vs MediaMTX readers. Manual "Retry" on failure only (no polling).

### `/login`
* Sign in; shows config errors when required env vars are missing; error focus management; redirects to `?next=` (site-local) after success; already-signed-in users are redirected away.

---

## 6. Streaming architecture (must not break)

### 6.1 Live view (`CamerasTile` → `LivePlayer`)

```
Browser ── GET /api/streams/camN_sub ─────────────► hub decides mode
        ◄── {mode: webrtc|hls|placeholder|unavailable, whepUrl, hlsUrl, message}

WebRTC:  Browser ── SDP offer POST /api/webrtc/camN_sub/whep ──► hub ──► MediaMTX 8889 /camN_sub/whep
                ◄── SDP answer + Location rewritten to /api/webrtc/camN_sub/session/<id>
         Browser ── DELETE that same-origin session URL on teardown (keepalive)

HLS:     Browser ── GET /api/hls/camN_sub/index.m3u8 (and segments) ──► hub ──► MediaMTX 8888
                ◄── playlist rewritten to hub-relative URLs (server/video/hls-rewrite.ts)
```

* MediaMTX stays the only media server: the browser never receives an RTSP URL, a DVR credential or a MediaMTX port. The hub proxies WHEP and HLS and attaches `MEDIAMTX_AUTH_USER/PASSWORD` server-side (`webrtc/[path]/whep/route.ts:29-31`, `hls/.../route.ts:28-30`).
* **Mode selection** (`src/lib/playback.ts:17-47`, used by `/api/streams`):
  1. `VIDEO_DEV_PLACEHOLDER` on → `placeholder` (striped "Development placeholder" panel).
  2. DVR not configured / auth failed / disconnected → `unavailable` with the matching message.
  3. Gateway (MediaMTX API) unreachable → `unavailable` "Video gateway unavailable".
  4. Camera reported offline → `unavailable` "Camera unavailable".
  5. Request `Host` hostname is `localhost`/`127.0.0.1`/`::1` **or** listed in `WEBRTC_ADDITIONAL_HOST` → `webrtc`.
  6. Otherwise → `hls` ("Live via HLS."). Rationale: WebRTC media (ICE UDP/TCP 8189) cannot traverse a Cloudflare/Tailscale HTTPS tunnel, so a tunnel client is deliberately offered same-origin HLS. **Do not make WebRTC unconditional.**
* Player behaviour (`LivePlayer.tsx`): `RTCPeerConnection({iceServers:[]})` (LAN-only), recvonly video+audio, waits ≤2.5 s for ICE gathering, POSTs the offer (15 s upstream timeout), waits ≤20 s for `connected`, then `video.play()`; autoplay-blocked → "Start video" gesture button. WHEP failure → automatic HLS fallback with the "WebRTC unavailable. Live via HLS." label. `/api/streams`/HLS failures retried twice with 2 s/4 s backoff, then "Retry". HLS uses hls.js (`enableWorker`, `lowLatencyMode:false`) unless the browser natively supports HLS (Safari). Cleanup closes the peer connection, destroys hls.js, DELETEs the WHEP session, and clears `srcObject`. Presence POST every 20 s.
* **Streams used**: live + focus always the **H.264 sub** stream (`camN_sub`, channel `N02`). Main streams (`camN_main`, `N01`, H.265) are never played.
* **No browser transcoding / no canvas / no MSE pipeline of our own** — hls.js + WebRTC only. Keep it that way.
* CSP relevant rules: `media-src 'self' blob:`, `connect-src 'self'` (`next.config.ts`). Any new media host would break the policy; do not introduce one.

### 6.2 Camera focus mode

* Pure application state (`useCameraFocus` context + `DashboardView` local `focusId`). The grid **stays mounted**: non-focused tiles get `hidden` (display:none) so their WebRTC sessions stay alive; the focused tile's own `<article>` becomes `fixed inset-0 z-50` (same DOM node → **no renegotiation** on enter/exit).
* The shell hides `<aside>`, `<header>` and the bottom nav while focused; `document.body.style.overflow = "hidden"`; Escape exits; `autoFocus` on the Exit button; a `role="status"` line announces the mode.
* The focused player's own controls (mute, retry) sit at `z-20` above the tile's full-surface expand button (`z-10`), so they must keep working.
* This is **not** the browser Fullscreen API on purpose; only the playback player uses `requestFullscreen` on its frame.

### 6.3 Playback

* `POST /api/playback/session` opens an RTSP **playback** URL on the DVR for `startTime..endTime` and republishes it through MediaMTX as path `playback`; the browser only gets same-origin WHEP/HLS URLs. Max span 8 h (clamped server-side). Playback track is the **H.264 sub track** (`N02`) even though recording/search use the main track — H.265 does not render in Chrome.
* Play/pause/seek are implemented by tearing down and re-creating the session at the new timestamp (`PlaybackPlayer.finishPlayback`/`jump`/`override` run object), then `DELETE /api/playback/session` on teardown. Position is a **local clock** (250 ms interval), not a media element seek.
* Single-stream contention: the DVR serves one playback stream; the background thumbnail generator stands down while playback is active, but the player still retries 502/503 up to 3× (1.2 s apart) to outlast an in-flight extraction. Do not run two playback players (or a "preview + player" pair) concurrently.
* `/api/playback/download` is intentionally 501 — download is a documented non-feature.

### 6.4 Timeline previews (no DVR work in the browser)

* `GET /api/playback/thumbnail/index?camera&date&focus` returns a JSON index of pre-generated sprite sheets (24 tiles/sheet, 198×162 per tile, default 30 s between frames, bucket versioning) and reports the viewport focus so the generator prioritises it. While `progress.generating` the client re-polls every 6 s.
* `GET /api/playback/thumbnail/sprite` serves immutable, versioned JPEG sheets; the browser keeps ≤6 decoded sheets and renders a hover as one `background-position`. The hover never requests a frame from the DVR.
* The generator itself runs in `instrumentation.ts` (`ensureThumbnailWorker`) with retention pruning (default 14 days).

### 6.5 SSE and background producers (must keep working)

* `GET /api/events/stream` is a single global SSE subscription held by `AppShell` (`EventNotifier`). Frame 1 is `event: status {running}`; subsequent unnamed frames are `LiveEvent` JSON; `: ping` every 20 s keeps intermediaries alive. The browser reconnects automatically.
* The notifier dispatches a DOM `CustomEvent("cctv-event", {detail})` that `EventsView` (unfiltered today view only) and `RecentEvents` use to refresh; then raises a `Notification` if permission is granted, and `navigate()`s to the event on click.
* Background producers started in `src/instrumentation.ts`: DVR event poller + retention (`ensureEventProcessor`), face-test notifier, Telegram media worker, object-event ingest, thumbnail worker, hourly session prune, 6-hourly thumbnail retention. **None of them is UI**; a redesign must not move/lose `instrumentation.ts` or its module imports.
* Mongo-less, queue-less design: the SQLite tables (`face_processing`, `object_detection_tracks`, `telegram_media_jobs`, `notification_history`) are the durable queues shared with the Python workers. The browser is never part of those flows.

---

## 7. Constraints and reuse notes for the redesign

### 7.1 Presentation-only vs logic-bearing

**Safe to restyle freely (JSX/CSS only, no data contract):**
`src/components/ui/*`, `layout/AppShell.tsx` structure, `camera/CameraTile.tsx` (visuals), `camera/LivePlayer.tsx` (overlays/controls; keep the connection phases), all `components/playback/*` visual composition (keep timeline arithmetic), `components/events/*` presentation pieces, `components/settings/*` presentation, `components/faces/*`, `src/app/globals.css`, the two client page-files (`settings/system`, `settings/audit-log`), `login/page.tsx`, `error.tsx`, `not-found.tsx`, `manifest.ts`, `icon.svg`/`Mark.tsx`.

**Logic-bearing — treat as API/harness, do not change behaviour:**
* `src/lib/events.ts` (event types, rule matching, schedule/quiet hours/cooldown math, query parsing, Kolkata day ranges, stats windows).
* `src/lib/priority.ts`, `src/lib/time-kolkata.ts` (all `+05:30` formatting; no DST), `src/lib/faces.ts` (faces + test-notification window), `src/lib/playback.ts` (stream-mode decision), `src/lib/timeline.ts`, `timeline-markers.ts`, `timeline-density.ts`, `playback-thumbnail.ts`, `playback-date.ts`, `recording.ts`, `object-detection.ts`, `date-popover.ts`, `redirect.ts`, `rate-limit.ts`, `password*`, `session.ts`, `client-ip.ts`, `peer-ip.ts`, `snapshot-path.ts`, `face-path.ts`, `camera-focus-mode.ts`/`camera-grid-layout.ts` (if present as test seams), `messages.ts` (user-facing strings asserted by e2e).
* Everything under `src/server/**` (ISAPI client, event store/migrations, rule engine, notification pipeline, retention, MediaMTX/HLS proxy, workers' contracts) and `src/instrumentation.ts`, `src/proxy.ts`, `next.config.ts` CSP/headers.
* Client hooks with behaviour: `usePoll`, `useRecordingDates` (session cache + error-vs-empty semantics), `useTimelineThumbnails` (sprite cache/polling), `useCameraFocus`, `useEscapeToDismiss`, `useElementWidth`, `useCameraNames`.

### 7.2 Tokens and shared classes (single source: `src/app/globals.css`)

```css
@theme {
  --color-bg:#080b10; --color-panel:#10151c; --color-card:#141b24;
  --color-line: rgba(232,237,245,.1); --color-ink:#e8eef6; --color-muted:#93a0b3;
  --color-teal:#3ee0c7; --color-online:#3ddc97; --color-offline:#ff6b6b; --color-warn:#f0c36a;
  --font-sans:"Avenir Next","Segoe UI",ui-sans-serif,system-ui,sans-serif;
  --font-mono:"SF Mono",ui-monospace,monospace;
  --app-header-h:3.8125rem; --app-main-pad-y:1.5rem; --app-page-intro-h:4.25rem;
  --app-grid-chrome: calc(header+pad+intro);
}
```
* Semantic colours used across the app: `bg`, `panel`, `card`, `line`, `ink`, `muted`, `teal` (accent/links/focus ring), `online` (ok), `offline` (error/critical), `warn` (degraded/high). Priority tones are hard-wired to these (`PriorityBadge`), as are status lamps and timeline markers.
* `.camera-grid-h` utility (`globals.css:31-45`) derives the dashboard grid height from `100dvh - var(--app-grid-chrome)` at `min-width:64rem` (declared *inside* the media query because a hand-written utility has no `lg:` variant). If the header/intro/padding change, update the three `--app-*` variables — that is the intended lever.
* `.rdp-app` + `.rdp-recorded/.rdp-disabled/.rdp-selected-app` (`globals.css:83-149`) theme react-day-picker; the library stylesheet is imported first at `:3`. Re-skin the calendar via these variables, not by forking the component.
* **Hard-coded colours outside the token set** (will not follow a token change): on-teal text `#08110f` (13 sites) and `text-black` (4, inconsistent), `FrameSkeleton` bg `#151b24`, placeholder stripes `#121820/#1a2330`, `Mark` SVG `#171e28/#3ee0c7/#8ef0e2`, manifest/theme `#080b10`, timeline playhead shadow `rgba(62,224,199,.8)`, calendar selected text `#08110f`. Centralise these as part of the design system.
* Typography: `text-[11px]` micro-labels, `text-xs` metadata, `text-sm` body, `text-base` page `h1` compact / `text-lg→xl` normal `h1`, `font-mono tabular-nums` for every clock/number. Radii: `rounded-lg` controls, `rounded-xl` cards, `rounded-full` pills. Heights: `h-11` (44 px) primary controls, `h-10`/`h-9` secondary/icon, `h-8` timeline zoom. Keep ≥44 px touch targets.
* Focus: global `:focus-visible { outline: 2px solid var(--color-teal); outline-offset: 2px }`; reduced motion kills `animate-pulse`.

### 7.3 DOM/behaviour contracts that tests and accessibility rely on

These are asserted by the Playwright suite (`tests/e2e/*.spec.ts`) and by unit tests; a visual rewrite that changes them is a behaviour break:
* Landmarks/roles: `navigation` "Primary", `banner` (header), `main`, `region` "Playback", "Timeline", "Event list", "Detected faces", "Recent security events", `article` "Event details", per-tile `article`, `heading` level 1 "Dashboard" / level 2 camera names, `dialog` "Choose playback date", `alertdialog` "Confirm delete…", `slider` "Recording timeline. Use the arrow keys to seek.", `slider` "Volume", `tooltip`, `status`, `alert`.
* Labels: Username, Password, Current password, New password, Confirm new password, Camera, Date, From, To, Status, Priority, Classification, Assignment, Minimum confidence, Role, User, Action, "Recording playback", "Live view <camera>".
* Button texts that e2e clicks: "Sign in", "Save", "Use DVR name", "Search", "Search recordings", "Clear filters", "Apply filters", "Previous", "Next", "Enable"/"Disable", "Switch role", "Reset password", "Sign out sessions", "Delete", "Cancel", "New rule", "Edit", "Save rule", "Send Telegram Test", "Run detection test", "Save settings", "Start video", "Retry", "Try again", "Exit", "Full screen", "Unmute"/"Mute", "−15s", "+15s", "Play"/"Pause", "Exit focus view".
* `data-testid` set (17 values in `DetectionSettings`, `telegram-status`, `detection-overlay`) — e.g. `detection-enabled`, `person-confidence`, `camera-1-enabled`, `camera-2-person-global`, `base-fps`, `detection-source`, `detection-save`, `detection-test-button`, `detection-worker-status`.
* Layout contracts: dashboard tiles must be >300×180 px with the video area >120 px and caption <120 px (`live.spec.ts`); the dashboard must not scroll at 1920×1080 (viewport-fit grid); sanitised text assertions ("No notifications for this period.", "No audit entries yet.", "Face detection is disabled.", "Detection is off.", "Rule saved.", "Rule created.", "Snapshot not available", "This device", "********").

### 7.4 Data/UX facts a new design should respect

* Every timestamps is Asia/Kolkata; use `formatKolkata*` helpers, never `toLocaleString()` on a raw ISO string (the server may be UTC). Account page uses `toLocaleString()` for session times — the one inconsistency.
* Camera display names come from `/api/cameras` (precedence: name saved in `data/cameras.json` → DVR channel name → `Camera N`; a saved name equal to the generic default counts as no override). Use `useCameraNames`/`cameraName()` to add another consumer.
* Empty vs failed are different states everywhere (recording availability, event list, faces, notifications, audit). Do not collapse them into one generic empty state.
* Live media assets must keep the authenticated `<img>` pattern (no `next/image` for snapshots/faces), `Cache-Control: private, no-store`.
* The UI is dark-only; a light theme would require both tokens and the hard-coded colours above, plus `color-scheme`.
* No external assets: no webfonts, no icon CDN, no analytics (CSP + privacy posture).

---

## 8. Risks and gotchas (ranked for the redesign)

| # | Risk | Why | Where to look |
| --- | --- | --- | --- |
| R1 | **Focus mode unmounting tiles** kills WebRTC sessions and causes reconnect storms | The grid is deliberately kept mounted; `hidden` + `fixed` are used instead of conditional rendering | `DashboardView.tsx:64-118`, `CameraTile.tsx:44-57` |
| R2 | **Two concurrent playback streams** fail (single DVR playback slot) | Player and thumbnail generator already compete; retries only mask a brief race | `PlaybackPlayer.tsx:114-141`, `server/playback/thumbnail-*` |
| R3 | Viewport-fit layout is fragile | Dashboard/playback depend on `md:h-dvh` + `min-h-0` chains, `--app-grid-chrome`, `camera-grid-h`; changing header/intro heights silently re-introduces page scroll or collapsed tiles | `globals.css:24-45`, `AppShell.tsx:150-221` |
| R4 | Renaming/moving routes breaks deep links and tests | `/events/<id>`, `/playback?camera&date&time` (from `eventPlaybackHref`), `?focus=<eventId>`, `?next=` login redirect, notification click targets | `lib/events.ts:222-226`, `events/[id]`, `login/page.tsx` |
| R5 | **VIEWER sees an editable `/cameras` page but saves 403** | Page gated only by "signed in"; `PATCH` is ADMIN | `cameras/page.tsx`, `api/cameras/[id]/route.ts:13` — either hide/disable inputs for VIEWER or gate the page |
| R6 | Duplicating the SSE subscription | `EventNotifier` is mounted once in `AppShell`; a redesign that renders the shell twice (e.g., per-page layout) would double browser notifications and double refresh events | `AppShell.tsx:56-107,214` |
| R7 | Changing accessible names / removing `data-testid` | 16 e2e specs, 1 worker, desktop-only; they assert roles, names and ids heavily | `tests/e2e/*` |
| R8 | Replacing authenticated `<img>` with `next/image` | The optimizer fetches without the session cookie → 401/blank images | `SnapshotPanel`, `EventsView`, `EventFacesPanel`, `FaceCard` |
| R9 | Adding external hosts/fonts/icons | CSP `default-src 'self'`, `img-src 'self' data: blob:`, `connect-src 'self'`, `frame-ancestors 'none'` | `next.config.ts:17-44` |
| R10 | Notification permission / notification copy changes | Permission is only requested on click; face notifications must say "Face detected", never a name; click navigates to `/events/<id>` | `NotificationPermissionButton.tsx`, `lib/faces.ts:290-338` |
| R11 | Hard-coded hex colours survive a token change | `#08110f`/`text-black`, `#151b24`, stripe colours, `Mark` SVG, manifest | §7.2 |
| R12 | Global shell polls `/api/dvr/status` every 15 s on every page (3 upstream calls each) plus dashboard polls `/api/cameras` | In a redesign, don't add more per-page pollers without removing others; the DVR connection is a shared resource (`getDvrOverview()` caches ~8 s when connected, longer on failure, but MediaMTX HLS/WHEP/API calls are per request) | `AppShell.tsx:140`, `components/hooks/usePoll.ts`, `server/hikvision/hikvision-status.ts` |
| R13 | Mobile nav is `grid-cols-8` for 7 visible items for VIEWER | Cosmetic but obvious in a nav redesign | `AppShell.tsx:139,228` |
| R14 | Stale README claims ("Full screen uses the main stream", "V5 API" lists a subset) | Don't trust the README for behaviour; this inventory + source is authoritative | `README.md:310-340,615-640` |
| R15 | `settings/system` and `settings/audit-log` are page-level client components | Any layout/shared-component refactor must edit the page files, not just `src/components` | `src/app/(hub)/settings/{system,audit-log}/page.tsx` |

---

## 9. Appendix

### 9.1 File → responsibility index (non-test, high-signal)

| Area | Files |
| --- | --- |
| Shell & nav | `components/layout/AppShell.tsx`; `components/hooks/useCameraFocus.tsx` |
| Live | `components/camera/CameraTile.tsx`, `components/camera/LivePlayer.tsx`, `components/dashboard/DashboardView.tsx`, `components/events/RecentEvents.tsx` |
| Playback | `components/playback/{PlaybackView,PlaybackPlayer,PlaybackControls,PlaybackFilters,PlaybackTimeline,PlaybackCalendar,DatePickerField,TimelineHoverPreview,useTimelineThumbnails}.tsx`, `components/hooks/{useRecordingDates,useElementWidth}.ts` |
| Events | `components/events/{EventsView (incl. EventDetail), EventStatsView, SnapshotPanel, EventFacesPanel, MarkReadOnView, PriorityBadge}.tsx` |
| Notifications | `components/events/{NotificationsView, NotificationRules (incl. RuleForm + RuleTester), NotificationPermissionButton, TelegramTestButton}.tsx` |
| Faces | `components/faces/{FacesView, FaceCard}.tsx` |
| Settings | `components/settings/{SettingsView, UsersView, DetectionSettings}.tsx`, `src/app/(hub)/settings/{system,audit-log}/page.tsx` |
| Auth/account | `components/auth/LoginForm.tsx`, `components/account/AccountView.tsx`, `src/app/login/page.tsx` |
| Shared UI | `components/ui/{States, StatusLamp, Mark}.tsx` |
| API surface | `src/app/api/**`, types in `src/lib/api-types.ts` |
| Data | `src/server/events/event-store.ts` (+ `data/events.sqlite`), `src/server/auth/accounts.ts` |
| Streaming | `src/server/video/{mediamtx,hls-rewrite,media-status,playback-gateway}.ts`, `src/app/api/{webrtc,hls,streams,playback}/**`, `src/lib/playback.ts` |
| Background | `src/instrumentation.ts`, `src/server/events/{event-processor,event-pipeline,rule-engine,face-notify,retention}.ts`, `src/server/notifications/telegram-media.ts`, `src/server/playback/thumbnail-worker.ts`, `src/server/detection/object-ingest.ts` |

### 9.2 Environment flags that change what the UI shows (read from `.env`, never exposed to the browser)

`APP_USERNAME/PASSWORD/SESSION_SECRET` (required) · `DVR_HOST/USERNAME/PASSWORD/HTTP_PORT/RTSP_PORT` · `MEDIAMTX_API_URL/WHEP_URL/HLS_URL/AUTH_USER/AUTH_PASSWORD` · `WEBRTC_ADDITIONAL_HOST` · `VIDEO_DEV_PLACEHOLDER` · `DATA_DIR` · `EVENT_POLL_INTERVAL_MS` (default 5 s) · `EVENT_RETENTION_DAYS` (30) · `AI_ENABLED` (off) · `FACE_DETECTION_ENABLED` (off) + `FACE_DETECTION_CONFIDENCE/MAX_FACES` · `FACE_DETECTION_TEST_NOTIFICATIONS/…_UNTIL/…_COOLDOWN_SECONDS` · `TELEGRAM_*` (server-side only) · `PLAYBACK_THUMBNAIL_ENABLED/INTERVAL_SECONDS/RETENTION_DAYS` · `MAX_THUMBNAIL_WORKERS` · `COOKIE_SECURE` · `TRUSTED_PROXY_CIDRS` · `DEV_ALLOWED_ORIGINS`.

### 9.3 Message catalogue

All user-facing status strings for DVR/gateway/stream/playback/face/notification errors come from `src/lib/messages.ts` (and are asserted by tests). New UI copy that replaces them should keep the same meaning (the e2e suite asserts several exact strings), and any new copy should live in the same catalogue rather than inline.
