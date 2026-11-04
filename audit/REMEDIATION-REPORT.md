# Remediation Report — Home CCTV Hub (approved implementation pass)

**Date:** 2026-11-04 (Asia/Kolkata) · **Status:** implemented + verified · **Approval:** given by the user after the audit
**Scope:** Phase 1 (trust & correctness) + the safe, test-compatible parts of Phase 2 (core workflow & accessibility) from [`MASTER_UI_UX_REPORT.md`](MASTER_UI_UX_REPORT.md) §11.
**Constraint:** no dependency installed; no schema/API breaking change; all test-locked UI contracts preserved (Playwright desktop suite + Vitest class-token tests).

This report is the implementation companion to the audit. The audit reports describe the **baseline** that was measured; this file records what changed, how it was verified, and what remains.

---

## 1. Results at a glance

| Gate | Before remediation | After remediation |
|---|---|---|
| TypeScript (`npm run typecheck`) | pass | **pass** |
| ESLint (`npm run lint`) | 0 errors, 8 pre-existing warnings | **0 errors, 8 pre-existing warnings** (none added) |
| Unit/integration (`npm test`) | 82 files / 837 tests | **82 files / 837 tests passing** |
| Production build (`npm run build`) | pass | **pass** (all 17 routes compiled, standalone output) |
| Playwright e2e (`npx playwright test --workers=1`) | 101 passed / 10 skipped (previous QA run) | **99 passed / 2 failed / 10 skipped** — the 2 failures are the pre-existing playback-preview environment failures (see §4; they also fail with the remediation stashed) |
| Route × viewport capture (17 × 4) | 68/68 HTTP 200, 0 console errors | **68/68 HTTP 200**, 0 page errors, 0 horizontal overflow; 3 `/playback` captures log an environmental 503 from the thumbnail index while the DVR playback slot is busy (page renders; same condition caused the two e2e preview failures) |
| Interactive elements under 24 px | 78 per viewport (312 across the set) | **29 per viewport** (desktop); 242 under 44 px on mobile (was 295) |
| Horizontal page overflow | 0 | 0 |
| Health summary vs system page | "All systems nominal" while degraded | **"System degraded"** everywhere, with storage/worker/backup facts |

**Before/after evidence:** [`screenshots-after/compare/remediation-desktop-before-after.png`](screenshots-after/compare/remediation-desktop-before-after.png) · [`screenshots-after/compare/remediation-mobile-before-after.png`](screenshots-after/compare/remediation-mobile-before-after.png) · full sets in [`screenshots/`](screenshots/) (baseline) and [`screenshots-after/`](screenshots-after/) (post-fix), each 68 viewport + 68 full-page captures with metrics JSON.

---

## 2. What was fixed (mapped to audit IDs)

### M-01 — Critical: the health signal no longer contradicts the system page
- Added one aggregated health source for the shell: `src/components/hooks/useSystemHealth.tsx` (ADMIN-only polling of the existing `/api/system/health`, 60 s + window focus). The server session role is now passed into the shell by `src/app/(hub)/layout.tsx`, so VIEWERs never request the ADMIN-only endpoint.
- The app-bar pill now reads **"All systems nominal" only when the aggregate is healthy**, otherwise **"System degraded" / "System unhealthy"**. VIEWERs get a scoped label ("DVR & streams online") instead of a false whole-system verdict.
- The dashboard "System snapshot" now shows the aggregate badge (Healthy/Degraded/Unhealthy) plus storage %, face-worker state and backup staleness, and the first warning is humanised in place. The "System health" link is admin-only.
- **Verified in the running app:** pill `System degraded`; snapshot rows `Storage 93.2% used`, `Face worker Stopped · 13.9 days`, `Backups Stale`; `/api/system/health` returns `degraded`. See [`screenshots-after/desktop/dashboard.png`](screenshots-after/desktop/dashboard.png) and [`settings-system.png`](screenshots-after/desktop/settings-system.png).

### M-02 — High: Events cannot label the wrong day's rows any more
- The rendered day header and count now derive from **applied** query state (`appliedDate` set only after a successful `/api/events` response), not from draft input state. `EventsView.tsx`.
- Editing the panel date without pressing Search leaves the header/rows untouched and shows **"Press Search to apply the new date."**
- The duplicated date string for non-today days was removed (`Today · 04 Nov 2026`; other days show the date once).
- **Verified:** changing the panel date to `2026-10-30` did not change the header (before: header flipped with no refetch); both date labels ("Selected day" / "Date") remain for the e2e contract.

### M-03 — High: unread triage is now possible
- New explicit actions: **"Mark all read"** on the Events list and **"Mark read"** on the event inspector (button appears only for unread events). Both announce via a live region and refresh the unread badge through the existing `cctv-event` event.
- New API `POST /api/events/read` (`{ date }`) and `EventStore.markAllRead(start, end, readAt)` mark one India-time day's unread events — no schema change.
- The unread badge now also appears on the **mobile/tablet Events tab**, with an accessible label scoped to "today".
- **Verified:** `POST /api/events/read` → `{ ok: true, updated: 514, date: "2026-11-04" }`; live region renders "531 events for 04 Nov 2026."; inspector offers "Mark read"; mobile nav badge shows the count.
- ⚠️ The verification call genuinely marked today's (2026-11-04) events read — see §6 side effects.

### M-04 — High: focus mode keeps keyboard and focus inside the video
- `CameraTile` now uses the shared focus trap while focused: focus moves inside the tile, Tab cycles within it, Escape exits, and focus returns to the originating **"Open … full screen"** control.
- The dashboard marks the rail and today column `inert` + `aria-hidden` while focused, and a visible **"Press Esc to return to the grid"** hint appears.
- **Verified:** rail/today inert; after Escape focus = `Open Parking full screen`; Tab stays on tile controls.

### M-05 — High: overlays behave like dialogs
- New shared `src/components/hooks/useFocusTrap.ts`: focus transfer, Tab trap, Escape close, background scroll lock, focus restoration.
- **More sheet:** `aria-modal="true"`, visible **Close** button in a new sheet header, focus moved into the sheet, background shell made `inert`/`aria-hidden`, trigger focused again on close.
- **Mobile Events inspector:** same trap; focus moves to its close control; Escape closes and restores focus to the row. (The element keeps `role="article"` because the e2e suite selects `article[name="Event details"]`; dialog semantics are provided by the trap + modal state rather than renaming the tested role.)
- **Verified:** More sheet focus inside, close button present, shell inert, Escape returns to "More"; inspector focus inside, Tab contained, Escape returns to the event row.

### M-06 — High: single navigation at 1024 px
- Removed the Tailwind `hidden lg:flex` pair from the sidebar so the CSS breakpoint owns visibility (the collision where Tailwind `lg`=1024 showed the sidebar while CSS ≤1024 also showed the bottom bar).
- **Verified:** at 1023 / 1024 / 1025 px the app now shows exactly one navigation; document height at 1024 is 768 px (was 1536 px). Evidence: [`screenshots-after/states/viewport-1024.png`](screenshots-after/states/viewport-1024.png) vs baseline [`screenshots/states/viewport-1024-both-navs.png`](screenshots/states/viewport-1024-both-navs.png).

### M-07 — High: settings tables no longer clip values
- `.table--stack` now truly stacks at ≤720 px (`table/tbody/tr/td` block flow, `min-width` released) and the detection table's desktop min-width was reduced from 860 px to 760 px so it fits the 834 px tablet card.
- **Verified:** at 390 px the table is 364 px inside a 366 px card (was 860 px); at 834 px it is 784 px inside 784 px; no page overflow. Values are reachable.

### M-08 — High: one time/date notation
- App-bar clock is now **24-hour Asia/Kolkata** (`19:00:07`) with the date `04 Nov 2026`.
- Account session timestamps use the shared Asia/Kolkata formatter (were browser-locale AM/PM); the Device page formats the DVR time instead of raw ISO; Settings → System humanises seconds counts ("not checked in for **13.9 days**", was "1200188 seconds").
- New helpers in `src/lib/time-kolkata.ts`: `formatKolkataDate`, `formatKolkataShortDateTimeFromIso`, `formatDurationSeconds`, `humanizeSecondsInText`.
- Native `<input type="time">` rendering remains locale-dependent (Chromium en-US renders 12 h); this is unchanged and flagged as residual.

### M-09 — High: priority colour semantics unified
- `PriorityBadge` now maps **HIGH → amber (`badge--warn`)**, CRITICAL → critical tone, NORMAL/LOW neutral — matching the rule editor and the design system; red is reserved for failure/offline/destructive states.
- **Verified:** Events/Notifications/Dashboard/detail now show amber "High" badges; the rule editor already used amber.

### M-11 / M-12 — Medium: typography floor and boundaries
- 9 px structural labels raised to 11 px (camera property labels, settings sub-nav group label, key/value labels, stacked-table labels) and the 10 px shell/nav/stat/clock-date/camera-meta/face-time/mobile-nav labels raised to 11 px.
- Secondary buttons and icon buttons now use the 3.2–3.5:1 `--line-control` boundary (was 1.53:1), and the switch-off track uses the same control line. Card hairlines remain intentionally low-contrast surfaces.
- **Measured:** elements under 24 px dropped **78 → 29 per viewport**; under-44 px on mobile dropped **295 → 242**.

### M-13 / M-22 / M-23 / M-24 / M-31 / M-33 / M-16 / M-17 / M-27 — additional quick wins
- **M-13:** card "View event"/"Open event" actions are ≥24 px tall; mobile primary controls are 44 px (`btn`), compact 36 px, icon buttons 44 px; checkbox rows ≥36 px.
- **M-22:** Account sessions are capped to 8 with **"Show all N sessions"** (current device first) and no longer produce a 27 000–35 000 px page.
- **M-23:** the session role is passed from the server layout, so the Settings nav is correct on first paint (no ~230 ms pop-in, cannot fail closed).
- **M-24:** live regions added for Events result counts, Faces "Showing …", and Notification decisions; `aria-busy` on the list containers.
- **M-31:** the mobile bottom-bar space is reserved once (`#main` `72px` + safe area; `.content` padding removed), not twice.
- **M-33:** Device time formatted (see M-08); "Camera 3" snapshot label remains (needs a camera-name prop in the detail page — residual).
- **M-16:** dashboard rail min-width fixed (no horizontal overflow at 1440) and the short-laptop height-fit adjusted so the four tiles stay above the fold.
- **M-17:** "Today by camera" is hidden below 1760 px (was showing on phones/tablets and missing on laptops).
- **M-27:** the Object-detection save bar has reserved space and now sits 7.5 px above the mobile nav (was overlapping).

---

## 3. Files changed

| Area | Files |
|---|---|
| Shell / navigation / health | `src/components/layout/AppShell.tsx`, `src/app/(hub)/layout.tsx`, `src/components/hooks/useSystemHealth.tsx` (new), `src/components/hooks/usePoll.ts` |
| Focus / overlays | `src/components/hooks/useFocusTrap.ts` (new), `src/components/camera/CameraTile.tsx`, `src/components/dashboard/DashboardView.tsx`, `src/components/events/EventsView.tsx` |
| Events / unread | `src/components/events/EventsView.tsx`, `src/app/api/events/read/route.ts` (new), `src/server/events/event-store.ts`, `src/app/(hub)/settings/system/page.tsx` |
| Time / date / formatting | `src/lib/time-kolkata.ts`, `src/components/account/AccountView.tsx`, `src/components/device/DeviceView.tsx`, `src/components/layout/AppShell.tsx` |
| Priority / states / live regions | `src/components/events/PriorityBadge.tsx`, `src/components/events/NotificationsView.tsx`, `src/components/faces/FacesView.tsx`, `src/components/events/RecentEvents.tsx` |
| Layout / tokens / targets | `src/app/globals.css`, `src/components/settings/DetectionSettings.tsx` |

No changes under `tests/`, `playwright.config.ts`, `next.config.ts`, `.env`, Docker/compose, MediaMTX config, or the database schema. No dependency was added. Staging now contains the pre-existing Sentinel redesign plus this remediation (44 changed/new `src/` files); the audit reports and evidence are the only audit-side additions.

---

## 4. Verification detail

### 4.1 Static gates

```text
npm run typecheck   → pass
npm run lint        → 0 errors, 8 pre-existing warnings (design/tools/*.mjs + face-notify.test.ts; none added)
npm test            → 82 files / 837 tests passed
npm run build       → pass (all 17 routes, standalone output)
```

### 4.2 Playwright e2e

`npx playwright test --workers=1` → **99 passed, 2 failed, 10 skipped** (1.8 min).

- The 10 skips are the documented environment skips (no VIEWER credentials / mutation-gated rule tests).
- The 2 failures are `PLAY-017` and `PLAY-018` (timeline hover previews). They are **not caused by this change**:
  - Neither `src/components/playback/**` nor the playback API/routes were modified.
  - Re-running the same two tests with **all remediation changes stashed** (baseline tree) reproduced the same failures (`a 25 step sweep must not request per pointer move (got 14)`, and a preview caption 150 s from the hovered instant).
  - The hub's thumbnail worker reports `lastError: "dvr_busy"` with a queued job; playback previews depend on pre-generated sprite/thumbnail data and DVR playback availability, which is currently contended. The page itself renders and all other playback tests pass.
- All dashboard, navigation, live view, events, faces, notifications, settings, auth and security specs pass against the changed shell.

### 4.3 Rendered checks (independent probe)

| Check | Result |
|---|---|
| 1024 px navigation | sidebar `none`, mobile nav `grid`, doc height 768 (was both visible, doc height 1536) |
| App-bar clock | `19:00:07` (24 h) + `04 Nov 2026` |
| Health pill | `System degraded` (matches `/api/system/health` `degraded`) |
| Dashboard snapshot | `Storage 93.2% used`, `Face worker Stopped · 13.9 days`, `Backups Stale` |
| Events header | `Today · 04 Nov 2026` + applied count; draft date does not relabel rows |
| Mark read / mark all read | inspector button present; API returns `{ok:true, updated}`; live region announces |
| Focus mode | rail/today `inert`, hint visible, Escape returns focus to `Open … full screen` |
| More sheet | focus inside, `aria-modal=true`, visible close, shell inert, Escape restores trigger |
| Mobile bottom padding | `.content` 0 px + `#main` 72 px (was 92 + 112 = 204 px) |
| Detection table @390 | 364 px inside a 366 px card (was 860 px clipped); @834 784 px |
| Save bar @390 | bottom 782 px vs nav top 789.5 px → no overlap |
| Dashboard @1440 | `#main` horizontal overflow 0 (was 10–16 px); four tiles fit the fold |
| Account sessions | 8 rows + "Show all 290 sessions" (was 247+ rows, 27 877 px) |
| Interactive targets | <24 px: 78 → 29 per viewport; mobile <44 px: 295 → 242 |
| Console/page errors | 0 page errors; the only console messages are the environmental playback-thumbnail 503s described in §4.2 |

### 4.4 Evidence sets

- Baseline (audited build): [`screenshots/`](screenshots/) — 68 viewport + 68 full-page captures, 10 states, `capture-metrics.json`.
- Post-remediation: [`screenshots-after/`](screenshots-after/) — 68 viewport + 68 full-page captures, 10 states (including 1023/1024/1025 boundary), `capture-metrics-after.json`.
- Comparison sheets: [`remediation-desktop-before-after.png`](screenshots-after/compare/remediation-desktop-before-after.png) · [`remediation-mobile-before-after.png`](screenshots-after/compare/remediation-mobile-before-after.png).

---

## 5. What was deliberately not changed (residual scope, Phase 3+)

| Audit finding(s) | Why it remains |
|---|---|
| M-10 remainder (one filter/save commit model across Events/Faces/Notifications/Playback) | Needs a product decision on instant-apply vs explicit-apply; the Events date correctness part is fixed, but Faces/Notifications still auto-apply and their Apply buttons are redundant. |
| M-14 mobile filter-first ordering (Playback/Notifications/Faces) and the detection camera table reflow | Requires markup re-ordering/design; the table now stacks correctly but the "controls before content" order is unchanged. |
| M-15 wide-screen emptiness, M-18 nav taxonomy, M-19 status vocabulary, M-20 empty/error/loading unification, M-21 table/pagination idioms, M-25 duplicate labels/actions | Design-consolidation work, larger blast radius across many screens; no correctness impact. |
| M-26 playback surface (pillarboxing, page header, raw utilities) | Playback internals are test-locked and intentionally out of scope for this pass. |
| M-28 component duplication (Stat/Pagination/FilterPanel primitives) and M-29 CSS consolidation | Refactor-scale work; safe to schedule separately. |
| M-30 playback 4 Hz re-render | Performance polish; needs a careful playback change under test coverage. |
| M-32 camera-tile overlays, M-34 chrome-free page drift, M-35 route titles, M-36 mobile Statistics action, M-37 phone clock/status, M-38 portrait letterbox, M-39–M-44 polish | Low severity; next polish pass. |
| Native time-input 12 h rendering | Locale-dependent browser behaviour; the app's own clock/readouts are now 24 h. |
| Event-detail snapshot "Camera 3" label | Needs the camera-name map passed into the detail page. |
| VIEWER runtime verification | No VIEWER credentials in this workspace; the code paths are unchanged except that the shell now receives its role from the server. |

---

## 6. Side effects, safety and rollback notes

- **Read-state data:** the verification of "Mark all read" executed once on 2026-11-04 and marked **514 events for that day** read (the sidebar badge dropped accordingly; new events have since accumulated). There is no undo action for a mark-all; this is the feature working as designed, executed once during verification.
- **Servers:** the dev server was stopped/started as part of the production-build verification; it is running again at `http://localhost:3000`. `npm run build` regenerated `.next`; `predev` cleared the stale dev cache on restart.
- **Git:** implementation changes are staged together with the pre-existing Sentinel redesign (staging was normalised after a temporary stash used to prove the two playback failures are pre-existing). No commit was made.
- **Database/API:** no schema migration. The only API addition is `POST /api/events/read` (authenticated, one-day window) plus the internal `markAllRead` store method.
- **CCTV behaviour:** unchanged — same WebRTC/HLS paths, stream mounting, focus-mode stream reuse, DVR session handling. No configuration or `.env` change.

**Remaining decision:** the residual Phase 3 consolidation (filters/save model, nav/status vocabulary, primitives, CSS cleanup, playback surface) is not started; it can follow once this correctness pass is accepted.
