# Design consistency review — Home CCTV Hub ("Sentinel")

**Auditor:** Agent 4, independent Design Consistency Critic (read-only)
**Date:** 2026-11-04 · **Target:** running UI at `http://localhost:3000` (Next.js 16 / React 19 / Tailwind v4)
**Reference spec:** `design/DESIGN-SYSTEM.md` (v1, 2026-11-04)
**Scope:** all 17 routes + login, 4 viewports (1920×1080, 1440×900, 834×1112, 390×844)
**Deliverable:** this file only. No application, CSS, config, API, DB or test file was modified.

---

## 1. Scope & method

### 1.1 What was judged

Consistency of the **current, rendered UI** between screens — not the quality of any single
screen in isolation, and not a redesign proposal. The audit compares:

1. screen ↔ screen (same concept implemented differently), and
2. shipped UI ↔ `design/DESIGN-SYSTEM.md` (drift in either direction).

Routes: `/login`, `/`, `/playback`, `/events`, `/events/[id]`, `/events/stats`, `/faces`,
`/notifications`, `/cameras`, `/device`, `/account`, `/settings`, `/settings/users`,
`/settings/notifications`, `/settings/detection`, `/settings/audit-log`, `/settings/system`.

### 1.2 Method

1. **Visual walkthrough** of the delivered capture set (desktop + laptop primary; tablet +
   mobile for responsive patterns; interaction states for sheets/focus mode).
2. **DOM measurement cross-check** using `audit/screenshots/capture-metrics.json`
   (68 route×viewport entries; every route HTTP 200, zero console/page errors, zero
   horizontal overflow). Used for h1 size/count, heading sizes, font-size histograms,
   card/table/article counts, tap-target counts, visible nav, and the app-bar clock string.
3. **Source read** of `src/app/globals.css`, `src/components/**`, `src/app/**/page.tsx` to
   locate the mechanism behind each visible divergence and to cite exact `file:line`.
4. **Spec comparison** against every normative statement in `design/DESIGN-SYSTEM.md`
   (tokens, type, controls, navigation, components, screen patterns, a11y contract,
   implementation mapping).

### 1.3 Evidence inventory

| Evidence | Location | Used for |
|---|---|---|
| Viewport shots, 17 routes × 4 viewports (68) | `audit/screenshots/{desktop,laptop,tablet,mobile}/*.png` | visual matrix, header/action/surface comparisons |
| Full-page shots (68) | `audit/screenshots/full-page/<viewport>/*-full.png` | pagination/footer/save-bar placement |
| Interaction states (7) | `audit/screenshots/states/` — `dashboard-focus-{desktop,mobile}.png`, `events-mobile-{list,filters,inspector}.png`, `mobile-more-sheet.png`, `settings-detection-mobile.png` | mobile patterns, focus mode, sheets |
| DOM metrics (68 entries) | `audit/screenshots/capture-metrics.json` | typography, counts, tap targets, overflow, clock text |
| Source | `src/app/globals.css`, `src/components/**` | `file:line` mechanism evidence |
| Spec | `design/DESIGN-SYSTEM.md` | drift table |

Notes on evidence hygiene: the floating circular **"N"** bottom-left in dev screenshots is the
Next.js dev indicator, **not app UI**, and is ignored throughout. The first `event-detail`
capture was a 404 (invalid event id) and was re-captured correctly by the Lead; this review
uses the final capture. `capture-metrics.json` counts `primaryNavs: 2` on every hub route;
this is the DOM duplicate (desktop sidebar + `display:none` mobile bar) that the spec
explicitly permits — not a violation.

### 1.4 What "intentional variation" means here

Three kinds of difference were deliberately **not** counted as defects:

- **Live-tile / playback geometry** — the dashboard live wall, focus mode, playback stage,
  and timeline geometry are explicitly constrained by `DESIGN-SYSTEM.md` §9.4 and the
  test-asserted `PageIntro`/camera-tile invariants (`design/DESIGN-SYSTEM.md` §10).
- **Admin-only density** — `/settings/*` sub-pages legitimately use denser tables, kv grids
  and a 200 px sub-nav; the offset they create is documented in §5.3 and is treated as a
  variant, not an inconsistency (except where width/padding diverges from other admin pages).
- **Chrome-free surfaces** — `/login`, `/not-found`, `/error` intentionally do not use the
  app shell; their differences are judged only against each other and the page-header pattern.

---

## 2. Consistency matrix

Legend: **✔** consistent across the screens that use the concept · **◐** variant (defensible,
constrained, or minor) · **✖** inconsistent with at least one other screen · **–** concept
absent.

Screenshot refs are under `audit/screenshots/` (e.g. `desktop/events.png`); state refs under
`audit/screenshots/states/`.

### 2.1 Matrix A — operator / investigation screens

Columns: **D** Dashboard · **PB** Playback · **EV** Events · **ED** Event detail · **ES** Event
statistics · **FA** Faces · **NO** Notifications · **LG** Login.

| Concept | D | PB | EV | ED | ES | FA | NO | LG |
|---|---|---|---|---|---|---|---|---|
| Page header (`PageHeader`: eyebrow + h1 + sub + actions) | ✔ | ✖ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ |
| Page-head action slot (presence, emphasis) | ✔ | – | ◐ | ✔ | ◐ | ◐ | ✖ | ◐ |
| Surface language (`.card` / `.card__head` / `.card__foot`) | ✔ | ✖ | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ |
| Section / card headings (`h2`, `.card__title`, `.section__title`) | ✔ | ◐ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| KPI / stat block (`.stat`) | ✔ | – | – | – | ✔ | ✔ | ✔ | – |
| Collection layout (table vs stacked list vs cards) | ◐ | ◐ | ✔ | ◐ | ◐ | ◐ | ◐ | – |
| Badges / pills / chips vocabulary | ✔ | – | ✔ | ✔ | ✔ | ✔ | ◐ | ◐ |
| Priority & status colour encoding | ✖ | – | ✖ | ✖ | ◐ | – | ✖ | – |
| Empty state (`.empty`: icon + title + explanation) | ◐ | ✖ | ✔ | – | ✖ | ✔ | ✔ | – |
| Notice / error surface | ✔ | ◐ | ✔ | ◐ | ✔ | ✔ | ✔ | ◐ |
| Loading treatment (skeleton vs "Loading…" text) | ✔ | ◐ | ✔ | ◐ | ✔ | ✔ | ✔ | – |
| Pagination controls & labels | – | – | ✖ | – | – | ✖ | ✖ | – |
| Date display format | ◐ | ✖ | ◐ | ✔ | ✔ | ✔ | ◐ | – |
| Time format (12 h vs 24 h) | ◐ | ✖ | ✖ | ◐ | ◐ | ◐ | ◐ | – |
| Filter panel pattern + submit label | – | ✖ | ✖ | – | – | ✖ | ✖ | – |
| Back/breadcrumb affordance | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ✔ | – |
| Mobile-specific pattern (collapse, sheet, stacking) | ✔ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ | ✔ |
| Content width / page padding | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |

### 2.2 Matrix B — configuration / administration screens

Columns: **CA** Camera setup · **DE** Device · **AC** Account · **SE** Settings overview ·
**US** Users · **NR** Notification rules · **OB** Object detection · **AU** Audit log ·
**SY** System.

| Concept | CA | DE | AC | SE | US | NR | OB | AU | SY |
|---|---|---|---|---|---|---|---|---|---|
| Page header (`PageHeader`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Page-head action slot (presence, emphasis) | ◐ | – | – | ◐ | ◐ | ✔ | ◐ | ◐ | ◐ |
| Surface language (`.card` / `.card__head` / `.card__foot`) | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Section / card headings | ◐ | ◐ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| KPI / stat block (`.stat` or equivalent) | ◐ | – | – | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Collection layout (table vs stacked list vs cards) | ◐ | ◐ | ◐ | ◐ | ✖ | ◐ | ✔ | ✖ | ✔ |
| Badges / pills / chips vocabulary | ✔ | ✔ | ◐ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Priority & status colour encoding | ◐ | ◐ | ◐ | ✔ | ◐ | ✖ | ◐ | ◐ | ◐ |
| Empty state (`.empty`) | ◐ | ◐ | ✖ | – | – | ✔ | ✖ | ✔ | ✖ |
| Notice / error surface | ✔ | ✔ | ◐ | ✔ | ◐ | ◐ | ◐ | ◐ | ◐ |
| Loading treatment | ◐ | ◐ | – | ✔ | ✔ | ◐ | ◐ | ◐ | ◐ |
| Pagination controls & labels | – | – | – | – | – | – | – | ✖ | – |
| Date display format | – | ✖ | ✖ | – | – | – | – | ✔ | ✔ |
| Time format (12 h vs 24 h) | ◐ | ◐ | ✖ | – | – | ✖ | – | ◐ | ◐ |
| Filter panel pattern + submit label | – | – | – | – | – | – | – | ✖ | – |
| Back/breadcrumb affordance | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ |
| Mobile-specific pattern | ✔ | ✔ | ✔ | ✔ | ✔ | ✔ | ◐ | ✔ | ✔ |
| Content width / page padding | ✖ | ✖ | ✖ | ◐ | ◐ | ◐ | ◐ | ◐ | ◐ |

### 2.3 Matrix reading notes (where the ✖ come from)

- **Page header / actions:** `/playback` is the only **hub** route without `PageHeader` (login is
  chrome-free by design and carries its own display headline)
  (`src/components/playback/PlaybackView.tsx:254` uses `PageIntro compact`,
  `src/components/ui/States.tsx:83-89`, measured h1 **16 px/600** vs **24 px/650** everywhere
  else). Header action slots range from three controls (Dashboard) to none
  (Notifications, Device, Account), with a hidden-below-640 action on Events
  (`EventsView.tsx:267`, `btn hidden sm:inline-flex`) that disappears on phones even though the
  destination remains reachable from the Dashboard rail.
- **Surfaces:** `/playback` contains **0** `.card` elements (`capture-metrics.json`) and is
  built from raw Tailwind/hex utilities; every other page is card-based.
- **Collections:** only `/settings/system` and `/settings/detection` use `.table`
  (metrics `tables: 2` and `1`); `/settings/users` and `/settings/audit-log` are custom
  `<ul>/<li>` rows; Events/Notifications/Faces use three different list/card idioms.
- **Priority & status colour:** HIGH is red (`badge--danger`) on D/EV/ED/NO but amber
  (`badge--warn`) in Notification rules; see CON-04.
- **Pagination:** Events, Faces, Notifications and Audit log use three different patterns
  (CON-08).
- **Date/time:** see CON-02 and CON-03.
- **Empty/loading/error:** see CON-10, CON-11, CON-12.
- **Content width:** `/cameras` 1240 px, `/device` 1000 px, `/account` 880 px centred inline;
  Dashboard/Events/Faces/Notifications/etc. are full-bleed (CON-06).

---

## 3. Findings

Severity = operator impact of the inconsistency, not aesthetic preference. Every row cites at
least two screens or one screen plus a code location.

| ID | Severity | Screens / components (`file:line`) | Inconsistency | Evidence | Recommendation |
|---|---|---|---|---|---|
| **CON-01** | **High** | All 17 routes: app-bar clock `src/components/layout/AppShell.tsx:92` (`hour12: true`) vs 24 h content elsewhere | The hub clock is 12-hour with lowercase am/pm (`05:41:10 pm`) on every screen, while the documented convention (and most content times) is 24-hour | `desktop/dashboard.png`, `desktop/events.png`, `mobile/settings.png` (clock `05:41:59 pm`); `capture-metrics.json` `clockText` = `05:40:32 pm`… on all 68 entries; spec §3 line 94 (“24-hour, Asia/Kolkata, 13:54:19”) | Render `formatKolkataClock`-based 24 h in `Clock`; keep seconds; drop the am/pm suffix |
| **CON-02** | **High** | Dashboard, Playback, Events, Faces, Account, Device, Audit log, System | One date is rendered in several incompatible formats: `WED, 04 NOV, 2026` (app bar), `04 Nov 2026` (event detail/faces), `TODAY · 04 NOV 2026` (Events day group), `04 Nov 2026, 17:40:30` (audit/system), `11/4/2026, 5:40:30 PM` (Account), `2026-11-04T17:41:30+05:30` (Device), `2026-11-04` (Playback date field) | `desktop/dashboard.png`, `desktop/account.png`, `desktop/device.png`, `desktop/playback.png`, `desktop/events.png`; `AccountView.tsx:21-24` (`toLocaleString()`), `DeviceView.tsx:38` (raw `currentDeviceTime`), `DatePickerField.tsx:99-101` (raw ISO in the field), `AppShell.tsx:94-96` | Single date formatter set (`formatKolkataDate`, `formatKolkataDateTime`); format device time and the playback date-button label through it |
| **CON-03** | **High** | Playback, Events, Notification rules, System, Account | 12 h and 24 h are mixed **inside the same screens**: Playback `From 12:00 AM / To 11:59 PM` beside `16:58:50` and timeline `00:00…20:00`; Events rows `17:39` beside native time inputs `12:00 AM`; Notification rules `Quiet hours 23:00–07:00` beside test-time `11:30 PM`; System pill `checked 17:42:10` beside clock `05:42:11 pm`; Account `5:40:30 PM` | `desktop/playback.png`, `mobile/playback.png`, `desktop/events.png`, `desktop/settings-notifications.png`, `desktop/settings-system.png`, `desktop/account.png`; `PlaybackFilters.tsx:86-104`, `EventsView.tsx:415-436`, `NotificationRules.tsx` time input, `AppShell.tsx:92` | Normalise inputs and readouts to 24 h (`type="time"` renders per locale; add a 24 h wrapper or a formatted text field consistent with `formatKolkataClock`) |
| **CON-04** | **High** | Events, Dashboard rail, Event detail, Notifications inspector, Notification rules | Same priority label, two colours: HIGH = red `badge--danger` in `PriorityBadge.tsx:9-13` (Events/Dashboard/Event detail/Notifications) but HIGH = amber `badge--warn` in `NotificationRules.tsx:86` (`PriorityFloorBadge`). Spec §2.3 assigns HIGH→warn amber, CRITICAL→danger red | `desktop/events.png` (red “High” badges), `desktop/settings-notifications.png` (amber floor badge when set), `desktop/event-detail.png` (red “High” twice); spec `DESIGN-SYSTEM.md` §2.3 lines 64-70 | One shared priority→tone map used by both components: CRITICAL danger, HIGH warn, NORMAL/LOW neutral |
| **CON-05** | **Medium** | Playback vs all other routes (`PlaybackView.tsx:254-258`, `States.tsx:83-89`) | Playback has no eyebrow, no 24 px h1, no header actions — its title is a 16 px/600 `PageIntro compact`. It is the only hub route whose h1 does not match the page-header role | `desktop/playback.png`, `mobile/playback.png` vs `desktop/events.png`, `desktop/faces.png`; metrics: playback h1 `16/600`, every other h1 `24/650` desktop / `20/650` mobile | Keep playback internals unchanged (test-constrained), but wrap the title in `.page-head` typography in `PlaybackView` (no geometry change) or document the exception in the design system |
| **CON-06** | **Medium** | Camera setup, Device, Account vs Dashboard/Events/Faces/Settings (`CamerasView.tsx:108`, `DeviceView.tsx:43`, `AccountView.tsx:125`, `globals.css:239`) | Card pages have three hard-coded max widths (1240 / 1000 / 880 px, centred inline) while the rest of the hub is full-bleed; the documented `.page` container class exists but is unused (no `className="page"` anywhere). Result: the h1 left edge moves from 256 px (Dashboard) to 458 px (Cameras), 575 px (Device) and 646 px (Account) on a 1920 px viewport | `desktop/cameras.png` (h1 x≈458), `desktop/device.png` (≈575), `desktop/account.png` (≈646) vs `desktop/dashboard.png` (≈255); `grep 'className="page'` = 0 hits; `globals.css:239` `--page-max` used by nothing | Apply one content container (`.page`, max-width + 24 px padding) to all hub routes; keep narrower reading columns only for forms and document it once |
| **CON-07** | **Medium** | Events, Faces, Notifications, Audit log (`EventsView.tsx:337-466`, `FacesView.tsx:293-306`, `NotificationsView.tsx:195-205`, `audit-log/page.tsx:90-122`) | Four filter panels, four conventions: submit label `Search` / `Apply filters` / `Apply filters` / `Filter`; icon `search` / `scan` / `filter` / `filter`; clear action conditional / always / always / none; hint right-aligned / right-aligned / dynamic / inline after button. On phones, Events collapses behind a “Filters” button (`hidden lg:block`) while Faces and Notifications render the entire 4-field panel expanded above the results | `desktop/events.png`, `desktop/faces.png`, `desktop/notifications.png`, `desktop/settings-audit.png`, `mobile/events.png` vs `mobile/faces.png`, `mobile/notifications.png`; code lines above | One filter-panel primitive: label “Apply filters”, always-visible “Clear filters”, one hint slot, and one collapse rule below 1024 px |
| **CON-08** | **Medium** | Events, Faces, Notifications, Audit log (`EventsView.tsx:583-605`, `FacesView.tsx:398-425`, `NotificationsView.tsx:248-270`, `audit-log/page.tsx:200-224`) | Three pagination idioms: Events = “Previous / Page X of Y / Next” buttons; Faces & Notifications = icon-only chevrons + “Page X of Y · 24 per page” + “N total”; Audit = “Showing a–b of N entries” + Previous/Next + `Page X of Y` badge inside the card foot. Placement (below list vs card foot) also differs | `full-page/desktop/events-full.png`, `full-page/desktop/faces-full.png`, `full-page/desktop/notifications-full.png`, `full-page/desktop/settings-audit-full.png` | Extract one `.pagination` pattern (count text + page indicator + prev/next) and apply to all four lists |
| **CON-09** | **Medium** | Users, Audit log, System vs Detection (`UsersView.tsx:182-235`, `audit-log/page.tsx:176-199`, `system/page.tsx:296-340`, `DetectionSettings.tsx:475-520`) | Record collections with columns are tables on some admin pages and custom lists on others: MediaMTX paths and camera monitoring are `.table`; Users and Audit log are hand-built `<ul>/<li>` rows (different paddings 12/16 vs 10/14, different column alignment). The spec says settings sub-pages use dense tables and that the Table primitive is the record pattern | `desktop/settings-system.png` (table + nested sessions table), `desktop/settings-users.png` (list rows), `desktop/settings-audit.png` (list rows); metrics: tables only on system(2) + detection(1) | Use `.table .table--stack` for users, audit log and active sessions; reserve cards for rule/face/camera media cards |
| **CON-10** | **Medium** | Account, Event statistics, System, Dashboard rail, Playback calendar, Object detection vs Events/Faces/Notifications/Users(rules)/Audit | Empty states are half componentised: `EmptyState` (icon + title + detail, dashed `.empty`) is used on 5 screens, but six other lists still show bare sentences: “No active sessions found.” (`AccountView.tsx:265`), “No events in this period.” (`EventStatsView.tsx:181`), “No status available.” (`system/page.tsx:167`), “No important events today.” (`RecentEvents.tsx:69-73`), “No recordings available for this month.” (`PlaybackCalendar.tsx:134`), “No person or vehicle above the detector floor.” (`DetectionSettings.tsx:896`) | `desktop/account.png`, `desktop/events-stats.png`, `desktop/settings-system.png`, `desktop/dashboard.png`; spec §6 line 155 (“never a bare sentence”) | Reuse `EmptyState` in those six places (title + explanation + optional action) |
| **CON-11** | **Medium** | 8 screens use `ErrorBanner`; Audit log, System, Users, Account, Notification rules, Object detection use bare `notice--danger`; login/playback use other forms | Two error surfaces and two retry labels for the same failure: `ErrorBanner` card with “Try again” (`States.tsx:13-31`) vs inline `notice--danger` with “Retry” (`audit-log/page.tsx:136-143`, `system/page.tsx:158-165`). Playback shows errors as un-styled `<p class="text-sm text-warn">` (`PlaybackView.tsx:279-281`) | `desktop/settings-audit.png`, `desktop/settings-system.png`, `desktop/dashboard.png`, `desktop/playback.png`; code lines above | One error component with one retry label (“Retry”), used everywhere; delete the ad-hoc `<p>` error path |
| **CON-12** | **Low** | Settings sub-pages vs operator pages (`audit-log/page.tsx:133`, `system/page.tsx:156`, `DetectionSettings.tsx:341`, `NotificationRules.tsx:257`, `events/page.tsx:9`, `notifications/page.tsx:9`) | Loading is skeleton-based on Dashboard/Faces/EventStats/Users/Settings/Events/Notifications, but text-only on Audit (“Loading audit log...”), System (“Loading system status...”), Detection (“Loading detection settings…”), Rules (“Loading rules…”) and Suspense fallbacks. Ellipsis style also alternates `...` / `…` | `full-page/desktop/settings-audit-full.png`, `desktop/settings-system.png`, `desktop/settings-detection.png`; spec §6 line 156 (“replaces ‘Loading…’ where shape is known”) | Use `SkeletonRows` / placeholder cards on the four admin sub-pages; standardise the ellipsis character |
| **CON-13** | **Medium** | Camera setup, Users, Account, Object detection, Notification rules | Five save/feedback patterns for the same “save settings” operation: per-card inline Save with a `field__hint` sentence (`CamerasView.tsx:253-300`, buttons forced to `height:38`), full-width primary inside the Create user card (`UsersView.tsx:373`), inline primary + `notice--accent` (`AccountView.tsx`), the only sticky save bar in the product (`DetectionSettings.tsx:948-984`), and rule-editor save + top notice (`NotificationRules.tsx:139`). Success feedback is sometimes `role="status"` notice, sometimes inline hint, sometimes only a dot+label in the sticky bar | `desktop/cameras.png`, `desktop/settings-users.png`, `desktop/account.png`, `desktop/settings-detection.png`, `mobile/settings-detection.png`, `states/settings-detection-mobile.png` | Define two documented save patterns: sticky save bar for multi-field settings pages (Detection, Notification rules) and inline save for single-field rows (Cameras); one success announcement style |
| **CON-14** | **Medium** | Dashboard, Settings, Faces, Notification rules, Object detection → `/settings/system`; Dashboard + Events → `/events/stats` | The same destination is labelled five different ways: **System** (`SettingsNav.tsx:24`, `SettingsView.tsx:47`, `DetectionSettings.tsx:373`, System page h1), **System health** (`SettingsView.tsx:96-99`, `FacesView.tsx:155-157`, `DashboardView.tsx:305-307`), **Open diagnostics** (`SettingsView.tsx:193-195`), **Worker health** (`DetectionSettings.tsx:938-941`); `/events/stats` is **Statistics** (`EventsView.tsx:267`, `RecentEvents.tsx:52-56`), **All statistics** (`DashboardView.tsx:259-261`) and **Event statistics** (h1) | `desktop/dashboard.png` (“System health” link + “Statistics” link), `desktop/settings.png` (“System health” button + “Open diagnostics” link), `desktop/settings-detection.png` (“System” button), `desktop/faces.png` (“System health”), `desktop/events.png` (“Statistics”) | One label per destination (“System health”, “Event statistics”); the nav item may keep “System” but page links should match the target title |
| **CON-15** | **Medium** | App shell + Device + Cameras + Settings (`AppShell.tsx:22-42`, `:55-64`, `DeviceView.tsx:44`) | Three navigation taxonomies disagree: sidebar groups **Monitor / Security / System**; app-bar breadcrumb sections **Monitor / Investigate / Configure / Account / Administration**; page eyebrows **Live monitoring / Investigate / Configure / System / Administration / Account**. Device is the sharpest conflict: breadcrumb says “Configure”, eyebrow says “System”, sidebar group says “System” | `desktop/device.png` (breadcrumb `Home CCTV / Configure`, eyebrow `SYSTEM`), `desktop/cameras.png` (breadcrumb `Configure`, eyebrow `CONFIGURE`), `desktop/settings.png` (breadcrumb `Administration`, sidebar group `System`) | One taxonomy map: nav group → breadcrumb section → eyebrow for each route, generated from one table |
| **CON-16** | **Medium** | Dashboard, Settings, System, Cameras, Device, Users, Audit log, Faces (`StatusLamp.tsx`; `.status`/`.pill`/`.badge` call sites) | Status is rendered five ways for the same underlying state: `StatusLamp` (only 6 call sites, `CamerasView`/`DeviceView`/`CameraTile`), hand-built `.status` + dot (Dashboard, Users, Audit, System, Detection), `.pill` + dot (app bar, Dashboard, Faces, Settings, Users, Audit), status `.badge` with a word (Settings cards, System cards, Camera cards), and unicode-glyph badges (`✓ Sent`, `⊘ Suppressed` in `NotificationsView.tsx:287-290`). The same DVR state reads **Online** (sidebar), **Connected** (Settings/Cameras), **ok** (System), **Connected · the hub answered this request** (Settings) | `desktop/dashboard.png` (pill + sidebar SYSTEM rows), `desktop/settings.png` (health badges), `desktop/settings-system.png` (`ok`/`connected`), `desktop/notifications.png` (glyph badges), `desktop/cameras.png` (StatusLamp) | Use `StatusLamp` / one `.status` renderer everywhere; keep one wording vocabulary per state (Online/Connected/…); replace unicode glyphs with the icon set |
| **CON-17** | **Low** | Dashboard rail, Events list, Events inspector (`RecentEvents.tsx:85`, `EventsView.tsx:552`, `EventsView.tsx:678`) | “Unread” is expressed three ways: nav badge count (`AppShell.tsx:279` + `globals.css:183-188`, teal pill, `99+`), event-row **New** chip (`chip--teal`), inspector **Unread** badge (`badge--info`, blue). Same concept, three colours/words | `desktop/dashboard.png` (nav 99+), `desktop/events.png` (“New” chips + “Unread” badge on the inspector), `states/events-mobile-inspector.png` (“High” + “Unread”) | Pick one word (“Unread”) and one tone; the count badge may stay a count but should share the tone |
| **CON-18** | **Medium** | Object detection vs Notification rules (`DetectionSettings.tsx:123`, `:537`, `:567` vs `NotificationRules.tsx:277-281`, `:666`) | The same boolean “enable this” role is a custom 15 px square checkbox in Detection (master switch, per-camera detection) and a 34×20 `.switch` in Notification rules — and inside Notification rules the rule list uses `.switch` while the rule editor uses a raw `<input type="checkbox">` for the same `enabled` field | `desktop/settings-detection.png` (checkbox next to “Stopped”), `desktop/settings-notifications.png` (switch + Enabled), `mobile/settings-detection.png`; code lines above; spec §6 Switch 34×20 | Use the `Switch` primitive for every single on/off setting; keep checkboxes only for multi-select lists |
| **CON-19** | **Medium** | Events page (`EventsView.tsx:270-300` vs `:380-392`; `desktop/events.png`, `mobile/events.png`) | The Events page has **two date controls bound to the same state**: the day navigator (auto-applies on change) and the Date field inside the Filters panel (requires Search). A user can change the date in one place and see the other silently change, with two different commit semantics on the same screen; the toolbar also adds a “Today” button | `desktop/events.png` (two `04/11/2026` fields), `mobile/events.png` (navigator only until Filters is expanded), `states/events-mobile-filters.png` | Keep one date control (day navigator) and remove the duplicate from the filters panel, or make both explicit with the same commit button |
| **CON-20** | **Medium** | Mobile bottom bar on every route (`AppShell.tsx:33`, `:47-52`) | The mobile bar label for `/notifications` is **Alerts**, while the desktop label, the page H1 and the More sheet say Notifications. The spec requires “labels unchanged” and “mobile keeps the same accessible labels”. (Dashboard shortens to “Dashboard” but keeps the word; Notifications is a rename) | `mobile/dashboard.png`, `mobile/notifications.png`, `desktop/dashboard.png`; spec §5.2 line 126 | Use “Notifications” in the mobile bar (or an explicit approved short label applied consistently to both navs) |
| **CON-21** | **Medium** | Faces, Notifications vs Events/Event detail; `.btn`/`.icon-btn` on mobile (`FaceCard.tsx:74` “View event”, `NotificationsView.tsx:336` “Open event”, `EventsView.tsx:726-734` “Open details”, `globals.css:258-282`, `mobile/*`) | Action affordances for “go to the event” are a 17 px-tall text link on Faces, an 18 px-tall text link on Notifications, a full-row button on Events and a `btn` on Event detail; their tap targets are far below the 44 px mobile rule (metrics: 24/25 sub-24 px targets on Faces/Notifications at every viewport). Separately, `.btn` stays 36 px and `.icon-btn` 34 px on phones (no mobile override) although the spec asks ≥44 px mobile primary targets (mobile Dashboard: 14 of 28 targets < 44 px) | `mobile/faces.png`, `mobile/notifications.png`, `mobile/events.png`; `capture-metrics.json` (`targetsUnder24` 24/25, `targetsUnder44` counts); spec §4 line 103, §8 line 185 | Make cross-screen actions the same control (`btn btn--sm` / row button) and give text links ≥24 px hit area (padding), with 44 px primary controls on mobile |
| **CON-22** | **Low** | Global typography (`globals.css:539, 587, 598, 916, 321, 624`; measured `fontHistogram`) | Spec-vs-shipped type drift that shows up between screens: 9 px text is still shipped (camera prop labels, kv-grid `dt`, settings-nav group label, stacked-table labels) although the minimum metadata size is 11 px; card titles are 13 px (`H2` spec 16 px) while cam-card and inspector titles are 16 px; login display renders up to 46 px (spec 28 px) | `desktop/cameras.png` (9 px PREVIEW/CHANNEL props), `desktop/settings.png` (9 px SETTINGS label), metrics `fontHistogram` 9 px = 136 chars on Cameras, 110 on Device, 70–78 on Settings; spec §3 lines 81-93 | Raise the four 9 px rules to 11 px; either adopt 16 px card titles or amend the spec; pin login display to the documented size |
| **CON-23** | **Low** | Playback (`PlaybackFilters.tsx:69-110`, `PlaybackControls.tsx:21-45`, `DatePickerField.tsx:99-120`, `PlaybackTimeline.tsx:310`) | Playback bypasses the component layer: 44 px controls (`h-11`) vs 36/38 px elsewhere, sentence-case labels instead of `.field__label`, and a hard-coded accent-ink hex `text-[#08110f]` (plus a raw calendar SVG with 2 px stroke vs the 1.7 px icon set). Visually it reads as a different product from Events/Faces filters. (Partly constrained: playback internals are declared out of scope for restyling) | `desktop/playback.png`, `mobile/playback.png` vs `desktop/events.png`, `desktop/faces.png`; spec §9.1 line 195 (“Remove hard-coded hex from components”) | At minimum replace the hex with `var(--accent-ink)` / `.btn` tokens and align the label style; a full control swap can follow the playback constraint review |
| **CON-24** | **Low** | Login, not-found, error (`login/page.tsx:53-59` + `:108-114`, `not-found.tsx:6-13`, `error.tsx:13-25`) | Chrome-free pages use ad-hoc type and hand-drawn SVGs: `not-found`/`error` h1 is Tailwind `text-xl` (20 px) instead of the 24 px page-title role, `error.tsx` hand-rolls a 24 px-grid triangle instead of `<Icon name="alert">`, and login repeats the full “Home CCTV / Local hub” lockup twice on one screen (brand panel + form panel) | `desktop/login.png` (visible duplication and eyebrow outside `PageHeader`) plus the `not-found.tsx`/`error.tsx` source above; the error screens were only transiently captured during evidence collection, so they are judged from code and the same chrome-free login pattern | Use `PageHeader` typography classes, `Icon` for the alert glyph, and keep the brand lockup once on the login screen |
| **CON-25** | **Low** | Mobile Events vs desktop/tablet Events, and Dashboard rail (`EventsView.tsx:267-273`; `RecentEvents.tsx:52-56`, `DashboardView.tsx:259-261`) | The Events page's own Statistics action is a `btn hidden sm:inline-flex`, so it disappears on phones even though the same destination keeps actions (and is reachable) elsewhere on mobile via the Dashboard rail. The page-level action is therefore inconsistently available across viewports and screens | `mobile/events.png` (no Statistics action) vs `desktop/events.png`, `tablet/events.png` (Statistics visible); `full-page/mobile/dashboard-full.png` (rail “Statistics” / “All statistics” links) | Keep the page action visible on phones (icon button) rather than forcing a detour via the Dashboard |

**Non-findings (checked and deliberately not raised):** the duplicate “Enable notifications” button
in the app bar and on `/settings/notifications` is required by spec §5.1 + §7.5; the dashboard’s
4-across stat strip and camera tiles are spec-mandated; the settings two-pane offset is spec §5.3;
the same `<article aria-label="Event details">` re-used as mobile bottom sheet is spec/intent; the
`primaryNavs: 2` DOM count is the allowed hidden duplicate.

---

## 4. Spec-vs-shipped drift

“Spec → shipped” = the spec promises it but the UI does not do it. “Shipped → spec” = the UI does
something the spec does not describe or explicitly excludes.

| DESIGN-SYSTEM.md section | Spec | Shipped | Where | Direction |
|---|---|---|---|---|
| §2.3 Priority table (lines 60-70) | HIGH = warn amber, CRITICAL = danger red; red never means alarm recording | HIGH = danger red almost everywhere; amber in Notification rules only | `PriorityBadge.tsx:9-13` vs `NotificationRules.tsx:86`; Events/Dashboard/Event detail/Notifications screenshots | spec → shipped (and internally split) |
| §3 Time format (line 94) | 24-hour `13:54:19`, no raw ISO, no raw seconds | App-bar clock 12 h `05:40:32 pm`; playback date field ISO `2026-11-04`; device time ISO `2026-11-04T17:41:30+05:30`; system warning “1198553 seconds”; durations “7 seconds” | `AppShell.tsx:92`, `DatePickerField.tsx:99-101`, `DeviceView.tsx:38`, `settings-system.png` notice, `EventsView`/event detail duration | spec → shipped |
| §3 Date format (line 94) | `04 Nov 2026` | 5+ formats incl. `WED, 04 NOV, 2026`, `TODAY · 04 NOV 2026`, `11/4/2026`, ISO | CON-02 evidence | spec → shipped |
| §3 Minimum text size (line 92) | 11 px metadata, 13 px interactive | 9 px shipped in camera props, kv-grid labels, settings-nav group label, stacked-table labels | `globals.css:539, 587, 598, 916`; `fontHistogram` 9 px on Cameras/Device/Settings | spec → shipped |
| §3 H2 (line 85) | 16 px / 650 for inspector & card title | `.card__title` is 13 px / 650; only cam-card and inspector h2 are 16 px | `globals.css:321`; metrics headings | spec → shipped |
| §3 Display (line 83) | 28 px login headline | `clamp(28px, 3.4vw, 46px)` → 46 px at 1920 | `globals.css:624`; `desktop/login.png` | shipped → spec (spec now ambiguous for wide screens) |
| §4 Control heights (line 103) | 38 px default, 34 px icon, mobile primary ≥44 px | `.btn` 36 px, `.icon-btn` 34 px on mobile too; playback uses 44 px; cameras locally force 38 px | `globals.css:258-282`, `PlaybackFilters.tsx`, `CamerasView.tsx:253-266`; metrics `targetsUnder44` | spec → shipped |
| §5.1 Layout (line 111) | content max-width 1760 px, 24 px padding, one page container | `.page` class exists but is unused; width is per-page inline (880/1000/1240) or full-bleed | `globals.css:239` (unused), `AccountView.tsx:125`, `DeviceView.tsx:43`, `CamerasView.tsx:108` | shipped → spec |
| §5.2 Nav labels (lines 118-126) | exact eight labels; mobile keeps the same accessible labels | Mobile bar uses “Alerts” for Notifications, “More” as 5th item (More is allowed) | `AppShell.tsx:33`, `mobile/*.png` | spec → shipped |
| §5.2 Active state (line 125) | teal wash + 2 px left accent bar | Primary nav has the 2 px bar; settings sub-nav active state has wash only | `globals.css:177-182` vs `:585-586`; `desktop/settings.png` | shipped → spec (settings nav variant) |
| §6 Empty state (line 155) | icon + title + explanation, dashed container, never a bare sentence | `EmptyState` on 5 screens; 6 bare-sentence empties | CON-10 | spec → shipped |
| §6 Skeleton (line 156) | replaces “Loading…” where shape is known | text-only loading on 4 admin sub-pages + Suspense fallbacks | CON-12 | spec → shipped |
| §6 Page header (line 158) | eyebrow + h1 + sub + actions, one h1/page | Playback uses compact `PageIntro` (h1 16 px, no eyebrow/actions) | `PlaybackView.tsx:254`, `States.tsx:83`; metrics | spec → shipped (documented exception needed) |
| §6 Table (line 149) | dense table, 10 px uppercase header, 44 px row, stacked on mobile | only System + Detection use `.table`; Users/Audit/Sessions are custom lists | CON-09 | partial → shipped |
| §6 Dialog/sheet (line 157) | `role="alertdialog"`, focus management, Escape | delete confirmations rendered inline (Users uses `notice--danger`, Notification rules uses `card card--pad`) with no shared dialog component | `UsersView.tsx:285-310`, `NotificationRules.tsx:335-350` | shipped → spec (no dialog primitive) |
| §7.1 Dashboard (line 167) | 4-stat strip, 2×2 live wall, rail; extra “Today by camera” column on ultra-wide | matches (Today-by-camera appears ≥1760 px) | `desktop/dashboard.png` (1920 shows it), `laptop/dashboard.png` (1440 hides it) | ✔ |
| §7.5 Notification rules (line 171) | action bar + rules + retention + tester; right editor; Telegram status | matches, but header duplicates the app-bar “Enable notifications” (spec-required) and the editor idle state is prose, not an empty state | `desktop/settings-notifications.png` | ✔ / minor |
| §8 A11y (lines 180-189) | focus visible, skip link, one Primary nav, role=status/alert | skip link + one visible Primary nav + roles present; tap targets below 44 px on mobile; 9 px text is below the readable floor | `capture-metrics.json` (`skipLink: true`, `targetsUnder44`), CON-21/22 | spec → shipped |
| §9.1 Implementation (line 195) | component classes in `globals.css`, remove hard-coded hex | 243 inline `style={{}}` objects, 10 hard-coded hex colours in TSX (`#08110f` twice), playback + admin pages use raw utilities | `grep` counts; `PlaybackFilters.tsx:106`, `PlaybackTimeline.tsx:310`, `error.tsx` | spec → shipped |
| §9.2 PageIntro (line 196) | PageIntro/compact class tokens are test-asserted, do not change | kept, but it is the reason Playback's h1 diverges | `States.tsx:83-98`, `playback-layout.test.ts` | intentional constraint — document it |

---

## 5. What is consistent and worth preserving

These are genuinely good cross-screen invariants and should be protected during any cleanup:

1. **Shell and navigation frame** — same 232 px sidebar (212 px ≤1280), 56 px app bar with
   breadcrumb, system pill, notifications, 24 h-style clock slot and avatar on all 16 hub
   routes; one accessible `Primary` nav per viewport (`primaryNavs` = 2 in DOM, 1 visible);
   5-item mobile bar + More sheet present on every route; skip link present
   (`capture-metrics.json` `skipLink: true`); no horizontal overflow on any route/viewport.
2. **Page-header primitive** — 15 of 16 hub routes use `PageHeader` with the same eyebrow →
   h1 → sub → actions structure and exactly one `h1` per page (`h1Count: 1` everywhere).
   This is the strongest shared pattern in the product.
3. **KPI / `.stat` component** — Dashboard, Faces, Notifications and Event statistics all use
   the identical stat markup (icon tile + uppercase label + value + delta line). Visual
   differences are data-driven, not structural.
4. **Card / surface layer** — `.card`, `.card__head`, `.card__title`, `.card__body`,
   `.card__foot` are used consistently across Dashboard, Events, Event detail, Faces,
   Settings, Users, Notification rules, Object detection, Audit log, System and Device.
5. **Badge / pill / chip token family** — shared classes with consistent radius/height/type
   (the *usage vocabulary* diverges — CON-16 — but the tokens themselves are unified).
6. **Settings shell** — two-pane sub-nav + content, sticky sub-nav, “Back to dashboard”,
   active state; consistent across all six `/settings/*` pages (and correctly collapses to
   wrapping chips ≤1024 px).
7. **Mobile inspector + More sheet** — the single re-used `article` that becomes a bottom
   sheet with backdrop, Escape-to-close, close button and safe-area padding is a genuinely
   consistent mobile pattern; the More sheet contains exactly the documented six entries.
8. **Toasts/status semantics** — status is never colour-only in the shared primitives: the
   `dot + word` pattern and `StatusLamp`'s screen-reader label are used wherever the
   component is used (the problem is that it is not used everywhere, CON-16).
9. **Form field token family** — `.field` / `.field__label` / `.input` / `.select` are
   consistent across Events, Faces, Notifications, Audit log, Users, Notification rules and
   Detection (Playback being the outlier, CON-23).
10. **Design tokens** — the palette, radii, spacing scale and `.badge`, `.notice`, `.empty`,
    `.pagination`, `.seg`, `.switch` classes are defined once and mostly consumed as
    intended; token names match the documented mapping (§2 of the spec).

---

## 6. Score

**Design consistency: 6.0 / 10.**

Rationale:

- **Strong foundation (would be 8.5+):** one token layer, shared shell, shared header/card/
  badge/stat/field primitives, responsive rules and no layout breakage anywhere. Half the
  screens are genuinely consistent with each other, and the design system is visibly the
  source of truth for the main operator flows (Dashboard → Events → Event detail → Faces →
  Notifications).
- **Deductions:** two High-severity *global* inconsistencies (CON-01 12 h clock; CON-02 date
  formats) affect every screen; a third High (CON-03 mixed 12/24 h) is visible inside three
  screens; a fourth High (CON-04) breaks the spec's central colour-semantics rule. On top of
  that, three screens (`Playback`, `Account`, `Audit log`) and several settings sub-pages
  were built outside the component layer (inline styles/raw utilities), which is the direct
  cause of ~10 Medium findings: page widths, filter/pagination/empty/loading/error/save
  patterns, duplicate destination labels, and the playback header.
- **Why not lower:** every Medium finding is a *local* pattern divergence with a shared
  primitive already available; none of them is a structural/design-language failure, and the
  product reads as one application overall. Why not higher: the inconsistencies are on the
  most-used surfaces (clock, dates, priorities) and would be obvious in daily operator use.

Closing the four High items + CON-06/07/08/13/14 would plausibly move this to ~8.5 without any
redesign — only consolidation onto the existing primitives.

---

## 7. What I could not verify

- **Interactive/hover/focus/disabled states** in the running UI beyond the delivered captures
  (focus-mode and mobile sheet states were available; individual hover, focus-ring, disabled
  and error states were judged from source, not pixels).
- **Transient feedback timing** — toast/`role="status"` announcements, save-bar states during
  in-flight requests, and the alertdialogs for delete/reset (their containers were verified in
  code, but their open states were not captured and could not be triggered without mutating
  data).
- **ARIA live-region behaviour and focus order** — presence and roles were checked in source
  and via the metrics (`skipLink`, `srOnly`, `h1Count`), but keyboard traversal was not
  exercised (a mutation-free read-only constraint).
- **Contrast ratios** — token values match the spec table, but measured contrast on the shipped
  glass/overlay surfaces (camera overlays, blurred app bar, sheet backdrop) was not computed.
- **Cross-browser/locale rendering** — captures are one Chromium profile at DPR 1; native
  `type="date"`/`type="time"` controls render per locale, so the observed `04/11/2026` vs
  `dd/mm/yyyy` vs ISO differences may widen in other locales (the Playback `2026-11-04` ISO
  string is a real app-rendered value and is not locale-dependent).
- **Full-page shots of every route** were available but only sampled for pagination/footer and
  save-bar placement; the viewport shots plus metrics were the primary basis.
- **Wording of API-driven messages** (`src/lib/messages.ts`) was not exhaustively compared for
  tone/label drift; only rendered strings that appear in the captures were judged.
- Tablet/mobile long-scroll compositions (e.g. the 35 000 px Account session list) were
  verified as “no overflow” but not visually walked end-to-end.
