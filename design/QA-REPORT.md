# Phase 5 — QA and regression report

**Date:** 2026-11-04 · **Hub:** `http://localhost:3000` · **DVR:** connected · **MediaMTX:** online · **Data:** live SQLite store (thousands of real events, 348 faces)
**Scope:** the approved Sentinel redesign implemented in the existing Next.js 16 / React 19 / Tailwind 4 app.

> Environment note: the dev server used for QA was started with a **process-level** `TELEGRAM_NOTIFICATIONS_ENABLED=false` override so real Telegram messages were not sent during the test run. `.env` and all application code for notifications are unchanged. The tree also contains unrelated security-hardening commits made by another session during this work (`security(auth|containers|mediamtx|data)`); none of those files are part of this redesign and the full suite passes on the merged tree.

---

## 1. Results at a glance

| Gate | Command | Result |
|---|---|---|
| TypeScript | `npm run typecheck` | ✅ **pass** (0 errors) |
| Lint | `npm run lint` | ✅ **0 errors** (8 warnings: 7 unused vars in `design/tools/*.mjs`, 1 pre-existing in `face-notify.test.ts`) |
| Unit / integration | `npm test` (Vitest) | ✅ **82 files / 837 tests passed** |
| End-to-end | `npx playwright test --workers=1` | ✅ **101 passed, 10 skipped, 0 failed** (1 m 42 s, 111 cases, 1920×1080) |
| Production build | `npm run build` | ✅ **pass** (standalone Next build, all 17 routes compiled) |
| Responsive + diagnostics probe | `node design/tools/responsive-probe-after.mjs` | ✅ **60/60 route×viewport checks clean** |
| Live streams | dashboard load + LIVE-005/006/007/008 | ✅ **4/4 WHEP sessions, 704×576 H.264, readyState 4**, focus mode enters/exits, no `MediaError` |
| Playback (functional + geometry) | PLAY-001…019 | ✅ **19/19 pass** — real H.264 playback, 1080 px vertical budget, popover, timeline semantics, previews unchanged |

**Regressions found: 0.** No tested role, label, `data-testid`, count, URL, API contract or geometry assertion fails.

---

## 2. Playwright detail

Full suite: **101 passed / 10 skipped / 0 failed**. The 10 skips are the documented pre-existing environment skips, not passes:

| Skip | Reason |
|---|---|
| `SEC-004`, `ACCT-004`, `USER-004…009` (8) | no `QA_VIEWER_*` credentials in this workspace (viewer role tests never ran) |
| `RULE-UI-001`, `RULE-UI-002` (2) | require `QA_ALLOW_RULE_MUTATIONS=1` and a disposable `DATA_DIR` |

Highlighted evidence:
- `DASH-001…005` — dashboard h1, shell, one `<article>` per camera, "Recent security events" region, zero console errors and zero failed/≥400 requests.
- `LIVE-003…010` — tile size, video-area proportion, determinate stream state, focus mode ≥1900×1060, Escape return, clean diagnostics with four live streams.
- `EVENT-*`, `FACE-*`, `NOTIF-*`, `USER-*`, `SYSTEM-*`, `TELEGRAM-*`, `AUTH-*`, `ACCT-*`, `SEC-*` — all pass on the redesigned screens.
- `PLAY-003/012/013/014/015/016/017/018/019` — playback internals were deliberately not restructured; the test-locked geometry still holds with the new shell.

---

## 3. Responsive verification

15 routes × 4 viewports = **60 checks** (1920×1080, 1440×900, 834×1112, 390×844), measured in the browser:

- **0** horizontal-overflow cases (`scrollWidth ≤ innerWidth` everywhere).
- **0** console errors, page errors, failed requests, or HTTP ≥ 400 responses.
- Every route resolved the expected single `<h1>`: Dashboard, Camera setup, Events, Event statistics, Detected Faces, CCTV Playback, Notification history, Device, Account, Settings, Users, Notification rules, Object detection, Audit log, System.
- Entering/leaving camera focus mode and the mobile Events inspector sheet were exercised separately (screenshots + LIVE-007/008).

Raw data: [`responsive-after.json`](audit/responsive-after.json). Before data: [`RESPONSIVE-FINDINGS.md`](audit/RESPONSIVE-FINDINGS.md).

---

## 4. Camera-stream verification

With the DVR reachable and the MediaMTX container running:

| Check | Result |
|---|---|
| Dashboard opens one WHEP session per camera | 4 × `201 /api/webrtc/<path>/whep` |
| Decoded frames | all four `<video>` elements: **704×576**, `readyState = 4`, `paused = false` |
| H.264 sub streams only / no browser transcoding | unchanged streaming code; `/api/streams/*` decides WHEP or HLS server-side |
| Focus mode | full-viewport overlay, other tiles `display:none` (streams stay mounted), Exit/Escape, no Fullscreen API |
| Playback | `PLAY-016` plays the real 704×576 H.264 sub-stream from the DVR session |
| HLS path | untouched; `HLS-*` unit tests and server HLS proxy tests pass |

---

## 5. What changed (and what deliberately did not)

**Changed — presentation only, 37 files** (`git diff --cached --stat -- src`):

- `src/app/globals.css` — Sentinel token set + component layer (buttons, cards, fields, badges, tables, camera tiles, event rows, inspector, settings shell, mobile sheet, responsive rules), brand/error/not-found/manifest colours.
- App shell, dashboard, camera tile, events + event detail, cameras, notification rules, faces, settings shell + five sub-pages, login, account, device, recent events, notification history, event statistics, notification-permission control.
- **3 new UI primitives:** `src/components/ui/Icon.tsx` (inline SVG set), `PageHeader.tsx`, `src/components/settings/SettingsNav.tsx`.

**Not changed (verified):**

- No changes under `src/app/api/**`, `src/lib/**`, `src/server/**`, `tests/**`, `package.json`, `next.config.ts`, Playwright/Vitest configs, Docker/compose files, `mediamtx/**`, `.env`.
- No new dependencies, no external fonts/icons (CSP-safe), no API/schema/streaming/business-logic changes.
- Playback components, the timeline, the date popover and the player were not restructured.

---

## 6. Before / after evidence

| Artifact | Location |
|---|---|
| Desktop before/after (6 screens) | [`audit/compare/desktop-before-after.png`](audit/compare/desktop-before-after.png) |
| Mobile before/after (3 screens) | [`audit/compare/mobile-before-after.png`](audit/compare/mobile-before-after.png) |
| After screenshots — 15 routes + login + focus mode + mobile sheet at 4 viewports | [`audit/after/`](audit/after/) (138 PNGs) |
| Before screenshots — baseline + interaction states | [`audit/before/`](audit/before/) (218 PNGs) |
| Approved design mockups | [`design/mockups/screens/`](mockups/screens/) (86 PNGs) |

After-set includes: `dashboard-*`, `dashboard-focus-desktop`, `event-detail-*`, `events-*`, `events-sheet-mobile`, `cameras-*`, `faces-*`, `settings-notifications-*`, `settings-detection-*`, `settings-users-*`, `settings-system-*`, `settings-audit-*`, `login-*`, `playback-*`, `notifications-*`, `device-*`, `account-*`, `events-stats-*` (desktop/laptop/tablet/mobile + full-page).

---

## 7. Follow-ups (not regressions)

1. **Target-size polish (WCAG 2.2 AA):** the probe counts interactive elements under 24 px: `View event` links in the face gallery (16 px tall), and native 15 px checkboxes inside labelled rows on detection/rules (~26/25 elements). Effective labelled targets are larger; worth a dedicated pass.
2. **Unsaved-changes guard** on settings forms remains absent — behaviour deliberately unchanged (audit P1, would need a state model).
3. **VIEWER redirects unverified** — no viewer credentials exist in this workspace; the role logic is untouched by the redesign.
4. **Dashboard "System health" link** is shown to VIEWERs; the settings route redirects them. Hide it by role in a follow-up.
5. **Camera setup previews are static** (no extra streams opened) by design.
6. **Dev-only Next.js badge** appears in the bottom-left of dev screenshots; it is absent from the production build.
7. **Native date/time inputs** keep the browser locale (existing behaviour; the UI keeps 24-hour data).
8. Server-generated strings such as "1184926 seconds" in Settings → System still need an API change to humanise.

---

## 8. Reproduce

```bash
npm run typecheck
npm run lint
npm test
npm run build
# with the hub + MediaMTX + DVR running and QA_ADMIN_* or APP_* credentials in .env:
npx playwright test --workers=1
node design/tools/responsive-probe-after.mjs
node design/tools/after-shots.mjs design/audit/after
```
