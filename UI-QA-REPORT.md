# UI QA REPORT — Home CCTV Hub

**Application:** http://localhost:3000 (Home CCTV, Next.js 16 + React 19, Tailwind 4)
**Method:** Real browser automation (Chromium via Playwright), live interaction only. Inspection-only — no source, config, database, or data was modified.
**Pages inspected:** 14 routes (12 authenticated + login + unauthenticated redirect behaviour)
**Viewports:** 320×568, 375×667, 390×844, 430×932, 768×1024, 820×1180, 1024×768, 1280×800, 1440×900, 1920×1080

> **Environment caveat (important for triage):** the DVR at `192.168.0.210`/`192.168.1.100` is **unreachable** from this test host. Live view still works (WebRTC sub-streams via MediaMTX), but **Playback returns HTTP 503**. I therefore **do not** report "playback is broken" as a UI defect. I *do* report the UI's handling of that condition, which is a genuine interface problem.

---

## Summary

| Severity | Count |
|---|---|
| **P0 — Blocker** | 0 |
| **P1 — High** | 3 |
| **P2 — Medium** | 7 |
| **P3 — Low** | 5 |
| **Total** | **15** |

**Overall:** the UI is genuinely well-built — correct landmarks, single `h1` per page, no heading-order skips, no unlabeled controls, visible focus rings everywhere, **zero WCAG AA contrast failures across 159 sampled text nodes**, client-side routing without reloads, and all pages interactive in ~300 ms. The problems below are concentrated in **mobile navigation**, the **Playback error state**, and a few **stale/contradictory data** cases.

---

## Critical Issues (P0 / P1)

### UI-001 — P1 — Mobile bottom navigation labels overlap each other
**Page:** All pages (shared component) · **Viewport:** 320×568, 375×667, 390×844, 430×932 · **Confidence:** HIGH

**Steps to reproduce:**
1. Open any authenticated page, e.g. `/events`
2. Resize the viewport to 390 × 844 (or any width from 320–430)
3. Look at the fixed bottom navigation bar

**Observed:** Adjacent labels physically overlap and become unreadable. At 390px, "Notifications" renders as **`NotificationsDevice`** with no gap. At 320px it is worse: **`DashboardCameras`** and **`NotificationsDevice`** collide. Measured text-vs-column widths:

| Width | Column | "Notifications" text | Overflow |
|---|---|---|---|
| 320 | 46px | 63px | **+17px** |
| 360 | 51px | 63px | **+11px** |
| 375 | 54px | 63px | **+9px** |
| 390 | 56px | 63px | **+7px** |
| 430 | 61px | 63px | **+1px** |
| 480+ | 69px+ | 63px | fits |

"Dashboard" (56px) also overflows below 390px.

**Expected:** Each nav item's label should fit its column — truncate, abbreviate (e.g. "Alerts"), or reduce the item count / font size.

**Evidence:** `nav-390-zoom.png`, `nav-320-zoom.png` — native-resolution crops of the bottom bar showing `NotificationsDevice` running together.

**Reproducibility:** Always (320–430px)

**Suggested fix:** The bar is `grid grid-cols-7` with `text-[11px]`. Either shorten the "Notifications" label, reduce to 5 items with an overflow menu, or add `truncate` + `min-w-0` with a tooltip so labels can never collide.

---

### UI-002 — P1 — Header status text clipped and "Log out" wraps; horizontal scroll at 320px
**Page:** All pages (shared `header`) · **Viewport:** 320×568, 390×844 · **Confidence:** HIGH

**Steps to reproduce:**
1. Open any authenticated page at 390 × 844
2. Look at the top header row

**Observed:**
- DVR status is truncated to **"Connec…"** — the single most important health indicator is unreadable on phones. Measured: text is **89px** wide inside an **82px** box at 390px, and 68px at 320px.
- **"Log out"** wraps onto two lines inside a 45px-wide button, reading "Log / out".
- **"Enable notifications"** wraps to two lines.
- The header grows to **105px tall** on mobile (vs 61px desktop).
- At **320px only**, the header overflows the viewport: `documentElement.scrollWidth` = **333px** vs 320px viewport → **13px of horizontal page scroll on all 12 pages**. The "Log out" button's right edge sits at x=333.

**Expected:** Status text should be readable or intentionally abbreviated; actions should not wrap mid-word; no horizontal page scroll.

**Evidence:** `header-390-zoom.png`; responsive sweep log confirms hscroll on **12/12 pages at 320px and 0/12 at 375px and above**.

**Reproducibility:** Always at ≤390px (clipping); Always at 320px (overflow)

**Suggested fix:** Give the header a mobile-specific layout — e.g. hide the wordmark, show a compact status dot with `aria-label`, and move secondary actions into a menu. Add `shrink-0`/`whitespace-nowrap` to prevent mid-word wrapping.

---

### UI-003 — P1 — Desktop "Log out" is unreachable without scrolling to the very bottom of long pages
**Page:** All pages (shared `aside`) · **Viewport:** 1920×1080, 1440×900, 768×1024 · **Confidence:** HIGH

**Steps to reproduce:**
1. Open `/notifications` at 1920 × 1080
2. Try to log out without scrolling

**Observed:** The sidebar `<aside>` is `position: static` and stretches to **full document height (2985px)**, not viewport height. The sidebar "Log out" therefore sits at **y = 2937px** — far below the fold. The header's "Log out" is `md:hidden`, so at desktop widths it is hidden (0×0). Net effect: **on desktop the only logout control is ~2900px down the page.**

Measured logout `y` per page at 1920×1080:

| Page | Document height | Logout y | Visible without scrolling? |
|---|---|---|---|
| `/notifications` | 2985px | 2937 | **No** |
| `/events` | 1967px | 1919 | **No** |
| `/` (Dashboard) | 1538px | 1490 | **No** |
| `/settings/system` | 1080px | 1032 | Yes |
| `/device` | 1080px | 1032 | Yes |

**Expected:** Account actions should be persistently reachable, as they are on short pages.

**Evidence:** `sidebar-1080.png` (empty sidebar region at viewport bottom); measurement across 6 routes.

**Reproducibility:** Always on any page taller than the viewport

**Suggested fix:** Make the sidebar sticky/full-viewport-height (`md:sticky md:top-0 md:h-dvh`) with an internal scroll region, so the footer logout stays pinned.

---

## Medium Issues (P2)

### UI-004 — P2 — Playback error state gives no reason, no recovery, and leaves controls enabled
**Page:** Playback · **Viewport:** All · **Confidence:** HIGH

**Steps to reproduce:**
1. Open `/playback` (DVR unreachable — the state present in this environment)
2. Wait ~16 s

**Observed:** The player shows a bare **"Playback unavailable"** centered in a ~1000px-tall empty black region.
- No cause is given, although the server distinguishes states (`Messages.playbackDvrOffline` = "Unable to connect to DVR." exists but was not surfaced).
- **No retry action.**
- **All transport controls remain enabled** (`−15s`, `Play`, `+15s`, `Unmute`, `Full screen` all `disabled: false`). Clicking Play toggles the label to "Play" but `currentTime` stays `0` — the UI accepts input and does nothing.
- The failure takes ~16 s to appear, with "Connecting to DVR..." shown throughout.

**Expected:** State the cause, offer Retry, and disable controls that cannot work.

**Evidence:** `playback-error.png`; API returned `503 {"error":"Playback unavailable"}`.

**Reproducibility:** Always when playback cannot start

**Suggested fix:** Surface the specific reason, add a Retry button, and set `disabled` on transport controls while `phase === "error"`.

---

### UI-005 — P2 — Events: 0-result message misattributes the cause, and there is no way to clear filters
**Page:** Events · **Viewport:** All · **Confidence:** HIGH

**Steps to reproduce:**
1. Open `/events`
2. Set **Camera = Camera 2** and **Priority = Low**
3. Click **Search**

**Observed:** The list reports **"0 events"** with the message **"No events for this period."** — blaming the *date range* when the actual cause is the Camera + Priority filters. On the future-date test the same message appeared, so the two very different causes are indistinguishable.

Additionally there is **no Reset / Clear filters control** anywhere (`hasReset: false`); the only way back is to manually reset five dropdowns plus three date/time inputs.

**Expected:** Either a message that names the active filters, or a generic "No events match your filters" plus a **Clear filters** action.

**Evidence:** `events-filters-applied.png`.

**Reproducibility:** Always

**Suggested fix:** Differentiate "no events on this date" from "no events matching filters", and add a Clear/Reset filters button.

---

### UI-006 — P2 — Events: stale detail panel contradicts the filtered result set
**Page:** Events · **Viewport:** All · **Confidence:** HIGH

**Steps to reproduce:**
1. Open `/events` (list populated)
2. Apply **Camera 2 + Priority Low** → result is "0 events"
3. Look at the right-hand detail panel

**Observed:** The panel still displays a previously selected event — **Camera 4, 11:01:49, "Person detected", High** — while the list says 0 events and the Camera filter is set to Camera 2. The panel shows an event that is not in the result set and does not match the active camera filter.

The same stale-panel behaviour was observed on the future-date (2030-01-01) empty state.

**Expected:** Clear or refresh the detail panel when the result set changes.

**Evidence:** `events-filters-applied.png`, `events-empty-desktop.png`.

**Reproducibility:** Always

**Suggested fix:** Reset the selected event when filters change, or scope the detail panel to the current result set.

---

### UI-007 — P2 — Users page: username text overflows into the role badge at mobile widths
**Page:** Settings → Users · **Viewport:** 390×844 · **Confidence:** HIGH

**Steps to reproduce:**
1. Open `/settings/users`
2. Resize to 390 × 844
3. Look at the `viewerb2` / `viewerc2` / `viewerd2` rows

**Observed:** The username cell collapses and its text overruns into the role badge, rendering **"viewerb2VIEWER"**. Measured at 390px: username box = **34px**, text = **60px** → **26px overflow** straight into the `VIEWER` badge at x=67.

Width-scoped — at 768px+ the box grows (≥91px) and the collision disappears:

| Width | Username box | Text width | Overflow |
|---|---|---|---|
| 390 | 34px | 60px | **+26px** |
| 768 | 91px | 60px | none |
| 1024+ | 347px+ | 60px | none |

**Expected:** Username and role should never overlap; the username should truncate with the badge keeping its own space.

**Evidence:** `users-390-crop.png` (native-resolution crop).

**Reproducibility:** Always at ~390px and below

**Suggested fix:** Add `min-w-0` + `truncate` to the username element and `shrink-0` to the role badge.

---

### UI-008 — P2 — Audit log shows raw UTC ISO timestamps, inconsistent with the rest of the app
**Page:** Settings → Audit log · **Viewport:** All · **Confidence:** HIGH

**Steps to reproduce:**
1. Open `/settings/audit-log`
2. Compare a row's timestamp with the header clock

**Observed:** Every row displays a raw machine timestamp such as **`2026-10-09T05:10:59.183Z`** (92 instances), while the entire rest of the app displays **India time** (e.g. header shows `10:54:58`; Device page shows `2026-10-09T10:43:43+05:30`). The audit entries are **~5.5 hours behind** what users see elsewhere, and the format is not human-readable.

**Expected:** Local (IST) formatting consistent with the rest of the app, e.g. `09 Oct 2026, 10:40:59`.

**Evidence:** `audit-log-desktop.png`, `audit-mobile.png`.

**Reproducibility:** Always

**Suggested fix:** Format audit timestamps with the same Kolkata-time helper used elsewhere.

---

### UI-009 — P2 — Audit log is a single unpaginated list (92 rows / 7037px tall)
**Page:** Settings → Audit log · **Viewport:** All · **Confidence:** HIGH

**Steps to reproduce:**
1. Open `/settings/audit-log`
2. Scroll to the bottom

**Observed:** All 92 rows render in one continuous list producing a **7037px-tall page**, with no pagination, no "load more", and no visible row limit. The available controls are only `Filter`. Compare with Events (20/page) and Notifications (25/page), which both paginate.

**Expected:** Consistent pagination or virtualisation matching the other list pages.

**Evidence:** `audit-log-desktop.png` (full-page, 7037px).

**Reproducibility:** Always

**Suggested fix:** Apply the same pagination pattern used by Events/Notifications.

---

### UI-010 — P2 — Timeline event markers are 12–14px and overlap, making individual events unselectable
**Page:** Playback · **Viewport:** All, worst on 390×844 · **Confidence:** HIGH

**Steps to reproduce:**
1. Open `/playback`
2. Select Camera 1 with a full day of recordings
3. Inspect the Timeline event markers

**Observed:** All **29 markers are packed into a single row**, each only **12×12px or 14×14px** — roughly half the 24px minimum touch target, and far below the 44px used by every other control in the app. On a **340px-wide mobile timeline, 24 of the 29 markers overlap** their neighbours (e.g. one cluster spans x=57–75 for four markers).

Result: the markers form a solid clump of circles and an individual event cannot be reliably selected by touch or mouse. Tooltips require precise hovering.

**Expected:** Markers should be individually targetable — stacked/offset, clustered with a count, or given a larger hit area.

**Evidence:** `timeline-zoom.png` (element screenshot of the timeline showing the clump).

**Reproducibility:** Always when a day has many events

**Suggested fix:** Increase the hit area via padding/pseudo-element, stack overlapping markers into rows, or collapse dense clusters into a single "N events" marker that expands.

---

## Low Priority (P3)

### UI-011 — P3 — "Live" badge overlaps the camera's on-screen timestamp
**Page:** Dashboard (and live cards generally) · **Viewport:** All · **Confidence:** HIGH

**Observed:** Each live card renders a full-width "Live" band at the top of the video area. The band geometrically intersects the visible video content box on **all 4 cards** (band y=1–41 vs content box y=1–459), and the camera's burned-in timestamp sits in exactly that region. In `dash-topleft.png` "Live" and `09-10-2026 Fri 10:27:14` occupy the same band; on mobile the "Unmute" button covers the timestamp instead (`dash-390x844.png`).

**Expected:** Overlays should occupy the letterbox bars or a reserved strip, not the image area.

**Reproducibility:** Always

**Suggested fix:** Move the badge into the letterboxed gutter, or offset it clear of the DVR's timestamp region.

---

### UI-012 — P3 — Dashboard status truncates to "Connec…" (same root cause as UI-002)
**Page:** Dashboard · **Viewport:** ≤390×844 · **Confidence:** HIGH

Reported together with UI-002 — same shared header component. Listed separately only because the Dashboard is the landing page. **Do not fix twice.**

---

### UI-013 — P3 — Delete confirmation appears as a full-width banner far from the clicked row, and Escape does not dismiss it
**Page:** Settings → Users and Settings → Notification rules · **Viewport:** All · **Confidence:** HIGH

**Steps to reproduce:**
1. Open `/settings/users`
2. Click **Delete** on the top row (`home`)
3. Observe where the confirmation appears; press Escape

**Observed:** The confirmation is not a modal. It renders as a **full-width (1652px) inline banner at the bottom of the list** (y=449), while the row that was clicked is far above — the visual connection between cause and effect is weak, and on a long list it can appear off-screen entirely.

Escape does **not** dismiss it (`after Escape still present: true`).

**Note:** the wording is good — "Delete user home? This cannot be undone." with Cancel/Delete — and destructive actions *are* confirmed. This is a placement/affordance issue, not a safety gap.

**Reproducibility:** Always

**Suggested fix:** Anchor the confirmation near the triggering row (or use a modal), and dismiss on Escape.

---

### UI-014 — P3 — Destructive action buttons change size between pages
**Page:** Settings → Users vs Settings → Notification rules · **Viewport:** All · **Confidence:** HIGH

**Observed:** Measured across pages, the same actions render at different sizes:

| Action | Users | Notification rules |
|---|---|---|
| Delete | 69×40, 14px | **63×36, 12px** |
| Disable | 74×40, 14px | **67×36, 12px** |

Similarly on the same pages:

| Action | Dashboard | Playback |
|---|---|---|
| Unmute | 70×44, **12px** | 77×44, **14px** |
| Full screen | 85×44, **12px** | 94×44, **14px** |
| Enable notifications | 133×36, 12px (header) | **151×44, 14px** (inline) |

Button heights across the app span **36 / 38 / 40 / 44px** (44 buttons at 36px, 20 at 40px, 21 at 44px), with no clear rule.

**Expected:** One shared size scale for equivalent actions.

**Reproducibility:** Always

**Suggested fix:** Standardise on a small/set of button sizes and reuse the same component for the same intent.

---

### UI-015 — P3 — Notification status is conveyed by colour alone, with inconsistent visual treatment
**Page:** Notification history · **Viewport:** All · **Confidence:** HIGH

**Observed:** Status is plain text differentiated **only by colour** — `SENT` = `rgb(61,220,151)` (green), `SUPPRESSED` = `rgb(147,160,179)` (grey), `FAILED` = `rgb(250,...)` amber. There is **no icon, no badge, no shape difference** (`hasIcon: false` for both "sent" and "suppressed").

By contrast, the neighbouring **priority** value *is* rendered as a bordered pill badge ("High"). So two categorical fields on the same row use two different conventions.

Contrast itself passes (`sent` 9.80:1, `suppressed` 6.53:1), so this is an encoding/consistency issue, not a legibility one. "Suppressed" in muted grey additionally reads like a disabled state.

**Expected:** Status distinguishable without relying on hue, and visually consistent with the priority badge beside it.

**Reproducibility:** Always

**Suggested fix:** Give statuses a badge treatment matching the priority pill, and add a small icon or distinct label per state.

---

## Responsive Issues

### Desktop (1920×1080, 1440×900)
- **UI-003** — sidebar "Log out" pushed to the bottom of the document on all tall pages.
- Otherwise clean: no overflow, no clipping, no horizontal scroll on any of the 12 routes.

### Tablet (1024×768, 820×1180, 768×1024)
- **No horizontal scroll or clipping on any page.**
- **UI-003** — "Log out" clipped at 768×1024 (page taller than viewport).
- Layout is genuinely good: the dashboard collapses to a clean 2-up grid with consistent 242×199 cards.
- Minor: on 768px cards, the "Full screen" and "Unmute" overlays cover a large share of each small video.

### Mobile (390×844, 430×932, 375×667)
- **UI-001** — bottom nav labels overlap (320–430px).
- **UI-002** — status truncated to "Connec…", "Log out" wraps to two lines.
- **UI-007** — Users page username/role collision at 390px.
- **UI-010** — timeline markers unusable.
- **UI-011** — "Unmute" covers the camera timestamp.
- Fullscreen overlay does not scale to fill a portrait screen (see UI note below).

### 320×568 (narrow)
- **UI-002** — 13px horizontal page scroll on **12/12 pages**, caused by the header's "Log out" extending to x=333.
- **UI-001** — worst nav collision (`DashboardCameras`, `NotificationsDevice`).

> **Note — not reported as a bug:** the dashboard "Full screen" is an intentional in-page overlay (`fixed inset-0 z-50 bg-black`, `role="dialog"`, `aria-modal="true"`), not the Fullscreen API (`document.fullscreenElement` stays `null`). It correctly covers the grid, traps attention, and closes via both Escape and the Close button. **Working as designed.** The only observation is that on a 390×844 portrait screen the video renders at 364×205, leaving roughly 75% of the overlay black — a polish item, not a defect.

---

## Accessibility Issues

Reported only where reproduced:

1. **UI-015** — notification status encoded by colour alone (no icon/shape), inconsistent with the priority badge.
2. **Login error is not announced to assistive technology.** After a failed sign-in the message "Authentication failed" renders visually, but:
   - there is **no `aria-live` region** (`ariaLive: false`),
   - inputs have **no `aria-invalid`** (both `null`),
   - **focus remains on `<body>`**, so a screen-reader user gets no notification that anything happened.
   *Viewport: all. Confidence: HIGH. Suggested fix: render the error in a `role="alert"`/`aria-live="polite"` region, set `aria-invalid` on the fields, and move focus to the error or the first invalid field.*
3. **UI-013** — confirmation banner does not respond to Escape.

**Verified as good (no issues found):**
- Landmarks correct on every page (`main`×1, `header`×1, `nav`×2 for sidebar + mobile bar).
- Exactly one `h1` per page; **no heading-order skips** on any inspected route.
- **No images without `alt`**, **no inputs without an accessible name**, **no buttons without an accessible name** across 6 audited routes.
- **Focus rings visible on every interactive element** tested (`solid 2px rgb(62,224,199)`), including icon-adjacent video controls.
- **Zero WCAG AA contrast failures** — 159 unique text/background pairs sampled across 6 routes, all ≥4.5:1 (or ≥3:1 for large text).
- Keyboard tab order is logical and follows visual order (nav → logout → header actions → card controls).

---

## Interaction Issues

1. **UI-004** — Playback transport controls stay enabled and respond visually while playback is impossible (Play toggles label but `currentTime` never advances). Reproduced: Always.
2. **UI-006** — Events detail panel shows a stale event that contradicts the active filters and the "0 events" result. Reproduced: Always.
3. **UI-013** — Delete confirmation does not close on Escape. Reproduced: Always.
4. **Events filters are not preserved in the URL.** Applying Camera = 2 leaves the URL as `/events` (no query string); reloading silently resets the filter to "All cameras" while the results also revert. Filters are therefore not shareable, bookmarkable, or survivable across a refresh. Reproduced: Always. *Confidence: HIGH on behaviour; MEDIUM on whether this is intended — but silent reset with no indication is a usability problem.*
5. **Scroll position resets to 0 on every navigation** (`beforeNav: 800 → afterNav: 0`). Minor; standard SPA behaviour, noted for completeness.

**Verified as working correctly:** browser Back/Forward navigation (`/` → `/events` → `/notifications` → back → back → forward all resolved correctly), client-side routing with no full page reloads (a `window` marker survived navigation), active-route indication via `aria-current="page"`, fullscreen overlay open/close via both Escape and the Close button, pagination on Events (20/page, Next enabled, Previous disabled on page 1) and Notifications (25/page), date/time pickers, camera selectors, and the "Test a rule" control on Notification rules.

---

## Visual Consistency Issues

1. **UI-014** — identical actions at different sizes across pages (Delete, Disable, Unmute, Full screen, Enable notifications). Button heights span 36/38/40/44px with no evident rule.
2. **UI-015** — Notification status is bare coloured text while the priority on the same row is a bordered pill.
3. **Timestamp formatting is inconsistent app-wide:** the audit log uses raw UTC ISO (`2026-10-09T05:10:59.183Z`), the Device page uses offset ISO (`2026-10-09T10:43:43+05:30`), and the header/Events/Notifications use `HH:MM` or `HH:MM:SS` local time.
4. **Letterspacing/radius conventions are otherwise consistent:** border radius is disciplined — `8px` for controls (90 instances), `12px` for cards, and full-round for chips. Card radii on the Dashboard are consistently 12px. No issue.

---

## Shared Component Issues

These are **single root causes with multi-page impact** — fix once.

| Component | Issue | Affected pages |
|---|---|---|
| **`AppShell` → bottom `<nav>`** (`grid-cols-7`, `text-[11px]`) | **UI-001** — labels overflow their columns and overlap at 320–430px | **All 12 authenticated pages** |
| **`AppShell` → `<header>`** | **UI-002** — status truncated to "Connec…", "Log out" wraps, 13px page overflow at 320px | **All 12 authenticated pages** |
| **`AppShell` → `<aside>`** (non-sticky, `position: static`) | **UI-003** — "Log out" pushed ~2900px down on tall pages | Dashboard, Events, Notifications, Playback, Cameras, Users, Audit log |
| **Button primitive / size scale** | **UI-014** — same action, different sizes | Users, Notification rules, Dashboard, Playback, header |
| **Delete-confirmation pattern** (inline `role="alertdialog"` banner) | **UI-013** — poor placement, no Escape handling | Users, Notification rules |
| **Timeline marker component** | **UI-010** — 12–14px markers, overlapping | Playback |

Fixing `AppShell` alone resolves **UI-001, UI-002, UI-012, and UI-003** — the four highest-impact findings.

---

## Recommended Fix Order

1. **UI-002** — P1 — shared header: status truncation, "Log out" wrapping, 320px page overflow
2. **UI-001** — P1 — shared bottom nav label collision (320–430px)
3. **UI-003** — P1 — sticky sidebar so desktop logout is reachable
4. **UI-004** — P2 — Playback error state: reason, retry, disable dead controls
5. **UI-006** — P2 — Events stale detail panel contradicts results
6. **UI-005** — P2 — Events "0 result" message misattributes cause + no clear-filters
7. **UI-010** — P2 — Playback timeline markers too small / overlapping
8. **UI-007** — P2 — Users username/role collision at 390px
9. **UI-008** — P2 — Audit log raw UTC timestamps
10. **UI-009** — P2 — Audit log unpaginated (7037px page)
11. **UI-013** — P3 — delete confirmation placement + Escape
12. **UI-015** — P3 — notification status colour-only encoding
13. **UI-011** — P3 — "Live" badge overlapping camera timestamp
14. **UI-014** — P3 — button size standardisation
15. Accessibility — **Login error not announced** (`aria-live` / `aria-invalid` / focus management)
16. **UI-012** — P3 — covered by fix #1; do not action separately

---

## Final Assessment

### Is the UI ready for V6 production deployment?

**NO — not for mobile use. Close on desktop.**

The application is well-architected and the desktop experience is strong. However, three **P1** defects sit in a single shared component (`AppShell`) and affect **every authenticated page**:

**Blockers to a clean V6 sign-off:**

1. **UI-002** — On any phone, the DVR health indicator reads "Connec…" and the logout action wraps mid-word; at 320px the entire page gains horizontal scroll. The header is the one element present on every screen.
2. **UI-001** — On every phone width from 320–430px the bottom navigation labels physically collide ("NotificationsDevice"), making primary navigation ambiguous. This is the only navigation available on mobile.
3. **UI-003** — On desktop, the logout control is ~2900px down the page on long pages (Notifications, Events, Dashboard) and there is no other logout at ≥768px — a functional dead-end.

If the V6 release targets **desktop only**, UI-003 is the sole P1 blocker, and it is a one-line class change. If the release includes **phones or tablets — which the responsive implementation clearly intends — UI-001 and UI-002 must be fixed first.**

Secondary but worth scheduling: **UI-004** (Playback's silent error state with live-looking controls) and **UI-006/UI-005** (Events showing a stale event and a misleading empty message) will generate user confusion and support questions even though they do not block operation.

**Strengths worth preserving:** no accessibility regressions in landmarks/headings/labels/contrast/focus, no horizontal scroll above 320px, no console errors on authenticated pages, ~300ms interactive times, and a genuinely good Event Detail page and fullscreen overlay.
