# Sentinel redesign mockups

Static, high-fidelity design mockups for the Home CCTV Hub redesign (Phase 2).
Not application code — no `src/` file is touched by anything in this folder.

## Open the review package

| File | What it is |
|---|---|
| [`screens/overview-screens.png`](screens/overview-screens.png) | One-image contact sheet of the six required screens |
| [`screens/overview-before-after.png`](screens/overview-before-after.png) | Current dashboard vs redesigned dashboard |
| [`screens/`](screens/) | 14 screens × 3 breakpoints × viewport/full = 84 PNGs |
| [`../DESIGN-SYSTEM.md`](../DESIGN-SYSTEM.md) | Tokens, typography, components, accessibility, implementation mapping |
| [`../REDESIGN-PROPOSAL.md`](../REDESIGN-PROPOSAL.md) | Screen-by-screen proposal + implementation/QA plan + approval checklist |
| [`../AUDIT.md`](../AUDIT.md) | Phase 1 audit synthesis |

## Screens

| HTML | Screen | Desktop preview |
|---|---|---|
| `dashboard.html` | Live monitoring (Dashboard) | [`screens/dashboard-desktop.png`](screens/dashboard-desktop.png) |
| `events.html` | Event timeline | [`screens/events-desktop.png`](screens/events-desktop.png) |
| `event-detail.html` | Event detail | [`screens/event-detail-desktop.png`](screens/event-detail-desktop.png) |
| `cameras.html` | Camera management | [`screens/cameras-desktop.png`](screens/cameras-desktop.png) |
| `notification-rules.html` | Notification rules | [`screens/notification-rules-desktop.png`](screens/notification-rules-desktop.png) |
| `faces.html` | Face detection | [`screens/faces-desktop.png`](screens/faces-desktop.png) |
| `settings.html` | Settings hub | [`screens/settings-desktop.png`](screens/settings-desktop.png) |
| `settings-users.html` | Settings → Users | [`screens/settings-users-desktop.png`](screens/settings-users-desktop.png) |
| `settings-detection.html` | Settings → Object detection | [`screens/settings-detection-desktop.png`](screens/settings-detection-desktop.png) |
| `settings-system.html` | Settings → System | [`screens/settings-system-desktop.png`](screens/settings-system-desktop.png) |
| `settings-audit.html` | Settings → Audit log | [`screens/settings-audit-desktop.png`](screens/settings-audit-desktop.png) |
| `login.html` | Login | [`screens/login-desktop.png`](screens/login-desktop.png) |
| `playback.html` | Playback (supporting; internals stay untouched in implementation) | [`screens/playback-desktop.png`](screens/playback-desktop.png) |
| `design-system.html` | Design-system sheet | [`screens/design-system-desktop.png`](screens/design-system-desktop.png) |

Every screen also has `-tablet.png` (834×1112) and `-mobile.png` (390×844), plus `-full.png` full-page variants.

## Re-render

```bash
# all screens, all breakpoints
node design/tools/render-mockups.mjs design/mockups/screens

# one screen
MOCK_ONLY=events node design/tools/render-mockups.mjs design/mockups/screens
```

Requires the repo's Playwright install (`@playwright/test` + Chromium); the script opens the local `file://` pages, no server needed.

## Structure

```
assets/ds.css        shared design system (tokens + component classes)
assets/shell.js      shared chrome: sidebar, appbar, icon sprite, mobile nav
assets/frames/       real 704×576 camera frames + event snapshot (design fixtures)
assets/faces/        real face crops (design fixtures)
*.html               one page per screen (content only; shell.js injects chrome)
screens/             rendered PNGs
```

`assets/shell.js` cannot be used by the chrome-free login page; login inlines its small icon sprite instead.

## Caveats (mockup-only)

- Static single-state mockups: they show the loaded/healthy state. Loading, empty, error, offline, focus mode and dialog states are specified in `DESIGN-SYSTEM.md` and kept in the implementation’s real components.
- Mockup-only CSS overrides live inside individual HTML files (responsive table stacking, face-grid density, login tablet brand band). They are design evidence, not the final implementation.
- Data is realistic but not live: camera names, event counts and face stats use the hub's real data captured 2026-11-04; the third mock user (`naina`) exists only to demonstrate the disabled-account state.
