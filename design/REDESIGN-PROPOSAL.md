# Redesign proposal — Home CCTV Hub → "Sentinel" operator console

**Phase 2 deliverable · for approval · 2026-11-04**
**Working dir:** `/Users/guruswamihiremath/Desktop/projects/home-hik-camera`
**Design system:** [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) · **Audit:** [`AUDIT.md`](AUDIT.md) · **Mockups:** [`design/mockups/`](mockups/) · **Rendered screens:** [`design/mockups/screens/`](mockups/screens/)
**Before (current app):** [`design/audit/before/`](audit/before/)

> Figma MCP is not available in this environment, so the design was produced with an equivalent visual design workflow: a real HTML/CSS design system (`design/mockups/assets/ds.css`) rendered in Chromium at 1920×1080, 834×1112 and 390×844, with real camera frames, real event data and real product copy. Every mockup is pixel-rendered from the same tokens that will be ported to Tailwind, so what is approved is what gets built.

---

## 1. One-paragraph summary

The hub works and its engineering is sound, but as an interface it is a camera website, not an operator console: the live view has no overview layer, the shell is an ungrouped list of eight links, there is no component language (26 button treatments, 4 input treatments, 306 of 549 targets under 44 px), text size has collapsed to 11–12 px, colour semantics collide, and mobile Events hides its own detail panel. The proposal keeps every route, API, stream and notification/face behaviour exactly as-is and rebuilds the presentation layer around a single dark "Sentinel" design system: grouped navigation, a KPI + recent-events dashboard above the fold, a dense event timeline with a proper inspector, real camera-management cards, a rules master/detail screen, a paginated face gallery, a genuine settings shell, and a mobile console with collapsed filters, a 5-item bottom bar and bottom-sheet details.

---

## 2. What changes vs what is preserved

### Changed (visual / presentational only)

- New palette, type scale, spacing, radii and component library (CSS tokens + primitives).
- App shell: grouped sidebar, breadcrumb banner, system-status cluster, IST clock, account menu, 5-item mobile bar + More sheet, skip link.
- Dashboard gains a 4-stat overview strip, a height-fit live wall and a right rail with "Recent security events" + system snapshot + quick links.
- Events becomes a two-pane timeline: date navigator + segmented quick filters + collapsible advanced filters + sticky inspector; mobile filters collapse and the inspector becomes a bottom sheet.
- Event detail becomes a hero evidence page (snapshot + detection box + metadata + faces).
- Camera setup becomes camera-management cards with a live frame, rename form and stream map.
- Notification rules becomes list + editor master/detail with Telegram status and retention/testing panels.
- Faces becomes a paginated dense gallery with KPI stats and test-mode status.
- Settings gets a two-pane shell and consistent cards/tables; save bars become sticky inside the content column and never collide with mobile navigation.
- Login gets a split local-first brand panel + focused form (form contract unchanged).
- Supporting screens (playback, notification history, device, account, event stats) inherit the tokens and primitives; **playback internals are not restructured** because its geometry is test-locked.

### Preserved (non-negotiable)

- Every route URL, all 8 navigation labels, every page `h1`, every tested `role`/`aria-label`/`data-testid`/empty-state string (see `design/audit/TEST-CONSTRAINTS.md`).
- MediaMTX remains the only media server; the hub still proxies WHEP/HLS same-origin with server-side auth; no browser transcoding; no DVR exposure.
- All APIs, SQLite schema, event ingestion, notification rules engine, browser/Telegram notifications, face detection, retention, roles and audit log unchanged.
- Playback: H.264 704×576 sub-stream, `object-fit:contain`, 20 px timeline track, markers/segments/preview semantics, date-popover geometry, 1080 px vertical budget.
- Camera focus mode: all four tiles stay mounted, fixed full-viewport overlay, Escape/Exit, no Fullscreen API, no WebRTC renegotiation.
- CSP: no external fonts/icons/CDNs; no new runtime dependencies.

### New behaviour built only from existing APIs (no API/schema change)

- **Unread count** in the nav + dashboard KPI from `GET /api/events?read=false&pageSize=1` (the existing filter already supports it), refreshed on the existing SSE `cctv-event` event.
- **Explicit "Mark as read"** action using the existing `POST /api/events/:id/read` endpoint (today read only happens silently on opening a detail page).
- **KPI strip** from the already-used `/api/cameras` and `/api/events/stats?range=today` responses.
- Nothing else — no acknowledgement workflow, no export, no new settings: those would require API/schema work and are explicitly out of scope.

---

## 3. Design system at a glance

- **Theme:** Sentinel dark. Canvas `#070A0E`, surfaces `#0B1017`/`#0F1620`/`#16202D`, ink `#E9F0F8`, krypton teal `#2FE3C6`, status emerald/amber/red. All body pairs WCAG AA (4.6–15.8:1); control borders raised to 3.06:1.
- **Type:** native system stack (CSP-safe) + monospace for machine data; 7-step scale from 10 px micro-label to 28 px display, 12 px metadata floor, 24 px page titles, tabular numerals, IST 24-hour times.
- **Space/radius:** 4 px rhythm; 6/8/12 px radii; 38 px controls; hairline borders + surface steps instead of heavy shadows.
- **Components (25):** button (5 variants × 3 sizes), icon button, field/input/select, card, stat/KPI, badge/pill/chip, status dot, switch, segmented control, table, property list, pagination, event row, timeline track, camera tile, inspector, notice, empty state, skeleton, dialog/sheet, page header, settings row, system-status cluster, nav item. Icons are one inline-SVG set.
- **Navigation:** same eight labels, grouped Monitor / Security / System; Settings ADMIN-only; active = teal wash + left bar + `aria-current`; mobile = 5 items + More sheet, duplicates hidden with `display:none`.
- **Breakpoints:** ≥1024 desktop sidebar; 768–1023 tablet (no sidebar, 5-item bar, 2-col tiles); ≤767 mobile single column; page padding 24/20/14.
- **Accessibility:** visible double focus ring on all controls, skip link, focus-managed alert dialogs, `aria-live` for async counts/saves, text+shape for every status, ≥44 px mobile targets, reduced-motion support, no hydration-unsafe first render.

Full spec: [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md). Rendered sheet: [`design-system-desktop.png`](mockups/screens/design-system-desktop.png).

---

## 4. Screen-by-screen

| # | Screen | Problem it fixes | Proposal | Key evidence |
|---|---|---|---|---|
| 1 | **Live monitoring** `/` | No overview; recent events below fold; tiles weak; 8-item nav; no unread signal | 4 KPI stats (cameras online, events today, person/vehicle, alerts sent) + height-fit 2×2 4:3 live wall + right rail (Recent security events, system snapshot, quick links) + unread badge in nav; tiles get LIVE/clock/signal chrome and a visible expand affordance | [`dashboard-desktop.png`](mockups/screens/dashboard-desktop.png) · before: [`dashboard-desktop-loaded.png`](audit/before/dashboard-desktop-loaded.png) |
| 2 | **Event timeline** `/events` | Filter wall; detail invisible below the list on mobile; 65 px cards; weak hierarchy | Date navigator + segmented quick filters + collapsible "Filters (n)"; grouped dense timeline (`li > button`, 66 px rows) + sticky inspector (`article` "Event details"); mobile: collapsed filters, bottom-sheet inspector | [`events-desktop.png`](mockups/screens/events-desktop.png), [`events-mobile.png`](mockups/screens/events-mobile.png) |
| 3 | **Event detail** `/events/[id]` | Metadata dump; snapshot not the hero; faces buried | Breadcrumb + evidence hero with detection box + summary card + "Face Detection" region + technical details + actions | [`event-detail-desktop.png`](mockups/screens/event-detail-desktop.png) |
| 4 | **Camera management** `/cameras` | Name field labelled "Channel 1"; no preview; stream use unclear | Health strip; 2×2 camera cards with live frame, channel identity, rename form (Save / Use DVR name) and stream map | [`cameras-desktop.png`](mockups/screens/cameras-desktop.png) |
| 5 | **Notification rules** `/settings/notifications` | Flat list + long inline editor; Telegram status hidden; cards inconsistent | Action bar + rule cards with switches/chips + retention + rule tester; right-side editor with grouped scope/schedule/quiet-hours; Telegram status | [`notification-rules-desktop.png`](mockups/screens/notification-rules-desktop.png) |
| 6 | **Face detection** `/faces` | 348 cards unbounded, ragged giant crops, no density | KPI stats + filter card + test-mode notice + dense paginated gallery (5–6 cols desktop) | [`faces-desktop.png`](mockups/screens/faces-desktop.png) |
| 7 | **Application settings** `/settings/*` | No shell; env table; inconsistent forms; save-bar collision | Two-pane settings shell + health cards + masked environment grid + admin link cards; sub-pages (Users, Object detection, System, Audit log) dense and mobile-safe | [`settings-desktop.png`](mockups/screens/settings-desktop.png), [`settings-detection-desktop.png`](mockups/screens/settings-detection-desktop.png) |
| 8 | **Login** `/login` | Plain centred form, no product identity | Split local-first brand panel + focused sign-in form; exact POST contract preserved | [`login-desktop.png`](mockups/screens/login-desktop.png) |
| 9 | **Shell** (every page) | Brand duplicated, flat nav, 8-item mobile bar, no skip link | Grouped sidebar, breadcrumb banner, status cluster + IST clock + account menu, 5-item mobile bar + More sheet, skip link | all mockups |
| 10 | **Supporting screens** | Inconsistent primitives | Tokens + primitives applied: playback (internals untouched), notification history, device, account, event statistics | described in DESIGN-SYSTEM §7 |

---

## 5. Implementation plan (Phase 4, after approval)

**Architecture:** keep Next.js 16 App Router, React 19, Tailwind 4, existing hooks/APIs. Presentation-layer refactor only.

| Step | Work | Files (write scopes) |
|---|---|---|
| 1 | Tokens + component CSS in `@theme`/`@layer components`; preserve token names; add `Icon`, `PageHeader`, `Stat`, primitives | `src/app/globals.css`, `src/components/ui/` |
| 2 | App shell: grouped nav, banner, status cluster, mobile bar + sheet, skip link; keep SSE/role/sticky/focus-mode contracts | `src/components/layout/AppShell.tsx`, `src/components/ui/StatusLamp.tsx`, `Icon.tsx` |
| 3 | Dashboard: KPI strip, height-fit live wall, rail; camera tile chrome; recent events (camera names, unread) | `DashboardView.tsx`, `CameraTile.tsx`, `RecentEvents.tsx`, `LivePlayer.tsx` (chrome only) |
| 4 | Events: timeline, toolbar/filters, inspector, mobile sheet, event detail page | `EventsView.tsx`, `EventDetail` internals, `events/[id]/page.tsx`, `SnapshotPanel.tsx`, `EventFacesPanel.tsx` |
| 5 | Camera setup + Notification rules | `CamerasView.tsx`, `NotificationRules.tsx`, `TelegramTestButton.tsx` |
| 6 | Faces + Settings (hub, users, detection, system, audit) + device + account + login | `FacesView.tsx`, `FaceCard.tsx`, `SettingsView.tsx`, `UsersView.tsx`, `DetectionSettings.tsx`, `settings/*/page.tsx`, `settings/layout.tsx` + nav, `DeviceView.tsx`, `AccountView.tsx`, `LoginForm.tsx`, `login/page.tsx` |
| 7 | Consistency pass on notification history / event stats / playback container (no playback internals) | `NotificationsView.tsx`, `EventStatsView.tsx`, playback page wrapper |
| 8 | QA + fixes | — |

**Parallelisation:** after step 1 (shared foundation, done by the Lead), steps 3–7 are split across 3–4 implementers with disjoint file scopes; the Lead reviews every diff and runs the final suites and screenshot comparison.

### Risk register

| Risk | Mitigation |
|---|---|
| Breaking a Playwright/Vitest contract (roles, labels, counts, geometry) | Constraints file as the implementation checklist; targeted suites after each screen; full suite at the end |
| Playback regression (test-locked geometry) | Playback components untouched; only inherited tokens change; PLAY-013/014/015 run explicitly |
| WebRTC/focus-mode regression | Keep mount lifecycles, DOM order (`article > div` video area), `hidden` (not unmount), `object-contain`; live/focus specs re-run with real streams |
| Hydration warnings from new chrome (clock/status) | No client-only values in first render; reuse existing hydration-safe patterns |
| Concurrent unrelated edits in the worktree | Do not touch auth/config/instrumentation files; report any pre-existing failures separately from redesign regressions |
| Large diff hard to review | Screen-by-screen commits/grouping; before/after screenshot pairs per screen |

---

## 6. QA plan (Phase 5)

1. `npm run typecheck`, `npm run lint`.
2. `npm test` — all Vitest files (baseline 79 files / 814 tests passing).
3. `npx playwright test` — full 111-case suite at 1920×1080, single worker, against the live hub + MediaMTX + DVR; 10 known environment skips reported as skips (no viewer credentials / rule-mutation flag).
4. Targeted geometry gates: `PLAY-003/004/005/006/012/013/014/015/016/017/019`, `LIVE-003/004/006/007`, `DASH-003`.
5. Before/after screenshots for every route at 1920×1080, 1440×900, 834×1112, 390×844, plus key states (loading, empty, error, focus mode, event selected, rule editor, mobile sheet).
6. Stream verification: all four live tiles reach a determinate state (video readyState ≥ 2), focus mode works, playback plays the H.264 sub-stream, HLS path unaffected.
7. Regression report: any failure classified as pre-existing (including the concurrent hardening edits) vs redesign-caused, with evidence.

---

## 7. Decisions requested (approval gate)

1. **Approve the "Sentinel" design system** (palette, type scale, components, dark-only theme) — [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md).
2. **Approve the eight screens + shell** shown in `design/mockups/screens/`.
3. **Approve navigation grouping** (Monitor / Security / System) — labels unchanged.
4. **Approve the mobile console pattern**: 5-item bottom bar + More sheet (replaces the 8-item bar), collapsed filters, bottom-sheet event detail.
5. **Confirm scope:** Tier 1 = Dashboard, Events, Event detail, Camera setup, Notification rules, Faces, Settings shell + sub-pages, Login, App shell; supporting screens inherit tokens. Playback internals untouched (test-locked).
6. **Confirm the two existing-API additions:** unread badge/KPI and explicit "Mark as read" (both use endpoints that already exist; no API or schema change).

On approval I will implement in the existing Next.js/React architecture, run the full QA matrix, and report regressions with before/after evidence. If any screen needs revision, name it and I will iterate the mockup before code is written.
