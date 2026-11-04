# Home CCTV Hub — Sentinel redesign

Design + implementation package for the approved UI/UX redesign of the Home CCTV Hub.
Everything here is documentation, evidence or design source; the application code lives in `src/`.

## Read this first

| Phase | Deliverable |
|---|---|
| **1 — Audit** (read-only) | [AUDIT.md](AUDIT.md) — synthesis · [API-INVENTORY.md](audit/API-INVENTORY.md) · [UX-FINDINGS.md](audit/UX-FINDINGS.md) · [TEST-CONSTRAINTS.md](audit/TEST-CONSTRAINTS.md) · [RESPONSIVE-FINDINGS.md](audit/RESPONSIVE-FINDINGS.md) |
| **2 — Design** | [DESIGN-SYSTEM.md](DESIGN-SYSTEM.md) — tokens, type, components, a11y, implementation mapping · [mockups/](mockups/) — 14 static screens + [rendered PNGs](mockups/screens/) at 3 breakpoints |
| **3 — Approval** | [REDESIGN-PROPOSAL.md](REDESIGN-PROPOSAL.md) — screen-by-screen rationale, constraints, plan (approved 2026-11-04) |
| **4 — Implementation** | Existing Next.js/React/Tailwind app restyled in place; 37 source files, 3 new UI primitives, no API/schema/streaming changes |
| **5 — QA** | [QA-REPORT.md](QA-REPORT.md) — 101/101 runnable Playwright cases, 837 Vitest tests, production build, responsive probe, stream verification, before/after evidence |

## Evidence

- **Before:** [audit/before/](audit/before/) — 218 screenshots of the original UI (17 routes × 3–4 viewports + loaded states + interactions).
- **After:** [audit/after/](audit/after/) — 138 screenshots of the redesigned hub (15 routes + login + focus mode + mobile inspector sheet × 4 viewports).
- **Before/after sheets:** [desktop](audit/compare/desktop-before-after.png) · [mobile](audit/compare/mobile-before-after.png).
- **Approved mockups:** [mockups/screens/overview-screens.png](mockups/screens/overview-screens.png) · [dashboard before/after](mockups/screens/overview-before-after.png).
- **Raw responsive/diagnostics data:** [audit/responsive-after.json](audit/responsive-after.json).

## What was redesigned

Live monitoring (dashboard), event timeline + event detail, camera management, notification rules, face detection, application settings (hub, users, object detection, system, audit log), the app shell/navigation, and the login screen. Supporting screens (playback, notification history, event statistics, device, account) inherit the same tokens and primitives; playback internals were deliberately left untouched because their geometry is test-locked.

## What was preserved

All routes, nav labels, headings, roles, `data-testid`s, empty/error strings, API and query contracts; MediaMTX as the only media server; same-origin WebRTC/HLS proxying; no browser transcoding; DVR never public; notification/face/detection behaviour; camera focus mode; playback timeline semantics; CSP-safe assets (no webfonts/CDNs); no new runtime dependencies.

## Maintenance

- **Continuous-reload bugfix (2026-11-04):** [`bugfix-continuous-reload/REPORT.md`](bugfix-continuous-reload/REPORT.md) — root cause (production build + Turbopack dev cache sharing `.next`), fix (`scripts/dev-cache.mjs` + `predev`/`prebuild` hooks) and verification evidence.

## Reproduce the checks

```bash
npm run typecheck && npm run lint && npm test && npm run build
# hub + MediaMTX + DVR running:
npx playwright test --workers=1
node design/tools/responsive-probe-after.mjs
node design/tools/after-shots.mjs design/audit/after
# design mockups (no server needed):
node design/tools/render-mockups.mjs design/mockups/screens
```

`design/tools/` also contains the read-only audit capture scripts used for the before/after evidence.
