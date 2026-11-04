# UX, Accessibility & Visual Audit — Home CCTV Hub

**Task:** task-2 · **Auditor:** ux-auditor · **Date:** 2026-11-04 (Asia/Kolkata)
**Target:** http://localhost:3000 (pre-existing dev server, never restarted)
**Method:** source read of every screen + Playwright evidence capture (Chromium, 1600×1000 desktop, 390×844 mobile, 834×1112 tablet spot-checks) + programmatic measurement of tap targets, type sizes, component variants, keyboard order, and WCAG contrast ratios.

**Write scope:** this file only, plus `design/tools/ux-audit-*.mjs` and `design/audit/before/uxaudit-*.png` / `uxaudit-measurements*.json`. No application code was modified.

---

## 0. How to read this document

**Severity**

| Severity | Definition |
|---|---|
| **P0** | Breaks a primary task or hides a safety-critical fact. Fix before any redesign work. |
| **P1** | Systematically degrades a primary task or fails WCAG 2.2 AA. Fix in the first redesign pass. |
| **P2** | Noticeable inconsistency/polish debt with a workaround. |
| **P3** | Cosmetic or wording-level. |

**Evidence conventions**

- Source refs are `path:line` relative to the repo root (verified by reading the file).
- Screenshots are under `design/audit/before/`. `uxaudit-*` were captured for this audit; the existing `*-desktop*.png` set was also reviewed (several were captured before data loaded).
- Contrast values are computed with the WCAG 2.x relative-luminance formula (including alpha compositing for `/15`-style tints and `disabled:opacity-*`). Full table in [Appendix A](#appendix-a--contrast-table).
- Measurements come from `design/audit/before/uxaudit-measurements.json`, `uxaudit-measurements-2.json`, `uxaudit-measurements-3.json`.

**Finding IDs:** `G` global shell · `D` dashboard · `E` events list · `ED` event detail · `P` playback · `C` camera setup · `F` faces · `NH` notification history · `NR` notification rules · `S` settings overview · `U` users · `DT` object detection · `SY` system · `AL` audit log · `DV` device · `AC` account · `L` login · `ST` states/empty/error.

**Environment / data state at audit time** (important context for every state claim):

- DVR `connected`, video gateway `connected`, all 4 cameras live and streaming (the earlier `design/audit/before/*-desktop.png` set was partly captured before data loaded; the new `uxaudit-*` set shows the loaded state).
- 301 events today, 7,571 in the last 30 days, 348 detected faces, 2 users.
- Object detection **off**, worker `stopped`; face detection **enabled** but worker stale 14 days; backup stale 14 days; disk **91.8 % used**; 27 active sessions.
- MediaMTX was **not** offline during this audit, so "Video gateway unavailable" was not exercised live; the video-area states were judged from source (`LivePlayer.tsx`, `MessagePanel`) and the tile chrome was judged in the loaded state. This limitation is called out wherever it matters.

---

## 1. Executive verdict

**The product is a well-engineered hobby dashboard, not yet an operator console.** The engineering care is real — the playback timeline is genuinely good, states are honest, and accessibility basics (labels, `aria-current`, `sr-only` status text, focus-visible ring, reduced-motion rule) are present. But the interface answers *"can I see my cameras?"* when a surveillance operator asks *"is anything wrong, and what do I owe a response to?"*

Five signals separate "hobby project" from "operator console" here:

1. **The dashboard has no overview layer.** Four video tiles fill the screen; there is no event count, no unread-alarm count, no camera/DVR/gateway health strip, no timeline. At 1600×1000 the "Recent security events" panel begins at **y = 1032 px — 32 px below the fold** (measured; `uxaudit-measurements-3.json`). The one screen an operator lives in shows none of the operational facts.
2. **There is no alarm lifecycle.** Events can be marked read, but only as a silent side effect of opening the detail page (`src/components/events/MarkReadOnView.tsx:10-25`). There is no unread badge in the navigation (`src/components/layout/AppShell.tsx:23-33`), no acknowledge action, no "mark all read", no unread default view. An operator cannot answer "what did I miss?" — the one thing a CCTV hub is for.
3. **Dangerous states are invisible where they matter.** Disk 91.8 % full, backup 14 days stale, face worker dead for 14 days — all of this is buried inside *Settings → System* and requires an ADMIN to go looking (`src/app/(hub)/settings/system/page.tsx:87-185`). The global status lamp can show a stale "Connected" while polling fails (`src/lib/hooks/…` → `src/components/hooks/usePoll.ts:38-56`, `AppShell.tsx:109-115`), and a dropped WebRTC stream keeps a frozen frame labelled "Live" (`src/components/camera/LivePlayer.tsx:30-54, 311-320`).
4. **The chrome is a website, not a console frame.** A 220 px sidebar of eight flat links, a header that repeats the brand already shown in the sidebar, a per-page intro paragraph, and settings reached through a paragraph of teal text links (`src/components/settings/SettingsView.tsx:35-45`). Nothing is grouped by "monitor" vs "administer" vs "investigate".
5. **There is no design system.** 260 measured controls produce **26 visibly different treatments**; 549 interactive elements across 15 routes, **306 of them under 44 px** in at least one dimension; 47 inputs use 4 different combinations incl. two different fills (`bg-card` vs `bg-bg`) for the same role; 24 hard-coded hex colours (13× `#08110f`) and 29 arbitrary value classes bypass the theme; **no `Button`, `Input`, `Card`, `Field`, `Badge`, `Dialog` or `EmptyState` primitive exists** (`src/components/ui/` contains only `Mark`, `States`, `StatusLamp`).

**Strengths to preserve (do not regress these in the redesign):**

- **Text contrast is genuinely good**: body ink 16.9:1, secondary muted 6.5:1 on cards, teal links 10.5:1, status colours 6.2–10.5:1, primary button ink 11.6:1. The palette is not the problem — the *boundaries* are (see §4.1.1).
- **The playback timeline** (`PlaybackTimeline.tsx`) is real operator thinking: density-aware marker grouping, hover thumbnails, keyboard seek, `role="slider"` with `aria-valuetext`, zoom presets, segment/gap semantics, and an accessible marker label built from real event data.
- **States are honest**: no fake "0" for disabled features (`EventFacesPanel` renders nothing when disabled), "Checking" instead of blanks, retry affordances, and empty-vs-filtered empty copy that names the cause (`EventsView.tsx:295-300`).
- **Accessibility intent exists**: every camera/status lamp has an `sr-only` full label (`StatusLamp.tsx:29-45`), every page has exactly one `<h1>`, zero unlabeled form controls and zero missing `alt` were found in the measured set, the login form never puts credentials in the URL, and the date popover implements `aria-haspopup/expanded/controls` + Escape (`DatePickerField.tsx:88-112`).
- **Security-aware copy**: password masking, "sessions revoked" wording, no bot token in the browser, admin-only route guards.

**Scorecard** (for tracking progress, not for scoring people)

| Dimension | Grade | One-line rationale |
|---|---|---|
| Operator fit / IA | **D** | No overview, no alarm queue, no staleness model; best tool (timeline) buried in Playback. |
| Visual hierarchy | **C−** | Page title 20 px vs section title 14 px; the loudest elements are header buttons, not operational state. |
| Density / data display | **D+** | Card-per-event lists at 65–103 px/row, 20–25 rows/page; only one screen uses a table-like layout. |
| Typography | **C−** | 53 % of text ≤ 12 px; 11 px is the second-most-common size; 9–10 px in the timeline; no display scale. |
| Colour | **B−** | Text contrast passes; red/amber/teal each carry 4–5 unrelated meanings; 1.2–1.3:1 borders. |
| Consistency / systemisation | **D+** | 26 button treatments, 4 input treatments, 4 card paddings, no primitives. |
| States & feedback | **C** | Good honesty, weak freshness and weak success/error prominence; no live regions. |
| Accessibility (WCAG 2.2 AA) | **C** | Strong semantics, but target size (53 %), non-text contrast, focus-on-primary-CTA, skip link and alert-dialog focus fail. |
| Responsive | **C−** | No overflow at 390 px, but the mobile Events filter wall and the mobile save-bar collision are blocking. |

---

## 2. Top-12 ranked problems

Ranked by (operator impact × reach), not by ease. File:line evidence is reproduced in the per-screen sections.

| # | Sev | Problem | Screen(s) | Evidence | First move |
|---|---|---|---|---|---|
| 1 | **P0** | **The dashboard is a video grid, not an operator overview.** No event KPI, no unread count, no camera/recorder health strip, no 24 h timeline; "Recent security events" starts 32 px below a 1000 px viewport. The screen cannot answer "is anything wrong?" | Dashboard | `uxaudit-dashboard-loaded.png`; `DashboardView.tsx:72-118`; measured `recentEvents.top = 1032` vs viewport 1000 (`uxaudit-measurements-3.json`) | Add a KPI/health strip + right-side alarm rail above the fold; move the grid to the remaining height. |
| 2 | **P0** | **No alarm acknowledgement lifecycle.** Opening an event silently marks it read; no unread badge, no ack action, no unread view, no "mark all read". Read state is invisible except a small "New" tag. | Global, Events, Event detail | `MarkReadOnView.tsx:10-25`; `AppShell.tsx:23-33` (no counts); `EventsView.tsx:315`; `uxaudit-events-loaded.png` | Introduce unread count per nav item + an explicit Acknowledge button + an "Unread" default segment. |
| 3 | **P0** | **The fixed Save bar on Object detection collides with navigation.** On mobile the Save button sits 27 px *under* the bottom nav (bar z-20 vs nav z-40), so the last action of the page is partly unclickable; on desktop the bar spans the full viewport and covers the sidebar's Account/Log out. | Object detection (mobile + desktop) | `uxaudit-mobile-detection-savebar.png`; `uxaudit-detection-desktop-bar.png`; `DetectionSettings.tsx:681-696` measured: mobile save 788–832 / nav 805–844 → overlap; desktop bar 0–1600 × 931–1000 vs Log out 948–988 → overlap | Make the save bar `sticky` inside the content column (or inset it by the sidebar width) and `bottom: calc(nav height)`. |
| 4 | **P1** | **Degradation and data freshness are invisible on monitoring surfaces.** "Needs attention (degraded)" (disk 91.8 %, backup 14 d stale, face worker 14 d dead) exists only inside Settings → System. The header lamp can report a stale "Connected"; a dropped stream freezes while labelled "Live"; nowhere shows "last updated". | Dashboard, header, System, Live player | `system/page.tsx:87-185`; `uxaudit-system-loaded.png`; `usePoll.ts:38-56`; `AppShell.tsx:109-115`; `LivePlayer.tsx:30-54, 311-320` | Promote a health summary to the shell/dashboard; add a `lastUpdated`/`stale` state; add a live-stream health listener. |
| 5 | **P1** | **Unsaved edits are silently discarded.** Toggle a detection switch, navigate away and back: the change is gone, with no dirty indicator, no save prompt, no toast. Proven experimentally. Same class of risk for every uncontrolled form in the app. | Object detection, User create, Rule form, Account | `DetectionSettings.tsx:230-238, 270-290` (no dirty state / no `beforeunload`); probe result `{before:false, after:true, reloaded:false, lost:true}` (`uxaudit-measurements-2.json`) | Add a dirty-state model + sticky "Unsaved changes" bar and navigation guard. |
| 6 | **P1** | **Mobile Events is a filter wall.** On a 390×844 phone the page shows title + intro + 5 wrapping filter pills + 7 stacked filter fields; the first event row is below ~1 100 px (≈1.3 viewports) and the result count is never visible with the filters. | Events (mobile) | `uxaudit-mobile-events.png`; `EventsView.tsx:196-285` (`sm:grid-cols-2 xl:grid-cols-4`, 7 fields) | Collapse advanced filters behind a "Filters (n)" drawer; keep quick segments + result count sticky. |
| 7 | **P1** | **Colour semantics collide and boundaries disappear.** Red = person classification dot, CRITICAL priority, offline status, alarm recording, error text; amber = HIGH priority, vehicle classification, warnings, "Failed" pill; teal = CTA, link, active nav, selection, playhead, "New", focus ring. Meanwhile the 1 px `line` token is **1.23–1.30:1** (invisible input/card boundaries), and the teal focus ring on a teal primary button is **1:1** (no visible keyboard focus on the app's main CTAs). | Global | `PriorityBadge.tsx:3-8`; `EventsView.tsx:33-37`; `PlaybackTimeline.tsx:19-24`; `StatusLamp.tsx:26-27`; `globals.css:9, 64-67`; contrast §4.1.1 | Split the palette into *interactive accent*, *status*, *priority*, *classification* roles; raise `line` to ≥3:1; give the focus ring a contrasting gap/double ring. |
| 8 | **P1** | **No design-system primitives → measurable drift.** 549 interactive elements / 306 below 44 px; 260 controls in 26 treatments (heights 30/32/36/40/44/58, radii 0/8/12); 47 inputs in 4 treatments with two different fills for the same job; 24 hard-coded hex values; 29 arbitrary value classes; no Button/Input/Card primitives. | Global | `uxaudit-measurements-3.json`; `src/components/ui/` inventory; `grep` hex/arbitrary counts | Build the primitives (§6.2) *before* redesigning screens; enforce tokens with lint. |
| 9 | **P1** | **The type scale has collapsed.** 642 nodes at 14 px, 496 at 12 px, 263 at 11 px, 7 at 10 px, 6 at 9 px; only 38 nodes (2.6 %) are ≥16 px. `h1` is 20 px and the section `h2` is 14 px — a 1.43 ratio; Playback's `h1` is 16 px. Nothing is sized for glance-reading at 1–2 m. | Global, particularly Playback, Events, Notifications | font census (`uxaudit-measurements.json`); `States.tsx:37-51`; `PlaybackTimeline.tsx:327, 429` | Adopt a 7-step console scale (§6.1.2) with a 12 px floor and 24/32 px page/KPI sizes. |
| 10 | **P1** | **Keyboard and focus access is incomplete.** Teal ring invisible on teal CTAs; **11 tab stops** before `<main>` (8 nav + Account + Log out + notifications), no skip link; `role="alertdialog"` confirmations (delete user, delete rule) do not move focus or trap it; `alert` text is not announced for async list refreshes (no `aria-live`/`aria-busy`). | Global, Users, Notification rules | `uxaudit-focus-events.png` + probe; `uxaudit-measurements-3.json` (`tabStopsBeforeMain:11, hasSkipLink:false`); contrast 1:1; `UsersView.tsx:163-171`; `NotificationRules.tsx:268-276` | Skip link, ring spec, focus management for dialogs, `aria-live` for async counts. |
| 11 | **P2** | **Navigation mixes monitoring and administration in one flat list, and settings have no shell.** 8 flat items put Camera setup/Device/Settings beside Dashboard/Playback/Events; `/settings/*` sub-pages have no sub-nav or breadcrumb (you reach them from a sentence of teal links); viewers are silently redirected (`redirect("/")`) with no explanation; the mobile bar is 8 × 49 px items at 11 px type. | Global, Settings | `AppShell.tsx:23-33, 139, 227-246`; `SettingsView.tsx:35-45`; `settings/layout.tsx:4-9`; `uxaudit-mobile-dashboard-loaded.png` | Group nav (Monitor / Investigate / Administer) and give settings a two-pane shell with a real sub-nav. |
| 12 | **P2** | **Several surfaces still read as prototype.** Events are 65 px cards at 20/page with no dense scanning mode or bulk actions; the face gallery renders 398–504 px-tall crops inside 322 px columns (ragged, non-square cards, 348 "Unassigned"); Camera setup labels the name field as "Channel 1" and shows no camera thumbnail; System prints raw UTC ISO timestamps and "1184926 seconds"; time appears in four different formats across the app. | Events, Faces, Camera setup, System, Account | `uxaudit-faces.png`; `uxaudit-cameras.png`; `FaceCard.tsx:17-32`; measured faces geometry; `system/page.tsx:148, 171`; `AccountView.tsx:20-24`; `CamerasView.tsx:125-135` | Redesign list density + Faces/system-data presentation; normalise all time display to IST 24 h. |

**Why these twelve:** items 1–3 break what the product is *for* or block a task outright; 4–5 create false confidence; 6–7 make the interface lie or disappear; 8–9 are the root causes that will re-create 1–7 on every new screen; 10–11 are the accessibility/IA debt that makes the redesign expensive later; 12 is what will still read "hobby" after the rest is fixed.

---

## 3. What a surveillance operator needs vs what exists

| Operator need | Expected affordance | Current state | Sev |
|---|---|---|---|
| "Is anything wrong right now?" | Persistent health/KPI strip (cameras online, recorder, gateway, disk, backup, detections) | Nothing on Dashboard; health only under Settings → System (ADMIN) | **P0** |
| "What do I owe a response to?" | Unread/acknowledged alarm queue with counts, badges, bulk ack | Read state exists but auto-set by opening a page; no counts, no ack action | **P0** |
| "What happened in the last minutes/hours?" | Dense timeline or grouped event feed on the primary screen | Event list is a separate page, 65 px cards, 20/page; timeline only in Playback | **P1** |
| "Is the video I'm looking at current?" | Live/frozen/reconnecting indicator with timestamp, stale banner | Tiny 11 px "Live" chip; no frozen detection; polled data has no freshness mark | **P1** |
| "Show me this camera bigger / that event's recording" | One-click expand + jump to recording from every tile/event | Expand exists but hidden until hover (invisible on touch); "View recording" deep inside detail page | **P1** |
| "Can I scan many events quickly?" | Table/dense rows, sticky header, keyboard nav, saved filters | 20-row paginated cards, no keyboard nav, 7-field filter form | **P2** |
| "Can I leave this on a wall display?" | Auto-refreshing, low-chrome, high-contrast (TV) mode | Full app chrome; fixed nav; no kiosk/TV mode | **P2** |
| "Prove what happened" (audit/export) | Export, shareable link, snapshot download, audit trail visible | Audit log exists (good); no download/export of an event bundle; snapshot has no download | **P2** |
| "On my phone, at a glance" | Thumbnail grid + alarm badge + one-tap ack | 4 stacked tiles (2.5 visible), no alarm badge, ack impossible | **P2** |

---

## 4. Cross-cutting findings

### 4.1 Visual system

#### 4.1.1 Surfaces and boundaries — the palette's real weakness

Text contrast is good; **non-text contrast is not**. The measured UI boundaries are invisible or near-invisible, which is why cards, inputs and the active nav state all depend on layout rather than on visible edges.

| Pair (computed) | Ratio | Requirement | Verdict |
|---|---|---|---|
| `--color-line` rgba(232,237,245,.10) over `bg` | **1.23:1** | 3:1 (WCAG 1.4.11 UI component) | **Fail** |
| `--color-line` over `card` (input border on card) | **1.30:1** | 3:1 | **Fail** |
| Active nav fill `white/10` over `panel` vs `panel` | **1.31:1** | 3:1 | **Fail** (active state relies on teal text alone) |
| Focus ring `teal` on a `bg-teal` primary button | **1:1** | 3:1 | **Fail** (invisible focus) |
| `warn/50` alert border on card | 3.56:1 | 3:1 | Pass |
| teal focus ring on bg / card / panel | 11.9 / 10.5 / 11.1:1 | 3:1 | Pass |
| Cards vs page bg (`#141b24` vs `#080b10`) | **1.14:1** | — | Cards barely separate from the page |

**Consequence:** form fields read as flat dark rectangles (see every filter bar), the selected nav item reads as grey text on a slightly grey pill, and a keyboard user tabbing to "Search", "Save", "Create user", "Sign in" or "Test" gets no visible focus at all — the highest-stakes controls in the product. Evidence: `src/app/globals.css:9` (`--color-line`), `src/app/globals.css:64-67` (focus ring), `src/components/ui/States.tsx:13-27` (card+input treatment), `design/audit/before/uxaudit-focus-events.png`.

**Recommendation**

```
--color-line:        #2b3441  /* decorative separators (1.38:1 card) */
--color-line-strong: #5c6878  /* inputs, card outlines, tabs (3.06:1 card, 3.48:1 bg) */
--color-surface-1:   #0e131a  /* page panel */
--color-surface-2:   #161e29  /* card */
--color-surface-3:   #1e2836  /* raised / menu / hover (1.34:1 above bg) */
```
and a focus spec that survives both dark and teal fills:

```
:focus-visible {
  outline: 2px solid var(--color-teal);
  outline-offset: 2px;
  /* primary buttons: dark inner gap so the ring is always visible */
  box-shadow: 0 0 0 2px var(--color-bg);
}
```
plus `outline-color: var(--color-ink)` on `.btn-primary:focus-visible` (ink on teal = 11.6:1).

#### 4.1.2 Typography

Font stack: `"Avenir Next", "Segoe UI", ui-sans-serif, system-ui` (`globals.css:16-17`). Avenir Next ships with macOS only; Windows users get Segoe UI, Linux gets a system sans. **The product therefore has a different typeface on every OS, and no webfont is loaded.** Mono is `"SF Mono", ui-monospace` — same issue. For a design system, either self-host one variable sans (e.g. Inter) + one mono (e.g. JetBrains Mono) or accept the system stack and stop tuning letter-spacing/metrics that assume Avenir.

Measured census across 15 authenticated routes (**1 452 text nodes with direct text**):

| Size | Nodes | Share | Used for |
|---|---|---|---|
| 20 px | 20 | 1.4 % | page `h1` (one per route; Playback drops to 16 px) |
| 16 px | 18 | 1.2 % | body-large/misc, Playback `h1`, `text-base` card titles |
| 14 px | 642 | 44.2 % | body, buttons, nav, most labels |
| 12 px | 496 | 34.2 % | metadata, captions, most `text-xs` |
| **11 px** | **263** | **18.1 %** | badges, "New", timestamps, captions, **body copy on Notifications/Faces** |
| **10 px** | **7** | 0.5 % | timeline ruler/playhead |
| **9 px** | **6** | 0.4 % | timeline marker count badges |

Findings:

- **TY-1 · P1 — The scale has no top end.** The largest type in the entire product is a 20 px page title; `h2` is 14 px, *the same size as body text* (`uxaudit-measurements-3.json`). Headings are not distinguishable from body except by weight/colour, so the eye has no entry point on any page.
- **TY-2 · P1 — 53 % of text is ≤12 px.** 11 px is the second-most-used size (263 nodes) and is used for *sentences*, not just micro-labels: notification rows ("Rule: all · Cooldown active for this rule"), face confidence/camera/date, camera "New" tags, session user-agent. At 11 px, no monitoring console is readable from a normal desk distance.
- **TY-3 · P2 — Sub-12 px is used inside the most interactive component.** `text-[10px]` ruler/playhead labels and `text-[9px]` count badges in `PlaybackTimeline.tsx:310, 327, 429` are smaller than the WCAG-sane floor and sit under the pointer during scrubbing.
- **TY-4 · P2 — No tabular figures outside a few places.** `font-mono tabular-nums` is used for times in lists but **not** in the `dl` metadata, the KPI numbers (Event statistics uses `text-xl font-semibold tabular-nums` — the one good pattern), or the System cards. Numbers do not align in columns.
- **TY-5 · P3 — Brand title and page title share a size.** "Home CCTV" (login `h1`, header) and every page `h1` are 18–20 px; hierarchy between brand, page and section is flat (`login/page.tsx:48`, `States.tsx:48`).

**Recommended console scale** (see §6.1.2): 12 micro-label / 13 secondary / 14 body / 16 emphasised / 20 card title / 24 page title / 32 KPI / 40 hero KPI. Minimum 12 px, with 12 px reserved for uppercase micro-labels with tracking, never for sentences.

#### 4.1.3 Spacing, density and radius

- **SP-1 · P2** — Padding is inconsistent by role: 59× `p-2`, 55× `p-3`, 23× `p-1`, 22× `p-4`, 3× `p-5`, 2× `p-6`. Cards use `p-3` (timeline), `p-4` (most), `p-5` (faces disabled), and `px-3 py-3` / `px-4 py-3` variants. There is no 8 px rhythm: 12 px is the de-facto unit for gaps (`gap-3`) while horizontal gutters are 12/16/24 px depending on breakpoint (`AppShell.tsx:220`).
- **SP-2 · P2** — Radius has three values with no rule: `rounded-lg` (8 px) on inputs/buttons, `rounded-xl` (12 px) on cards, `rounded-2xl` (16 px) on the login card, `rounded-full` on pills. Recommendation: 8 interactive / 12 containers / 999 pills, no 16.
- **SP-3 · P2** — Page frames vary: Dashboard/Playback are viewport-fit (`md:h-full`), everything else scrolls in the document; content widths are `max-w-3xl` (events detail, rules, detection), `max-w-2xl` (account), `max-w-xl` (user form), and full-width (dashboard/events/faces). At 1600 px the settings column is 768 px wide with 700 px of empty space to its right (`uxaudit-settings-detection.png`) — the console look ends at the page frame.
- **SP-4 · P3** — Table-less data: every list is a stack of cards with 12 px gaps; there is not a single `<table>`. Dense operator data (events, audit log, users, sessions) should be tabular with a sticky header.

#### 4.1.4 Colour semantics — one hue, many jobs

The theme defines five semantic colours (`globals.css:6-15`) and then reuses each for unrelated meanings:

| Token | Ratio on card | Meanings currently assigned | Where |
|---|---|---|---|
| `offline` `#ff6b6b` | 6.24:1 | CRITICAL priority · offline camera/DVR · **person-classification dot** · error text (`text-warn` is amber; `text-offline` used on Users delete + login error) · alarm recording segment · "Stop"/"Delete" affordance text | `PriorityBadge.tsx:4`; `EventsView.tsx:34`; `StatusLamp.tsx:27`; `PlaybackTimeline.tsx:21`; `LoginForm.tsx:99`; `UsersView.tsx:130` |
| `warn` `#f0c36a` | 10.49:1 | HIGH priority · **vehicle-classification dot** · warning borders · form error text · "Failed" notification pill · "Delete" confirm fill | `PriorityBadge.tsx:5`; `EventsView.tsx:35`; `NotificationsView.tsx:150`; `States.tsx:15`; `UsersView.tsx:168` |
| `teal` `#3ee0c7` | 10.47:1 | primary CTA · link · active nav · selected row/tab · playhead · "New"/unread · "Live" · focus ring · calendar accent | `globals.css:12`; `PriorityBadge` fallback no; `NotificationsView.tsx:182`; `EventsView.tsx:315`; `AppShell.tsx:171` |
| `online` `#3ddc97` | 9.80:1 | camera online · notification sent · recording · "Enabled" · "Running" | `StatusLamp.tsx:27`; `NotificationsView.tsx:148`; `PlaybackTimeline.tsx:22-23` |
| `muted` `#93a0b3` | 6.53:1 | secondary text · offline/unknown lamp · disabled · "Not reported" | `StatusLamp.tsx:27`; everywhere |

- **CO-1 · P1 — Red means five things, three of them benign.** In the Events list, a *person* event gets a red dot while its priority is HIGH (amber). Visually it reads as "critical alarm" and competes with the genuinely critical badge. In Playback, "alarm recording" is red while "motion recording" is green — a recording-type distinction that looks like a fault. **Direction:** status hues get glyphs + labels and are reserved for *state*; priority gets its own neutral-with-accent-badge treatment (or a left rule); classification gets shape/icons (person/vehicle/motion), not hue. Never colour-only, and never the same hue for "normal category" and "failure".
- **CO-2 · P2 — Teal owns too much.** Because teal is CTA + link + selected + live + unread, every screen has 15–30 teal objects and none of them stands out. Reserve teal for **interactive** affordances and selection; introduce `--color-live` (e.g. `#3ddc97` with a dot) and `--color-unread` (e.g. `#7cc4ff` or an ink chip) so "live" and "new" stop competing with buttons.
- **CO-3 · P2 — No informational/info colour.** WebRTC-vs-HLS fallback notices, gateway states and "checking" all reuse amber/muted; add `--color-info: #5aa9ff` (7.06:1 on card) for system messages.

#### 4.1.5 Component drift (the case for primitives)

Measured on 14 authenticated routes (`uxaudit-measurements-3.json`):

| Inventory | Count | Distinct treatments | Detail |
|---|---|---|---|
| Interactive controls | 549 | — | 306 (56 %) < 44 px in at least one dimension |
| Buttons/links as buttons | 260 | **26** | heights **30 / 32 / 36 / 40 / 44 / 58**; radius **0 / 8 / 12**; font **12 / 14 / 16**; 4 fills (transparent, teal, `white/5`, card) |
| Text/select/date inputs | 47 | **4** | 3 heights (**40 / 44 / 58**), 2 fills (`bg-bg` **21×** in 12 routes vs `bg-card` **22×** in 3 routes), same border |
| Card-like containers | 33 | 3 | 30× `rounded-xl bg-card border-line` (good!), 2× warn alert, 1× black snapshot fallback |
| Hard-coded colours in TSX | 24 | — | 13× `#08110f` (primary-ink), 3× `#3ee0c7` duplicated outside the token |
| Arbitrary-value classes | 29 | — | `text-[10px]`, `text-[9px]`, `text-[11px]`, `bg-[#151b24]`, `bg-[repeating-linear-gradient(...)]` |
| Inline `style={{…}}` in source | 14 | — | 28 rendered elements on Playback (timeline positioning — legitimate), 37 on detection (range fills) |

- **CD-1 · P1 — Buttons have no variants.** The same "secondary" job is done by `h-9/text-xs`, `h-10/text-sm`, `h-11/text-sm` and `h-11/text-xs` depending on which file you are in (`AppShell.tsx:182` vs `UsersView.tsx:126` vs `EventsView.tsx:280`). Primary buttons use `text-[#08110f]` in 10 places and `text-black` in 3 (`LoginForm.tsx:106`, `DetectionSettings.tsx:691`, `CamerasView.tsx:140`) — two different ink colours on the same teal.
- **CD-2 · P1 — Inputs change fill by page.** Events/Faces/Notifications filters use `bg-card` **on a `bg-card` page region** (invisible field, 1.30:1 border); Detection/Audit/Account/Playback use `bg-bg` on card (visible field). The user learns two different field appearances for the same control.
- **CD-3 · P1 — No component owns its states.** Loading, disabled, error, focus and hover styles are copy-pasted per call-site; 6 different disabled treatments exist (`disabled:opacity-40`, `opacity-60`, `opacity-50`…). Disabled pagination text computes to **3.42:1** (below 4.5:1 for the informational page counter it shares a row with), and disabled calendar days compute to **1.92:1** (the "no recording on this date" information effectively disappears).
- **CD-4 · P2 — Cards are the only consistent thing** (30/33). Keep `rounded-xl border border-line bg-card p-4` as the base `Card` and standardise padding to 16 px (`p-4`) / 20–24 px for hero cards; delete `p-3`/`p-5` variants.

#### 4.1.6 Iconography and brand

- **IC-1 · P2 — No icon system.** The UI uses emoji-free text glyphs (`✓`, `⊘`, `!`, `•` in `NotificationsView.tsx:147-151`, `−15s/+15s`), logo-only SVG marks, and two hand-rolled SVGs (expand, close in `CameraTile.tsx:129-143`). Status is communicated with dots and words, navigation with words only. At 8 items × 2 breakpoints, word-only nav is why the mobile labels had to be shortened to 11 px text.
- **IC-2 · P3 — The brand mark is decorative but unrecognisable** as a CCTV product (4 teal rounded squares, `Mark.tsx`) and is repeated in the sidebar, header (mobile) and login. Fine to keep, but pair it with a wordmark once, not three times per shell.

### 4.2 States and feedback

| State | Current behaviour | Finding | Sev |
|---|---|---|---|
| **First paint** | Header shows "Checking" (idle lamp) until `/api/dvr/status` resolves; the dashboard shows 4 pulsing skeletons. | Honest, but the page intro and layout shift when data lands; header lamp "Checking" can be the only status for several seconds with no explanation. | P3 (`ST-1`) |
| **Loading lists** | Only Dashboard has skeletons. Events/Faces/Notifications/Users/Audit/System show "Loading…" text or leave stale rows; the submit button text changes ("Searching…", "Loading…"). | No skeletons for the primary data surfaces; no `aria-busy`, no `aria-live`; typing in filters and pressing Search gives no progress cue beyond a button label. | P1 (`ST-2`) |
| **Empty** | "No events for this period." / "No detected faces for this period." / "No audit entries yet." / "Select an event." | The empty Events state shows "Select an event." in the right column while there is nothing to select — a dead instruction. Empty states are one muted line in an empty canvas with no CTA (e.g. "Clear filters", "Jump to today", "Enable detection"). | P1 (`ST-3`) — see `uxaudit-events-empty.png` |
| **Error** | `ErrorBanner` with "Try again" only when `!data`; list pages show an inline warn line with Retry. | Invisible when data already exists: a poll failure leaves the last data on screen with no staleness marking (see `usePoll.ts:38-56`, `DashboardView.tsx:88`). Errors read at 14 px amber in a card-less line — low salience for a security tool. | **P1** (`ST-4`) |
| **Disabled** | `disabled:opacity-40/60`, "Saving", "Searching". | 3.42:1 pagination text; no tooltip/explanation on disabled controls (e.g. "Sign out other sessions" is disabled when only 1 session — no reason given). | P2 (`ST-5`) |
| **Stale** | None. | No "last updated", no "connection lost" banner, no frozen-frame overlay. | **P0/P1** (`ST-6`) |
| **Success** | A line of muted/online text appears near the action ("Saved", "Rule saved", "Password reset for …"). Not announced; disappears on navigation; no toast. | P2 (`ST-7`) |
| **Focus** | Global teal `:focus-visible` ring. | Good on dark, invisible on teal CTAs; no skip link; dialogs don't manage focus. | P1 (`ST-8`) |
| **Reduced motion** | `.animate-pulse` disabled. | Minimal but adequate; no other motion exists except hover opacity. | P3 (`ST-9`) |
| **Empty vs filtered** | Copy names the cause ("No events match your filters." vs "No events for this period."). | **Good — keep.** | — |

### 4.3 Navigation and information architecture

- **NA-1 · P2 — Flat 8-item navigation mixes three jobs.** Dashboard / Camera setup / Playback / Events / Faces / Notifications / Device / Settings. Monitoring (Dashboard, Playback), investigation (Events, Faces, Notifications) and administration (Camera setup, Device, Settings) sit at the same weight; "Camera setup" next to "Playback" invites the wrong click, and "Device" is a read-only info page that sounds like a device *control*.
- **NA-2 · P2 — Settings have no shell.** `/settings` is a read-only env dump plus a sentence of teal links (`SettingsView.tsx:35-45`); sub-pages have no sub-nav, no breadcrumb, no "back to settings", and the sidebar still says "Settings" (active) so location is ambiguous. On a 1600 px screen the settings content occupies 768 px and the rest is empty.
- **NA-3 · P2 — Role handling is silent and flickers.** `nav` is filtered after a client fetch (`AppShell.tsx:139`), so a VIEWER sees the Settings item disappear a moment after load; a VIEWER opening `/settings/users` is redirected to `/` with no message (`settings/layout.tsx:4-9`). Nobody learns why.
- **NA-4 · P2 — Mobile bar is over-packed.** 8 items × **49 px wide × 38 px tall at 11 px** (measured), labels shortened ("Home", "Alerts"), no icons, no active fill (teal text only), no alarm badge. The safe-area inset is handled (good) but the bar overlaps page content/footers (see DT-2).
- **NA-5 · P3 — Brand duplication.** "Home CCTV / Local hub" in the sidebar and "Home CCTV" in the header, plus "Home CCTV" on login, plus a Mark in all three (`AppShell.tsx:155-162, 188-194`). On mobile the header title truncates to nothing (measured: `.truncate` with `min-w-0` and competing `shrink-0` actions) — the app name literally disappears, while Account/Log out consume the header.
- **NA-6 · P3 — Page titles inconsistent.** 8 of 15 routes have the generic `Home CCTV` document title; the rest use `Page · Home CCTV` (measured). Screen titles also drift: sidebar "Playback" → page "CCTV Playback"; sidebar "Camera setup" → page "Camera setup"; sidebar "Notifications" → "Notification history"; sidebar "Settings" → "Users"/"Object detection".
- **NA-7 · P3 — No 404 inside the shell.** `not-found.tsx` renders a bare full-page message with one link; inside the app a missing event would be better as an in-shell empty state.
- **NA-8 · P3 — No skip link.** 11 tab stops before `<main>` (measured) on every route, forever.

### 4.4 Accessibility audit (WCAG 2.2 AA by inspection + measurement)

| SC | Requirement | Status | Evidence / finding |
|---|---|---|---|
| 1.1.1 | Non-text content | **Pass** | 0 images without `alt`; logo `aria-hidden`; icon-only buttons have `aria-label` |
| 1.3.1 | Info & relationships | **Partial** | Correct `dl/dt/dd`, `fieldset/legend`, one `h1`; but h2 is 14 px (visual only), Camera setup's `<label>` says "Channel 1" for the name input (`CamerasView.tsx:125-135`), `role="alertdialog"` used for inline confirmations without dialog semantics |
| 1.4.1 | Use of colour | **Partial** | Classification dots are `aria-hidden` and accompanied by text (pass); but status/classification/priority hue collisions (CO-1) make meaning ambiguous (*not* strictly colour-only) |
| 1.4.3 | Contrast (text) | **Pass** on all primary pairs (4.6–16.9:1) | Disabled pagination 3.42:1 and disabled calendar days 1.92:1 are informational; treat as fail for content (`globals.css:139-143`) |
| 1.4.11 | Non-text contrast | **Fail** | `line` 1.23–1.30:1 borders; active nav fill 1.31:1; teal-on-teal focus 1:1 |
| 1.4.12 | Text spacing | Pass (no fixed line boxes) | — |
| 1.4.13 | Content on hover/focus | **Partial** | Tooltip on timeline markers via `role="tooltip"`, not dismissible/hoverable (P3); fullscreen pill is hover-only (see D-4) |
| 2.1.1/2.1.2 | Keyboard, no trap | **Partial** | Everything reachable; timeline seek on arrows; but 11 stops before main and no skip link; dialogs don't trap |
| 2.2.2 | Pause/Stop/Hide (auto-updating) | **Partial** | Events list live-refreshes on new events when unfiltered (`EventsView.tsx:172-188`) with no pause; header clock updates every second (acceptable) |
| 2.4.1 | Bypass blocks | **Fail** | No skip link (`AppShell.tsx:148-150`) |
| 2.4.3 | Focus order | **Pass** in main content; sidebar-first on every page (see 2.4.1) |
| 2.4.7 | Focus visible | **Fail on primary CTAs** | teal ring on teal fill 1:1 |
| 2.4.11 | Focus not obscured | **Partial** | Fixed mobile bottom nav overlaps the detection save bar (DT-2) and can obscure focused content |
| 2.5.8 | Target size (min 24×24) | **Fail** | Inline text links at 16 px line-height: "View event" (`FaceCard.tsx:42-44`), "Open event" (`NotificationsView.tsx:182`), "Statistics"/"All events" (`RecentEvents.tsx:61-62`), `−15s` etc. are 44 px but badges/links are not; 306/549 controls < 44 px (44 px is AAA 2.5.5; 24 px is AA) |
| 3.2.3 | Consistent navigation | **Pass** | Same nav order everywhere |
| 3.3.1/3.3.2 | Error identification/labels | **Pass** | Login moves focus to the error; labels present (placeholder-only on Users create form and Account password — `aria-label` exists, visible label does not) |
| 4.1.2 | Name/role/value | **Partial** | Timeline `role="slider"` reports `aria-valuenow=0` when there is no position (`PlaybackTimeline.tsx:236-239`); status lamps expose full label via `sr-only` (good); `title`-only help on "Use DVR name" |
| 4.1.3 | Status messages | **Fail** | No `aria-live`/`aria-busy` for search result counts, save confirmations, session revocations, notification-permission result |
| 2.3.1 | Three flashes | Pass | — |
| 1.4.4 | Resize to 200 % | Partial | Layout reflows (no horizontal overflow at 390 px measured), but 11 px text at 200 % is still 11 px CSS |

Measured facts backing the table: 0 unlabeled inputs, 0 missing `alt`, exactly one `<h1>` per page, 306/549 targets <44 px, 11 tab stops before main, no skip link, no `aria-live` in async regions (`uxaudit-measurements*.json`).

### 4.5 Time and number formatting drift

The app claims "India time" in two places (`Audit log` intro, `Event statistics` intro) but displays **five different time models**:

| Surface | Format | Evidence |
|---|---|---|
| Header clock | browser-locale 12 h ("01:54:42 PM") | `AppShell.tsx:43-48` |
| Events list / detail | 24 h IST ("13:54", "13:43:33") | `formatKolkataClock` |
| Detection worker | browser-locale 12 h ("11:39:59 PM") | `DetectionSettings.tsx:340` |
| System cards | **raw UTC ISO** ("2026-11-04T08:24:41.897Z") | `system/page.tsx:148, 171` |
| Account sessions | browser-locale `toLocaleString()` | `AccountView.tsx:20-24` |
| Rule schedule summary | 24 h ("23:00–07:00") while the time inputs render 12 h ("11:30 PM") | `NotificationRules.tsx:240, 471-475` |
| Audit log | IST 24 h | `formatKolkataDateTimeFromIso` |

**T-1 · P2 — One hub, five clocks.** For a security product this is a trust problem: the DVR's burned-in timestamp (24 h), the header (12 h) and the event time (24 h IST) can all disagree on screen, and the System page shows UTC. Fix: a single `formatTime`/`formatDateTime` utility (IST 24 h) for every surface except native `<input type="time">`, plus a visible "IST" label on absolute times.


---

## 5. Per-screen findings

Tables are ordered by severity. "Direction" is implementation guidance, not a design spec — full redesign briefs are in §7.

### 5.1 Global shell (sidebar, header, mobile bar)

**What works:** `aria-current="page"` on nav, `sr-only` full labels for status lamps, one `h1` per page, active state visually distinguishable, safe-area inset on the mobile bar, logout/account always reachable, focus ring visible on dark surfaces.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| G-1 | **P0** | **No alarm/unread affordance in navigation.** `NAV` is a plain list of `{href,label}` (`AppShell.tsx:23-33`); nothing counts unread events, so the shell cannot answer "did something happen while I was elsewhere". Combined with #2 this is the operator's biggest blind spot. | Add a per-item count from `/api/events` (`read=false&important=true`) + an alarm bell; make it a live region. |
| G-2 | **P1** | **The shell has no skip link and puts 11 stops before content.** Measured: 11 tab stops precede `<main>` on every route; `hasSkipLink:false` (`uxaudit-measurements-3.json`). | First focusable element = "Skip to live view"; move header actions after `<main>` in DOM or add `tabindex="-1"` on main. |
| G-3 | **P1** | **Brand is repeated and the mobile header loses the product name.** Sidebar "Home CCTV / Local hub" (`AppShell.tsx:155-162`), header "Home CCTV" (`188-192`), both with `Mark`. At 390 px the title truncates to nothing (screenshot `uxaudit-mobile-dashboard-loaded.png`); the header is consumed by "DVR ok", "Enable notifications", "Account", "Log out" (all `shrink-0`). | One brand instance (sidebar desktop / header mobile), a status/health chip, and a single avatar/menu for account+logout. |
| G-4 | **P1** | **Header actions out-shout page content.** "Enable notifications" is a bordered 133×36 px button on every page (`AppShell.tsx:198`), visually heavier than the 20 px page title; it duplicates the same action on Notification rules (`NotificationRules.tsx:209-212`). | Demote notification permission to a one-time prompt/settings row; put 1 primary action max in the header. |
| G-5 | **P2** | **Sidebar nav items are 36 px tall with no icons** (measured 195×36, 14 px), active state = teal text + a `white/10` pill at **1.31:1** against the panel. | 40–44 px rows, icon + label, active = left rule + filled surface ≥3:1 or ink-on-teal pill. |
| G-6 | **P2** | **Status lamp is over-compressed in the header.** `compact` renders "DVR ok"/"Gateway down" at 12 px with a 10 px dot; full label is `sr-only` + `title` only (`StatusLamp.tsx:2-14, 36-45`). "Video gateway unavailable" becomes "Gateway down", which no operator understands. | One status chip with an expandable health popover; keep short label *plus* tooltip and link to System. |
| G-7 | **P2** | **Mobile bar is 8 items × 49×38 px at 11 px with no icons or badges** (`AppShell.tsx:227-246`, measured). "Alerts" hides that notifications is the alert history; "Home" hides Dashboard. | 5 primary items + "More" (safe tab bar pattern), icons, 44 px min height, unread badge. |
| G-8 | **P2** | **Role changes are client-side and silent.** `role` starts `null` (`AppShell.tsx:132-139`) → Settings appears after the session fetch (visible layout shift for admins, disappears for viewers); a viewer hitting an admin route is redirected with no explanation (`settings/layout.tsx:4-9`). | Resolve role server-side into the shell (it already is in `HubLayout`), render both variants in the first paint, and show a 403 page instead of redirecting. |
| G-9 | **P3** | **Clock is locale-dependent and shows `--:--:--` pre-hydration** (`AppShell.tsx:43-48`). At 12 h it disagrees with every event time (see T-1). | IST 24 h monospace clock + date, matching event timestamps. |
| G-10 | **P3** | **Logout is a bare text button at the sidebar bottom** (`AppShell.tsx:182-184`) and a bordered button in the mobile header (`205-211`); no confirmation, inconsistent placement. | Put account/logout in one menu with the user identity. |

### 5.2 Dashboard / live monitoring

Screens: `design/audit/before/uxaudit-dashboard-loaded.png`, `uxaudit-dashboard-hover.png`, `uxaudit-mobile-dashboard-loaded.png`, `design/audit/before/debug-dashboard.png`.

**What works:** the 2×2 grid fits the viewport exactly (`camera-grid-h`, `globals.css:31-45`); tiles keep their aspect ratio and never distort; focus mode is well-engineered (Escape, autofocus, live-region announcement, no stream teardown, scroll lock); skeleton state exists; per-camera status lamps are labelled.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| D-1 | **P0** | **No operational overview.** Above the fold: page intro + 4 video tiles only. No "events today", no "unread", no camera/recorder/disk health, no timeline. Recent events begin at y=1032 on a 1000 px viewport (`DashboardView.tsx:98-117`; measured `recentEvents.top=1032`). | See §7.1: KPI strip (Events today / Unread / Cameras 4/4 / Recorder+Gateway / Disk+Backup) + right alarm rail + 24 h event strip above the grid. |
| D-2 | **P1** | **Tile identity and state live outside the video.** Camera name and "Online" are in a caption row below the frame (`CameraTile.tsx:116-124`); the frame itself has no overlay identity, and the DVR burns its own name into the picture, so the same name appears twice (see screenshot). | Overlay: name (top-left), REC/LIVE dot + local time (top-right), signal + expand (bottom-right); keep the caption row for secondary info only. |
| D-3 | **P1** | **The only "expand" affordance is hover-only.** `opacity-0 group-hover:opacity-100 group-focus-within:opacity-100` (`CameraTile.tsx:107-110`); measured on a touch context: `overlayButtonOpacity:"0"`, `overlayButtonVisible:false`. The whole frame is an invisible `<button>` (`101-106`), so on a phone focus mode is undiscoverable. | Always-visible corner expand icon (44 px) + tap-anywhere still working. |
| D-4 | **P1** | **"Sub 102" exposes stream channel ids** in the caption (`CameraTile.tsx:120`); same numbers appear on Camera setup. Meaningless to an operator, reads as debug output. | Replace with useful state: resolution/stream health, last motion, or nothing. |
| D-5 | **P1** | **Page copy is implementation detail:** "Four-camera live view. The grid and full screen use the H.264 sub streams." (`DashboardView.tsx:74`). The intro slot is the most valuable line on the screen; it is spent on codec plumbing. | Replace with live operational summary ("3 cameras live · 2 unread alarms · DVR OK · updated 4 s ago"). |
| D-6 | **P1** | **No temporal context on the dashboard.** Nothing shows what happened in the last minutes/hours; the defense-relevant object (event timeline) is only on another page. | 24 h multi-camera event strip (reuse `buildTimelineMarkers`) under the KPI strip or beside the grid; click → jump to playback at that instant. |
| D-7 | **P2** | **Three overlays compete in the bottom third of every tile:** burned-in DVR name, centred "Live" chip (`LivePlayer.tsx:311-320`), "Unmute" button bottom-left (`321-334`), plus the hover "Full screen" pill top-right. | One overlay system: status top-left/top-right, controls bottom-right on hover/focus only, mute in a tile menu. |
| D-8 | **P2** | **"Live" has no visual weight and no state distinction.** 11 px white text on `black/70`, no dot, no pulse, identical whether WebRTC or HLS fallback (detail text changes to "Live via HLS." at 11 px). | `LIVE` pill with a pulsing dot (respect reduced motion) + distinct amber "HLS fallback" and red "reconnecting" states. |
| D-9 | **P2** | **Error handling deletes the grid.** `error && !data` replaces everything with `ErrorBanner` (`DashboardView.tsx:88`); once data exists a poll failure is invisible. | Keep last-known frames and overlay a "connection lost / last updated" banner instead of unmounting. |
| D-10 | **P3** | **Recent-events block is a sentence, not a KPI.** "Today: 302 events. Person 286. Vehicle 16. Motion 0. Critical 0." as one 14 px line (`RecentEvents.tsx:66-70`); rows show `Camera {id}` when the names call fails (`RecentEvents.tsx:81`). | 4 KPI tiles + labelled rows with camera names and priority chips. |
| D-11 | **P3** | **Focus mode is a dead end.** Entering focus hides all chrome; no camera switcher, no timeline, no snapshot, no keyboard shortcut hint beyond the `sr-only` announcement. | Overlay filmstrip/next-prev camera + "snapshot"/"go to recording" actions. |

### 5.3 Events list (timeline/table)

Screens: `uxaudit-events-loaded.png`, `uxaudit-events-empty.png`, `uxaudit-mobile-events.png`, `design/audit/before/events-desktop.png`.

**What works:** server-side filtering (browser never downloads the day), honest empty copy that distinguishes filters from date, filters cleared in one click, `aria-pressed` quick filters, row buttons with selected state, priority badge + unread marker + camera + time on one line, right-hand detail panel with actions.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| E-1 | **P1** | **Filter wall before content.** 5 quick pills + 7-field form (Camera, Classification, Date, From, To, Read state, Notification, Priority) = 204 px tall at 1600×1000, first row at y=441 (`uxaudit-measurements-2.json`); on mobile the first event is below ~1 100 px (`uxaudit-mobile-events.png`). | Segmented quick filters + a collapsed "Filters (n)" drawer; sticky result count; keep date + quick filter visible. |
| E-2 | **P1** | **Rows are cards, not a scanning surface.** 65 px tall rows × 20 per page (`EventsView.tsx:301-333`), paginated with Prev/Next at the bottom; 301 events today = 16 pages. An operator cannot glance at "the last hour". | Dense list (44/56 px rows), sticky header, time-grouped sections, "load more"/infinite, optional compact density toggle. |
| E-3 | **P1** | **No acknowledgement workflow.** Read state only exists as a filter field; the row shows an 11 px "New" label (`EventsView.tsx:315`); no ack button, no bulk select, no unread count in the heading (only "301 events"), and the detail auto-marks read (`MarkReadOnView`). | Default "Unread" segment, checkbox + bulk Acknowledge, explicit Ack action in row hover and detail panel, unread count badge in nav. |
| E-4 | **P1** | **Classification dots misuse status colours.** `dot()` returns red for person/alarm, amber for vehicle, teal otherwise (`EventsView.tsx:33-37`), while the priority badge on the same row uses the same red/amber palette. A person event looks like a critical alarm. | Shape/icon per classification (person/vehicle/motion) in neutral ink, or a left rule colour that is reserved for *priority* only. |
| E-5 | **P1** | **Dead-end empty state.** With 0 results the right panel still says "Select an event." (`EventsView.tsx:342`) and the page offers no CTA ("Clear filters", "Jump to today", "Open Playback for this day"). | Purpose-built empty state with the 2–3 next actions and a "create rule from this filter" link. |
| E-6 | **P2** | **Primary action is stranded.** "Search" sits alone on a second row (2 of 8 columns) left-aligned (`EventsView.tsx:275-284`), breaking the form grid and the visual reading order. | Toolbar: filters left, "Search" (or auto-apply) right, aligned with the filter row. |
| E-7 | **P2** | **Two interaction models on one screen:** quick filters apply immediately, advanced filters require Search (`EventsView.tsx:135-138` vs `212-218`). No hint which does what. | Apply everything immediately with a debounce, or make everything explicit — and label it. |
| E-8 | **P2** | **Errors are bare amber text** with no container or retry (`EventsView.tsx:287`), unlike `ErrorBanner` on other pages. | Use one `ErrorState` component (banner + retry + last-updated). |
| E-9 | **P2** | **Read state is invisible.** Read rows and unread rows look identical apart from the "New" tag; there is no unread dot, no bold treatment, no count. | Unread dot + weight change; "New" tag only for < 1 h. |
| E-10 | **P2** | **List is keyboard-only by Tab.** No arrow-key navigation, no Enter-to-open-detail, no shortcuts; selected state relies on a 1.31:1 fill + teal border. | Roving tabindex, j/k/↑/↓, Enter to ack/open, visible selection ≥3:1. |
| E-11 | **P3** | **Native date input** renders locale format ("04/11/2026") while Playback uses a custom IST calendar — inconsistent and ambiguous. | One date field component (IST-aware) used by both. |
| E-12 | **P3** | **Detail snapshot has no loading/error state** (`EventsView.tsx:350-364`) unlike `SnapshotPanel`; a blank bordered box appears while the image loads. | Reuse `SnapshotPanel` for both list detail and event page. |

### 5.4 Event detail page

Screens: `uxaudit-event-detail.png`, `uxaudit-event-detail-full.png`.

**What works:** correct `<dl>` metadata, bounding-box overlay with label, faces panel that hides when disabled, playback deep link, read-marking as a best-effort side effect, priority badge.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| ED-1 | **P1** | **Actions are below the fold.** The 4:3 snapshot is full-width (~720×540) so "View recording" / "Open details" / "Notification history" sit at ~1 500 px on a 1000 px viewport (`events/[id]/page.tsx:65-129`). | 2-column layout: snapshot/player left (max 60 %), sticky action rail right (Ack, View recording, Download snapshot, Next/Prev). |
| ED-2 | **P1** | **Debug metadata at equal weight with operational facts.** `Source`, `Detector`, `Raw class`, `Threshold`, `Track` are listed beside `Time`, `Duration`, `Priority` (`events/[id]/page.tsx:91-114`); `Time` is duplicated in the header (`page.tsx:60`). "Source: object-detection-worker" is internal. | Split into "Event" (operator facts) and a collapsed "Detection details" disclosure; single time display. |
| ED-3 | **P2** | **"Face detection pending" is a 12 px muted line** (`EventFacesPanel.tsx:39-41`) with no ETA/explanation and no spinner. | A small inline state row with retry/progress semantics. |
| ED-4 | **P2** | **Three peer CTAs + a primary.** "Notification history" as a peer action on an event page is confusing (`page.tsx:126-128`). | One primary (View recording) + secondary (Ack/Download) + tertiary menu. |
| ED-5 | **P2** | **No acknowledge action on the page where a human decides.** Opening the page already marks read (`MarkReadOnView.tsx:10-25`) with no visible confirmation or undo. | Explicit Ack/unack toggle with toast + audit entry. |
| ED-6 | **P3** | No download/export of snapshot, no copy-link, no next/previous event. | Toolbar with download + copy + prev/next. |
| ED-7 | **P3** | Page title ("Person detected") and intro ("Event detail from the DVR alarm log.") use internal language; the `<dl>` repeats "Type: Motion / Classification: Person". | "Person detected · Left Side Outside · 13:43:33" as a single header line. |

### 5.5 Playback

Screens: `uxaudit-playback-loaded.png`, `uxaudit-playback-loaded-full.png`, `uxaudit-mobile-playback.png`.

**What works:** viewport-fitting player + timeline, IST day model, recording availability calendar with dots + disabled days, keyboard-accessible timeline slider with `aria-valuetext`, density-aware event markers, hover thumbnail preview, zoom presets, "no recording at this time" honesty, request sequencing to prevent stale responses. This is the product's best screen — the redesign should *promote* it, not rebuild it.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| P-1 | **P1** | **The best screen has the smallest title.** `PageIntro compact` gives a 16 px `h1` while ordinary pages get 20 px (`PlaybackView.tsx:255-259`); the section heading "TIMELINE" is 12 px uppercase. | Make Playback a first-class investigation workspace with a 24 px title + camera/date context line. |
| P-2 | **P1** | **The player wastes ~45 % of its width.** 4:3 sub-stream letterboxed inside a 1230×470 area (`uxaudit-playback-loaded.png`); no "fit/crop/zoom" control and no side rail, so half the screen is black. | Player left (max 8/12 cols) + event list/markers right; or 16:9-constrained player with an info rail. |
| P-3 | **P1** | **Control bar is underspecified for review.** `−15s / Pause / +15s / Unmute / volume / Full screen` (`PlaybackControls.tsx:26-57`); no position/total time readout (a bare "12:01:45" floats above), no speed control, no jump-to-event, native range slider looks off-theme. | Transport with time readout `12:01:45 / 24:00:00`, speed menu, prev/next event, and the timeline as the primary scrub surface. |
| P-4 | **P1** | **Timeline targets and labels are too small.** Ruler/playhead 10 px, count badges 9 px (`PlaybackTimeline.tsx:310, 327, 429`); markers are 10–14 px dots with 8 px padding → ~26 px hit area (`369-434`) — the primary interaction on touch. | 12 px minimum labels, 44 px touch hit area (invisible padding), enlarged marker rhythm at 1 h zoom. |
| P-5 | **P2** | **Legend colours don't match marker colours.** Legend "Event" swatch is amber (`PlaybackTimeline.tsx:528`) but NORMAL-priority markers are teal (`markerTone` `26-30`); legend shows only "Critical"/"Event", omitting High vs Normal. | Derive legend from the same tone function; label all three levels. |
| P-6 | **P2** | **No event list or "next event" control.** Markers are the only way to find an event; on a 24 h view with 300 events the markers cluster. | Adjacent event list (time, camera, type, priority) synced to the playhead; next/prev event buttons. |
| P-7 | **P2** | **The date can change without the user asking.** `resolvePlaybackDate` + `nearestRecorded` silently move the selected date to a day with recordings (`PlaybackView.tsx:67-74`); nothing announces the correction. | Announce "No recording on 12 Nov — showing 11 Nov" with an undo, or show an empty state. |
| P-8 | **P3** | No "now" marker, no recording-quality/stream label, camera name only in the filter select. | Overlay camera name + date + stream in the player header. |
| P-9 | **P3** | Zoom is only 24/6/1 h (32 px buttons, `PlaybackTimeline.tsx:214-227`); no drag-to-window, no finer zoom. | Add 15 min/1 h/6 h/24 h presets + shift-drag window. |
| P-10 | **P3** | Full screen lives in the control row, not on the player chrome; no picture-in-picture. | Player-level fullscreen button + PiP where supported. |

### 5.6 Camera setup

Screens: `uxaudit-cameras.png`, `design/audit/before/cameras-desktop.png`.

**What works:** inline save with per-row pending state, DVR-name reset action, explicit channel/stream data, per-camera online lamp, clear copy about local vs DVR name.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| C-1 | **P1** | **You cannot see the camera you are naming.** The page shows no preview/snapshot, so mapping "Parking" to channel 1 requires leaving the page and watching the dashboard (`CamerasView.tsx:108-181`). | Thumbnail/snapshot per card (authenticated snapshot route or a poster frame) + "open live" link. |
| C-2 | **P1** | **Wrong accessible name on the name field.** The visible label is `Channel {id}` and it is `htmlFor` the *name* input (`CamerasView.tsx:125-135`), so AT/voice-control announces "Channel 1" for the name field; the input also has no `name`/`autocomplete`. | Visible label "Camera name"; channel as hint text; `aria-describedby` for the DVR-override explanation. |
| C-3 | **P2** | **Raw stream diagnostics presented as user data.** `Channel / Main stream / Sub stream` (101/102) and `Stream: Ready to view` per card (`CamerasView.tsx:161-178`) — device internals, duplicated in `Device`. | Collapse under "Technical details"; show only name, status, stream health, last event. |
| C-4 | **P2** | **Three actions per card, one wraps.** "Use DVR name" wraps to two lines at 1600 px (`uxaudit-cameras.png`); no dirty indicator, no reset-all, no bulk rename. | Row with inline save on blur/Enter + undo toast; secondary actions in a menu. |
| C-5 | **P2** | **Three status systems on one page:** page-level "Connected" lamp (`CamerasView.tsx:100-107`), per-card "Online" lamps, header lamp — with different vocabularies. | One health strip at the top; per-card status only as a dot on the thumbnail. |
| C-6 | **P3** | No ordering/drag, no "last seen", no per-camera recording state. | Add last-event + online-since columns. |

### 5.7 Faces

Screens: `uxaudit-faces.png`, `design/audit/before/faces-desktop.png`.

**What works:** authenticated image route, clear disabled-state explanation, pagination, counts for queued/failed snapshots, test-notification banner, `alt` text per crop.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| F-1 | **P1** | **Card geometry is broken.** `aspect-square` is defeated by the flex/grid stretch: measured image heights 398 / 407 / 426 / 504 px inside 322 px columns, card heights 572 / 614 px in the same grid (`uxaudit-measurements-3.json`); text blocks start at different heights (`uxaudit-faces.png`). | Fixed 1:1 or 3:4 thumbnails with `object-cover` on a fixed-ratio wrapper (no `h-full` image), equal card heights, text baseline aligned. |
| F-2 | **P1** | **A face cannot be inspected.** No enlarge/lightbox, no full frame, no bounding box, no "open recording at this moment" — only a 12 px "View event" link (`FaceCard.tsx:42-44`). | Click-to-lightbox with the full snapshot + crop, zoom, next/prev, and "play from here". |
| F-3 | **P1** | **348 unassigned faces with no way to reduce them.** Assignment filter exists but every row is "Unassigned"; the copy promises a future "people" phase (`FacesView.tsx:89-92`). Confidence is a raw percentage with no threshold explanation. | Either ship grouping (by day/camera/event) and a "reviewed" state, or move the page behind a beta flag; explain confidence thresholds. |
| F-4 | **P2** | **Filter pattern repeats Events** (4 fields + Apply) and stats mix metrics: "348 detected faces", "0 snapshot(s) queued" (`FacesView.tsx:184-192`). | Toolbar with segment chips and one stats line using pluralisation helpers. |
| F-5 | **P2** | **"View event"** is a 16 px-tall inline link → fails 2.5.8 (24×24). | Make the whole card a link/button with a visible action row. |
| F-6 | **P2** | **Images lazy-load with no skeleton or aspect reservation** → layout shift as crops arrive. | Fixed-ratio skeleton per card. |
| F-7 | **P3** | Naming drift: nav "Faces", page "Detected Faces" (capital F), doc title "Detected Faces · Home CCTV". | One name: "Detected faces". |

### 5.8 Notification history

Screens: `uxaudit-notifications-loaded.png`, `design/audit/before/notifications-desktop.png`.

**What works:** decision-level audit (sent/suppressed/failed), status uses border + glyph + label (not colour alone), reason text explains *why*, link to event, date/camera/status/priority filters, per-day totals.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| NH-1 | **P1** | **The single most important insight is buried.** 301 suppressed vs 2 sent (0.7 % delivery) is a 14 px line (`NotificationsView.tsx:68-74`); nothing explains that the cooldown is the cause, and there is no link to the rule. Every row repeats "Rule: all · Cooldown active for this rule" (`163-187`). | Top KPI row "Sent 2 · Suppressed 301 · Failed 0 · Delivery 0.7 %" with an explanatory callout and "tune rule" link; group reasons and add reason filter. |
| NH-2 | **P2** | **Density:** 25 cards ≈ 103 px each (`uxaudit-notifications-loaded.png`); 4 lines per record with lots of repetition. | Table: time · event · camera · rule · priority · status (+ reason on expand). |
| NH-3 | **P2** | **Scanning for failures is hard:** status pill is far right, suppressed is visually recessive, failed would only be amber (`NotificationsView.tsx:147-151`). | Sticky status column, failed-first sort option, filters as segments. |
| NH-4 | **P2** | **No range filter** (single date only) and no per-rule/camera summary — cannot answer "how did alerting behave this week?". | Date range + rule filter + grouped summary. |
| NH-5 | **P3** | No export, no resend for failed, no link to the rule that decided. | Row actions menu. |

### 5.9 Notification rules (/settings/notifications)

Screens: `uxaudit-settings-notifications.png`, `uxaudit-mobile-settings-notifications.png`, `design/audit/before/settings-notifications-desktop.png`.

**What works:** multi-camera/multi-event rules, quiet hours with behaviour, day-of-week, schedule window, cooldown, priority floor, inline validation for empty selections, rule test simulator, delete confirmation anchored to the rules list.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| NR-1 | **P1** | **Four unrelated domains on one page:** notification rules + event retention ("Keep events") + rule simulator ("Test a rule") + Telegram test + browser permission (`NotificationRules.tsx:209-311`). | Rules page = rules only; retention → Settings → Data; simulator → a collapsible Diagnostics disclosure; Telegram → channel settings. |
| NR-2 | **P1** | **No rule performance.** Each rule shows a 12 px middot sentence (cameras · events · time · cooldown · quiet hours, `NotificationRules.tsx:238-248`) but not "sent 2 / suppressed 301 in 7 days" — the operator cannot tell which rule floods or is silent. | Rule row: name + state + last triggered + 7-day sent/suppressed sparkline; click → detail. |
| NR-3 | **P2** | **Debug status line** "Telegram: Disabled · Rule events: Off · Snapshot: Off · Video: Off" reads like env output (`uxaudit-mobile-settings-notifications.png`). | Move channel health into a small status card with labels + edit links. |
| NR-4 | **P2** | **Diagnostics promoted to primary actions:** "Send Telegram Test" sits beside "New rule"; "Test a rule" is a full section. | Demote both behind "Diagnostics". |
| NR-5 | **P2** | **The rule editor is an 18-control wall** (`NotificationRules.tsx:380-574`); the enabled checkbox at the end is an **unstyled native checkbox** while every other checkbox in the app uses `h-4 w-4 accent-teal` (`557` vs `403, 417`). | Group into "Trigger", "Schedule", "Quiet hours", "Limits"; use the shared `Switch`/`Checkbox`. |
| NR-6 | **P2** | **Delete confirmation has no focus management**: inline `role="alertdialog"` without moving focus or trapping it (`NotificationRules.tsx:268-276`); delete fill is amber (warning), while Users delete fill is also amber — destructive action should not be the same hue as "warning". | One `ConfirmDialog` with focus trap + danger colour reserved for destructive. |
| NR-7 | **P2** | The editor renders *after* the rule list (`278-286`); on a long page opening "Edit" may leave the form off-screen, with no scroll-into-view or drawer. | Right-side drawer / modal editor, or scroll + focus on open. |
| NR-8 | **P3** | Retention auto-saves on change (`294-308`) while rules require Save — two save models on one page; no confirmation. | Use the same explicit-save pattern or auto-save everything with a toast. |
| NR-9 | **P3** | Terminology: "Rule events", "Quiet hours ... Notify anyway", rule named "all" in data. | Plain-language labels ("Notify me for…", "During quiet hours…"). |

### 5.10 Settings overview

Screens: `uxaudit-settings.png`, `design/audit/before/settings-desktop.png`.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| S-1 | **P1** | **Settings is a read-only env dump with a link paragraph.** Five teal links separated by middots (`SettingsView.tsx:35-45`) are the only way to reach users/notifications/detection/audit/system. No descriptions, no grouping, no status. | Two-pane settings shell: left sub-nav with icons + one-line descriptions + current value badges; content on the right. |
| S-2 | **P1** | **Developer instructions in product UI:** "Change values in the .env file, then restart the hub." (`SettingsView.tsx:33`), "Video placeholder: On/Off" (dev flag). | If this hub is env-configured, say "Managed by the server configuration" with a copyable file path and remove per-flag developer knobs from the UI. |
| S-3 | **P2** | Password masked row uses `aria-label="Password hidden"` on the `<dd>` (`SettingsView.tsx:68`) — a label, not an explanation; no reveal/copy (probably intentional) and no "configured/not configured" clarity. | Render as a status row ("DVR password: configured") with a lock icon. |
| S-4 | **P2** | Status lamps duplicate the header and System page (`SettingsView.tsx:50-60`). | One health component reused in shell popover, dashboard, and System. |

### 5.11 Users

Screens: `uxaudit-settings-users.png`, `design/audit/before/settings-users-desktop.png`.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| U-1 | **P1** | **Five equal-weight actions per row**: Disable, Switch role, Reset password, Sign out sessions, Delete — all 40 px outline buttons with destructive actions adjacent to routine ones (`UsersView.tsx:126-130`). Mis-click risk in the highest-privilege screen. | Row menu (`⋯`) for secondary/destructive actions + one primary visible action; destructive behind a red confirm. |
| U-2 | **P1** | **"Switch role" and "Sign out sessions" act immediately** with no confirmation and no undo (`UsersView.tsx:103-113, 127, 129`); only delete confirms. | Confirm for role change and session revocation; show the resulting role on the button ("Make admin" / "Make viewer"). |
| U-3 | **P2** | **Placeholder-only fields** in Create user and reset password (`UsersView.tsx:144-183`) — labels vanish as you type; no password policy/confirmation. | Visible labels + helper text + show-password. |
| U-4 | **P2** | **No table columns**: role/status float at arbitrary x positions per row; no last sign-in, session count, or created date. | Table with sortable columns + status chips. |
| U-5 | **P3** | No self-protection cues (can you delete yourself? what happens to the last admin?). | Disable destructive actions on self/last admin with explanations. |

### 5.12 Object detection (/settings/detection)

Screens: `uxaudit-settings-detection.png`, `uxaudit-mobile-settings-detection.png`, `uxaudit-detection-desktop-bar.png`, `uxaudit-mobile-detection-savebar.png`.

**What works:** every control has a visible label and test id, ranges constrained, worker status surfaced, per-camera overrides explicit, detection-test diagnostics.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| DT-1 | **P0** | **Save bar collision.** Mobile: save button y 788–832, bottom nav y 805–844, bar `z-20` vs nav `z-40` → **27 px of the button is under the nav** (measured, `uxaudit-mobile-detection-savebar.png`). Desktop: bar spans x 0–1600, y 931–1000 → covers sidebar Account/Log out (y 948–988, measured, `uxaudit-detection-desktop-bar.png`). | `position: sticky` save bar inside the content column + `bottom: env(safe-area-inset-bottom)` + mobile-nav offset; never `fixed inset-x-0` in an app shell with a sidebar/tab bar. |
| DT-2 | **P1** | **No unsaved-changes model.** 40+ controls, Save only in the bottom bar, no dirty marker, no navigation guard — proven data loss (`unsavedChanges.lost = true`). | Dirty flag → sticky "Unsaved changes" bar with Save/Discard, `beforeunload` + route-change guard, and per-section save. |
| DT-3 | **P1** | **Duplicate section title:** page `h1` "Object detection" and the first card `h2` "Object detection" (`DetectionSettings.tsx:324-327`); the page is 6 stacked cards of equal weight. | Section titles that describe the switch ("Master switch", "Thresholds", "Camera overrides", "Performance", "Behaviour", "Diagnostics"). |
| DT-4 | **P1** | **Worker status is a 12 px log block:** model name/version/license/size, "Inference — · FPS — · Queue 0 · Dropped 0 · Today: 0", "last report 11:39:59 PM" (`DetectionSettings.tsx:334-363`). | Status card with 4 KPIs (worker, FPS, queue/dropped, detections today) + a "Details" disclosure; IST 24 h. |
| DT-5 | **P2** | **Checkboxes are not switches.** 20×20 checkbox at the end of a `justify-between` row (`DetectionSettings.tsx:64-91`); scanning 12+ toggles in a column is slow. | Real `Switch` component (36×20 with label + state text), 44 px row target. |
| DT-6 | **P2** | **Compound "use global" checkbox + conditional slider + number field** causes layout jumps and 4×2 hidden branches (`DetectionSettings.tsx:436-483`). | One row: `Person threshold [Use global ▾] 50 %` with the control disabled when "global" is on, not inserted/removed. |
| DT-7 | **P2** | **Diagnostics section** ("Run detection test", model bbox list) is developer tooling at the same visual weight as settings (`DetectionSettings.tsx:620-679`). | Move to a separate "Diagnostics" tab/page. |

### 5.13 System

Screens: `uxaudit-system-loaded.png`, `design/audit/before/settings-system-desktop.png`.

**What works:** warnings are collected and named, "unknown" is explicit rather than guessed, storage/backup/retention/queue states all surfaced, face-worker problem escalates to an alert.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| SY-1 | **P1** | **Machine output shown to humans:** UTC ISO strings (`system/page.tsx:148, 171`), "1184926 seconds" in the warnings list while the card below says "14d ago" via `age()` (`28-34, 87-96`), "1 MediaMTX reader", "27 active sessions". | Humanise through shared formatters (duration, IST datetime, pluralisation); show raw values only under a disclosure. |
| SY-2 | **P1** | **Duplicate alerts:** the warnings list includes the face-worker problem and a second amber card repeats it (`system/page.tsx:87-106`). | One alert stack, deduplicated, sorted by severity, with runbook text. |
| SY-3 | **P1** | **Ops health is ADMIN-only and hidden three clicks deep**, while disk is 91.8 % full. The dashboard shows nothing. | Health summary chip in the shell (all roles) linked to System; disk/backup thresholds on the dashboard. |
| SY-4 | **P2** | **Six inline "Label: value" pairs in a 2-col card** (`109-117`), 14 px, no lamps or emphasis; "Overall: degraded" is the same weight as "Database: ok". | Status list with lamp + label + detail + timestamp; overall state as a header banner. |
| SY-5 | **P2** | **No refresh/auto-refresh and no "checked at"** (`load()` only on mount, `43-66`). | Poll like the rest of the app + last-checked timestamp. |
| SY-6 | **P2** | **"Active sessions: 27" vs "live viewers 4"** (`187-200`) reads as a bug (26 idle sessions); no session expiry explanation. | Add "sessions expire after N h" + per-session age, or hide inactive ones. |
| SY-7 | **P3** | Mixed vocabulary across pages: "hub", "DVR", "MediaMTX", "gateway", "worker". | Glossary or consistent labels ("Recorder", "Video gateway", "Detection worker"). |

### 5.14 Audit log

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| AL-1 | **P2** | Filters are placeholder-only with no visible labels (`settings/audit-log/page.tsx:65-67`); "Action" needs an exact action token but no suggestions/list. | Labelled filters + action select populated from a distinct query. |
| AL-2 | **P2** | Rows are cards (`80-91`), not a table; no columns, 25/page paginated. | Table: IST time · user · action · resource · detail; sticky header; export CSV. |
| AL-3 | **P2** | No "who/what" drill-down: a resource link would let an admin jump to the user/rule affected. | Link resource → detail. |
| AL-4 | **P3** | No time-range filter (single date only). | Range + quick presets (today/7 d/30 d). |

### 5.15 Device

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| DV-1 | **P2** | Eleven key/value rows (`DeviceView.tsx:18-32`) including encoding/hardware/web/plugin versions — an ungrouped diagnostic dump with full navigation weight ("Device" sounds like a control surface). | Group into Identity / Versions / Storage / Network, with a copy button; or move under System → Recorder. |
| DV-2 | **P3** | "Checking" is the only loading state; error banner is good (retry). | Skeleton rows. |

### 5.16 Account

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| AC-1 | **P2** | Times use browser locale (`AccountView.tsx:20-24`) — contradicts the app's IST claim. | Shared IST formatter. |
| AC-2 | **P2** | Session list is 12 px muted text; user-agent truncated at 87 chars in 11 px mono; no device/location; only "sign out others/all" (`201-214`). | Device rows with icon, parsed browser/OS, IP + last active, per-session revoke. |
| AC-3 | **P2** | "Sign out everywhere" has no confirmation and navigates away; "Sign out other sessions" is disabled with no reason when only one session exists. | Confirm dialog + explanatory helper text on disabled state. |
| AC-4 | **P3** | No show-password toggle, no strength guidance, no current-session indicator in the form. | Standard password field component. |

### 5.17 Login

Screens: `uxaudit-login.png`, probe: `focusedOnLoad: BODY`, inputs 38 px, button 36 px.

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| L-1 | **P2** | **Reads as a demo login:** 384 px card on a black field, logo + "Home CCTV" + "Local network hub", no hub status (recorder reachable? version?), no footer/help. | Security-product login: hub identity + last-known status (non-sensitive), version, "local network only" notice. |
| L-2 | **P2** | **Controls are 38 px (inputs) / 36 px (button)** (`LoginForm.tsx:74-109`), inconsistent with the 44 px field standard used elsewhere. | 44 px fields + 44 px primary. |
| L-3 | **P3** | No autofocus on username (probe `focusedOnLoad: BODY`). | `autoFocus` + `enterKeyHint`. |
| L-4 | **P3** | No password visibility toggle. | Eye toggle with `aria-pressed`. |

### 5.18 Error / 404 / empty

| ID | Sev | Finding & evidence | Direction |
|---|---|---|---|
| ER-1 | **P2** | `error.tsx` and `not-found.tsx` render full-page, out-of-shell centred text with one button/link and no nav (`src/app/error.tsx`, `src/app/not-found.tsx`). | In-shell error state with retry + back-to-dashboard + error digest (copyable). |
| ER-2 | **P2** | Every list invents its own empty/error style ("No events…", "No audit entries yet.", "No status available.", "Unable to load…") at different sizes/colours. | One `EmptyState` / `ErrorState` component with icon, title, description, 0–2 actions. |
| ER-3 | **P3** | `MessagePanel` is full-bleed black with centred 14 px white/90 text (`States.tsx:1-7`) — inside a tile it looks like a crashed player. | Tile-level state overlay with an icon + retry action, keeping the tile chrome. |

---

## 6. Design system to derive

This section is written so the Lead can lift it into `design/DESIGN-SYSTEM.md` with minimal rework. Values are chosen against the *measured* current state and checked for WCAG AA.

### 6.1 Foundations

#### 6.1.1 Colour tokens

Keep the app dark (surveillance UIs must not emit light at night; the current palette is directionally right). Change the **roles**, not the mood.

```css
@theme {
  /* surfaces — increased separation; measured card-vs-bg goes 1.14 → ~1.30 */
  --color-bg:            #070a0f;
  --color-surface-1:     #0e131a;   /* page panel / sidebar */
  --color-surface-2:     #161e29;   /* card */
  --color-surface-3:     #1e2836;   /* raised, menu, hover, sticky bars */

  /* boundaries — 3:1 on card (WCAG 1.4.11) */
  --color-line:          #2b3441;   /* decorative separators only (1.38:1) */
  --color-line-strong:   #5c6878;   /* inputs, card outlines, tab rails (3.06:1 card / 3.48:1 bg) */

  /* text */
  --color-ink:           #e8eef6;   /* 16.9:1 on bg, 14.8:1 on card */
  --color-ink-2:         #b0bccd;   /* secondary sentences, 9.0:1 on card */
  --color-ink-3:         #93a0b3;   /* micro-labels only, 6.5:1 on card */

  /* interactive accent — reserved for clickable/selected */
  --color-accent:        #3ee0c7;
  --color-accent-ink:    #08110f;   /* 11.6:1 on accent */
  --color-accent-soft:   rgba(62, 224, 199, 0.12);

  /* status — state of a thing, never a category */
  --color-ok:            #3ddc97;   /* online, sent, recording OK / 9.8:1 card */
  --color-danger:        #ff6b6b;   /* offline, failed, alarm / 6.2:1 card */
  --color-warn:          #f0c36a;   /* degraded, needs attention / 10.5:1 card */
  --color-info:          #5aa9ff;   /* informational: HLS fallback, checking / 7.1:1 card */

  /* priority — neutral surface + accent, NOT status hues */
  --color-priority-critical: #ff8a8a;
  --color-priority-high:     #f0c36a;
  --color-priority-normal:   #b0bccd;
  --color-priority-low:      #93a0b3;

  /* classification — shape/icon first, hue second */
  --color-class-person:  #8ea7ff;   /* distinct from status/danger */
  --color-class-vehicle: #c9a2ff;
  --color-class-motion:  #93a0b3;

  /* live / fresh */
  --color-live:          #3ddc97;
  --color-stale:         #f0c36a;
  --color-frozen:        #ff6b6b;
}
```

Rules to encode in the design system doc:

1. **Accent = interactive only.** If it is not clickable, focusable, or selected, it is not teal.
2. **Status hues = state only.** Never use `danger`/`warn` for a category (person/vehicle) or for emphasis.
3. **Priority gets a badge with a label** plus a 3 px left rule; the badge may use priority hues, but **never the same hue used for alarm state on the same row** — use the neutral-with-rule treatment in the event list.
4. **Every status must be glyph + label + dot**, never dot alone. (`NotificationsView`'s `✓/⊘/!` pattern is the right instinct — formalise it as `StatusPill`.)
5. **Focus is visible on every fill:** ring = `outline: 2px var(--color-accent); outline-offset: 2px;` on dark; on accent-filled controls add `box-shadow: 0 0 0 2px var(--color-bg)` (dark gap) so the ring never merges.

#### 6.1.2 Type scale

Self-host **Inter** (`font-sans`) + **JetBrains Mono** (`font-mono`) as variable `woff2` (or accept the OS stack, but then stop relying on Avenir metrics). Replace the current 7 sizes with 6 + tabular numerals for all data.

| Token | Size / line-height | Weight | Use |
|---|---|---|---|
| `text-micro` | 11/14 uppercase, `letter-spacing: .06em` | 600 | micro-labels only (table headers, chips) — **never sentences** |
| `text-xs` | 12/16 | 500 | metadata, captions, helper text (minimum for sentences) |
| `text-sm` | 14/20 | 400 | body, table cells, buttons |
| `text-md` | 16/24 | 500 | emphasised body, section headings (`h3`) |
| `text-lg` | 20/28 | 600 | card titles, `h2` |
| `text-xl` | 24/32 | 600 | page titles, `h1` |
| `text-kpi` | 32/36 | 600 tabular | KPI numbers |
| `text-display` | 40/44 | 600 tabular | hero KPI / wall-display mode |

Mapping for implementation: page title 24 (Playback 24, not 16), section title 16–20, KPI 32, event row time 14 mono tabular, table header 11 uppercase, all `dl` values tabular mono where numeric.

#### 6.1.3 Spacing, radius, elevation, motion

- **Spacing:** 4 px base; use 4/8/12/16/24/32/48. Card padding **16** (compact 12, hero 24) — remove `p-3`/`p-5` variants. Section gap 16, page gutters 24 desktop / 16 tablet / 12 mobile.
- **Radius:** 6 (small controls/badges), 8 (buttons/inputs), 12 (cards/panels), 999 (pills). Retire 16 (`rounded-2xl`).
- **Elevation:** 3 levels via surface tokens + 1 shadow (`0 8px 24px rgba(0,0,0,.45)`) only for popovers/menus/drawers. No shadows on cards (currently none — keep).
- **Borders:** 1 px `line-strong` on interactive containers; 1 px `line` on decorative separators; 2 px accent left-rule for selected.
- **Motion:** 120 ms ease-out for hover/opacity, 180 ms for drawers; honour `prefers-reduced-motion` (already partially handled in `globals.css:70-74`). No autoplaying pulse except the LIVE dot (and it stops under reduced motion).

### 6.2 Component inventory (to create in `src/components/ui/`)

Each component owns tokens, states (default/hover/active/focus/disabled/loading/error), sizes, and a11y contract. Suggested API:

| Component | Variants / sizes | Contract | Replaces |
|---|---|---|---|
| `Button` | `primary` `secondary` `ghost` `danger`; `sm 32` `md 36` `lg 44`; `loading` | `aria-busy` while loading, `disabled` styling with tooltip reason, focus ring per token | 26 ad-hoc button treatments |
| `IconButton` | `sm 32` `md 40` `lg 44` | Requires `aria-label`, tooltip on hover/focus | expand/close/menu buttons |
| `Field` (`Input`, `Select`, `Textarea`, `DateField`, `TimeField`) | `md 44` (mobile-first) | Visible label always; hint + error ids wired; `aria-invalid`; `line-strong` border; invalid = danger border + message | 4 input treatments |
| `PasswordField` | with visibility toggle | `aria-pressed` on toggle, `autocomplete` passed | login/account/users |
| `Checkbox` / `Switch` | 16/20 checkbox; 36×20 switch | Whole row is a 44 px target; label association; `aria-checked`; disabled reason | every checkbox inconsistency |
| `Card` | `p-4` / `hero p-6`, optional header/actions | `rounded-xl border border-line bg-card` | 33 cards |
| `SectionHeader` | title + description + action slot | h2/h3 semantics sized ≥16 | duplicate/small h2s |
| `StatusPill` | `ok` `warn` `danger` `info` `neutral`; glyph + label | Never colour-only; `title` for extra detail | notification status, priority, lamps |
| `PriorityBadge` | critical/high/normal/low with rule | Label + tone; shared with list rows | `PriorityBadge.tsx` |
| `HealthChip` | compact/expanded | Dot + label + tooltip + expandable details popover; used in shell + dashboard + System | `StatusLamp` |
| `KpiTile` | label / value / delta / hint; `lg` for wall display | tabular numerals, `aria-label` full sentence | Event statistics `Metric` |
| `MeterBar` | used/limit, threshold tones | `role="meter"` with `aria-valuenow/min/max` | camera activity bars, disk usage |
| `EventRow` | `md 56` `compact 44` `card 72`; selected + unread states | Full-row button/link semantics, keyboard `j/k`, checkbox slot, ack slot | Events list rows, recent events |
| `DataTable` | sticky header, sort, empty/loading slots | `<table>` semantics, `<th scope>` | events, audit, users, sessions |
| `Toolbar` | sticky, left/right slots, filter summary | contains segments, search, "Filters (n)" | filter forms |
| `SegmentedControl` | 2–6 options, `aria-pressed` | replaces quick-filter pill rows | Events/Faces/Stats ranges |
| `Drawer` / `Dialog` | right drawer, modal | focus trap, Escape, `aria-modal`, return focus, `role="alertdialog"` for confirms | rule editor, delete confirms |
| `EmptyState` | icon, title, description, 0–2 actions | `role="status"`; used by every list | 6 bespoke empty states |
| `ErrorState` | banner/card variants, retry, last-updated | `role="alert"`; never unmount stale content | `ErrorBanner`, inline warnings |
| `Skeleton` | text/row/tile variants | `aria-hidden`, no motion under reduced-motion | `FrameSkeleton` + missing list skeletons |
| `Toast` | success/error/info, auto-dismiss, `aria-live="polite"` | replace inline "Saved" text | save confirmations |
| `LiveBadge` | live/hls/reconnecting/stale | Dot + label + timestamp; also a tile-overlay variant | "Live" chip |
| `PageHeader` | title, subtitle, actions, breadcrumb slot | 24 px title, breadcrumb for settings | `PageIntro` |
| `NavItem` / `NavGroup` | desktop 40–44 px rows; mobile tab 44 px | icons + active fill ≥3:1 + count badge | sidebar/mobile nav |

### 6.3 Pattern specs

1. **Sticky action bar** (used on any form page): `position: sticky; bottom: 0;` inside the content column; height 64 px; left inset = sidebar width on desktop; `padding-bottom: calc(64px + env(safe-area-inset-bottom))` on mobile so it sits above the tab bar; contains dirty-state text + Save/Discard. Never `fixed inset-x-0`.
2. **Filter drawer:** toolbar shows 2 primary controls + "Filters (n)" + result count; advanced filters in a right drawer on desktop / bottom sheet on mobile; applying updates the count with `aria-live="polite"`.
3. **Alarm queue:** `Unread` default; rows show time, camera, type, priority, age; Ack on row (hover/focus reveals, always visible on touch); bulk ack; "N new" pill appears on live updates without moving scroll.
4. **Freshness model:** every polled region carries `lastUpdated`; if `now - lastUpdated > 2 × interval`, add `data-stale` → amber "Last updated 42 s ago · retrying" banner over the region (never blank it). The shell health chip mirrors the worst state.
5. **Live video states:** `connecting` skeleton, `live` (green dot), `hls` (info chip "HLS fallback"), `reconnecting` (amber + attempt count), `frozen` (red + "Frozen 00:12" derived from an `HTMLVideoElement` frame watchdog), `unavailable` (neutral + reason + retry). Include a `data-stream-state` attribute for tests.
6. **Event acknowledgment:** `unread → acknowledged` is explicit, audited, undoable for 10 s via toast; opening detail no longer changes state silently.
7. **Data freshness/format:** one `formatIstDateTime()` (IST 24 h), `formatDuration()` ("14 d", "2 h 05 m"), `formatCount()` (pluralisation). Native time inputs stay locale-rendered but their labels show IST.
8. **Dense list keyboard model:** `j/k`/arrows move, `Space` selects, `Enter` ack/open, `a` ack, `Shift+A` ack all visible, `f` focus filters. Document in a `?` shortcut sheet.

### 6.4 Files to add / replace

```
src/components/ui/
  Button.tsx IconButton.tsx Field.tsx Checkbox.tsx Switch.tsx
  Card.tsx SectionHeader.tsx StatusPill.tsx PriorityBadge.tsx
  HealthChip.tsx KpiTile.tsx MeterBar.tsx EventRow.tsx DataTable.tsx
  Toolbar.tsx SegmentedControl.tsx Drawer.tsx Dialog.tsx
  EmptyState.tsx ErrorState.tsx Skeleton.tsx Toast.tsx LiveBadge.tsx
  PageHeader.tsx NavItem.tsx index.ts
src/lib/format.ts        # IST time/date/duration/count formatters
src/lib/freshness.ts     # usePoll + lastUpdated/stale contract
src/components/layout/AppShell.tsx   # regroup nav, health chip, unread badges, skip link
src/app/globals.css                  # tokens above + focus/scrollbar/selection
```
Delete/replace: `States.tsx` (split into `PageHeader`, `Skeleton`, `EmptyState`, `ErrorState`), `StatusLamp.tsx` (→ `HealthChip`), `PriorityBadge.tsx` (add rule variant), the `text-[#08110f]` literals (→ `text-accent-ink`), the 29 arbitrary values.

---

## 7. Screen redesign briefs

### 7.1 Dashboard — "Command view"

**Goal:** answer three questions above the fold in under 2 seconds: *is anything wrong*, *what happened recently*, *can I see my cameras*.

Desktop ≥1280 px (fits 1280×720 and up; target 1440×900 / 1600×1000):

```
┌─ shell header: health chip · unread badge · clock · user menu ───────────────┐
├─ row 1 · KPI strip (h 88, 5 tiles, 16 gap) ─────────────────────────────────┤
│  EVENTS TODAY 302 ↑12   UNREAD 7 (accent)   CAMERAS 4/4   RECORDER+GATEWAY  │
│  07:00–13:00 · peak 09:00      [Ack all]     disk 91.8% ⚠   backup 14 d ⚠  │
├─ row 2 · main grid (fills remaining height, min 360) ───────────────────────┤
│ ┌ 2×2 live grid (flex 1) ────────────────┐ ┌ alarm rail 320 px ───────────┐ │
│ │ tile: name / LIVE / time / signal      │ │ Unread 7 · last 24 h         │ │
│ │ [always-visible expand corner icon]    │ │ 13:54 Person · Left Side  [Ack]│ │
│ │                                        │ │ 13:43 Person · First Floor ... │ │
│ └────────────────────────────────────────┘ └──────────────────────────────┘ │
├─ row 3 · 24 h event strip (h 64): per-camera lanes with event ticks ────────┤
└─ row 4 (scrolls) · recent events table (dense) ─────────────────────────────┘
```

- KPI strip: 5 tiles, `text-kpi`, each with label, value, and a trend/secondary line; degraded health turns the relevant tile amber and shows a "Fix" link → System.
- Grid: 2×2 only when ≥1200 px wide; 1×2 + rail at 768–1199; 1×1 + rail drawer on mobile.
- Tile overlays: top-left camera name; top-right LIVE dot + clock; bottom-right expand + snapshot; bottom-left audio state only on hover/focus (or a tile menu). No "Sub 102".
- Alarm rail: unread-first, keyboard-driven, Ack inline, "Ack all" with bulk endpoint; empty state "Nothing unread in 24 h" + link to Events.
- Event strip: one lane per camera, 24 h, event ticks sized by priority; click seeks Playback to that instant. This promotes `buildTimelineMarkers` to the main screen.
- Recent events: `DataTable` (time · camera · type · priority · unread) max 10 rows, "Open events" link.

Mobile 390 px: header health chip only; KPI strip becomes a 2×2 grid of 4 KPIs; single-column camera tiles (one per viewport third) with always-visible expand; unread count as a pill on "Events" tab; no event strip (link to Events).

**Acceptance:** at 1280×720 and 1600×1000, KPI strip + grid + at least 3 alarm rows are visible without scrolling; "Recent events" is no longer required to be above the fold (it is replaced by the rail); no `Sub` ids; expand affordance visible in a touch context.

### 7.2 Events — "Triage workspace"

```
PageHeader: Events · "Unread 7 · Today 302"                 [Export] [Mark all read]
Toolbar: [Unread] [All] [Person] [Vehicle] [Motion] [Important]   Search…  [Filters 2]
DataTable (dense, sticky header, virtualised):
  ☐ │ time │ camera │ type │ priority │ status │ rule │ ack
  13:54 │ Left Side Outside │ Person detected │ HIGH │ Unread │ — │ [Ack]
  …grouped by hour, 56 px rows, keyboard j/k
Right detail panel 360 px: snapshot + metadata + actions (Ack, Play recording, Download)
Footer: "Showing 1–50 of 302 · Load more" (no page buttons)
```

- Default segment **Unread** (with count); "All" preserves today's behaviour.
- Advanced filters: date range, camera multi-select, read state, notification state, priority — inside the drawer, with active-filter chips and one "Clear all".
- Bulk: select-all-in-view, ack, mark read, export CSV.
- Detail panel: merge today's `EventDetail` and the event page; "Open full page" available.
- Live updates: "3 new events" pill inserts rows at top without jumping scroll; respects `prefers-reduced-motion`.

**Acceptance:** first row above the fold at 390 px; 50+ rows reachable without pagination clicks; unread count visible in heading and nav; ack undoable.

### 7.3 Playback — "Investigation desk" (keep, promote, densify)

- 24 px `PageHeader` "Playback · Parking · 04 Nov 2026" + "Back to live".
- Layout: player (8/12) + event rail (4/12) on desktop; on mobile player 16:9 + collapsible timeline.
- Player: overlay camera name/time/stream; transport with time readout, speed, prev/next event, snapshot, fullscreen; no wasted black (constrain player to stream aspect or add a rail).
- Timeline: 12 px labels, 44 px hit areas, 15 m/1 h/6 h/24 h presets + window drag, legend derived from the marker tone function, "now" marker on live days, event rail sync.
- Event rail rows: time · type · priority · duration, click seeks; keyboard up/down.
- Availability: when the date is auto-corrected, announce with a dismissible banner and an undo.

**Acceptance:** time readout always visible; marker hit area ≥44 px on touch; legend matches marker colours; date corrections announced.

### 7.4 Settings shell

```
Settings
┌ sub-nav 240 px (desktop) ───────────────┬ content ───────────────────────────┐
│ Monitoring    Cameras, detection        │ PageHeader (24 px) + description   │
│ Alerting      Rules, channels, history  │ Card sections, 16 gap              │
│ Data          Retention, storage        │ Sticky action bar on form pages    │
│ Access        Users, sessions, audit    │ Dirty state + Save/Discard         │
│ Recorder      Device info, system       │                                    │
└─────────────────────────────────────────┴────────────────────────────────────┘
```
- `/settings` becomes an overview: sub-nav cards with a one-line description + current status/metric (users count, detection on/off, retention 30 d, storage 91.8 % ⚠) — replacing the env dump.
- Every settings page gets the same `PageHeader`, `Card` sections, sticky save bar (sticky, inset for sidebar + tab bar), dirty guard, and toast feedback.
- Move: retention → Data; system health → Recorder/System + surfaced in shell; audit log → Access; Telegram + rule simulator → Alerting → Diagnostics (collapsed).
- Role-gated pages: replace silent redirect with a 403 in-shell state ("Admin required") and hide nav items server-side (no flicker).

### 7.5 Faces / System / Device clean-up (lower effort, high polish return)

- **Faces:** square fixed-ratio thumbnails, equal card heights, whole-card inspect action → lightbox (full frame + crop + "play from here"), grouping by day/camera, "reviewed" state, or gate the whole page behind beta. Filters in the toolbar pattern.
- **System:** alert stack first (deduped, sorted, runbook links), then a status grid of `KpiTile`s (workers, queue, storage meter, backup age) with "checked 12 s ago"; raw JSON behind a disclosure. **Promote a summary of this to the shell.**
- **Device:** grouped key/value cards (Identity, Versions, Storage, Network) with copy buttons; or fold into System → Recorder.
- **Users/Audit:** `DataTable` + row menu + confirm dialogs with focus management.
- **Login:** 44 px controls, autofocus, hub identity + non-sensitive status (recorder reachable? last backup?), "local network only" notice.

---

## 8. Prioritised direction and delivery plan

### Phase 0 — Stop the bleeding (½–1 day, no redesign)

1. **Fix the save-bar collision** (`DetectionSettings.tsx:681-696`): make it `sticky` in the content column; add mobile-nav offset. Verify at 390/834/1024/1600. *(DT-1)*
2. **Add a dirty-state guard** to Object detection + Notification rules + Users create + Account password: navigation prompt, `beforeunload`, sticky "Unsaved changes" text. *(DT-2)*
3. **Fix focus visibility** on accent-filled controls (`globals.css:64-67` + button classes) and raise `--color-line` to a ≥3:1 boundary token on inputs. *(CO-1, A11y 1.4.11/2.4.7)*
4. **Add a skip link** and move the header actions after `<main>` in DOM order. *(G-2)*
5. **Stop the silent read side effect** (`MarkReadOnView.tsx`) and add an explicit Ack action in the event detail panel/list. *(start of #2)*
6. **Surface staleness**: add `lastUpdated` to `usePoll`, show "Last updated …" + stale styling; add a stream-state listener to `LivePlayer` so a dropped stream reads "Reconnecting/Frozen", not "Live". *(#4)*
7. **Minimum target size**: 24 px minimum for inline links inside rows/cards (make the whole card a link or pad the link), 44 px for primary controls. *(start of #8, A11y 2.5.8)*

### Phase 1 — Design system (3–5 days)

1. Tokens in `globals.css` (§6.1) + self-hosted fonts or a documented system stack.
2. Primitives (§6.2) with a dev-only `/design-system` preview route showing every component × state.
3. Replace the 26 button treatments, 4 input treatments, 33 cards, 6 empty states, and all `text-[#08110f]`/arbitrary values.
4. Shared `format.ts` + `freshness.ts` (§6.3.7) and fix T-1 everywhere.
5. Lint rules: forbid raw hex in `className`, forbid `text-[Npx]`/`text-[#hex]`, enforce token usage (stylelint or a small custom check in CI).

### Phase 2 — Dashboard + Events (proof of the new system, 5–8 days)

1. Shell regroup: nav groups, health chip, unread badges, account menu, skip link, 44 px tab bar with icons (5 + More).
2. Dashboard command view (§7.1) + alarm rail + ack flow + 24 h event strip.
3. Events triage workspace (§7.2) + data table + filter drawer + bulk ack + detail panel.
4. Backend touches required: unread counts endpoint (or include in `/api/events/stats`), bulk ack endpoint, snapshot download. Flag these to the backend owner early.

### Phase 3 — Settings shell + remaining screens (3–5 days)

Settings two-pane shell + sticky save pattern; System alert stack + health promotion; Playback densify/promote; Faces geometry + lightbox; Users/Audit tables; Login/account polish; empty/error states unified.

### Phase 4 — Accessibility & QA hardening (2 days)

Keyboard pass on every screen (tab order, traps, shortcuts), screen-reader pass on dashboard/events/settings, contrast re-check (borders, focus, disabled), 390/768/1024/1280/1600/1920 screenshot diff, stale-state simulation (kill API/network), reduced-motion pass, and a `?` shortcut sheet.

### Acceptance checklist (measurable, for the Lead's final verification)

- [ ] No control has a boundary below **3:1** against its surface; text ≥ **4.5:1** (≥3:1 for ≥24 px).
- [ ] Focus ring visible on **every** interactive element incl. accent-filled buttons (keyboard-only screenshot set).
- [ ] **100 % of primary controls ≥44 px**, secondary ≥40 px, inline touch targets ≥24 px.
- [ ] **Skip link** present; ≤3 tab stops before main content on any route.
- [ ] **First result above the fold at 390×844** on Events, Faces, Notifications.
- [ ] **No overlap** between sticky/fixed bars and nav at 390/834/1024/1440/1920.
- [ ] **No text ≤11 px** except uppercase micro-labels; no sentences at 11–12 px.
- [ ] A single time format (IST 24 h) across all screens except native time inputs; zero raw ISO/UTC strings in the UI.
- [ ] **Unread count** visible in the shell and Events heading; **Ack** works and is undoable; no silent read changes.
- [ ] **Stale state**: killing the API shows a "last updated / retrying" state within one poll interval; video stream drop shows reconnecting/frozen.
- [ ] **Unsaved changes** cannot be lost silently on any form.
- [ ] Every async region has `aria-live`/`aria-busy`; every dialog traps/returns focus.
- [ ] Empty/error states all use `EmptyState`/`ErrorState` and offer a next action.
- [ ] Dashboard answers "is anything wrong?" at 1280×720 without scrolling.

---

## Appendix A — Contrast table

Computed with WCAG 2.x relative luminance; translucent tints are alpha-composited over the stated background (`node design/tools/ux-audit-contrast.mjs`).

| Pair | Size | Ratio | Verdict |
|---|---|---|---|
| ink `#e8eef6` on bg `#080b10` | 16 | **16.88:1** | Pass |
| ink on card `#141b24` | 14 | 14.84:1 | Pass |
| ink on panel `#10151c` | 14 | 15.70:1 | Pass |
| muted `#93a0b3` on bg | 14 | 7.43:1 | Pass |
| muted on card | 14 | 6.53:1 | Pass |
| muted on card | 12 | 6.53:1 | Pass |
| muted on panel | 12 | 6.91:1 | Pass |
| muted on card/50 (disabled rule card) | 12 | 7.03:1 | Pass |
| teal on card | 14 | 10.47:1 | Pass |
| teal on bg (links) | 14 | 11.91:1 | Pass |
| teal on bg (11 px "New"/"View event") | 11 | 11.91:1 | Pass |
| online `#3ddc97` on card | 14 | 9.80:1 | Pass |
| offline `#ff6b6b` on card | 11 | 6.24:1 | Pass |
| warn `#f0c36a` on card | 14 | 10.49:1 | Pass |
| warn on bg | 14 | 11.94:1 | Pass |
| CRITICAL pill: offline on offline/15 over card | 11 | 5.07:1 | Pass |
| HIGH pill: warn on warn/15 over card | 11 | 7.55:1 | Pass |
| Sent pill: online on online/15 over card | 11 | 7.15:1 | Pass |
| NORMAL pill: muted on white/5 over card | 11 | 5.74:1 | Pass |
| primary ink `#08110f` on teal | 14 bold | 11.57:1 | Pass |
| black on teal | 14 bold | 12.69:1 | Pass |
| ghost: ink on white/5 over card | 14 | 13.04:1 | Pass |
| ghost: ink on white/5 over bg | 14 | 15.39:1 | Pass |
| **disabled pagination: ink@40 % on card** | 14 | **3.42:1** | **Fail** (informational text) |
| disabled button label: ink@60 % on card | 14 | 6.09:1 | Pass |
| **disabled calendar day: muted@35 % on panel** | 14 | **1.92:1** | **Fail** (date availability disappears) |
| **line `rgba(232,237,245,.10)` on bg** | 1 px | **1.23:1** | **Fail 1.4.11** |
| **line on card** | 1 px | **1.30:1** | **Fail 1.4.11** |
| **active nav fill white/10 on panel** | fill | **1.31:1** | **Fail 1.4.11** |
| warn/50 border on card | 1 px | 3.56:1 | Pass |
| teal focus ring on bg | 2 px | 11.91:1 | Pass |
| teal focus ring on card | 2 px | 10.47:1 | Pass |
| teal focus ring on panel | 2 px | 11.07:1 | Pass |
| **teal focus ring on teal fill** | 2 px | **1:1** | **Fail** (invisible) |
| offline dot vs card | 10 px | 6.24:1 | Pass as graphics |
| warn dot vs card | 10 px | 10.49:1 | Pass as graphics |

Proposed replacement tokens verified: `line-strong #5c6878` = 3.06:1 on card / 3.48:1 on bg (passes 1.4.11); `muted-2 #a6b2c4` = 8.07:1 on card (for 11–12 px living text); `info #5aa9ff` = 7.06:1 on card.

## Appendix B — Measurement tables

**B.1 Interactive targets <44 px** (measured per route; links, buttons, inputs, `[role=slider]`, `[tabindex]`)

| Route | Targets <44 px / total |
|---|---|
| `/` | 18 / 36 |
| `/events` | 18 / 59 |
| `/cameras` | 11 / 33 |
| `/faces` | 37 / 52 |
| `/playback` | 21 / 42 |
| `/notifications` | 38 / 53 |
| `/device` | 11 / 21 |
| `/account` | 13 / 27 |
| `/settings` | 16 / 26 |
| `/settings/users` | 21 / 35 |
| `/settings/notifications` | 14 / 32 |
| `/settings/detection` | 49 / 60 |
| `/settings/audit-log` | 13 / 27 |
| `/settings/system` | 11 / 21 |
| `/events/stats` | 15 / 25 |
| **Total** | **306 / 549 (55.7 %)** |

**B.2 Text-size census** (1 452 nodes with direct text across the 15 routes)

| Size | Nodes | Share |
|---|---|---|
| 20 px | 20 | 1.4 % |
| 16 px | 18 | 1.2 % |
| 14 px | 642 | 44.2 % |
| 12 px | 496 | 34.2 % |
| 11 px | 263 | 18.1 % |
| 10 px | 7 | 0.5 % |
| 9 px | 6 | 0.4 % |

**B.3 Heads and document titles**

| Route | Doc title | `h1` | first `h2` |
|---|---|---|---|
| `/` | Home CCTV | 20 px | 14 px "Recent security events" |
| `/events` | Home CCTV | 20 px | 14 px "Today 304 events" |
| `/playback` | Home CCTV | **16 px** | 12 px "Timeline" |
| `/faces` | Detected Faces · Home CCTV | 20 px | — |
| `/cameras` | Camera setup · Home CCTV | 20 px | — |
| `/settings` | Settings · Home CCTV | 20 px | — |
| `/settings/detection` | Object detection · Home CCTV | 20 px | 14 px **"Object detection"** (duplicate) |
| `/settings/users` | Home CCTV | 20 px | 14 px "Create user" |
| `/settings/system` | Home CCTV | 20 px | 14 px "Face detection" |
| `/settings/audit-log` | Home CCTV | 20 px | — |
| `/events/stats` | Event statistics · Home CCTV | 20 px | 14 px "Today" |
| `/notifications` | Home CCTV | 20 px | — |
| `/device` | Device · Home CCTV | 20 px | — |
| `/account` | Home CCTV | 20 px | 14 px "Change password" |

**B.4 Shell geometry**

| Item | Measured |
|---|---|
| Sidebar nav item | 195 × **36** px, 14 px text |
| Header height | 61 px; "Enable notifications" 133 × 36 px |
| Mobile header @390 | Mark + "DVR ok" + Enable notifications + Account (63×36) + Log out (68×36); product title truncates to 0 width |
| Mobile tab bar | 390 × **39** px, 8 items **49 × 38** px, **11 px** labels |
| Dashboard @1600×1000 | camera grid 145→992 (847 px); recent events top **1032** (below fold); tiles 658 × 416 |
| Mobile dashboard @390 | tiles 366 × 261; 2.5 visible per viewport |
| Detection save bar @390 | save 788–832, nav 805–844 → **27 px overlap**, z 20 vs 40 |
| Detection save bar @1600 | bar 0–1600 × 931–1000; Log out 12–207 × 948–988 → **fully covered** |

**B.5 Faces card geometry** (`/faces`, first 8 cards)

| Card | Card H | Image H | Image W | Square? |
|---|---|---|---|---|
| 1 | 614 | 398 | 322 | no |
| 2 | 614 | 426 | 322 | no |
| 3 | 614 | 504 | 322 | no |
| 4 | 614 | 407 | 322 | no |
| 5 | 572 | 462 | 322 | no |
| 6 | 572 | 407 | 322 | no |
| 7 | 572 | 421 | 322 | no |
| 8 | 572 | 437 | 322 | no |

**B.6 Component inventory**

- Interactive elements: **549**; `<44 px`: **306**.
- Button/row treatments: **26 distinct** (`h` 30/32/36/40/44/58; radius 0/8/12; 4 fills; font 12/14/16) across **260** controls.
- Input treatments: **4 distinct** across **47** inputs (heights 40/44/58; fills `bg-card` 22× vs `bg-bg` 21×).
- Cards: **33**, 30 share `rounded-xl bg-card border-line` (the good base).
- Hard-coded colours in TSX: **24** (13× `#08110f`); arbitrary value classes: **29**; inline `style` in source: **14** (28 rendered on Playback, 37 on Detection).
- Padding distribution: `p-2` 59, `p-3` 55, `p-1` 23, `p-4` 22, `p-5` 3, `p-6` 2.

**B.7 Keyboard probe**

- `tabStopsBeforeMain: 11`, `totalTabStops: 22`, `hasSkipLink: false`.
- First five stops: Dashboard, Camera setup, Playback, Events, Faces (sidebar before content on every route).
- Focus probe on a nav link: `outline: solid 2px rgb(62, 224, 199)` — ring works on dark only.
- Dialogs (`role="alertdialog"` inline cards) do not move focus or trap it.

**B.8 Unsaved-changes probe** (Object detection)

```json
{ "before": false, "after": true, "reloaded": false, "lost": true }
```

**B.9 Login probe**

```json
{ "inputs": [{"name":"username","height":38,"hasLabel":true,"autocomplete":"username"},{"name":"password","type":"password","height":38}], "buttonHeight": 36, "focusedOnLoad": "BODY" }
```

## Appendix C — Screenshot index

| File | What it shows |
|---|---|
| `uxaudit-dashboard-loaded.png` | Dashboard, live video, 1600×1000 — fold position, tile chrome, duplicate brand |
| `uxaudit-dashboard-hover.png` | Tile hover affordance ("Full screen" pill) |
| `uxaudit-dashboard-header.png` | Header/status lamp/clock sample |
| `uxaudit-mobile-dashboard-loaded.png` | Mobile shell: truncated title, 8-item tab bar, stacked tiles |
| `uxaudit-events-loaded.png` | Events with data: filter form, rows, detail panel |
| `uxaudit-events-empty.png` | Events 0-result dead end ("Select an event.") |
| `uxaudit-mobile-events.png` | Mobile filter wall (first row below 1.5 viewports) |
| `uxaudit-event-detail.png` / `-full.png` | Event detail: snapshot dominance, actions below fold, metadata dump |
| `uxaudit-playback-loaded.png` / `-full.png` | Playback: letterboxed player, control bar, timeline, legend |
| `uxaudit-mobile-playback.png` | Playback mobile |
| `uxaudit-cameras.png` | Camera setup: no preview, "Channel 1" label, raw stream ids |
| `uxaudit-faces.png` | Ragged face cards, all "Unassigned" |
| `uxaudit-notifications-loaded.png` | Notification history: 2 sent / 301 suppressed, card rows |
| `uxaudit-settings-notifications.png` | Rules page: mixed domains, debug status line |
| `uxaudit-mobile-settings-notifications.png` | Rules on mobile: Telegram button, status line |
| `uxaudit-settings-users.png` | Users: 5 equal actions per row, placeholder-only form |
| `uxaudit-settings-detection.png` | Detection: duplicate title, log-style status, fixed save bar |
| `uxaudit-detection-desktop-bar.png` | Save bar covering sidebar Account/Log out |
| `uxaudit-mobile-settings-detection.png` | Detection mobile form |
| `uxaudit-mobile-detection-savebar.png` | **Save bar under the bottom nav (P0)** |
| `uxaudit-tablet-detection.png` | Tablet 834 save bar/geometry spot-check |
| `uxaudit-settings-system.png` / `uxaudit-system-loaded.png` | System: raw ISO/seconds, duplicate alerts |
| `uxaudit-settings-audit.png` | Audit log: card rows, placeholder filters |
| `uxaudit-settings.png` | Settings overview: env dump + link paragraph |
| `uxaudit-device.png` | Device key/value dump |
| `uxaudit-account.png` | Account: sessions, locale times |
| `uxaudit-event-stats.png` | Event statistics (the one KPI pattern worth reusing) |
| `uxaudit-login.png` | Login card |
| `uxaudit-focus-events.png` | Keyboard focus on nav (ring on dark), active vs focus ambiguity |
| `uxaudit-measurements.json`, `-2.json`, `-3.json` | Raw measurements (targets, fonts, headings, geometry, probes) |

Existing `design/audit/before/*-desktop*.png` were also reviewed for states (several predate data load; `debug-dashboard.png` confirms the loaded layout).

## Appendix D — Evidence index (file:line)

| Area | References |
|---|---|
| Shell / nav | `src/components/layout/AppShell.tsx:23-33` (flat nav), `:43-48` (clock), `:109-115` (stale lamp), `:132-139` (role fetch/filter), `:155-192` (duplicate brand), `:198-211` (header actions), `:220` (main padding `pb-28`), `:227-246` (mobile tab bar) |
| Dashboard | `src/components/dashboard/DashboardView.tsx:74` (jargon intro), `:88` (error replaces grid), `:98` (grid), `:115-117` (recent events after grid) |
| Tiles / video | `src/components/camera/CameraTile.tsx:101-110` (hover-only expand), `:116-124` (caption/"Sub"), `src/components/camera/LivePlayer.tsx:30-54` (connection only at start), `:311-334` (Live chip + Unmute) |
| Events | `src/components/events/EventsView.tsx:33-37` (classification hues), `:196-285` (filters), `:275-284` (Search row), `:301-333` (rows/pagination), `:315` ("New"), `:341-383` (detail) |
| Event detail | `src/app/(hub)/events/[id]/page.tsx:47-54` (intro), `:60` (duplicate time), `:65-129` (snapshot/CTAs), `:91-114` (debug metadata), `src/components/events/MarkReadOnView.tsx:10-25` (silent read) |
| Playback | `src/components/playback/PlaybackView.tsx:67-74` (silent date correction), `:255-259` (16 px title), `PlaybackTimeline.tsx:26-30` (marker tones), `:310,327,429` (9–10 px), `:369-434` (small markers), `:513-542` (legend), `PlaybackControls.tsx:26-57` (transport) |
| Camera setup | `src/components/cameras/CamerasView.tsx:95-98` (intro), `:125-135` ("Channel 1" label), `:161-178` (raw ids) |
| Faces | `src/components/faces/FacesView.tsx:89-92` (future-phase copy), `:184-192` (stats), `src/components/faces/FaceCard.tsx:17-47` (geometry, 16 px link) |
| Notifications | `src/components/events/NotificationsView.tsx:68-74` (buried KPI), `:147-151` (status glyphs), `:163-187` (row) |
| Rules | `src/components/events/NotificationRules.tsx:209-222` (actions), `:238-248` (middot summary), `:268-276` (confirm), `:294-308` (auto-save retention), `:380-574` (editor), `:557` (unstyled checkbox) |
| Settings | `src/components/settings/SettingsView.tsx:33` (.env copy), `:35-45` (link paragraph), `:61-73` (env rows), `src/app/(hub)/settings/layout.tsx:4-9` (silent redirect) |
| Users | `src/components/settings/UsersView.tsx:103-113` (no confirm), `:126-130` (5 actions), `:144-183` (placeholder labels) |
| Detection | `src/components/settings/DetectionSettings.tsx:64-91` (checkbox toggle), `:324-327` (duplicate title), `:334-363` (log block), `:436-483` (compound threshold), `:620-679` (diagnostics), `:681-696` (fixed save bar) |
| System | `src/app/(hub)/settings/system/page.tsx:28-34` (age), `:87-106` (duplicates), `:109-117` (health pairs), `:148,171` (raw ISO), `:187-200` (sessions) |
| Audit / Device / Account | `src/app/(hub)/settings/audit-log/page.tsx:65-67, 80-91`; `src/components/device/DeviceView.tsx:18-32`; `src/components/account/AccountView.tsx:20-24, 201-214` |
| Login / errors | `src/app/login/page.tsx:42-66`, `src/components/auth/LoginForm.tsx:68-110`, `src/app/error.tsx`, `src/app/not-found.tsx` |
| Theme / states | `src/app/globals.css:5-29` (tokens), `:64-67` (focus), `:70-74` (reduced motion), `src/components/ui/States.tsx:1-51`, `src/components/ui/StatusLamp.tsx:2-45`, `src/components/hooks/usePoll.ts:20-22, 38-56` |

## Appendix E — Files written by this audit

- `design/audit/UX-FINDINGS.md` (this report)
- `design/tools/ux-audit-contrast.mjs`, `ux-audit-shots.mjs`, `ux-audit-shots2.mjs`, `ux-audit-shots3.mjs`
- `design/audit/before/uxaudit-*.png` (39 screenshots), `uxaudit-measurements*.json` (3 files)

No application source, configuration, `.env`, server or database state was modified. MediaMTX/DVR were read only; no test suite or Playwright suite was run (single-purpose screenshot scripts only).
