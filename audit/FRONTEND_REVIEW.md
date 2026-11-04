# Frontend Architecture Review — Home CCTV Hub ("Sentinel" UI)

| | |
|---|---|
| **Auditor** | Agent 3 — independent frontend architecture auditor |
| **Target** | `/Users/guruswamihiremath/Desktop/projects/home-hik-camera` (Next.js 16 App Router, React 19, Tailwind v4), running at `http://localhost:3000` |
| **Mode** | Read-only. No file under `src/`, `design/`, config, tests, `.env` or `data/` was modified; no dependency installed; no service started/restarted; no mutating UI flow (no test notification, save, delete or user creation) executed. The only file created is this report. |
| **Method** | Static analysis of every route/component/hook/CSS/test file (grep/read), plus independent DOM measurement with a throwaway Playwright script kept in `/tmp` (never in the repo), run against `localhost:3000` with the existing `tests/e2e/.auth/admin.json` storage state and waiting for hydration (`.clock__time` → real time). |
| **Evidence caveat** | The first screenshot set in `audit/screenshots/**` was captured against `127.0.0.1` and never hydrated; the Lead re-captured it against `localhost`. **No finding below depends on that broken set.** Rendered checks were re-run independently (values quoted in §2.3 and §3.4). |
| **Codebase size** | 61 `.tsx` files under `src/app` + `src/components` (42 with `"use client"`), 1 global stylesheet (1,041 lines / 61.4 KB), 17 routes. |

---

## 1. Scope, method and architecture inventory

### 1.1 Routes (17)

All 16 hub routes are nested under the `(hub)` route group, whose layout is the auth gate; `/login` is outside it. Every page is dynamic (`force-dynamic`), which is correct for a session-cookie + live-DVR console.

| # | Route | File | Guard / shape |
|---|---|---|---|
| 1 | `/` (dashboard + live wall) | `src/app/(hub)/page.tsx:3` | group layout guard + a 4-tile WebRTC wall |
| 2 | `/playback` | `src/app/(hub)/playback/page.tsx:6` | async server page, reads `camera`/`date`/`time` searchParams (`:11-16`) |
| 3 | `/events` | `src/app/(hub)/events/page.tsx:7` | `Suspense` + client view (`:9-11`) |
| 4 | `/events/[id]` | `src/app/(hub)/events/[id]/page.tsx:21` | fully server-rendered detail; id regex `:19`; `notFound()` `:23,:28` |
| 5 | `/events/stats` | `src/app/(hub)/events/stats/page.tsx:7` | client view, no search params |
| 6 | `/faces` | `src/app/(hub)/faces/page.tsx:10` | client view |
| 7 | `/notifications` | `src/app/(hub)/notifications/page.tsx:7` | `Suspense` + client view |
| 8 | `/cameras` | `src/app/(hub)/cameras/page.tsx:6` | client view (static previews only) |
| 9 | `/device` | `src/app/(hub)/device/page.tsx:6` | client view, `usePoll` |
| 10 | `/account` | `src/app/(hub)/account/page.tsx:5` | client view |
| 11 | `/settings` | `src/app/(hub)/settings/page.tsx:6` | settings shell + ADMIN guard |
| 12 | `/settings/users` | `src/app/(hub)/settings/users/page.tsx:5` | ADMIN only |
| 13 | `/settings/notifications` | `src/app/(hub)/settings/notifications/page.tsx:5` | ADMIN only |
| 14 | `/settings/detection` | `src/app/(hub)/settings/detection/page.tsx:6` | ADMIN only |
| 15 | `/settings/audit-log` | `src/app/(hub)/settings/audit-log/page.tsx:1` | ADMIN only; **the page itself is `"use client"`** |
| 16 | `/settings/system` | `src/app/(hub)/settings/system/page.tsx:1` | ADMIN only; **the page itself is `"use client"`** |
| 17 | `/login` | `src/app/login/page.tsx:28` | chrome-free; redirects when already signed in (`:46-49`) |

### 1.2 Shells

| Shell | File | Responsibility |
|---|---|---|
| Root layout | `src/app/layout.tsx:13-18` | `<html lang="en">`, global CSS (`:2`), `dynamic = "force-dynamic"` (`:4`), metadata template (`:6-11`). |
| Hub layout (server) | `src/app/(hub)/layout.tsx:8-13` | `getConfig()` → redirect `/login` when unconfigured; `currentSession()` → redirect when unauthenticated; renders `<AppShell>`. |
| App shell (client) | `src/components/layout/AppShell.tsx:202-413` | Sidebar + app bar + content scroll region + mobile bottom nav + "more" sheet; wraps everything in `CameraFocusProvider` (`:202-208`); host of the only global `EventSource` (`:131-181`). |
| Settings layout (server) | `src/app/(hub)/settings/layout.tsx:13-23` | Second auth check + `session.role !== "ADMIN"` redirect (`:14-16`); two-pane `.settings-shell` (`:19-22`). |

### 1.3 Shared UI inventory (`src/components/ui/*`)

| Component | File:line | Used by | Assessment |
|---|---|---|---|
| `Icon` (46 named inline SVGs) | `src/components/ui/Icon.tsx:1-206` | everywhere | Good: no icon dependency, single stroke language, `aria-hidden` (`:180`). |
| `Mark` (brand) | `src/components/ui/Mark.tsx:1-11` | shell, login | Fine. Hard-coded palette hexes in SVG (`:4-8`) — the only place that is acceptable. |
| `PageHeader` | `src/components/ui/PageHeader.tsx:10-31` | 15 files (30 references) | Good single h1 + eyebrow + action slot. |
| `MessagePanel`, `FrameSkeleton`, `ErrorBanner`, `EmptyState`, `SkeletonRows` | `src/components/ui/States.tsx:4,12,16,39,63` | 3–8 call sites each | Genuinely reused; `EmptyState` used in 5 views with title/detail/action contract. |
| `PageIntro` (compact/variant heading) | `src/components/ui/States.tsx:83-98` | **only** `PlaybackView.tsx:255` | Duplicates `PageHeader`'s job; exists only because playback needs a compact heading. |
| `StatusLamp` | `src/components/ui/StatusLamp.tsx:30-58` | 6 call sites | Good a11y (dot + text + `sr-only` full label `:45`). |

### 1.4 CSS architecture (`src/app/globals.css`)

Measured facts (script-assisted, verified by grep):

- 1,041 lines / 61,371 bytes; **one** `@theme` block (`:14-55`), a `:root` alias layer with 40 short aliases (`:59-109`), `@layer base` (`:111-125`), `@layer utilities` (`:127-142`), and **11 separate `@layer components` blocks** (`:144`, `:792`, `:800`, `:871`, `:925`, `:1007`, `:1013`, `:1018`, `:1026`, `:1033` — note `:800` is a `@layer components` nested inside the block opened at `:792`).
- `@import "react-day-picker/style.css"` is global (`:3`), so calendar CSS ships to every route.
- **21 media queries** in one file with two boundary conventions: `max-width:1024px` (`:672`, `:772`, `:780`) **and** `max-width:1023px` (`:976`, `:1034`); `min-width:1025px` (`:744`, `:753`, `:763`) **and** `min-width:1024px` (`:1000`); plus `min-width:64rem` (`:130`), `min-width:1760px` (`:757`, `:1019`), `max-width:1500px/1280px/720px/430px`.
- Token discipline is **good in the component layer** (484 `var(--…)` references) but leaky around it: 54 literal hex colors and 74 `rgba()` literals that re-state token values (e.g. `#04211c` at `:75` vs `--accent-ink`; `#8a9ab0` at `:306` for the switch thumb instead of `--muted`; `#e9f0f8` at `:419` instead of `--ink`; `rgba(47,227,198,…)` at `:76-77`, `:296`, `:556` instead of `--accent`/`color-mix`). 636 `px` literals vs 19 `rem` literals — the type scale is token-based (`--fs-*`), spacing is partly raw px.
- 308 distinct class selectors; **23 verified-dead selectors** (never referenced from any `className` in `src/`; a 24th, `.camera-grid-h`, is referenced only by a test comment and kept "for compatibility" at `:128-134`), e.g. `.page` (`:239`), `.card--span` (`:665`), `.camera__media`/`--empty` (`:411-413`), `.camera__action` (`:419`), `.camera__clock` (`:422`), `.detail-media__tag` (`:512`), `.playback-grid`/`-stage`/`-controls`/`-timeline` (`:642-652`), `.track`/`.track__seg`/`__head`/`__labels` (`:648-652`), `.quick-link(s)` (`:440-444`), `.search-input` (`:299-301`), `.textarea` (`:287-293`), `.btn--icon` (`:275`), `.icon-btn--accent` (`:282`), `.badge--hide-sm` (`:710`). The `.rdp-*` block (`:801-867`) is separately dead — see FE-14.
- 4 `!important` usages (`:744` mobile-nav hiding, `:746-747` reduced motion, `:346`) — the `:744` one exists because two nav systems must be force-hidden on desktop.

### 1.5 Client/server boundary

42 of 61 `.tsx` files are `"use client"`. The boundary is consistent: **server** = root/hub/settings layouts, the fully-rendered event-detail page, and 13 thin pages that only render a client view; **client** = every view with live data, plus hooks.

| Boundary | Files | Why justified |
|---|---|---|
| Server-only data + redirects | `(hub)/layout.tsx:8-13`, `settings/layout.tsx:13-23`, `events/[id]/page.tsx:21-68` | Session/DVR access must not reach the browser (`client-boundary.test.ts` enforces no secrets/`rtsp://` in browser source). |
| Thin server page → client view | 14 pages, e.g. `(hub)/page.tsx:3`, `events/page.tsx:9-11` | Pages need client polling/SSE. |
| **Client page (pattern break)** | `(hub)/settings/system/page.tsx:1`, `(hub)/settings/audit-log/page.tsx:1` | The only two routes that put the view directly in `app/` instead of `components/`; inconsistent with the other hub routes (FE-25). |
| Client hooks | `components/hooks/usePoll.ts`, `useCameraNames.ts`, `useElementWidth.ts`, `useRecordingDates.ts`, `useCameraFocus.tsx`, `useEscapeToDismiss.ts` | All effect-driven; correct. |

Only two pieces are flagged as questionable client components: `MarkReadOnView.tsx:10-19` (a POST-on-mount side effect could be a server action) and `PageHeader`/`StatusLamp` being consumed mostly from client trees (small cost, not worth changing).

### 1.6 Data-fetching patterns

| Pattern | Implementation | Call sites | Cadence |
|---|---|---|---|
| `api<T>(url, init)` | `src/lib/client-api.ts:16-32` — `fetch(..., {cache:"no-store", credentials:"same-origin"})`, 401 → `navigate("/login")` (`:23-26`). No `AbortSignal` parameter, no timeout. | ~25 | per action |
| `usePoll<T>(url, intervalMs = 15000)` | `src/components/hooks/usePoll.ts:6-51`; refetch on `window.focus` (`:41-42`), `ignore` guard, interval cleaned up. | 4 (`AppShell:228`, `DashboardView:28`, `SettingsView:56`, `DeviceView:23`) | 15 s |
| SSE | `new EventSource("/api/events/stream")` in `EventNotifier` (`AppShell.tsx:133`); server route with 20 s `: ping` heartbeat (`api/events/stream/route.ts:22-28`). Consumers via `window` custom event `cctv-event` (`AppShell.tsx:146`). | 1 global stream | event-driven |
| Per-page fetch effects | `useEffect` + `api()` + `setTimeout(…, 0)` deferral, `ignore`/`cancelled` flags | most views | on mount / on filter submit |
| Manual intervals | clock 1 s (`AppShell.tsx:78`), unread badge 60 s (`AppShell.tsx:119`), dashboard summary 60 s (`DashboardView.tsx:58`), stream presence 20 s ×4 tiles (`LivePlayer.tsx:254-261`), notification-permission poll 2 s (`NotificationPermissionButton.tsx:18`), playback position 250 ms (`PlaybackPlayer.tsx:199`) | 6 | see §3.6 |

---

## 2. Findings

Severity: **High** = user-visible defect or blocks work; **Medium** = real maintenance/consistency cost or edge-case defect; **Low** = polish/test hygiene. "Targeted" = small, local, test-safe; "Optional refactor" = worth doing but not necessary now.

### 2.1 Findings table

| ID | Sev | Location | Problem and evidence | Recommendation |
|---|---|---|---|---|
| **FE-01** | Medium | `DashboardView.tsx:158-206`, `NotificationsView.tsx:91-132`, `EventStatsView.tsx:125-168`, `FacesView.tsx:177-230` | The KPI tile is copy-pasted **16 times** (`4 files × 4 tiles`) with only icon/label/value/sub-line varying. Same class skeleton (`.stat`, `.stat__icon`, `.stat__label`, `.stat__value`, `.stat__delta`) and the same wrapper `.stat-row`. No `Stat` component exists, although `EmptyState`/`ErrorBanner` prove the shared-primitives pattern is already in use. Skeleton row heights are also ad-hoc inline values (`DashboardView:145` 66 px, `EventStatsView:113` 74 px, `FacesView:369` 232 px). | **Targeted:** extract `ui/Stat.tsx` (`<StatRow>`, `<StatTile tone icon label value delta>`), replace 16 blocks. |
| **FE-02** | Medium | `EventsView.tsx:88-96`, `EventStatsView.tsx:41-49`, `FacesView.tsx:54-62`, `NotificationsView.tsx:35-43`, `PlaybackView.tsx:94-106`, `CamerasView.tsx:29-43`, `DashboardView.tsx:28` | `/api/cameras` is fetched and reduced to a `Record<number,string>` **7 times**, in near-identical effects, while a purpose-built cached hook exists (`useCameraNames.ts:17-57`) and is used by only 2 files (`DetectionSettings.tsx:232`, `NotificationRules.tsx:99`). The hook's module cache is never invalidated after a rename (`CamerasView.tsx:45-73` PATCH), so those two screens can show stale names for the rest of the session (`resetCameraNameCache()` at `useCameraNames.ts:37-39` is test-only). | **Targeted:** migrate the 5 remaining pages to `useCameraNames`; export a cache-invalidation call and use it after a successful camera PATCH. Also fixes the stale-name path. |
| **FE-03** | Medium | `PriorityBadge.tsx:9-17` vs `NotificationRules.tsx:84-88` | The same "HIGH priority" concept is rendered in two different tones: `PriorityBadge` maps `HIGH → badge--danger` (`:11`), while the rules editor's local `PriorityFloorBadge` maps `HIGH → badge--warn` (`:86`). A HIGH event therefore looks "danger" in `/events` and "warn" in `/settings/notifications`. | **Targeted:** delete `PriorityFloorBadge`, reuse `PriorityBadge` (or add a documented `tone` variant). |
| **FE-04** | Low | `StatusLamp.tsx:16-21`, `AppShell.tsx:184-196`, `SettingsView.tsx:15-27`, `DetectionSettings.tsx:56-68`, `settings/system/page.tsx:46-64` | Tone→class mapping (`online/offline/warn/idle` → `dot--*`/`badge--*`) is implemented **5 times**. Divergences: `AppShell.toneFor` (`:184-190`) folds `auth_failed`/`not_configured` into `warn` and everything else into `offline`; `SettingsView.toneForBadge` (`:15-20`) maps `offline → badge--danger`; `DetectionSettings.dotFor`/`badgeFor` (`:56-68`) duplicate both functions verbatim. | **Targeted:** one `toneClasses(tone)` helper in `ui/StatusLamp.tsx` (or a small `lib/tone.ts`), import everywhere. |
| **FE-05** | Low | `ui/PageHeader.tsx:10-31` vs `ui/States.tsx:83-98` | Two page-heading abstractions coexist; `PageHeader` is used by 15 files, `PageIntro` only by `PlaybackView.tsx:255`. `PageIntro` also duplicates `States.tsx`'s role (it is a "states" module). Note it is class-token-locked by `playback-layout.test.ts:82-95`. | **Optional refactor:** merge into `PageHeader` with a `compact` prop; only with the test updated. |
| **FE-06** | Low | `EventsView.tsx:582-606`, `FacesView.tsx:397-425`, `NotificationsView.tsx:247-275`, `audit-log/page.tsx:200-231` | Pagination is re-implemented 4 times with two different visual paradigms: text buttons with `pagination__count` (events, audit-log) vs icon-only buttons with `aria-label` (faces, notifications). Counts also differ in shape ("Page 1 of 3 · 25 per page" vs "Page 1 of 3"). | **Targeted:** one `ui/Pagination.tsx` (`page`, `pageSize`, `total`, `onPage`). |
| **FE-07** | Medium | `EventsView.tsx:339-473`, `FacesView.tsx:232-307`, `NotificationsView.tsx:134-211`, `audit-log/page.tsx:74-118` | Four filter panels with the same `.filter-panel / .filter-grid / .field / .field__label / .filter-panel__foot` skeleton and the same "Apply/Clear + hint" foot; each re-implements the `label.field > span.field__label + input/select` wrapper (`label className="field"` appears 4× in FacesView, 4× in NotificationsView, 8× in EventsView, 3× in audit-log). `audit-log/page.tsx:82` uses `form-grid form-grid--3` while the other three use `filter-grid`, so the audit filters have a different column rhythm. | **Targeted:** shared `Field` wrapper + `FilterPanel`/`FilterFooter` (keep each page's own fields); swap audit-log to `filter-grid`. |
| **FE-08** | Medium | `system/page.tsx:296,381`, `DetectionSettings.tsx:475` vs `audit-log/page.tsx:169-199`, `UsersView.tsx:179-309`, `AccountView.tsx:242-268` | Three different "tabular list" implementations: real `.table.table--stack` (3 tables, always wrapped in an inline `overflowX` div and given an inline `style={{minWidth: …}}`), styled `<ul>` with per-row inline styles (audit log, users), and `<article className="card">` rows (notifications `:309-341`). The mobile stacking behaviour exists only for `.table--stack` (`globals.css:896-922`), so audit/users lists cannot get it. | **Targeted:** audit log → `.table--stack` (simple swap). **Optional:** shared `DataList` for the card-row lists. |
| **FE-09** | Medium | 243 `style={{…}}` occurrences in 28 files; top: `DetectionSettings.tsx` 36, `NotificationRules.tsx` 27, `CamerasView.tsx` 26, `UsersView.tsx` 21, `settings/system/page.tsx` 18 | Static layout styling is inlined instead of using the design system: the identical wrapper `style={{ display:"grid", gap:14, minWidth:0 }}` appears in `SettingsView.tsx:85`, `UsersView.tsx:132`, `DetectionSettings.tsx:360`, `system/page.tsx:135,281,364`, `audit-log/page.tsx:60`; the identical "spread row" `style={{display:"flex",alignItems:"center",justifyContent:"space-between"}}` in `RecentEvents.tsx:91`, `SettingsView.tsx:190`, `UsersView.tsx:311`, `DetectionSettings.tsx:961`; `.status` is given `style={{justifyContent:"space-between"}}` 6 times (`DashboardView.tsx:283,289,295`, `CamerasView.tsx:358,362,366`); static radii/sizes are hard-coded (`EventsView.tsx:668` `borderRadius:"11px 11px 0 0"`, `CamerasView.tsx:196-210`, `FaceCard.tsx:36-51`). | **Targeted:** add ~4 component classes (`.stack-sm`, `.row-between`, `.status--spread`, `.page-narrow`) and convert the repeated instances; remaining dynamic styles (bar widths, detection box) stay inline. |
| **FE-10** | Medium | `globals.css:568,658,689,706,719` (`.face-grid` ×5); `:387,670,699,718` (`.stat-row` ×4); `:399,659,663,758` (`.dash` ×4); `:400,755,759,1020` (`.dash__main` ×4); `:726,774` (`.mobile-nav` ×2 + `:678`); `:527,1029` (`.cam-card__preview`) | Cascade is managed by re-declaring whole rules later instead of extending them, producing contradictory duplicates: `.cam-card__preview` first sets `aspect-ratio:16/9` (`:527`) and is later reset to `aspect-ratio:auto; height:168px` (`:1029`); `.content` padding-bottom 76 px (`:677`) then 92 px (`:783`); `.page-head` column layout declared at `:696` and again at `:781`; `.dash__main` grid columns at `:759` then again at `:1020`; `.by-camera__name` width 118→112 (`:448`→`:1022`); `.camera__top` `space-between`→`flex-end` (`:416`→`:1023`); a "Fixes after first render pass" block (`:767-784`) that re-states earlier rules. `globals.css:800` nests `@layer components` inside `@layer components`. | **Optional refactor:** consolidate each selector to one place, delete superseded declarations, and keep breakpoint blocks in ascending order. No visual change expected if done mechanically. |
| **FE-11** | Low | `globals.css` (see list in §1.4) | 23 dead class selectors, including a whole unused page container `.page` (`:239`, with `--page-max` token at `:107`) and the unused playback layout layer (`:642-652`). Dead CSS is ~2–3 KB and, more importantly, actively misleads maintainers about where playback/camera styling lives. | **Targeted:** delete dead selectors (verify with the class-usage script; `rdp-*` excluded — see FE-14). |
| **FE-12** | Medium | `globals.css:801-867` vs `PlaybackCalendar.tsx:63-95` | The 66-line react-day-picker theme block targets `.rdp-day`, `.rdp-day_button`, `.rdp-month_grid`, `.rdp-selected`, `.rdp-disabled`, but `PlaybackCalendar` overrides exactly those slots with Tailwind strings (`day`, `day_button`, `month_grid`, `selected`, `disabled`). react-day-picker builds its class map as `{ ...getDefaultClassNames(), ...props.classNames }` (`node_modules/react-day-picker/dist/esm/DayPicker.js:113`), so an overridden slot carries **only** the custom classes — the CSS markers (including the `.rdp-recorded … ::after` "recording available" dot at `:827-837`) cannot match. Styling for the same widget therefore lives in two places, and the CSS-file edits a maintainer would naturally make are inert. | **Targeted:** pick one path — either pass Tailwind classNames (then delete `:801-867` and move the recorded-dot into a Tailwind pseudo-element class) or drop the slot overrides and keep the CSS. Validate the dot marker against the real calendar. |
| **FE-13** | Medium | `PlaybackTimeline.tsx` (97 utility tokens), `LivePlayer.tsx` (50), `PlaybackPlayer.tsx` (45), `TimelineHoverPreview.tsx` (36), `PlaybackFilters.tsx` (27), `PlaybackCalendar.tsx` (29) vs `PageHeader.tsx`/`StatusLamp.tsx` (0) | Two styling systems coexist: the Sentinel screens use BEM component classes (`globals.css`), while playback, the live player and calendar are raw Tailwind utility strings, including arbitrary values (`text-[11px]` ×~14, `w-[232px]` `PlaybackTimeline.tsx:481`, `shadow-[0_0_6px_rgba(62,224,199,0.8)]` `:441` — the same colour as the CSS `.track__head` rule at `globals.css:651`, and `bg-[repeating-linear-gradient(...)]` `LivePlayer.tsx:294`). The same input styling is retyped per field (`PlaybackFilters.tsx:59,86,97` `"h-11 w-full rounded-lg border border-line bg-card px-3"`) and only eight `sm/md/lg/xl/2xl` utilities exist outside these files. | **Targeted containment:** define `.playback-field`/`.playback-button` component classes (or share one const string) and delete the now-dead `.playback-*` CSS; **optional refactor:** decide one direction for the playback screen. Do not rewrite working UI wholesale. |
| **FE-14** | Medium | `.today-col` — `globals.css:757-765`, rendered at `DashboardView.tsx:237-266` | The "today by camera" column is visible ≥1760 px and **hidden only in the 1025–1759 px window** (`:763-765`), so below 1025 px it renders again as a full-width block after the camera wall. Measured at `localhost:3000`: `display:block` at 390/834/1024 px, `display:none` at 1440 px, `block` at 1920 px. This contradicts the code comment ("a 3rd today column appears only when the width can afford it", `globals.css:750-752`) and adds a large block to the mobile dashboard. | **Targeted:** change the hide rule to `@media (max-width: 1759px) { .today-col { display:none } }` (or render it conditionally via a container query). |
| **FE-15** | **High** | `AppShell.tsx:256` + `globals.css:672-694,744` | At a viewport of **exactly 1024 px** the sidebar and the mobile bottom nav are both visible: the aside is `"sidebar hidden lg:flex"` (`AppShell.tsx:256`, Tailwind `lg` = `min-width:1024px`) while the CSS hides `.sidebar` only at `max-width:1024px` (`:672-674`) and the mobile nav only from `min-width:1025px` (`:744`), and `.shell__body` is single-column at ≤1024 px (`:673`). Measured at 1024×768: `sidebar display:flex` **and** `mobile-nav display:grid`, body scroll height 1536 px, i.e. the desktop sidebar stacks above the content while the bottom nav is also shown. 1023 px and 1025 px are both correct. | **Targeted:** delete the `hidden lg:flex` class pair and let the CSS breakpoint own the sidebar, or move `lg → min-width:1025px`; then normalise the `1023/1024/1025` boundaries to one pair. |
| **FE-16** | Medium | `AppShell.tsx:354` + `globals.css:677,783` | Bottom spacing for the fixed mobile nav is reserved **twice**: `main` carries `pb-28` (112 px) below `md` (`AppShell.tsx:354`) **and** `.content` gets `padding-bottom:92px` at ≤1024 px (`globals.css:783`); the 76 px value at `:677` is superseded. Measured at 390×844: `main padding-bottom 112px` + `.content padding-bottom 92px` → ~204 px of empty band under the last card (visible in the mobile dashboard capture). | **Targeted:** keep one reservation (e.g. `padding-bottom: calc(var(--mobile-nav-h) + safe-area)` on `.content` only) and remove the other. |
| **FE-17** | Medium | `AppShell.tsx:20-45` (NAV_GROUPS), `:47-52` (MOBILE_NAV), `:55-64` (SECTIONS), `:382-408` (sheet links), `SettingsNav.tsx:18-25` (ITEMS), `SettingsView.tsx:31-53` (MANAGE_LINKS) | Six hand-maintained route lists. Adding/moving a route requires up to four edits; labels already disagree: sidebar groups are `Monitor/Security/System`, breadcrumb sections are `Monitor/Investigate/Configure/Account/Administration` (`:55-64`), and the sheet re-lists `/faces`, `/cameras`, `/device`, `/settings`, `/account` by hand instead of deriving from `NAV_GROUPS`. `/settings` visibility is filtered by role twice (`:225` and `:391`). | **Targeted:** derive the mobile nav and the sheet from `NAV_GROUPS` (filter by `short`/`mobile` flag), and use one section taxonomy. |
| **FE-18** | Medium | `EventsView.tsx:67-86,102-127,179-218` | The events filter model is 9 parallel `useState`s, an `overrides` object that re-specifies each filter (`:104-127`), and **three** copies of the defaults/active logic: `filtersActive` (`:179-187`), `advancedActive` (`:190-197`), `clearFilters` (`:199-218`). Adding one filter means touching 5 places. `search()` has no request-sequence guard (compare `PlaybackView.tsx:91,132-149`), so two rapid quick-filter clicks can apply an out-of-order response. | **Targeted:** introduce a `Filters` object state + a `DEFAULT_FILTERS` const and a `requestSeq` ref. No API change. |
| **FE-19** | Low | `PlaybackView.tsx:44-92,260-290`, `PlaybackFilters.tsx:8-46` | Playback state is 17 `useState` + 4 refs (`requestSeq`, `eventSeekRef`, `loadRef`, `loadedQuery`, `timeRange`) in one component; `PlaybackFilters` receives **17 props** (`:8-46`), mostly pass-through setters. The refs exist to keep the load effect from re-firing; each has a comment explaining a workaround. | **Optional refactor:** group the query into one `PlaybackQuery` object (it already exists at `:33`) and a small `usePlaybackSearch` hook. Behavior must stay identical — this screen is the most test-locked (§4). |
| **FE-20** | Medium | `PlaybackPlayer.tsx:199-217` + `PlaybackView.tsx:82,289,153-154` | The playback clock ticks at **4 Hz** and calls `onPosition`, which is `setPosition` in the page (`PlaybackView.tsx:289`); that re-renders `PlaybackView`, `PlaybackFilters`, `PlaybackTimeline` (up to 100 events fetched for markers, `PlaybackView.tsx:154`) and `PlaybackPlayer` four times per second during playback. The timeline also recomputes marker grouping/density from that prop (`lib/timeline-density`, `PlaybackTimeline.tsx`), so the cost is proportional to marker count. The interval itself is not cleared while paused (`:199-217` only returns early), so it keeps waking the tab. | **Targeted:** throttle the reported position to ~1 Hz (or move position state into the timeline) and clear the interval on pause/ended. |
| **FE-21** | Low | `AppShell.tsx:73-99,107-129,228`, `DashboardView.tsx:42-64`, `LivePlayer.tsx:254-261`, `NotificationPermissionButton.tsx:15-20` | Steady-state background work on the dashboard (LAN-only hub, so severity is low): clock re-render 1 s, permission poll 2 s, `/api/dvr/status` 15 s, unread badge 60 s, cameras 15 s, dashboard summary 3 requests/60 s, presence POST ×4 every 20 s, SSE connected. Each SSE message additionally fans out to 1 unread request (`AppShell.tsx:121`) + 3 summary requests (`DashboardView.tsx:56-58`) and a full dashboard re-render. Nothing pauses on `document.hidden`, and none of these intervals use jitter/backoff. | **Targeted:** pause polls on `visibilitychange`; coalesce the per-event fan-out (single refresh already exists in two places). Do not change server poll intervals. |
| **FE-22** | Low | `AppShell.tsx:131-181` | The single global `EventSource` is a good pattern, but it has no `onerror`/`onopen` handling and no visibility management: after a 401 (expired session) the browser reconnects on its own schedule forever, and the app only learns of the 401 through the next `api()` call. No `cctv-event`-consumer cleanup issue (all listeners remove correctly). | **Targeted:** add `source.onerror` — on `readyState === CLOSED`, close and let the next `api()` 401 path redirect; optionally close while hidden. |
| **FE-23** | Low | `DashboardView.tsx:36,51` + `RecentEvents.tsx:11-22,81` | `useState(() => Date.now())` is evaluated during SSR **and** during hydration, and `RecentEvents` renders relative text from it ("N minutes ago"), so server and client markup can disagree at hydration. No `suppressHydrationWarning` exists anywhere. Elsewhere the codebase handles this correctly: the clock renders `--:--:--` until mounted (`AppShell.tsx:74-88`) and notification permission uses a fixed server snapshot (`NotificationPermissionButton.tsx:38-43`). | **Targeted:** initialise `now` to `null` and publish relative times only after mount (one-line guard in `relativeTime`). |
| **FE-24** | Low | `AccountView.tsx:21-25` vs `src/lib/time-kolkata.ts:43-72`; `AppShell.tsx:91-96`; `PlaybackCalendar.tsx:118` | Time rendering is inconsistent: the session list uses `date.toLocaleString()` (`AccountView.tsx:24`) → **browser** timezone, while every other screen prints Asia/Kolkata via `lib/time-kolkata`; the shell clock uses `toLocaleTimeString("en-IN")` (`AppShell.tsx:92`) instead of `formatKolkataClock`; the calendar formats labels with `en-GB` (`PlaybackCalendar.tsx:118`). On a non-IST browser, session times and clock disagree with the rest of the hub. | **Targeted:** use `formatKolkataDateTimeFromIso`/`formatKolkataClock` in those three places (the `time-kolkata.test.ts` suite already covers the helpers). |
| **FE-25** | Low | 9 of 16 hub pages have no `metadata`; `settings/system/page.tsx:1`, `settings/audit-log/page.tsx:1`; `app/layout.tsx:4` | Browsers will show "Home CCTV" for `/`, `/events`, `/notifications`, `/account`, `/playback`, `/settings/users`, `/settings/notifications`, `/settings/audit-log`, `/settings/system` (only 7 pages export `metadata`), unlike `/faces`, `/cameras`, `/settings`, `/settings/detection`, `/events/stats`, `/device`, `/events/[id]`. The two client pages also break the page→view convention (§1.5). `force-dynamic` is set on the root layout and repeated per page. | **Targeted:** add the missing `metadata` exports and a `layout.tsx` client wrapper for the two client pages. |
| **FE-26** | Low | `src/lib/client-api.ts:16-32` | `api()` accepts no `AbortSignal` and has no timeout, so a slow DVR call cannot be cancelled when a filter changes or a component unmounts; components compensate ad hoc (`usePoll.ts:25` `ignore`, `PlaybackView.tsx:91` seq, `EventFacesPanel.tsx:22` ignore) but `EventsView.search` has none. | **Targeted:** add optional `signal`/`timeoutMs` to `api()` (no new dependency) and pass it from the filter/search call sites. |
| **FE-27** | Low | `src/lib/camera-focus-mode.test.ts:17-34,70-114`; `src/lib/camera-grid-layout.test.ts:142-163` | Two "layout invariant" tests do not import any component or read `globals.css`: `camera-focus-mode.test.ts` asserts its own local constants (e.g. `FOCUSED_ARTICLE = "fixed inset-0 z-50 …"` `:17-20`, `expect(SHELL.headerFocused).toBe("hidden")` `:70-72`), and `camera-grid-layout.test.ts` asserts a literal `rule` string (`:142-163`). Meanwhile the implementation moved to CSS classes (`.camera--focused`, `globals.css:936-953`) and the pinned Tailwind strings are stale. They read as regression guards but cannot fail when the UI regresses. | **Targeted (test hygiene):** either delete them or make them read `globals.css` / render `CameraTile` like `playback-layout.test.ts` does. Does not change app behaviour. |
| **FE-28** | Low | `LivePlayer.tsx:168-274` vs `PlaybackPlayer.tsx:110-248` | The WHEP/HLS helpers are correctly shared (`startWhep`/`startHls` exported from `LivePlayer.tsx:56-133` and imported by `PlaybackPlayer.tsx:9`), but the surrounding session lifecycle (abort controller, `bag {pc,hls,session}`, retry ladder, DELETE-on-cleanup, `srcObject` teardown) is duplicated in both players (~40 lines each) with slightly different retry counts. Copying that logic is how the two players previously diverged. | **Optional refactor:** a `useStreamSession` hook returning phase/detail/retry; do not unify the UI. |
| **FE-29** | Low | `AppShell.tsx:287-309` vs `DashboardView.tsx:272-310` | The DVR/gateway/database status is rendered twice on the dashboard: the sidebar "System" card and the dashboard "System snapshot" card, with separate label/tone logic. Not a defect, but it means the same state has two presentations to keep in sync (`AppShell.toneFor` vs the dashboard badge ternary). | **Optional:** keep the sidebar card; make the dashboard card show different information (e.g. storage/backup) or drop it. |

### 2.2 Severity distribution

| Severity | Count | IDs |
|---|---|---|
| Critical | 0 | — |
| High | 1 | FE-15 |
| Medium | 14 | FE-01, FE-02, FE-03, FE-07, FE-08, FE-09, FE-10, FE-12, FE-13, FE-14, FE-16, FE-17, FE-18, FE-20 |
| Low | 14 | FE-04, FE-05, FE-06, FE-11, FE-19, FE-21, FE-22, FE-23, FE-24, FE-25, FE-26, FE-27, FE-28, FE-29 |
| **Total** | **29** | FE-01 … FE-29 |

### 2.3 Rendered verification of the responsive findings

Measured with a `/tmp` Playwright script (Chromium, `storageState: tests/e2e/.auth/admin.json`, `http://localhost:3000`, hydration awaited via `.clock__time`):

| Viewport | `.sidebar` | `.mobile-nav` | `.content` padding-bottom | `main` padding-bottom | `.today-col` | Notes |
|---|---|---|---|---|---|---|
| 1920×1080 | flex | none | 0 px | 24 px | block | baseline desktop |
| 1440×900 | flex | none | 0 px | 24 px | none | dash rail 330 px |
| **1024×768** | **flex** | **grid** | 92 px | 24 px | block | **both navs visible (FE-15)**; page scrolls 1536 px |
| 834×1112 | none | grid | 92 px | 24 px | block | `today-col` visible below wall (FE-14) |
| 768×1024 | none | grid | 92 px | 24 px | block | `md:` boundary crossed, CSS boundary not |
| 390×844 | none | grid | 92 px | 112 px | block | ~204 px bottom dead space (FE-16) |

Hydration was confirmed at every viewport the Lead's caveat applies to: `.clock__time` contains a real time (e.g. `05:46:04 pm`), and `article` counts match the 4 camera tiles.

---

## 3. Assessment

### 3.1 Component reuse and duplication

**What is genuinely reused:** the shell, `Icon` (46 icons, one SVG language), `EmptyState`/`ErrorBanner`/`SkeletonRows`/`MessagePanel`, `PageHeader`, `StatusLamp`, `PriorityBadge`, `CameraTile`, `FaceCard`, and the playback/camera stream helpers (`startWhep`/`startHls` are shared, not duplicated). `DetectionSettings` also decomposes into local `SettingRow`/`NumberField`/`ConfidenceField`/`CheckboxToggle` (`DetectionSettings.tsx:78-229`) — that is the right level of abstraction.

**What is duplicated (verified by count):**

1. **KPI tiles ×16** across 4 files (FE-01) — the single largest duplication by volume.
2. **Camera-name fetching ×7** with a caching hook used twice (FE-02) — the single most wasteful network duplication, and it hides a stale-name bug.
3. **Filter panels ×4** with the field-label wrapper repeated 19 times across those files (FE-07).
4. **Pagination ×4** with two visual paradigms (FE-06).
5. **Route lists ×6** (FE-17) — navigation is described four times inside one file (`AppShell.tsx:20-64`, `:382-408`).
6. **Tone→class maps ×5** and **HIGH priority rendered two ways** (FE-03, FE-04) — this one is a visible inconsistency, not just code repetition.
7. **`.by-camera` bar rows** duplicated between dashboard (`DashboardView.tsx:246-257`) and statistics (`EventStatsView.tsx:184-244`), including the same `Math.round((count/max)*100)%` width computation five times.
8. **Save/feedback paradigms ×3:** sticky save bar (`DetectionSettings.tsx:951-986`), per-card Save button + inline notice (`CamerasView.tsx:252-277`), and page-level `notice--accent` banner after submit (`UsersView.tsx:157-162`, `AccountView.tsx:144-149`, `NotificationRules.tsx:397`). Each is defensible individually, but the user experiences three different confirmation models in Settings.

**Intentional variation — do not "fix":** the playback date popover (`DatePickerField.tsx`) is a genuinely different control from the native `type="date"` inputs because it must show per-month recording availability; the session-inspector vs mobile bottom-sheet (`.events__inspector[data-open]`) is one DOM node with different presentation, deliberately (`globals.css:973-1004`); the compact `PageIntro` exists for a viewport-fitting screen with a test locking its tokens.

### 3.2 CSS organisation and token discipline

**Strengths:** a real token layer (`@theme` + `:root` aliases, 484 `var()` references), one BEM-ish component layer, semantic status modifiers, `prefers-reduced-motion` handling (`globals.css:346,746-748`), and `@layer` used so utilities can override components — which is what makes occasional Tailwind escapes (`hidden lg:flex`) work at all.

**Weaknesses, in order of cost:**

1. **Two styling systems** (FE-13). Playback and camera surfaces are Tailwind-utility-first (≈358 arbitrary-value tokens across the codebase), everything else is component-class-first. The same visuals are expressed twice, and the component classes for playback were left behind as dead CSS (FE-11).
2. **Cascade managed by re-declaration** (FE-10). 48 selectors are defined more than once. The worst case is `.cam-card__preview`: a full rule at `:527-530` is silently half-overridden 500 lines later at `:1029`; `.face-grid` is re-declared five times as breakpoints accumulate. Readers cannot tell which declaration is live without running the browser.
3. **Token leakage at the edges** (54 hex + 74 `rgba()`), including exact-token duplicates (`#8a9ab0` = `--color-muted`, `#e9f0f8` = `--color-ink`, `#04211c` = `--accent-ink`). This is a small, mechanical cleanup with no behavioural risk.
4. **Dead CSS** (FE-11) and the **inert calendar block** (FE-12). The latter is more dangerous than ordinary dead CSS because it looks like the live theming path for a widget that is actually themed in TSX.
5. **Breakpoint sprawl** (FE-15/16) — see §3.4.
6. **Inline styles as a third styling mechanism** (FE-09): 243 occurrences, many static, which is why a designer changing a spacing token must search three systems.

### 3.3 Design consistency at code level

- **Type/spacing/colour**: consistent where tokens are used; the `--fs-*` scale is respected in TSX via inline `fontSize: "var(--fs-12)"` (e.g. `FacesView.tsx:317`, `NotificationRules.tsx:313`) rather than utility classes — correct intent, awkward mechanism (FE-09).
- **Status semantics are consistent in colour+text pairing** (always a dot + word), but the **mapping functions differ** (FE-04) and **HIGH priority gets two tones** (FE-03). This is the strongest "same concept implemented differently" instance.
- **Page scaffolding:** `PageHeader` + `.section` + `.card` is used on 15 screens; playback uses its own `PageIntro` + utility layout. Heading levels are consistent (`h1` from `PageHeader`, `h2` in cards) which is what the e2e role queries rely on.
- **Page width/containers:** three ad-hoc inline max-widths (`CamerasView.tsx:108` 1240, `DeviceView.tsx:43` 1000, `AccountView.tsx:125` 880) while the token-based `.page` container (`globals.css:239`, `--page-max:1760px` `:107`) is applied nowhere. A `page--narrow` modifier would remove all three inline styles.
- **Copy tone** is consistently operator-facing and honest ("unknown"/"Not reported" instead of fabricated values) — a genuine strength. Minor wording/ellipsis drift exists between screens (`Loading…` vs `Loading...`), and the `Messages` module (`lib/messages.ts`) covers shared strings only partially.

### 3.4 Responsive implementation

**Strategy in place (three systems):**

1. Hand-written CSS media queries — the primary mechanism — with breakpoints **1500, 1280, 1024/1023, 720, 430** and up-queries **1024, 1025, 1760, 64rem** (`globals.css:130,657-765,772-784,896-922,976-1040`).
2. Tailwind responsive utilities — **35 occurrences in 11 files** (`md:` 18, `sm:` 4, `lg:` 3, `xl:` 3, `2xl:` 1) plus one component using arbitrary breakpoints (`DetectionSettings.tsx:88,93,952` `max-[720px]:`, `min-[1025px]:`).
3. JS media queries — `window.matchMedia("(max-width: 1023px)")` in `EventsView.tsx:251` to decide whether a row opens a mobile sheet.

**Consequences (all measured, §2.3):**

- **The 1024 px boundary is contradictory** (FE-15): Tailwind `lg` = 1024 and the CSS hide rule = ≤1024, so exactly at 1024 px both navigation systems render. This is a real, user-reachable device width (iPad landscape, small laptops) and the one High finding.
- **`md:` (768) has no CSS counterpart.** Between 768–1023 px the layout switches to `md:h-dvh` + internal scroll while the CSS still treats 1023 px as the mobile boundary; at 768 the page stops scrolling the document but the bottom nav is still shown. It works, but it is two mental models.
- **`.today-col` visibility window is inverted** (FE-14): hidden only in the middle band.
- **Bottom padding is reserved twice** (FE-16).
- **Height fitting is done with viewport math** (`globals.css:750-762`): `.live-wall { max-width: max(600px, calc((100dvh - 430px)*4/3 + 14px)) }`, plus the older but still-declared `.camera-grid-h` (`:130-134`). It achieves "all four tiles above the fold" on desktop but hard-codes `430px` of assumed chrome — a magic number that will silently drift if the app bar/page head changes. (The dashboard comment at `DashboardView.tsx:210-217` documents the intent.)
- **Mobile nav duplication** (FE-17) — three navigation surfaces exist; only one is visible per breakpoint by construction, but the duplication is in the markup, not just styling.
- **Tablet band** (768–1023) is the least specified: sidebar hidden, bottom nav shown, `md:` columns active. Screens were not designed for it explicitly; the CSS falls through to whichever rules happen to apply.

**Measured positives:** no horizontal page overflow at 390/768/834/1024/1440/1920; tiles keep their aspect ratio; the playback page fits the viewport at 1920 (scroll height = 1080); mobile stat grid remains 2-up; the event list collapses its thumbnail at ≤720 px (`globals.css:708-709`).

### 3.5 Unnecessary complexity

- **State duplication / triplicated defaults** in `EventsView` (FE-18) is the clearest instance: 9 filters described in 5 places.
- **Ref-driven effects** in `PlaybackView` (FE-19): five refs exist to keep one load effect from re-running. It is documented and works, but it is the most fragile code in the app and the hardest to modify.
- **Prop drilling:** `PlaybackFilters` takes 17 props (`PlaybackFilters.tsx:8-46`) for what is a single query object (`PlaybackView.tsx:33` already defines the type).
- **Post-hydration role fetch** in the shell (`AppShell.tsx:216-221`) despite `(hub)/layout.tsx:11-12` already awaiting `currentSession()` server-side: it causes the Settings nav item (and the sheet entry) to pop in after hydration, and costs a request per page load. Passing `role` from the server layout would remove both, and does not break `dashboard.spec.ts:31-36` (the link is still present once rendered).
- **Two WebRTC session-lifecycle implementations** (FE-28).
- **Over-abstraction:** not a problem here. The abstractions that exist (`Icon`, `EmptyState`, `PageHeader`, `usePoll`) are used; the problem is under-abstraction of the repeated markup, not premature abstraction.

### 3.6 Frontend performance (evidence-based)

- **Bundle:** `hls.js` is **correctly lazy** — `await import("hls.js")` inside `startHls` (`LivePlayer.tsx:121`), only reached on the HLS fallback path. The production build emits it as a separate chunk of **579,431 bytes** (`.next/static/chunks/1ot398v-o9o55.js`, verified by content). `react-day-picker` is only pulled in by the playback page (separate 108,348-byte chunk). No component imports the whole library bundle eagerly; `Icon` avoids an icon dependency entirely. **No bundle-size finding.**
- **Re-render hot spot (new):** the playback clock updates page state at 4 Hz (FE-20), re-rendering the playback tree including a timeline built from up to 100 events. This is the only place where a measured cadence is likely to be visible as jank on a low-end machine; the fix is a throttle, not an architecture change.
- **Polling footprint:** dashboard steady state is ~13–14 API calls/minute across six independent loops (FE-21); each incoming SSE event adds up to 4 requests (unread + 3 summary) from two different listeners. On a LAN this is acceptable; it is still worth pausing on `document.hidden` and coalescing the event fan-out.
- **Streams:** all four tiles stay mounted and active in focus mode by design (`DashboardView.tsx:110-115,220-234`), so focus changes never renegotiate WebRTC — a deliberate, documented trade-off; presence POSTs continue for hidden tiles (`LivePlayer.tsx:254-261`).
- **Images:** 5 `<img>` uses, all for **authenticated API routes** (`/api/events/:id/snapshot`, `/api/faces/:id/image`) where `next/image`'s optimizer cannot attach the session cookie; the code documents the exemption at the call sites (`EventsView.tsx:538-541,637`, `FaceCard.tsx:26-34`, `SnapshotPanel.tsx:94-107`). Containers are aspect/height-constrained, so CLS risk is low; `SnapshotPanel` even handles the "image finished loading before hydration" case (`:52-59`). This is the right call — **no change recommended**.
- **SSE lifecycle:** single connection, heartbeat server-side, cleanup on unmount (`AppShell.tsx:179`) — good; missing error handling (FE-22).
- **Hydration:** mostly well handled (mounted clock, external-store permission, pre-hydration image measurement); one residual mismatch risk from `Date.now()` positional state (FE-23).

---

## 4. Test and contract constraints on refactoring

The suite is the real constraint on what "cleaning up" is allowed to change. Two layers:

### 4.1 Strong locks (will fail if markup changes)

| Contract | Source | What it locks |
|---|---|---|
| Playwright e2e, **desktop 1920×1080 only** (`playwright.config.ts:8-10,44-52`) | `tests/e2e/*.spec.ts` (3,459 lines, 16 specs) | Roles/names/testids across all routes. |
| Page h1 + nav structure | `dashboard.spec.ts:19,31-36,42`; `live.spec.ts:62,74-96` | `h1` names, nav `aria-label="Primary"` (uses `.first()` because two `<nav>` share the label, `AppShell.tsx:264,362`), all 8 sidebar link names, `Log out` button, `article` count = camera count, tile geometry (>300×180, video area >120 px tall, caption <120 px) (`live.spec.ts:72-96`). |
| Dashboard/events/article structure | `events.spec.ts:42,71,118,134-156`; `users.spec.ts:93`; `faces.spec.ts:133,241,383`; `notifications.spec.ts:31` | `region[name="Event list"]`, `article[name="Event details"]`, metadata labels (`Camera/Time/Duration/Type/Classification/Confidence/Notified`), links "View recording"/"Open details", `article` count on `/faces` = face cards (so no other `<article>` may be added there), `ul li article` row shape on notifications. |
| Labels used by filters | `events.spec.ts:31,55,63,79,90`; `faces.spec.ts`; `notifications.spec.ts` | `getByLabel("Date"/"Priority"/"Classification"/"Camera"/"Status"/"Assignment"/"Minimum confidence")`, buttons `Search`, `Person`, `Motion`, `All` (exact). **The dual date inputs in EventsView must keep "Selected day" vs "Date"** (`EventsView.tsx:290,388`). |
| Detection page test ids | `detection.spec.ts` (13 `getByTestId` ids) | `detection-enabled`, `person-confidence`, `vehicle-confidence`, `base-fps`, `detection-source`, `detection-save`, `detection-worker-status`, `detection-test-button`, `camera-N-enabled`, `camera-N-person(-global/-confidence)` — all produced by `DetectionSettings.tsx` / its local field components; renaming `CheckboxToggle`/`NumberField`/`ConfidenceField` is fine, changing ids is not. |
| Telegram status sentence | `telegram.spec.ts`; comment at `TelegramTestButton.tsx:17-19` | the exact `data-testid="telegram-status"` wording (`Telegram: / Enabled / Snapshot: On / Video: On (10s, 5s before) / FFmpeg: found`). |
| Playback class tokens (vitest, rendered markup) | `playback-layout.test.ts:29-95`; `playback-timeline.test.ts:91,115,162-163,183,188-202,234-241`; `date-picker-field.test.ts:31-70` | `md:aspect-auto`, `md:flex-1`, `md:min-h-0`, `flex min-w-0 flex-col md:min-h-0 md:flex-1`, `object-contain`, `mt-2 font-mono text-base`, `bg-black/50`, `bg-online`, `height:20px`, `role="slider"`, `aria-valuetext`, `aria-label="Timeline scale"`, `aria-pressed`, `shadow-[0_0_6px_rgba(62,224,199,0.8)]`, `cursor-pointer`; `PageIntro compact` tokens (`text-base font-semibold`, no `mb-4`). **Do not rewrite playback class strings without updating these tests.** |
| Login form contract | `login-security.test.ts:24-68` | `method="post"`, `action="/api/auth/login"`, no credentials in URL, hidden `name="next"`, `name="username"`, `name="password"` of `type="password"`. |
| Client boundary | `client-boundary.test.ts:19-45` | no `DVR_PASSWORD`/`APP_PASSWORD`/`SESSION_SECRET`/`rtsp://`/`NEXT_PUBLIC_` anywhere in `src/app` or `src/components`. |

### 4.2 Locks that look stronger than they are

- `camera-focus-mode.test.ts` and `camera-grid-layout.test.ts` assert their **own constant strings / a copied CSS literal**, not the components or `globals.css` (FE-27). They cannot detect a regression, and they now describe class strategies the code no longer uses (`.camera--focused` replaced the Tailwind focus classes). Treat focus mode and the camera grid as **code-locked only by `live.spec.ts` geometry assertions**, which do not run on mobile.
- Playwright is desktop-1920 only (explicit in `playwright.config.ts:9-10`), so **all mobile/tablet behaviour is untest-locked**: fixing FE-14/15/16 cannot break the suite, but also has no regression net. Any responsive fix should be validated by eye/DOM measurement, not assumed safe because tests pass.

### 4.3 Safe refactor envelope (consequence for planning)

- Safe without touching tests: FE-01, FE-02 (except rename cache function), FE-03 (visual change but not asserted), FE-04, FE-06, FE-07 as long as labels/ids stay, FE-09, FE-10, FE-11, FE-14/15/16 (CSS-only), FE-17 (labels must stay `Dashboard`, `Playback`, `Events`, `Faces`, `Notifications`, `Camera setup`, `Device`, `Settings`, `Log out`), FE-20, FE-21, FE-22, FE-23, FE-24, FE-25, FE-26.
- Requires test updates in the same change: FE-05 (`PageIntro` tokens), FE-08 if audit/users markup moves to tables and changes the `getByLabel`/`article` shape, FE-12 (if calendar classNames change), FE-13 (playback class strings), FE-18 if button names change.
- Do not touch: login form attributes, detection test ids, telegram status copy, the events inspector `aria-label`, the faces `article` count, nav labels/`aria-current`, and `events.spec`'s two date-field labels.

---

## 5. Score and priorities

### Score: **6.0 / 10**

The app is functionally sound and thoughtfully built for its niche: secure server/client boundary, no secret leakage, lazy-loaded `hls.js`, one global SSE with proper cleanup, reusable primitives for the common cases, honest empty/unknown states, and good comments on the non-obvious workarounds. It loses points for systematic duplication that a design-system restyle should have absorbed (16 KPI tiles, 4 filter panels, 4 paginations, 6 route lists, 7 camera-name fetches), for running two styling systems at once with the older one left dead in CSS, and for a breakpoint strategy that is contradictory at exactly 1024 px and wrong for the today column. Fixing the top five items would move this to ~8 without any architectural rewrite.

### Top 5 by impact ÷ effort

| # | Action | Addresses | Effort |
|---|---|---|---|
| 1 | Fix the 1024 px boundary (sidebar `hidden lg:flex` vs the CSS `max-width:1024` / `min-width:1025` pair; normalise 1023/1024/1025) and verify at 1023/1024/1025. | FE-15 (High) | ~10 lines, no tests affected |
| 2 | Make `.today-col` hidden below 1760 px and remove the duplicate bottom-space reservation (`main pb-28` vs `.content` 92 px). | FE-14, FE-16 (Medium, visibly weird on phones/tablets) | 2 CSS edits |
| 3 | Throttle the playback position report to ~1 Hz (or keep position state inside the timeline) and clear the interval on pause. | FE-20 (Medium, the only measured re-render hot spot) | ~10 lines in one file; class tokens untouched |
| 4 | Extract `ui/Stat.tsx` and use it in the four KPI screens; extract `ui/Pagination.tsx` and a `Field` wrapper for the four filter panels. | FE-01, FE-06, FE-07 (Medium, largest duplication by volume) | ~1 medium PR, no contract changes |
| 5 | Route all camera-name reads through `useCameraNames` + invalidate its cache after a successful rename. | FE-02 (Medium; also fixes stale names) | ~1 small PR |

Runner-up (cheap, high clarity): delete the 23 dead CSS selectors and resolve FE-12 by choosing one theming path for the calendar — it stops future work from being silently ineffective.

---

## 6. Limitations and what I could not verify

- **No mutating flows were run**, by instruction. Save/delete/notification paths were reviewed statically only; confirmation-dialog behaviour (e.g. `useEscapeToDismiss`) was not exercised in a browser.
- **DVR-dependent states** (offline/auth-failed/gateway-down banners, HLS-fallback playback, empty event days) were not forced. Findings about them are code-level.
- **The screenshot set** was re-captured by the Lead while I worked; I used only my own independent DOM measurements at `localhost:3000` for rendered claims (§2.3). I did not audit screenshot contents for visual regressions — that is the visual critic's scope.
- **Real device/SAFARI behaviour** (safe-area insets, `100dvh` collapse, touch hover) was not tested; only Chromium at fixed viewports.
- **Bundle-size claims** rely on the existing `.next` production build (BUILD_ID present) and content matching, not on a fresh build (builds are out of scope). I verified `hls.js` is in a separate 579 KB chunk; I did not measure gzip transfer sizes or Lighthouse metrics.
- **react-day-picker behaviour** was reasoned from its class-map construction (`node_modules/react-day-picker/dist/esm/DayPicker.js:113`) plus the component's overrides; I did not open the calendar in a browser to confirm the missing dot marker visually (the popover is closed by default and opening it is a UI interaction, albeit read-only).
- **Server-side/API performance** (DVR polling, MediaMTX) is out of scope; only client-side cadence was measured.
- I did not run the test suites (they target the live hub / require QA env); contract claims are read from the test sources.
