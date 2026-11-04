# MOCKUP SPEC — Sentinel redesign (Phase 2)

Static, high-fidelity mockups of the Home CCTV Hub redesign, rendered to PNG for approval.
They are **design artifacts only**, not the implementation. Do not modify `src/` or `tests/`.

## Ground rules

1. Each screen is a single static HTML file in `design/mockups/`:
   - `<body data-nav="<key>" data-crumb="<crumb>">` where `data-nav` is one of
     `dashboard|playback|events|faces|notifications|cameras|device|settings` and `data-crumb`
     is the appbar breadcrumb ("Live monitoring", "Investigate", "Configure", "Administration"…).
   - `<main class="page">…</main>` contains the screen. `assets/shell.js` injects the sidebar,
     appbar, icon sprite and mobile nav. Do not write your own chrome.
   - `<link rel="stylesheet" href="assets/ds.css">` in `<head>`, `<script src="assets/shell.js"></script>`
     at the end of `<body>`.
2. Only the design system CSS is allowed: use the classes in `assets/ds.css` (documented below) and,
   if you truly need a one-off, an inline `style="…"` using the CSS variables. **Do not edit**
   `assets/ds.css` or `assets/shell.js` (the Lead owns them). Do not add external fonts/CDNs.
3. Icons: inline `<svg class="icon"><use href="#i-<name>"/></svg>`. Available names in shell.js:
   `dashboard camera playback events faces bell device settings user logout clock chevronLeft
   chevronRight chevronDown search filter expand close plus check alert info refresh arrowRight
   external database activity wifi lock shield send eye calendar image volume mute play pause
   fullscreen sliders users file home more cpu zap scan key copy`.
4. Use the real product copy from the existing app (labels below are mandatory — tests depend on them).
   Do not invent features the app does not have (no export, no recording download, no mobile push).
5. Realistic data: camera names are **Parking**, **Right Side Outside Camera**, **First Floor Passage**,
   **Left Side Outside** (channels 1-4, main 101/201/301/401, sub 102/202/302/402). Times use
   Asia/Kolkata and format `13:54`, dates `04 Nov 2026`. Never use lorem ipsum.
6. Images available: `assets/frames/cam1.jpg` … `cam4.jpg` (704×576 live frames),
   `assets/frames/event-hero.jpg`, `assets/faces/face1.jpg` … `face4.jpg` (small crops).
   Use them with `object-fit: contain` for camera video and `cover` only for event thumbnails.
7. Responsive: the page must look right at **1920×1080, 834×1112 (tablet) and 390×844 (mobile)**.
   Mostly handled by `ds.css`; make sure your markup works in one column on mobile.
8. Verify by rendering: `MOCK_ONLY=<yourpage> node design/tools/render-mockups.mjs design/mockups/screens`
   then read the PNGs (`read_image`) and fix layout problems (overflow, collisions, clipped text,
   uneven spacing, illegible contrast). Iterate until desktop + mobile both look intentional.

## Class cheat-sheet (see ds.css for details)

- Layout: `.page`, `.page-head`, `.page-head__eyebrow`, `.page-head__sub`, `.page-head__actions`,
  `.section`, `.section__head`, `.section__title`, `.card`, `.card--pad`, `.card__head`, `.card__title`,
  `.card__body`, `.card__foot`, `.split`, `.dash`, `.dash__main`, `.dash__rail`, `.grid-2`, `.settings-shell`,
  `.settings-nav`, `.settings-nav__item`, `.settings-body`.
- Text: `.muted` via `<span class="section__hint">`, `.chip`, `.badge` (+ `--accent/--online/--warn/
  --danger/--critical/--info/--mono`), `.pill`, `.status`, `.dot` (+ `--online/--warn/--offline/--idle/--live`).
- Controls: `.btn` (+ `--primary/--ghost/--danger/--sm/--lg/--icon`), `.icon-btn`, `.seg`/`.seg__item`
  (`aria-pressed`), `.field`/`.field__label`/`.input`/`.select`/`.textarea`, `.check`, `.switch`
  (`aria-checked`), `.day` (`aria-pressed`), `.datenav`, `.toolbar`, `.filter-panel`, `.filter-grid`,
  `.pagination`.
- Data: `.table`, `.prop-list`, `.kv-grid`/`.kv`, `.stat-row`/`.stat` (+ `--accent/--warn/--info`),
  `.by-camera`, `.health-grid`/`.health-card`, `.link-cards`/`.link-card`.
- Screen-specific: `.live-wall`/`.camera*` (dashboard), `.events`/`.event-row*`/`.inspector*`/
  `.day-group`/`.detail-hero`/`.detail-media`/`.face-strip`, `.cam-grid`/`.cam-card*`,
  `.rule-list`/`.rule*`/`.rule-editor*`/`.form-grid`, `.face-grid`/`.face-card*`,
  `.settings-*`, `.notice` (+ variants), `.empty`, `.skeleton`, `.breadcrumb`.
- Page heading hierarchy: exactly one `<h1>` per page; section titles `<h2>`; card titles use
  `.card__title` (a div is fine) unless they are real content headings (e.g. camera names in tiles are `<h2>`).

## Mandatory labels per screen (do not rename)

Keep these exact strings because the Playwright suite addresses them by role/name:
`Dashboard`, `Camera setup`, `Playback`, `Events`, `Faces`, `Notifications`, `Device`, `Settings`,
`Log out`, `Account`, `Enable notifications`, `Sign in`, `Username`, `Password`,
`Detected Faces`, `Notification history`, `Notification rules`, `New rule`, `Save rule`, `Cancel`,
`Edit`, `Delete`, `Keep events`, `Retention`, `Test a rule`, `Users`, `Object detection`, `Audit log`,
`System`, `CCTV Playback`, `Recent security events`, `Event list`, `Event details`, `Detected faces`,
`View recording`, `Open details`, `Statistics`, `All events`, `Snapshot not available`,
`Search`, `Clear filters`, `Person`, `Vehicle`, `Motion`, `Important`, `Camera`, `Classification`,
`Date`, `Start time`, `End time`, `Read state`, `Notification state`, `Priority`,
`Apply filters`, `Filter`, `Person detected`, `Vehicle detected`.
Semantic wrappers that must exist: `aria-label="Recent security events"` region on the dashboard,
`aria-label="Event list"` region on events, `aria-label="Event details"` on the inspector,
`aria-label="Detected faces"` region on event detail; event rows are `<li><button>`; notification rows
would be `<li><article>` (not needed in these mockups).

## Screen briefs

### A. events.html + event-detail.html
- **events.html**: toolbox row = date navigator (‹ date input `2026-11-04` › + "Today"), segmented quick
  filters (`All`, `Person`, `Vehicle`, `Motion`, `Important`), "Filters" toggle with active count, then a
  filter panel with Camera / Classification / Date / Start time / End time / Read state / Notification state /
  Priority + `Search` and `Clear filters`. Main grid: left = Event list with day groups ("Today" + 297 events,
  "Yesterday" + 312) and ~11 event rows from real data (13:54 Person High Left Side Outside New; 13:43 Person
  High First Floor Passage; 09:59, 09:56, 09:52 Person High Left Side Outside; 09:51 Vehicle Normal;
  yesterday rows mixed). Row = time, thumbnail, title + priority badge + New, camera · "notified", chevron.
  Right = sticky `article` inspector: 16:9 snapshot, HIGH + Unread badges, title "Person detected", camera +
  time, prop-list with Camera / Time / Duration / Type / Classification / Confidence / Notified, "View recording"
  + "Open details". Below it a small "Detected faces" card with one 72% face and "1 face detected".
- **event-detail.html**: breadcrumb "Events / Person detected", h1 "Person detected", actions "View recording"
  + "Back to events". Hero grid: large snapshot card with a detection bounding-box overlay (teal 1px box +
  "person · 92%" label), footer "Snapshot · 704×576 · 04 Nov 2026 13:54:19"; right column cards:
  "Event summary" prop-list (Camera, Time, Date, Duration, Type, Classification, Priority, Confidence,
  Notification, Source) with actions, and "Face Detection" region with h2 "Face Detection", "1 face detected",
  face thumb "Confidence: 72%" "Unassigned"; optional "Technical details" collapsible card.

### B. cameras.html + notification-rules.html
- **cameras.html**: heading + "Camera setup", sub = existing copy ("Names come from the DVR channel
  configuration. Saving a name here overrides it on this hub only; the DVR keeps its own name.").
  DVR/gateway status strip. 2×2 camera cards, each with the live frame preview (16:9, LIVE badge),
  "CHANNEL 01", h2 camera name, status, rename row (`Camera name` field + `Save` + `Use DVR name`),
  metadata: Channel, Main stream, Sub stream, Stream = "Ready to view". Bottom info card explaining the
  3 stream uses (grid/focus = sub, playback = H.264 sub track, main never leaves the LAN).
- **notification-rules.html**: heading + actions (`Enable notifications`, `Send Telegram Test`, `New rule`).
  Two-column: left = rule cards ("Person at night" enabled with Person + all cameras + 22:00–06:00 + cooldown
  5 min; "Driveway vehicles" disabled) each with switch, chips, Enable/Disable, Edit, Delete; then "Keep events"
  retention card ("30 days") and "Test a rule" card (Camera, Event, Time, Test). Right = open "New rule"
  editor card with Name (placeholder `Camera 2 Person Night Alert`), Camera + Event checkbox groups,
  Minimum priority, Active from/To, Days chips, Quiet hours from/To/behaviour, Cooldown, Enabled switch,
  `Save rule`/`Cancel`; plus a Telegram status card (`Telegram: Enabled`, `Snapshot: On`,
  `Video: On (10s, 5s before)`, `FFmpeg: found`).

### C. faces.html + login.html + playback.html
- **faces.html**: heading "Detected Faces" + copy ("Faces found in event snapshots by the local detector.
  Every face stays Unassigned until a later phase adds people."). Stat strip (348 total, 12 today,
  348 unassigned, 0 pending). Filter card: Camera, Date, Assignment, Minimum confidence + `Apply filters`;
  test-notification status line. Gallery of 8 face cards (`Unassigned`, `NN% confidence`, camera,
  timestamp, "View event"), one with "Face image unavailable" state. Pagination.
- **login.html**: split brand panel (headline "Your cameras. Your network. No cloud.", 3 local-first points,
  facts row "4 cameras / 30-day history / 100% local") + sign-in card with mark, "Sign in to the hub",
  Username/Password labels, `Sign in` primary, footer note. No top nav (login is chrome-free).
- **playback.html**: supporting screen: heading "CCTV Playback", camera select + date trigger
  `2026-11-04` (button-styled, no inline calendar — the real one is a popover), `Search recordings`;
  player stage (4:3 dark stage with frame image + "H.264 sub stream" tag), control row
  (Seek backward 15 seconds / Play / Seek forward 15 seconds / Mute / Full screen), thin 20px timeline
  with recording segments + event markers, zoom group 24h/6h/1h. Keep it compact and honest.

### D. settings.html + settings-{users,detection,system,audit}.html
- Shared settings sub-shell: `.settings-shell` + `.settings-nav` with items `Users`, `Notification rules`,
  `Object detection`, `Audit log`, `System` and current page highlighted, plus a "Back to settings" item.
- **settings.html**: "Read-only view of the server environment. Change values in the .env file, then restart
  the hub." Health cards (Backend Connected, DVR Connected, Video gateway connected), environment kv-grid
  (DVR host, HTTP port 80, RTSP port 554, Username, Password `********` — masked, WebRTC host, Video
  placeholder Off), link cards to the five subpages, read-only notice.
- **settings-users.html**: Users table (home ADMIN, piyu VIEWER, one disabled viewer), role badges,
  sessions/last active, row actions (Disable, Reset password, Delete); "Create user" card with Username,
  Password, Role fields and `Create user` button; delete-confirmation alert card (Cancel only).
- **settings-detection.html**: `Object detection` form: master switch, person/vehicle confidence (70),
  base FPS 1, detection source, per-camera override rows (Camera 1-4 enable + thresholds), worker status
  card (YOLOX-Nano, Running/Stopped), `Save` primary, test button, "Detection is off." / saved notice.
- **settings-system.html**: health cards (application, database, DVR, MediaMTX, events ingestion, face
  worker, object worker, thumbnails, storage), MediaMTX paths table, active sessions table, warnings
  notice. Copy "Application:" and "Active sessions:" visible.
- **settings-audit.html**: `Audit log` filter row (User, action, date + `Filter`), table of audit rows
  (sign-in, password change, rule update, user disable), pagination.

## Definition of done for each mockup

- Renders without console errors; no external requests.
- Desktop + tablet + mobile screenshots exist under `design/mockups/screens/` and have been visually checked.
- No overflow, no clipped/overlapping text, consistent spacing, one clear primary action per screen.
- Report back to the Lead: files created, screenshot paths, and anything the design system could not express.
