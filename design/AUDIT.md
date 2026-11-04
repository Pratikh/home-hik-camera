# Phase 1 audit — Home CCTV Hub

**Date:** 2026-11-04 · **Mode:** read-only (no application code, schema, API or infrastructure was modified)
**Method:** four parallel read-only audit streams + live evidence capture against the running hub (DVR connected, MediaMTX online, all four cameras streaming).

| Stream | Deliverable | Evidence |
|---|---|---|
| Route / component / API / data-model inventory | [`API-INVENTORY.md`](audit/API-INVENTORY.md) | 17 page routes, 42 components, 51 API modules / 59 handlers, 21 SQLite tables |
| UI/UX heuristics, accessibility, visual audit | [`UX-FINDINGS.md`](audit/UX-FINDINGS.md) | 549 interactive elements measured, WCAG contrast computations, screenshots |
| Test-constraint inventory (Vitest + Playwright) | [`TEST-CONSTRAINTS.md`](audit/TEST-CONSTRAINTS.md) | 111 Playwright cases, 813 Vitest cases, exact labels/roles/layout contracts |
| Responsive / breakpoint capture | [`RESPONSIVE-FINDINGS.md`](audit/RESPONSIVE-FINDINGS.md) | 144 "before" screenshots at 390 / 834 / 1440 / 1920 + interaction states |

Before screenshots: [`design/audit/before/`](audit/before/) (login, dashboard, cameras, events, event detail, faces, playback, notifications, device, account, settings + all settings sub-pages × 3 sizes).

Baseline verification: `npm test` → **79 files / 814 tests passing** (2026-11-04 13:53). Workspace note: the tree also contains concurrent, unrelated hardening edits (auth/login, client-ip, rate-limit, container hardening) made by another session during this work; the audit is consistent with that tree and the redesign does not touch those files.

---

## 1. What exists (functional summary)

- **17 routes:** `/login` public; hub routes `/` (live view), `/cameras`, `/playback`, `/events`, `/events/[id]`, `/events/stats`, `/faces`, `/notifications`, `/device`, `/account` for any signed-in user; `/settings` + `/settings/{users,notifications,detection,audit-log,system}` ADMIN-only.
- **Architecture:** Next.js server proxies everything same-origin; the browser never learns DVR credentials or RTSP URLs, and MediaMTX stays the only media server. Live view uses server-side WHEP (or HLS on tunnelled hosts) with all four tiles mounted during focus mode. Playback uses the 704×576 H.264 sub-stream through a server-side DVR session.
- **Data:** one SQLite DB (21 tables): 7,571 events, 10,650 notification-history rows, 348 detected faces (detection only — every face is Unassigned), 2 users (1 ADMIN, 1 VIEWER), 1 notification rule, 1,737 audit rows. Retention/ingest settings live in a KV table.
- **Preserved behaviour that must not change:** notification rules (multi-camera × multi-event, schedule, quiet hours, cooldown), browser + Telegram notifications, face detection, event filtering/pagination, playback deep links, roles, audit log, PWA manifest.

---

## 2. Key UI/UX problems found

### P0 — breaks the product's purpose

1. **The dashboard is a video grid, not an operator overview.** No event KPI, unread count, camera/recorder health strip or timeline; "Recent security events" starts *below the fold* (measured `top = 1032 px` in a 1000 px viewport). It cannot answer "is anything wrong right now?".
2. **No visible alarm lifecycle.** Events are marked read only as a silent side effect of opening a detail page; there is no unread badge, no acknowledgement action, no unread view. The one screen an operator lives in offers no sense of "what did I miss?".
3. **The Object detection sticky save bar collides with navigation** — on mobile the Save button is ~27 px under the bottom nav (z-20 vs z-40); on desktop the full-width bar covers the sidebar's Account/Log out.

### P1 — systematically degrades primary tasks / WCAG

4. **Freshness and degradation are invisible** on monitoring surfaces: disk 91.8 % full, backup 14 days stale, face worker dead 14 days are buried in Settings → System; the header can show a stale "Connected"; a dropped stream freezes while labelled "Live".
5. **Unsaved edits are silently discarded** (proven experimentally on object detection): no dirty state, no navigation guard.
6. **Mobile Events is a filter wall:** title + intro + 5 pills + 7 stacked filter fields push the first event row below ~1,100 px, and the detail panel renders *after the entire list* (measured y ≈ 1900 on mobile).
7. **Colour semantics collide:** red = person classification, CRITICAL priority, offline, alarm recording and error text; amber = HIGH priority, vehicle, warnings, "Failed". Card/input borders are 1.23–1.30:1 (effectively invisible), and the teal focus ring on teal CTAs is 1:1.
8. **No design-system primitives:** 549 interactive elements / 306 below 44 px; 260 controls in 26 treatments; 47 inputs in 4 treatments; 24 hard-coded hex values; 29 arbitrary value classes; no Button/Input/Card/Badge/EmptyState primitive.
9. **The type scale has collapsed:** 53 % of text ≤ 12 px, 11 px is the second-most-common size, only 2.6 % is ≥ 16 px; h1 is 20 px on most pages (16 px on playback).
10. **Keyboard/focus gaps:** 11 tab stops before `<main>`, no skip link, alert-dialogs do not move/trap focus, async updates are not announced.

### P2 — polish/IA debt

11. **Flat navigation mixes monitoring and administration** (8 items side by side) and settings sub-pages have no shell — they are reached from a sentence of teal links. The mobile bar is 8 × 49 × 38 px items with 11 px labels.
12. **Prototype texture remains:** 65 px event cards with no scanning mode; face gallery blows small crops into ragged ~400 px tiles; camera setup labels the name field "Channel 1"; System prints raw UTC ISO timestamps and second counts; time appears in four formats.

### Strengths to preserve

Honest states and empty/error copy; strong text contrast; the playback timeline's density-aware markers, keyboard seek, tooltips and zoom; every camera/status lamp's `sr-only` full label; one `h1` per page; unlabelled-input and missing-alt counts of zero; login never puts credentials in the URL; password masking; admin-only guards; focus-visible ring exists; reduced-motion rule exists.

---

## 3. Responsive audit (measured)

- No horizontal scrolling at 390 / 834 / 1440 px in the current build; camera focus mode is correct at all sizes; zero console errors.
- **P1** Events detail invisible after tapping a row below 1024 px (detail after the list).
- **P1** Detection save bar behind the mobile bottom nav (39 px overlap).
- **P2** 768–1023 px band: desktop sidebar + one-column dashboard → 900 px of inner scroll for four tiles.
- **P2** Mobile header: actions take 353.5 / 390 px, brand collapses, transient pre-hydration clock can push the header past the viewport; at 320 px the page scrolls horizontally.
- **P2** 8-item bottom bar: 49 × 38 px targets, 11 px labels, "Settings" truncates.
- **P2** Unbounded faces list (13,284 px at 390 px) and notification history (4,152 px); filter-first forms; mobile playback timeline below the fold.

The redesign addresses every P1/P2 by construction: collapsed mobile filters + bottom-sheet detail, sticky save bar inside the content column, sidebar only ≥ 1024 px, header that reduces to brand + bell + avatar, 5-item bottom bar + More sheet, denser paginated galleries, stacked settings rows.

---

## 4. Hard constraints discovered (design envelope)

From [`TEST-CONSTRAINTS.md`](audit/TEST-CONSTRAINTS.md) — the redesign must keep:

- the 16 hub routes + `/login`, all 8 nav labels (`Dashboard`, `Camera setup`, `Playback`, `Events`, `Faces`, `Notifications`, `Device`, `Settings`) and every tested `h1`;
- exactly one accessible `Primary` navigation per viewport, `aria-current="page"`, banner containing "Home CCTV", a `Log out` button, `Account` link;
- `article` counts on `/` (cameras) and `/faces` (faces), `li > button` event rows, `ul li article` notification rows;
- the login POST form contract (`method=post`, `action=/api/auth/login`, hidden `next`, native fallback);
- **playback's 1080 px vertical budget, class tokens, 20 px timeline track, `span[title]` segments, priority markers, slider label, popover geometry, `object-fit:contain`** — playback internals are therefore left untouched;
- event/face/notification/rules labels, `data-testid`s and API query contracts;
- CSP same-origin only (no webfonts/CDNs), no hydration mismatches, no new console errors or ≥ 400 responses.

The design system in [`DESIGN-SYSTEM.md`](DESIGN-SYSTEM.md) was written against these constraints; the screen mockups keep every tested label.

---

## 5. Design implications

1. **Add an overview layer** to the dashboard (KPIs + health + recent events above the fold) using only existing APIs.
2. **Make status and time legible** with a consistent type scale, mono tabular numerals, IST 24-hour times and a status language that never relies on hue.
3. **Systemise everything:** tokens + primitives first, then screens; delete ad-hoc hexes, heights and paddings.
4. **Restructure navigation by job** (Monitor / Security / System) without renaming a single label, and give settings a real shell.
5. **Design mobile as a first-class console:** collapsed filters, bottom-sheet details, 5-item nav, 44 px targets, no save-bar collisions.
6. **Preserve the tested/functional contracts** — visual change only; no API, schema, streaming or business-logic changes.
