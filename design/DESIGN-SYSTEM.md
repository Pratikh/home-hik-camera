# Sentinel — Home CCTV design system (v1)

**Status:** proposed · **Phase 2 deliverable** · 2026-11-04
**Owner:** UI/UX lead · **Implementation target:** existing Next.js 16 App Router + React 19 + Tailwind CSS v4 (`src/app/globals.css` `@theme`).
**Visual reference:** [`design/mockups/design-system.html`](mockups/design-system.html) → rendered at [`design/mockups/screens/design-system-*.png`](mockups/screens/).

> The design system is expressed as static HTML/CSS (`design/mockups/assets/ds.css`) so it can be reviewed and rendered before any application code changes. The same tokens and component classes are then ported into `globals.css` and the React components in Phase 4.

---

## 1. Direction

**"Sentinel": an operator console, not a website.**

The current hub already has good bones: honest states, strong text contrast, a genuinely thoughtful playback timeline, and security-aware copy. What it lacks is an operator frame: an overview layer, a consistent component language, grouped navigation, and a dark surface system with real depth. The redesign keeps the product's behaviour and local-first architecture and changes the presentation layer into a calm, dense, high-contrast surveillance console.

Four principles drive every decision:

1. **Operate, don't decorate** — the picture, the time and the state are the content. Chrome recedes.
2. **Status is never colour-only** — every state pairs colour with a dot/shape and a word (Online, Checking, Sent, Failed).
3. **Dense, then calm** — 38 px controls, 13 px compact type, a strict 4 px spacing rhythm, generous card padding, no wasted whitespace.
4. **One accent, few alarms** — krypton teal means action and "live"; amber and red are reserved for warnings and failures.

**No external assets.** CSP is `default-src 'self'`; the design uses only the native system font stack and inline SVG icons. No webfont, icon font or CDN.

---

## 2. Colour

Four surface steps + two ink steps + muted/faint + one accent + a semantic status family.
All body-text pairs pass WCAG 2.1 AA (≥ 4.5:1); borders and focus rings are specified for ≥ 3:1 non-text contrast.

### 2.1 Surfaces & ink

| Token | Value | Tailwind | Use |
|---|---|---|---|
| `--bg` | `#070A0E` | `bg-bg` | App/page canvas |
| `--surface` | `#0B1017` | `bg-surface` | Sidebar, app bar, input wells |
| `--card` | `#0F1620` | `bg-card` | Cards, tiles, rows |
| `--card-2` | `#121B26` | `bg-card-2` | Nested surfaces, quiet hover |
| `--raised` | `#16202D` | `bg-raised` | Popovers, menus, pressed/active |
| `--ink` | `#E9F0F8` | `text-ink` | Primary text (15.8:1 on card) |
| `--ink-2` | `#C3CFDD` | `text-ink-2` | Secondary text (11.5:1) |
| `--muted` | `#8A9AB0` | `text-muted` | Metadata, helper (6.3:1) |
| `--faint` | `#7E8EA4` | `text-faint` | Micro-labels only (4.6:1) |
| `--line` | `rgba(224,235,250,.09)` | `border-line` | Hairline card/row borders |
| `--line-2` | `rgba(224,235,250,.16)` | `border-line-2` | Control borders, dividers |
| `--line-strong` | `#24303F` | `border-line-strong` | Hover borders, separators |

### 2.2 Accent

| Token | Value | Use |
|---|---|---|
| `--accent` / `teal` | `#2FE3C6` | Primary action, active nav, live, focus |
| `--accent-hover` | `#57EDD3` | Primary hover |
| `--accent-ink` | `#04211C` | Text on accent (10.4:1) |
| `--accent-soft` | `rgba(47,227,198,.12)` | Active nav/row wash, badges |
| `--accent-line` | `rgba(47,227,198,.42)` | Selected outlines |

### 2.3 Status & priority (semantic, always paired with text)

| Role | Token | Value | Notes |
|---|---|---|---|
| OK / online / sent / live | `online` | `#3DDC97` | Dot + word |
| Warning / checking / suppressed / HIGH | `warn` | `#F5C451` | Dot + word |
| Failure / offline / failed / CRITICAL | `offline` / `danger` | `#FF7A7A` | Dot + word |
| Informational / low-emphasis | `info` | `#6AB0FF` | Filters, info notices |
| Priority NORMAL / LOW | `muted` | `#8A9AB0` | Neutral badge |

**Rule:** red never means "person" or "alarm recording" again. Classification is carried by a label/icon, priority by its badge, and system state by the status dot + word. This removes the current collision where red means five unrelated things.

---

## 3. Typography

**Stack:** `-apple-system, BlinkMacSystemFont, "Segoe UI", "Inter", system-ui, sans-serif`
**Mono:** `"SF Mono", "JetBrains Mono", "Roboto Mono", ui-monospace, monospace`

Rule: sans for humans, mono for machine data (times, channel numbers, IDs, counts, hex). Always `font-variant-numeric: tabular-nums` on times/counters so live updates don't jitter.

| Role | Size | Weight | Tracking | Use |
|---|---|---|---|---|
| Display | 28 px | 650 | −0.03em | Login headline |
| H1 | 24 px | 650 | −0.02em | Page title |
| H2 | 16 px | 650 | −0.01em | Inspector/card title |
| Body | 14 px | 450 | 0 | Default |
| Compact | 13 px | 550 | 0 | Rows, buttons, nav |
| Meta | 12 px | 450 | 0 | Metadata, helper text |
| Label | 10–11 px | 650 | +0.12–0.16em, uppercase | Micro-labels (CAMERAS ONLINE, CHANNEL 01) |
| Mono data | 11–13 px | 500–650 | +0.02em | Timestamps, counters |

Minimum text size: **11 px** for metadata, **13 px** for interactive labels (the previous UI used 9–10 px in places; that is gone).

Time format: **24-hour, Asia/Kolkata, `13:54:19`; dates `04 Nov 2026`**. No UTC ISO strings in the interface and no "1184926 seconds" style raw numbers.

---

## 4. Space, radius, elevation

- Spacing rhythm: **4 / 8 / 12 / 16 / 20 / 24 / 32 / 40 px**. Page padding 24 px desktop, 20 px laptop, 14 px mobile.
- Radii: **6 px** inputs/chips · **8 px** buttons/segments · **12 px** cards/tiles/panels · 999 px badges/pills/avatars.
- Depth: surface steps + 1 px hairlines. Shadows only for floating layers (date popover, mobile sheet): `0 18px 48px rgba(0,0,0,.55)`.
- Control heights: **38 px** default · 30 px compact · 42 px large/form CTA; **34 px** icon buttons. Mobile primary targets ≥ 44 px.

---

## 5. Layout & navigation

### 5.1 Shell

- **Desktop ≥ 1024 px:** sticky 232 px sidebar + 56 px app bar; content max-width 1760 px, 24 px padding. Sidebar scrolls internally (the existing UI-003 fix is preserved).
- **Tablet 768–1023 px:** no sidebar; compact app bar with brand + bell + avatar; **5-item bottom bar + More sheet**.
- **Mobile ≤ 767 px:** single column, page actions stack, cards 12 px radius, 14 px page padding, bottom bar fixed with safe-area padding.
- App bar contains: breadcrumb `Home CCTV / <section>` (the banner must contain "Home CCTV"), system status pill, "Enable notifications" button, IST clock + date, account avatar. No duplicated brand headline — the breadcrumb carries the name.

### 5.2 Navigation (labels unchanged, grouping added)

One `<nav aria-label="Primary">` per viewport (the hidden duplicate uses `display:none`), with the exact eight labels:

| Group | Items |
|---|---|
| Monitor | Dashboard (`/`), Playback (`/playback`) |
| Security | Events (`/events`, live unread badge), Faces (`/faces`), Notifications (`/notifications`) |
| System | Camera setup (`/cameras`), Device (`/device`), Settings (`/settings`, ADMIN only) |

Active state: teal wash + 2 px left accent bar + `aria-current="page"`. Mobile keeps the same accessible labels; the More sheet holds Faces, Camera setup, Device, Settings, Account, Log out.

### 5.3 Settings shell

`/settings/*` gets a real two-pane shell: 200 px sticky sub-nav (Overview, Users, Notification rules, Object detection, Audit log, System, Back to dashboard) + content. The current inline sentence of teal links is removed. Role guard and route names are unchanged.

---

## 6. Components

Every screen uses the same primitives. Implementation: CSS component classes in `globals.css` (`@layer components`) + small React components where behaviour is needed (icon, page header, status, dialogs). No component library, no new runtime dependency.

| Component | Variants / rules | Visual spec |
|---|---|---|
| **Button** | primary (accent fill), secondary (card fill + border), ghost, danger, icon; sm 30 / md 36 / lg 42; disabled 45 % | radius 8, 13 px/550, icon 15 px, gap 7 px |
| **Icon button** | default, accent | 34×34, radius 8, 1 px border |
| **Field** | label (10 px uppercase) + input/select/textarea; error text; hint | 38 px, `#070A0E` well, border `line-2`, focus: accent border + 3 px soft ring |
| **Card** | default, with header/footer, padded, interactive | `card` surface, 1 px line, radius 12; header 13 px/650 + optional action |
| **Stat** | default/accent/warn/info | icon tile 34 px + uppercase label + 20–24 px value + delta line; **never an `<article>`** on the dashboard (article count is test-asserted) |
| **Badge / pill / chip** | status, priority, mono, accent, info | 20–28 px, radius 999/6, 11 px/600, always includes a word |
| **Status dot** | online/warn/offline/idle/live (live pulses) | 6–7 px + 3 px glow; reduced-motion stops the pulse |
| **Switch** | on/off, 34×20 | teal track when on; label always present |
| **Segmented control** | 24h/6h/1h, quick filters, timeline scales | 3 px inset track, 28 px items, `aria-pressed` |
| **Table** | dense, header 10 px uppercase, row 44 px | 1 px hairlines, mono for IDs/times; mobile → stacked rows |
| **Property list** | key/value, 12 px labels | used in inspectors and summaries |
| **Timeline / event row** | time, 74×50 thumbnail, title + priority + New, camera · notified, duration, chevron | row 66 px desktop, 56 px mobile (thumb hidden < 720) |
| **Camera tile** | 4:3 video, LIVE badge, clock, signal, name + sub channel + event count | video area is the **first child div** of the `<article>`; hover reveals expand; focus mode unchanged |
| **Inspector** | sticky 400 px on desktop; bottom sheet on mobile | snapshot 16:9, badges, title, props, primary actions |
| **Notice** | default, accent, warn, danger | 1 px tinted border + soft fill + icon |
| **Empty state** | icon tile + title + explanation + optional action | dashed border container, never a bare sentence |
| **Skeleton** | shimmer, reduced-motion aware | used for tile/list loading; replaces "Loading…" text where shape is known |
| **Dialog / sheet** | delete confirmations, mobile detail sheet | `role="alertdialog"` with focus management and Escape; backdrop blur |
| **Page header** | eyebrow + h1 + sub + actions | one h1/page, eyebrow uppercase 10 px accent, actions right-aligned (stack on mobile) |
| **Settings row** | title + description + control | stacks vertically at ≤ 767 px; save bar sticky **inside** content column and above the mobile nav |

Icons: one inline-SVG set (24 px grid, 1.7 px stroke): dashboard, camera, playback, events, faces, bell, device, settings, user, logout, clock, chevrons, search, filter, expand, close, plus, check, alert, info, refresh, arrow-right, external, database, activity, wifi, lock, shield, send, eye, calendar, image, volume/mute/play/pause/fullscreen, sliders, users, file, home, more, cpu, zap, scan, key, copy. No icon package.

---

## 7. Screen patterns

1. **Live monitoring (Dashboard):** eyebrow + h1 + system pill → 4-stat overview strip (cameras online, events today, person/vehicle, alerts sent) → height-fit 2×2 live wall → right rail: "Recent security events" (region name preserved), system snapshot, quick links. On ultra-wide an extra "Today by camera" column appears. All 4 tiles remain above the fold on desktop, 4:3 stream ratio preserved, focus mode untouched.
2. **Event timeline:** date navigator + segmented quick filters + collapsible "Filters (n)" panel → two-pane: dense grouped timeline (`<li><button>` rows, day/hour groups) + sticky inspector (`article` named "Event details"). Mobile: filters collapsed, inspector becomes a bottom sheet opened by tapping a row.
3. **Event detail:** breadcrumb → h1 + priority → hero snapshot with detection box + metadata sidebar (summary, faces region, technical details) + actions.
4. **Camera management:** DVR/gateway health strip → 2×2 camera cards with frame preview, channel identity, rename form (Save / Use DVR name), stream map (sub for live, H.264 sub for playback, main stays on LAN).
5. **Notification rules:** action bar (Enable notifications, Send Telegram Test, New rule) → rules list with switches and chips + retention card + rule tester; right-hand rule editor with grouped scope/schedule/quiet-hours sections; Telegram status.
6. **Face detection:** 4 KPI stats → filter card + test-notification notice → dense gallery (5–6 columns desktop, 2 mobile) with faces counted as the only `<article>` elements, pagination.
7. **Settings:** two-pane shell; overview health cards + masked environment grid + administration link cards; sub-pages use dense tables and stacked mobile rows. Save bars never collide with the bottom nav.
8. **Login:** split brand panel (local-first promise, facts) + focused sign-in form; native POST fallback, error announcement and focus management preserved.

---

## 8. Accessibility contract

- Focus visible everywhere: 2 px teal ring + 2 px offset (and a contrasting gap so it is visible on the teal primary CTA).
- Skip link to `<main>`; no more 11 tab stops before content.
- Status text always accompanies colour; classification and priority use labels, not hue alone.
- `aria-current="page"` for the active destination; one accessible `Primary` nav per viewport; the hidden duplicate uses `display:none`.
- Async results: `role="status"`/`aria-live="polite"`; errors `role="alert"`; dialogs move focus, trap it, close on Escape and restore focus.
- Tap targets: ≥ 36 px desktop / ≥ 44 px mobile primary controls; all controls keyboard reachable.
- Reduced motion disables live pulse and shimmer.
- Contrast: body ≥ 4.5:1; non-text UI boundaries ≥ 3:1 (the current 1.2–1.3:1 `line` token is raised).
- No hydration-unsafe values (`Date.now()`, `Math.random()`, `window`, `Notification.permission`) in first render.
- Every tested label, role, `data-testid` and layout invariant from `design/audit/TEST-CONSTRAINTS.md` is preserved.

---

## 9. Implementation mapping (Phase 4)

1. **`src/app/globals.css`** — replace the palette values (keep existing token names `bg/panel/card/line/ink/muted/teal/online/offline/warn`; add `surface/card-2/raised/ink-2/faint/accent-soft/accent-line/info` and status soft tints), add type/space/radius tokens, add an `@layer components` block with `.btn`, `.card`, `.field`, `.input`, `.badge`, `.pill`, `.chip`, `.stat`, `.table`, `.notice`, `.empty`, `.skeleton`, `.seg`, `.switch`, page-header and layout classes. Remove hard-coded hex from components.
2. **`src/components/ui/`** — add `Icon.tsx` (inline SVG sprite/component), `PageHeader.tsx`, `Stat.tsx`, `Badge.tsx`, `EmptyState.tsx`, `Card` helpers as needed. Keep `States.tsx` exports (`PageIntro` compact variant is class-string-tested by playback Vitest — do not change it) and `StatusLamp` API.
3. **`AppShell.tsx`** — grouped sidebar, breadcrumb banner, status cluster, account menu, 5-item mobile bar + More sheet, skip link. Preserve single Primary nav per viewport, exact labels, ARIA, SSE notifier, role filtering, stickiness.
4. **Screens** — restyle in place, reusing existing hooks/APIs; no API/schema/business-logic changes. Playback internals stay untouched (only inherited tokens change).
5. **QA** — `npm run typecheck`, `npm run lint`, `npm test`, full Playwright suite, before/after screenshots, responsive capture matrix, regression report.

---

## 10. Approval checklist

- [ ] Palette, typography scale and component language approved.
- [ ] Navigation grouping (labels unchanged) approved.
- [ ] Mobile 5-item bottom bar + More sheet approved.
- [ ] Screen layouts (Dashboard, Events, Event detail, Camera setup, Notification rules, Faces, Settings, Login) approved.
- [ ] Scope confirmed: Tier 1 six screens + shared shell + login; settings sub-pages consistency pass; playback internals untouched per constraints.
