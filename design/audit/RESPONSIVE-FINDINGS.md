# Home CCTV Hub — Responsive audit (BEFORE baseline)

**Task:** task-4 · **Author:** responsive-auditor · **Date:** 2026-11-04
**App:** Next.js dev server at `http://localhost:3000` (already running; never restarted)
**Method:** Playwright (`@playwright/test`, Chromium, `deviceScaleFactor: 1`) against the live app with a real
session cookie from `APP_USERNAME`/`APP_PASSWORD`; login screens captured from an **unauthenticated fresh
context**. DOM geometry was measured separately (`design/tools/responsive-probe.mjs`) so the findings cite
numbers, not just impressions. No application code was modified.

Target widths (portrait orientation, as requested):

| Label | Viewport | Layout branch actually used |
|---|---|---|
| `mobile` | 390 × 844 | `< 768px`: no sidebar, fixed 8-item bottom bar |
| `tablet` | 834 × 1112 | `768–1023px`: desktop sidebar, **no** bottom bar, but `lg` (1024px) rules not active |
| `laptop` | 1440 × 900 | `≥ 1024px`: sidebar + 2-column dashboard + events side panel |

> There is **no 1024–1439px sample** in the deliverable set, so the exact `lg` transition is inferred from code
> (`min-width: 64rem`) and from the 834/1440 results. If a real 1024/1280 device matters, capture it separately.

---

## 1. Deliverables and how to reproduce

**Screenshots — directory:** `design/audit/before/`
**Total produced by this task: 144 PNG files**

| Group | Count | Naming |
|---|---|---|
| Baseline screens (17 screens × 3 sizes) | **102** (51 viewport + 51 full-page) | `<route>-<size>.png`, `<route>-<size>-full.png` |
| Below-the-fold support shots | **33** | `<route>-<size>-bottom.png` |
| Interaction states | **9** | `events-selected-<size>.png`, `events-selected-detail-<size>.png`, `dashboard-focus-<size>.png` |

17 screens = `/` dashboard, `/cameras`, `/events`, `/events/<real id>`, `/events/stats`, `/faces`, `/playback`,
`/notifications`, `/device`, `/account`, `/settings`, `/settings/notifications`, `/settings/users`,
`/settings/detection`, `/settings/audit-log`, `/settings/system`, and `/login` (unauthenticated).
Real event id used for the detail routes: `evt_417d9dd35c747de1567a8a95` (resolved at runtime from
`/api/events/recent?limit=1`; note `/api/events?limit=1` returns `400 Invalid date` because that endpoint
requires `date`, `page` and `pageSize`).

The directory also contains **pre-existing `*-desktop*.png` baseline shots (35 files, not overwritten)** from
earlier work and `uxaudit-*.png` files owned by the UX auditor. Those are **not** part of the 144 counted above.

**Why `-full.png` at tablet/laptop looks identical to the viewport shot:** at ≥768px the shell locks the
document to the viewport (`md:h-dvh`) and `<main>` becomes the scroll container (`md:overflow-y-auto`), so
`fullPage` cannot see scrolled-out content. That is why the extra `<route>-<size>-bottom.png` set exists: each
one is the same screen scrolled to the maximum inner-`main` offset. **This inner-scroll shell is itself a
responsive characteristic to keep or consciously change.**

**Tools written (all new, repo-safe):**

- `design/tools/responsive-shots.mjs` — baseline + login capture (waits 6–8 s on `/`, `/events`, 5–6 s elsewhere,
  one retry on interrupted navigation, verifies size/bytes of every file).
- `design/tools/responsive-scroll-shots.mjs` — below-the-fold captures for the inner scroll region.
- `design/tools/responsive-probe.mjs` — DOM geometry probe → `design/tools/responsive-probe.json`.
- `design/tools/responsive-states.mjs` — events-row-selected and camera-focus states →
  `design/tools/responsive-states.json`.
- `design/tools/responsive-metrics.json` — per-screen visibility/overflow/tap-target metrics from the shot run.
- Logs: `design/tools/responsive-shots.log`, `design/tools/responsive-scroll-shots.log`,
  `design/tools/responsive-probe.log`.

**Capture state (before):** DVR **connected**, video gateway **connected**, live dashboard streams rendered
video (no "Video gateway unavailable" banner appeared on any of the 51 screens). `/playback` on tablet/mobile
was still showing "Connecting to DVR…" at capture time while the laptop shot shows a recording — a player/data
timing artefact, not a layout defect, but it means the playback screenshots document layout with and without a
loaded video. Frames on `/playback` and `/device` show "DVR offline" briefly in some probe passes because the
status poll was mid-retry; the screenshots themselves show the connected state.

**Known screenshot artefact (dev-only, not a product issue):** the Next.js dev indicator (the round "N" badge and
the "Compiling…" pill) is painted over the bottom-left corner of every page, overlapping the first bottom-nav
item and, in focus mode, the player controls. It is injected by the dev server and must not be treated as a
responsive defect; all geometry numbers in this report were measured with the badge present but its 40 px
footprint is excluded from the tap-target analysis (it is not an app element).

---

## 2. Verdict at a glance

| # | Finding | Severity | Screens | Evidence |
|---|---|---|---|---|
| 1 | Tapping an event on **tablet/mobile** shows no detail; detail panel renders **after the whole list**, 1 000–1 800 px below the fold | **P1** | `/events` (<1024px) | `events-selected-mobile.png`, `events-selected-detail-mobile.png`, `events-selected-tablet.png`, `events-selected-detail-tablet.png`, `events-tablet-bottom.png` |
| 2 | Object-detection **Save bar is behind the mobile bottom nav** (39 px overlap; ~26 px of the 44 px Save button covered, z-20 vs z-40) | **P1** | `/settings/detection` (mobile) | `settings-detection-mobile.png`, `settings-detection-mobile-bottom.png`; probe `fixedBars` |
| 3 | **Breakpoint gap at 768–1023 px**: tablet gets the 220 px desktop sidebar but mobile-ish one-column dashboard and no events side panel — 2×2 grid wasted, 900 px inner scroll for 4 cameras | **P2** | `/` (tablet) | `dashboard-tablet.png`, `dashboard-tablet-bottom.png` |
| 4 | **Mobile header crowding**: action cluster takes 353.5 / 390 px (91 %), brand title collapses to **0 px**, logo overlaps the action cluster by 15.5 px; a hydration-time clock can push the row to 443 px (> viewport) | **P2** | all (mobile) | `dashboard-mobile.png`, `settings-mobile.png`; probe header geometry |
| 5 | **Bottom bar** = 8 items × 49 × 38 px, 11 px labels, 39 px tall — under the 44 px tap minimum; labels have no room at 320–360 px devices | **P2** | all (mobile) | `dashboard-mobile.png`, `settings-detection-mobile.png`; probe `bottomNav` |
| 6 | **Faces screen is unbounded**: 348 cards → **13 284 px** page at 390, 5 478 px at 1440, no pagination/virtualisation; "View event" links are 16 px tall | **P2** (P1 candidate if unpaginated in redesign) | `/faces` | `faces-mobile.png`, `faces-mobile-full.png`, `faces-laptop.png` |
| 7 | **Filter-first screens** on mobile put a 364–604 px form before any content (events 604 px / 9 controls) — no collapse/sheet | **P2** | `/events`, `/faces`, `/playback`, `/notifications` | `events-mobile.png`, `faces-mobile.png`, `playback-mobile.png`, `notifications-mobile.png` |
| 8 | **Playback on mobile**: player ends at y 861 (> 844 viewport) and the timeline starts at y 873 — timeline is below the fold, page is 1 186 px | **P2** | `/playback` (mobile) | `playback-mobile.png`, `playback-mobile-bottom.png`; probe `specific.playback` |
| 9 | **Tap targets < 44 px on every screen** (18–49 per screen; 24–26 < 24 px on faces/detection/notifications) | **P2** | all | probe `tapTargets`, e.g. `faces-mobile.png`, `notifications-mobile.png` |
| 10 | **Type floor**: 11 px metadata everywhere (47 nodes on mobile events, 58 on notifications), 10 px timeline axis | **P3** | all | `events-mobile.png`, `notifications-mobile.png`, `playback-mobile.png` |
| 11 | Camera tiles are fixed **16:9 boxes** while DVR sub-streams are ~1:1/4:3 → 30–40 % pillarbox bars; tile area under-used (focus mode wastes even more on portrait mobile) | **P3** | `/` all sizes | `dashboard-laptop.png`, `dashboard-tablet.png`, `dashboard-mobile.png`, `dashboard-focus-mobile.png` |
| 12 | **Settings sections have no shared sub-nav / breadcrumb**; links exist only on the `/settings` index and wrap on mobile | **P3** | `/settings/*` | `settings-mobile.png`, `settings-users-mobile.png`, `settings-detection-mobile.png` |
| 13 | **Login**: inputs 38 px, Sign in 36 px (below 44 px); otherwise clean at all three widths | **P3** | `/login` | `login-mobile.png`, `login-tablet.png`, `login-laptop.png` |
| 14 | **Safe area**: only the bottom nav uses `env(safe-area-inset-bottom)`; fixed save bars and `main`'s static `pb-28` do not adapt to home-indicator devices | **P3** | mobile | code `AppShell.tsx`, `DetectionSettings.tsx`; screenshots (headless env = 0 px) |
| 15 | **No horizontal page scrolling anywhere at the target widths** — document `scrollWidth == viewport` on all 51 screens, no `overflow-x` scrollers, no tables. **But at 320 px the header forces horizontal scroll** (see P3-15) | ✅ / **P3** below 360 px | all | `responsive-metrics.json` (`docOverflow: 0`) |
| 16 | **Camera focus mode works** at every size: header/sidebar/bottom bar hidden, tile fills viewport, Exit button present; `body` scroll locked | ✅ positive | `/` | `dashboard-focus-{mobile,tablet,laptop}.png`, `responsive-states.json` |

**Severity key** — P0 blocks a workflow outright; **P1 breaks a core action at a target width (has no clear
workaround)**; P2 = significant friction or accessibility failure with a workaround; P3 = polish/consistency.
Nothing found rises to P0.

---

## 3. Findings in detail

### P1-1 — Event detail is invisible after tapping a row on tablet and mobile

`/events` renders the detail panel in the second column only at `lg` (`lg:grid-cols-[minmax(0,1fr)_20rem]`).
Below 1024 px the grid collapses to one column, so `EventDetail` is appended **after the entire event list**.

Measured (row clicked, 20-row page):

| Width | List | Detail position | Result |
|---|---|---|---|
| 390 | y 362 → 1 884 (1 522 px tall) | **y 1 900** (below the fold by 1 056 px) | tap appears to do nothing |
| 834 | y 593 → 2 115 | **y 2 131** (below the fold by 1 019 px) | tap appears to do nothing |
| 1440 | y 413 → 1 935 | x 1 096, y 413 (side panel) | works |

Only feedback on tap is the row's teal border + `aria-pressed`. There is no scroll-into-view, no sheet, no
navigation. The detail actually exists, at the very bottom of the page (see `events-selected-detail-*.png` and
`events-tablet-bottom.png`, which shows the detail after the pager "Page 1 of 16").

**Redesign direction:** on `<lg` open the detail as a bottom sheet / full-height drawer / dedicated route with
visible selection feedback, or at minimum scroll the panel into view and add a close affordance.

### P1-2 — Object-detection save bar sits behind the mobile bottom navigation

`DetectionSettings` renders a fixed footer (`fixed inset-x-0 bottom-0 z-20`, 69 px tall) while `AppShell`'s
bottom bar is `fixed … bottom-0 z-40` and 39 px tall on the same edge. Measured on 390×844:

- save bar: y 775 → 844, z 20
- bottom bar: y 805 → 844, z 40
- **overlap: 39 px**, i.e. the lower **26 px of the 44 px Save button and the whole help sentence are covered**
  by the nav (`settings-detection-mobile.png`, `settings-detection-mobile-bottom.png`). Tapping the lower half of
  "Save settings" hits a nav item instead.

At tablet/laptop the bar does not overlap (no bottom bar) and the 96 px `pb-24` page padding clears it.
**Fix direction:** place the save bar above the safe-area + nav height (`bottom: calc(env(safe-area-inset-bottom) + nav-h)`),
hide it in favour of a sticky action row, or raise its z-index and give the page matching bottom padding.

### P2-3 — The 768–1023 px band (our 834 px tablet) gets the worst of both layouts

- `md` (768) turns on the 220 px sidebar **and** hides the mobile bottom bar **and** locks the shell to `h-dvh`
  with an inner scroll region.
- `lg` (1024) turns on the 2-column camera grid, the 20 rem events detail column (P1-1) and the 3-column faces
  grid — none of these apply at 834.

Consequences at 834 × 1112: content width 614 px (26 % of the screen is sidebar), dashboard tiles are 566 × 373
in **one column**, so 4 cameras need an **inner scroll of 900 px** (`main` 1952 vs 1051 available;
`dashboard-tablet-bottom.png`). A 2×2 grid at that height would fit. Same band: `/faces` drops to 2 columns
(6 274 px of content), `/events` loses the side panel.
**Redesign direction:** either add a `md`-level 2-column grid / collapsible rail, or move the sidebar breakpoint
to `lg` and treat 768–1023 as an enlarged mobile/compact layout with the bottom bar.

### P2-4 — Mobile header is over-subscribed

Measured on 390 px (`/`):

- brand block: **w = 4.5 px**, header title **w = 0** — "Home CCTV" is invisible; only the 28 px logo shows;
- action cluster: **353.5 px** (`Connected` 65 + `Enable notifications` 133 + `Account` 63 + `Log out` 68 + gaps);
- the logo (x 12→40) overlaps the action cluster (starts x 24.5) by **15.5 px**;
- controls are **36 px** tall (below 44 px);
- on `/settings` while DVR status was "Checking", the pre-hydration `--:--:--` clock span made the action row
  **443 px > 390 px** (header `scrollWidth` 463), i.e. a brief clipped/overflowing header on first paint.

**Redesign direction:** keep the brand visible (title or mascot) and the actions inside one predictable
priority: status → notifications → overflow menu (account/logout). Kill the `--:--:--` placeholder before
hydration (render nothing until mounted) so the header never overflows during load.

### P2-5 — Eight-item bottom bar is below tap-target and label budgets

`grid-cols-8` in 390 px → **49 × 38 px** per item, 11 px labels, 39 px bar height (safe-area 0 in headless).
At 390 the short labels ("Home, Cameras, Playback, Events, Faces, Alerts, Device, Settings") fit with only a few
px of headroom; at 320 px each column is 40 px and "Settings" (44 px of text) truncates. Tap height (38 px) is
below 44 px on every mobile screen.
**Redesign direction:** 4–5 primary destinations + "More" sheet, or a scrollless icon+label rail; ensure ≥ 44 px
touch height, include the safe-area inset in the bar's height, and never use a fixed 8-column grid.

### P2-6 — Faces list has no density control

`348 detected faces` → 13 284 px tall at 390 (cards 366 × 560/591), 6 274 px of inner scroll at 834 (2 columns),
5 478 px at 1440 (3 columns of 383 × 706 cards). Each card's only action is a 340 × 16 px "View event" link
(24 instances < 24 px on mobile). At the bottom of the mobile page there is no paging control at all.
**Redesign direction:** paginate or virtualise, use a compact thumbnail grid (2–3 columns of ~150 px tiles) with
per-tile actions, or a grouped-by-event list.

### P2-7 — Filter-first mobile screens

Forms above the content, always expanded, one column at 390:

| Screen | Form height | Controls | Page height (mobile) |
|---|---|---|---|
| `/events` | 604 px | 9 (camera, classification, date, from, to, read, notification, priority, submit) | 3 044 px |
| `/faces` | 364 px | 5 | 13 284 px |
| `/playback` | 364 px | 5 | 1 186 px |
| `/notifications` | 364 px | 5 | 4 152 px |

At 390 the user sees only filters for the first ~0.7 viewport on `/events`; quick-filter chips already wrap to
2 rows. `/settings/audit-log` shows the alternative pattern that works (148 px, inline row).
**Redesign direction:** collapsed "Filters" summary + sheet on mobile, quick chips first, live result count.

### P2-8 — Playback layout on mobile and the letterboxing on large screens

- 390: player 366 × 340 at y 521 → **bottom 861 > 844**; timeline 366 × 202 at **y 873** (below fold);
  transport controls require scrolling. Total page 1 186 px.
- 834: player 566 × 530, timeline ends at 1 088 vs 1 112 viewport — fits, with 24 px to spare.
- 1440: player 1 172 × 454 with large pillarbox (see P3-11), timeline 675 → 876, fits.
**Redesign direction:** mobile should prioritise a sticky player + timeline/transport; move filters into a sheet
so the player and timeline share the first screen.

### P2-9 — Tap targets below 44 px (and below 24 px) on every screen

Probe counts per screen at 390: `/` 18 (<24: 2), `/events` 18, `/faces` 37 (<24: **24**), `/notifications` 38
(<24: **25**), `/settings/detection` 49 (<24: **26**), `/settings/users` 21, `/playback` 15, login 3.
Representative offenders:

| Element | Size | Screen |
|---|---|---|
| `View event` link | 340 × **16** | `/faces` |
| `Open event` link | 65 × **16** | `/notifications` |
| Header `Enable notifications` / `Account` / `Log out` | **36** px tall | all |
| Quick-filter chips (`All/Person/Vehicle/…`) | 36 px tall | `/events`, `/notifications` |
| Bottom-nav items | 49 × **38** | all mobile |
| `Statistics` / `All events` header links | 55/62 × **20** | `/` |
| Volume slider | 97 × **16** | `/playback` |
| Threshold sliders | 218 × **20** | `/settings/detection` |
| User row buttons (`Disable`, `Switch role`, …) | 40 px tall | `/settings/users` |
| Login inputs / `Sign in` | 38 / **36** px | `/login` |
| Playback zoom `24h/6h/1h` | 43/36/36 × **32** | `/playback` |

Note the app already uses 44 px (`h-11`) for the primary buttons in forms — the small targets are the inline
links, header controls, chips, nav and sliders.

### P3-10 — Typographic floor of 10–11 px

11 px for badges/time/meta and 10 px for the playback timeline axis. Counts at 390: `/events` 47 nodes,
`/notifications` 58, `/account` 39, `/` 17. It reads as "dense CCTV tool", but it is below comfortable mobile
legibility. If the redesign keeps 11 px meta text, raise contrast rather than size.

### P3-11 — Camera tiles are 16:9 while streams are not

The media box is `aspect-video` (`16:9`): 364 × 205 (mobile), 564 × 317 (tablet), 576 × 310 (laptop). The DVR
sub-streams render at roughly 1:1/4:3, so `object-contain` produces wide pillarbox bars — visible in
`dashboard-laptop.png` (≈190 px of black on each side of a 576 px tile) and `dashboard-tablet.png`. The tiles look
empty even though the grid is the page's main feature. In focus mode on a portrait phone the same ratio problem is
worse: `dashboard-focus-mobile.png` shows a 390 × 376 video inside a 390 × 844 viewport (≈55 % of the screen is
black). Consider sizing the media box from `video.videoWidth / video.videoHeight` once metadata arrives, using a
tighter tile ratio at ≥lg, and letting focus mode fit-to-height/width rather than contain inside the full viewport.

### P3-12 — No settings sub-navigation

`/settings` shows the only cross-links (inline text row: Users · Notification rules · Object detection · Audit log ·
System); it wraps onto two lines at 390. From `/settings/users`, `/settings/detection`, `/settings/audit-log`,
`/settings/system` there is no breadcrumb, no section nav and no "back to settings" link. Desktop is identical.
The redesign's settings hub should introduce a persistent section nav (sidebar sub-nav at ≥md, list at mobile).

### P3-13 — Login

Card is `max-w-sm` and centres cleanly at 390 (358 px card), 834 and 1440; no overflow, no truncation. Only
tap-size nits: inputs 38 px tall, `Sign in` 36 px, all 308–334 px wide. Not a layout problem; note if the
redesign wants a stricter 44 px form standard.

### P3-14 — Safe area is only half-handled

Only the bottom bar consumes `env(safe-area-inset-bottom)`; the detection save bar (P1-2), `main`'s `pb-28` and
the fixed chrome do not. Chromium headless reports 0 px, so this cannot be visually verified here — flagged as a
risk for iPhone/iPad PWA use, and it compounds P1-2 because the nav grows on those devices while the save bar
stays glued to `bottom: 0`.

### P3-15 — Below ~360 px the header forces horizontal page scroll

The three target widths pass, but the header has no lower bound. Measured at **320 × 700** (iPhone SE / large
system font class): the header action cluster is 374 px wide → `document.scrollWidth` 374 > 320, i.e. the page
scrolls horizontally by 54 px; the bottom bar keeps 8 equal 40 px columns and truncates "Settings" (label 44 px
in 40 px, `truncate` active). This is the same over-subscription as P2-4, just past its breaking point.
**Redesign direction:** the mobile header must allow the action cluster to collapse (icon-only or overflow menu)
before 360 px, and the bottom bar must not use a fixed 8-column grid.

### Positive findings worth preserving

1. **No horizontal scrolling at 390/834/1440**: `document.scrollWidth == viewport` on all 51 screens; no
   `overflow-x: auto|scroll` container exists in the app at any width (probe `hScrollers` is empty for every
   screen). The events "table" era is gone — the DOM contains zero `<table>` elements on all 51 screens, and long
   values truncate with `truncate`/ellipsis rather than being clipped. The only non-ellipsis text collapse is the
   header brand at mobile (P2-4).
2. **Camera focus mode** (`dashboard-focus-*.png`): at 390/834/1440 it hides header, sidebar and bottom bar,
   fills the viewport with a fixed tile, locks body scroll, and exposes an `Exit` button — consistent across sizes.
3. **Event details page** `/events/<id>` reflows correctly (snapshot `aspect-video`, meta `dl` grid
   `[auto_minmax(0,1fr)]`); at 390 only the action row lands below the fold.
4. **Sticky header + inner scroll region** work: on tablet/laptop the header stays while `main` scrolls; on
   mobile the header is sticky over the document scroll.
5. **Settings index, device, stats, account** reflow without overflow: status strips stack, definition grids go
   1→2 columns, no clipped values (`break-all` on long values works).

---

## 4. Per-screen notes

All paths are under `design/audit/before/`; `-full` = full-page, `-bottom` = scrolled-to-bottom.

**`/` dashboard** — `dashboard-{mobile,tablet,laptop}.png` (+ `-full`, `-bottom`, `dashboard-focus-*`)
- mobile: header crowding (P2-4), 4 stacked tiles 366 × 261, recent-events list rows 332 × 30 (tap target 30 px),
  document 1 691 px. Nav overlays the last row until scrolled.
- tablet: **1-column** grid due to `lg` threshold (P2-3); 4 × 566 × 373 tiles need 900 px inner scroll; only 2
  cameras visible at a time on a 1 112 px tall screen.
- laptop: 2 × 2 grid fits the viewport (578 × 366 each), recent events below the fold, inner scroll 1 170/839.
- focus mode: correct at all sizes.

**`/cameras`** — `cameras-{mobile,tablet,laptop}.png`
- Reflows cleanly: channel cards stack, name field + Save + "Use DVR name" become full width at 390,
  channel metadata 2-col. Buttons 44 px. Mobile page 1 549 px.
- Only nit: repeated "Save" buttons per channel (not a responsive defect).

**`/events`** — `events-{mobile,tablet,laptop}.png`, `events-selected-*`, `events-bottom`
- **P1-1** detail placement below 1024.
- **P2-7** 604 px filter form before results on mobile; 2-col form at tablet (364 px) with an empty cell
  (Priority leaves a gap); 4-col at laptop (204 px).
- Rows are 65 px tall (good); pagination "Previous / Page 1 of 16 / Next" sits after the list (1 522 px list).
- List + filter are otherwise overflow-free at every width.

**`/events/<id>`** — `event-detail-{mobile,tablet,laptop}.png`
- Snapshot is `aspect-video` and scales correctly; meta `dl` two-column label/value works at 390; the
  "View recording / Open details" buttons are 44 px and wrap. Mobile page 1 079 px — the last meta row + actions
  sit under the fixed nav until scrolled (normal). No overflow.

**`/events/stats`** — `event-stats-{mobile,tablet,laptop}.png`
- Fits: `max-w-3xl` column, stat tiles 2-col at mobile / 3-col at ≥sm, bars are percentage-width. No issues.

**`/faces`** — `faces-{mobile,tablet,laptop}.png`
- **P2-6** unbounded card grid, 348 faces, 13 284 px page at 390; 2 columns at 834; 3 columns at 1440 with
  383 × 706 cards. `View event` links 16 px tall. Filter form 364 px, always open.

**`/playback`** — `playback-{mobile,tablet,laptop}.png`, `playback-mobile-bottom.png`
- **P2-8**: mobile player overflows the first screen and the timeline starts below the fold; tablet fits with
  24 px margin; laptop fits. Controls (transport 44 px, zoom chips 32 px, volume slider 16 px) wrap into one row
  at mobile and are tight. Tablet/mobile shots caught the player in "Connecting to DVR…" (data timing, not layout).

**`/notifications`** — `notifications-{mobile,tablet,laptop}.png`
- 364 px filter form + stat row; rows are cards with `Open event` links (65 × 16). 4 152 px at 390, 3 071 px of
  inner scroll at 834, 2 991 px at 1440 (no pagination). No overflow.

**`/device`** — `device-{mobile,tablet,laptop}.png`
- Definition grid 1-col at mobile, 2-col at ≥sm; long values wrap (`break-all`). Fits viewport at tablet/laptop.
  No issues.

**`/account`** — `account-{mobile,tablet,laptop}.png`
- Password form 44 px inputs; sessions list long (16 sessions → 2 564 px at mobile, 3 874 px inner scroll at
  laptop) but no pagination need. User-agent strings truncate with ellipsis. `Sign out everywhere` is the only
  outlined/warning button. No overflow.

**`/settings`** — `settings-mobile.png` (+ tablet/laptop)
- Inline settings links wrap to 2 lines at mobile; status strip stacks 3 rows; definition list 1-col at mobile.
  Header crowding + transient `--:--:--` overflow observed here (P2-4). No overflow.

**`/settings/notifications`** — `settings-notifications-{mobile,tablet,laptop}.png`
- Action buttons (`Enable notifications`, `New rule`, `Send Telegram Test`) wrap; rule cards stack; long
  "Telegram: Disabled · Rule events: Off …" line wraps. Filter/test forms reflow. No overflow.

**`/settings/users`** — `settings-users-{mobile,tablet,laptop}.png`
- User cards with 6 action buttons each; wrap into 2–3 rows at mobile, buttons 40 px (P2-9). Create-user form
  44 px inputs. No overflow.

**`/settings/detection`** — `settings-detection-{mobile,tablet,laptop}.png` (+ `-bottom`)
- **P1-2** save bar under the bottom nav at mobile. Otherwise reflows: 1-col groups, sliders + number inputs
  20/40 px, max-w-3xl. Long page (3 241 px mobile / 2 192 px inner scroll laptop) but correctly padded for the
  desktop fixed bar.

**`/settings/audit-log`** — `settings-audit-{mobile,tablet,laptop}.png`
- Compact filter row (148 px at mobile) is the good pattern; list rows stack time + action + user. 2 335 px at
  mobile; no overflow, no table.

**`/settings/system`** — `settings-system-{mobile,tablet,laptop}.png`
- Read-only rows, long values wrap, 1 729 px at mobile. No issues.

**`/login`** (unauthenticated fresh context) — `login-{mobile,tablet,laptop}.png`
- Centred `max-w-sm` card, full width minus 32 px margins at 390; no horizontal scroll; no keyboard overlap
  issues visible at these sizes. Inputs 38 px / button 36 px (P3-13).

---

## 5. Breakpoint behaviour map (as implemented today)

| Width | Shell | Navigation | Layout consequences |
|---|---|---|---|
| `< 768` (tested at 390; breaks at < 360) | document scroll, `main` `pb-28` | header actions (lamp, notifications, account, logout) + fixed 8-item bottom bar | 1-col everything; filter forms always open; faces 1-col; events detail after list. At 320 px the header forces a 54 px horizontal page scroll and "Settings" truncates in the bar |
| `768–1023` | `md:h-dvh` + inner `main` scroll, 220 px sticky sidebar | sidebar 8 items + account/logout; header brand/clock/notifications | still 1-col camera grid, 2-col faces, no events side panel — the gap in P2-3 |
| `1024–1279` | same shell | same sidebar | 2×2 camera grid, events 2-col (20 rem detail), faces 3-col |
| `≥ 1280` (`xl`) | same shell | same sidebar | 4/5-col filter bars, faces stat row 5-col; `2xl` faces 4-col (≥1536) |

---

## 6. Recommendations for the redesign (priority order)

1. Make the event selection legible below 1024 px: sheet/drawer/detail route + immediate visual feedback
   (P1-1). This is the single worst interaction break.
2. Prevent fixed bars from stacking on one edge: one owned "bottom offset" token (safe-area + nav height) used by
   the nav and any save bar (P1-2, P3-14).
3. Decide the 768–1023 band deliberately: 2-column dashboard + collapsible rail (or move sidebar to `lg`)
   (P2-3).
4. Give mobile a real header/nav system: brand + status + overflow menu (already needed below 360 px), 4–5 bottom
   destinations with a "More" sheet, ≥44 px everywhere (P2-4, P2-5, P2-9, P3-15).
5. Introduce a mobile filter pattern (collapsed summary / sheet) and make `/faces` dense and paginated
   (P2-6, P2-7).
6. Playback: keep player + timeline in the first mobile viewport, move filters to a sheet, size the media box
   from the real stream aspect (P2-8, P3-11).
7. Typography and detail polish: 12 px floor for meta, settings sub-nav, 44 px login controls, safe-area-aware
   chrome (P3-10, P3-12, P3-13).

**Regression checks the redesign must pass (because they already pass today):** no horizontal page scroll at
390/834/1440; focus mode still hides chrome and locks scroll; long values still wrap (`break-all`); sticky header
still works at both scroll models; camera tiles keep their aspect (`object-contain`, no stretching).
