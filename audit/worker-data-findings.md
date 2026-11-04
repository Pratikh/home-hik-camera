# WRK — Python workers, SQLite data layer, backups, Telegram

Read-only security audit of the Home CCTV Hub (`/Users/guruswamihiremath/Desktop/projects/home-hik-camera`).
Audit date: 2026-11-03. Auditor scope: `face-worker/**`, `object-worker/**`, the SQLite data
layer (`src/server/events/*`, `src/server/cameras/store.ts`, `src/server/detection/settings-store.ts`,
`src/server/settings.ts`, `src/server/auth/accounts.ts`, `src/lib/session.ts`), `scripts/*.sh`,
`src/server/ops/backup-scripts.test.ts`, the Telegram stack (`src/server/notifications/*`,
`src/app/api/notifications/**`, `src/components/events/Telegram*`, `src/lib/notification-permission.ts`),
and the existing operational backups under `backups/`.

## Method and limits

- Static analysis of source/config plus read-only shell inspection of file modes and live data.
- SQLite was only ever opened read-only (`sqlite3 -readonly`) or immutably
  (`sqlite3 -readonly "file:…?immutable=1"` for WAL-mode copies). No `VACUUM`/`UPDATE`/`INSERT`/
  `DELETE`/`ALTER`, no writes through `.backup`, no `.writelines`.
- No worker was run, no live camera/MediaMTX/DVR call was made, no Telegram API was contacted,
  no container was started/restarted. Nothing outside `audit/` was written.
- **Secret handling:** no secret value is reproduced in this report. Bot token, chat id,
  password hashes, `SESSION_SECRET`, DVR/MediaMTX credentials appear only as `[REDACTED]` or as
  variable *names*/lengths. The one `app_settings` row with a NULL key is described, its value
  is not printed.
- **Environment caveat:** findings were confirmed against the macOS dev checkout. The production
  target is Ubuntu + Podman; the documented production assumption is **rootful Podman**
  (`deploy/systemd/README.md:17`), which materially raises WRK-01. Anything that depends on the
  running deployment (PID namespace, userns mapping, actual `.env` contents at deploy time, unit
  file drift) is marked unverified.
- **Dependency/CVE tooling:** `pip-audit`/`trivy`/`osv-scanner` are **not installed** in this
  checkout and no vulnerability database/network lookup was performed. Therefore no CVE claim is
  made. Only pinning/freshness observations are reported (WRK-11). CVE findings would require
  `pip-audit -r face-worker/requirements.txt -r object-worker/requirements.txt` on a networked host.

---

## Findings

### WRK-01 — HIGH — Worker/hub containers run as root with read-write host bind mounts (rootful Podman is the documented production default)
- Component: Container runtime configuration for both Python workers (and the stack generally)
- Location: `compose.yml:83-93` (object-worker), `compose.yml:133-140` (face-worker), `face-worker/Dockerfile:14-34` (no `USER`), `object-worker/Dockerfile:10-38` (no `USER`), `deploy/systemd/README.md:17`
- Evidence: neither Dockerfile declares a `USER`, so both processes run as uid 0 inside the container. `compose.yml` grants each worker `./data:/app/data` read-write and also grants object-worker a **read-write** bind of the repo directory `./object-worker/models:/app/models` (only face-worker's model mount is `:ro`). No `user:`, `read_only:`, `security_opt`, `cap_drop` or `no-new-privileges` appears anywhere in `compose.yml`. `deploy/systemd/README.md:17` states the production assumption is "Rootful Podman with `podman compose` available to root". With rootful Podman, container uid 0 *is* host uid 0, and the rw bind `./data` contains the entire application database (`users`, `auth_sessions`, `audit_logs`, `events`, `event_faces`).
- Attack scenario: an attacker who achieves code execution in a worker — via the media/model parsers (FFmpeg/OpenCV/onnxruntime process DVR video and ONNX model bytes), via a supply-chain-compromised model/image, or via any future bug in the worker loop — is root on the Ubuntu host under the documented deployment. Even in rootless mode the attacker gets write access to the live SQLite DB, so they can read every password hash/session row and audit trail, rewrite `users.role`, inject/delete events, and modify files under `object-worker/models` on the host (rw mount).
- Impact: full host compromise (rootful) or full application-data compromise (rootless); loss of integrity of all CCTV data and all account state. Violates least privilege for data the workers do not need (they only use `events`, `event_faces`, `face_processing`, the heartbeat tables and detection settings).
- Remediation: add `USER` (e.g. uid 10001) to both worker Dockerfiles and `user:` in compose; run the model mount `:ro` (provision the model on the host instead of at container start); prefer rootless Podman/user units; add `read_only: true` + tmpfs for `/tmp`, `cap_drop: [ALL]`, `security_opt: [no-new-privileges:true]`, `pids_limit`, `mem_limit`; give the workers their own dedicated SQLite file (or `ATTACH` the shared DB read-only and write results to a separate worker DB) so a worker cannot rewrite `users`/`auth_sessions`.
- Status: VERIFIED (static)
- Safe-test status: SAFELY TESTED (read-only inspection of Dockerfiles/compose/unit docs; no container run)

### WRK-02 — MEDIUM — Every container (including both workers) receives the full `.env`, exposing `SESSION_SECRET`, the Telegram bot token and DVR/MediaMTX/APP credentials they do not need
- Component: Container secret distribution
- Location: `compose.yml:12-13` (mediamtx), `compose.yml:43-44` (web), `compose.yml:83-84` (object-worker), `compose.yml:133-134` (face-worker); `.env` (names only)
- Evidence: all four services use `env_file: - .env`, so Compose injects the *whole* file into every container. The variable names present in `.env` are: `HIKVISION_USERNAME`, `HIKVISION_PASSWORD`, `APP_USERNAME`, `APP_PASSWORD`, `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `MEDIAMTX_AUTH_USER`, `MEDIAMTX_AUTH_PASSWORD` (`[REDACTED]` values; `.env` is mode `0600` on the host, which is good). The face-worker needs only `DATA_DIR`/`FACE_DETECTION_*`; the object-worker only `DATA_DIR`, `OBJECT_DETECTION_*` and `MEDIAMTX_*`. Neither worker ever reads `SESSION_SECRET`, `TELEGRAM_*`, `HIKVISION_*` or `APP_PASSWORD` (greps over `face-worker/` and `object-worker/` show no such reads).
- Attack scenario: any worker compromise (see WRK-01) reads `/proc/1/environ` and walks away with `SESSION_SECRET` — sufficient to forge a valid ADMIN session cookie (`src/lib/session.ts:46-64` HMAC payload with `u`+`role`) — plus the Telegram bot token (full control of the notification bot) and the DVR credentials (direct camera access). `podman inspect` on the host also shows all of it for every service.
- Impact: single worker weakness escalates to total application takeover, camera takeover and third-party bot takeover. Blast radius far larger than the component compromised.
- Remediation: stop using one shared `env_file` for all services. Give the web container the full `.env`; give each worker an explicit, minimal `environment:` block (and a separate `.env.worker` if needed) containing only `DATA_DIR`, model path and worker tuning. Rotate `SESSION_SECRET` (invalidates sessions), the Telegram token (via BotFather) and the DVR password if the current deployment has ever run with this compose file.
- Status: VERIFIED (static)
- Safe-test status: SAFELY TESTED (read-only `grep -o '^[A-Z_]*=' .env` for names only; values never read out)

### WRK-03 — MEDIUM — Retention does not cover object-detection track metadata, audit logs or test requests; detection metadata outlives the events it belongs to
- Component: SQLite retention / data lifecycle
- Location: `src/server/events/retention.ts:80-133`; `src/server/events/event-store.ts:995-1003` (`deleteOlderThan`, `deleteNotificationsOlderThan`), `src/server/events/event-store.ts:1606-1609` (only `telegram_media_jobs` is pruned)
- Evidence: the hourly retention pass deletes `events` (cascading `event_faces`/`face_processing`), `notification_history`, snapshot files, face-crop files and orphans. Nothing anywhere deletes from `object_detection_tracks`, `audit_logs`, `object_detection_test_requests` or `viewer_presence` (verified by grepping every `DELETE FROM` in `src/`). `object_detection_tracks.event_id` has **no** foreign key, so track rows survive event deletion. Current DB: 7,270 retained `events` but 100 `object_detection_tracks`, 1,731 `audit_logs`, 3 `object_detection_test_requests`, 9 `viewer_presence` rows — all permanent.
- Attack scenario: not an active exploit, a privacy/retention failure. Each track row permanently records camera id, first/last seen timestamps, class (person/vehicle), bounding box, confidence, threshold, detector/model and the (now deleted) `snapshot_path`. `audit_logs` permanently records IP addresses, user agents and usernames. On a shared/backed-up disk this is a growing, undeletable-by-UI history of who was where and when, plus PII, that the operator believes retention removed. Unbounded growth also bloats every backup (the DB is copied whole).
- Impact: meaningful privacy weakness versus the product's stated retention promise; storage growth; audit-log PII retained indefinitely with no stated basis.
- Remediation: extend `runRetention` with `DELETE FROM object_detection_tracks WHERE first_seen < ?`, `DELETE FROM object_detection_test_requests WHERE created_at < ?`, `DELETE FROM viewer_presence WHERE seen_at < ?`; add an `audit_log` retention window (e.g. 90–365 days) configurable by the Admin, documented as a deliberate exception. Add `ON DELETE SET NULL`/explicit cleanup for track rows so they never outlive their events.
- Status: VERIFIED (static) + read-only row counts
- Safe-test status: SAFELY TESTED (read-only `sqlite3 -readonly` counts; no deletion performed)

### WRK-04 — MEDIUM — Live DB/WAL/SHM and data directories are world-readable on the host (0644/0755), exposing password hashes, session rows and audit PII
- Component: SQLite data layer file permissions
- Location: `data/events.sqlite` (mode `0644`), `data/events.sqlite-wal` (`0644`, 4.2 MB), `data/events.sqlite-shm` (`0644`), `data/` (`0755`), `data/events/` (`0755`), `data/face-crops/` (`0755`), `data/telegram-clips/` (`0755`); creation sites `src/server/events/event-store.ts:1729-1730` (`mkdirSync` + `new DatabaseSync`, no `chmod`/explicit mode)
- Evidence: `ls -l data/…` confirms the database and both WAL sidecars are `-rw-r--r--` while the surrounding directories are `drwxr-xr-x`. The hub never sets the DB file mode: `openEventStore` creates the directory and opens the file with process defaults (umask 022 → 0644/0755 in the container image and on the documented Ubuntu host). This is inconsistent with the deliberate `0600` used for snapshots/face crops (`src/server/events/snapshot.ts:67` `writeFile(..., {mode: 0o600})`, `face-worker/crops.py:113` `os.chmod(temporary, 0o600)`), `data/backup-status.json` (0600) and the entire `backups/` tree (0700/0600). Under the documented rootful-Podman production model the DB is root-owned 0644, and the systemd README only hardens `.env` (`deploy/systemd/README.md:38-39`), not `data/`.
- Attack scenario: any other local account/process on the Ubuntu host (or a compromised low-privilege service, or a backup agent running as another user) reads `data/events.sqlite*` and obtains: `users.password_hash` (scrypt, offline-crackable at leisure), `auth_sessions` (session ids, IP addresses, user agents), `audit_logs` (IP/UA/action history), `events` metadata and the exact filesystem layout, plus the recent-row contents replayed in the 4.2 MB `-wal` file. The 0755 directories additionally leak snapshot filenames (camera id + event id + IST date) even though the JPEGs themselves are 0600.
- Impact: meaningful privacy exposure (CCTV activity patterns, household presence, login PII) and credential material exposure to a local attacker. Not directly remotely exploitable.
- Remediation: create `data/` and the DB with `0700`/`0600` (`mkdirSync(…, {mode: 0o700})`, `fs.chmod` after first open, or set umask 077 for the service), keep WAL/SHM at 0600 (SQLite copies the DB mode), document `chmod -R go-rwx data/` in the deploy README, and set `UMask=0077` in the systemd units.
- Status: VERIFIED (static + `ls -l`)
- Safe-test status: SAFELY TESTED (read-only `ls -l`/`find`; no data exported)

### WRK-05 — LOW — A stale, corrupt copy of the database sits in `data/` at mode 0644, outside backup and retention
- Component: SQLite data directory hygiene
- Location: `data/events.sqlite.corrupt-20261017-194428` (6,955,008 bytes, mode `-rw-r--r--`)
- Evidence: the file is listed in `data/` and is not covered by `scripts/backup.sh` (which only copies `events.sqlite`, `events/`, `face-crops/`, `cameras.json` — `scripts/backup.sh:143-168`) nor by retention (which only deletes `events` rows/files). Opened immutably read-only it still exposes the full schema including `users`, `auth_sessions`, `audit_logs`; it contains 2 `users` and **388 `auth_sessions`** rows. Its session TTL (7 days) has long expired, so it is not a live credential, but it is an unmanaged second copy of password hashes, session ids/IPs and the audit trail, world-readable on the host.
- Attack scenario: a local reader (see WRK-04) harvests another copy of credential material and historical PII; the operator believes the file is "just a corrupt DB" and never removes it; it is also silently absent from backups, so a restore does not reflect it.
- Impact: limited (expired sessions, scrypt hashes), but it is exactly the kind of unmanaged copy that survives an "all data deleted" request.
- Remediation: delete/move the `.corrupt-*` file (operator action — not done by this audit), and make the hub rename such files into a managed, 0600 quarantine path with a documented disposition; add a note to the deploy README.
- Status: VERIFIED (static; immutable read-only query)
- Safe-test status: SAFELY TESTED (read-only table list/counts via `sqlite3 -readonly file:…?immutable=1`; no values read)

### WRK-06 — LOW — Temporary Telegram clip files are created with default (0644) permissions in a 0755 directory
- Component: Telegram media temp files
- Location: `src/server/notifications/event-clip.ts:391-393` (`clipDir`), `:652-655` (`mkdir` with no mode, ffmpeg writes `clip-<eventId>-<ts>.mp4`), `:402-428` (`cleanupStaleClips`, 30 min), `src/server/notifications/telegram-media.ts:307-310` (unlink after upload)
- Evidence: `mkdir(dir, {recursive:true})` uses the process umask (022 in the node:24-alpine image → 0755); the MP4 is written by the ffmpeg child with default mode (0644) and is never `chmod`ed. The file is deleted after the upload attempt and a 10-minute maintenance sweep removes leftovers older than `CLIP_STALE_MS = 30 min` (`event-clip.ts:33,383-388`). Live dev checkout shows `data/telegram-clips/` at `0755` (currently empty).
- Attack scenario: other local users/processes can read a clip (up to 30 minutes' worth of household video, including audio) during the window before upload/deletion; a crash or kill between ffmpeg and `unlink` leaves it for up to 30 minutes. On a single-user home server this is defense-in-depth only.
- Impact: brief, local-only exposure of private video/audio.
- Remediation: `mkdir(dir, {recursive:true, mode:0o700})` and `chmod 0600` the output (or run ffmpeg with `-y` into a pre-created 0600 file: `fs.open(…, 0o600)` then pass the path), and shorten `CLIP_STALE_MS`.
- Status: VERIFIED (static)
- Safe-test status: SAFELY TESTED (read-only `ls -ld data/telegram-clips`)

### WRK-07 — LOW — Notification egress sends face crops/snapshots and clips (with optional audio) plus camera name and timestamp to a third-party cloud
- Component: Telegram integration / data minimisation
- Location: `src/server/notifications/telegram-media.ts:264-311` (video upload), `:315-343` (image: **face crop preferred**, then full snapshot), `src/server/notifications/telegram.ts:264-265` (`api.telegram.org`), `:121-141` (caption), `src/server/notifications/event-clip.ts:194-199,226-231` (AAC audio mapped by default)
- Evidence: what actually leaves the LAN for each accepted notification is: a JPEG face crop (`filename: "person.jpg"`) or the full camera snapshot, or an H.264 MP4 clip of up to `pre+post` seconds **with audio** when the DVR stream carries it, plus an HTML caption containing the camera **display name**, the event timestamp in IST and the detector confidence percentage. No event id, path, token, chat id or DVR address is included (good). Transport is HTTPS to the fixed Bot API base; the chat id is server-side config only. Cloud-side retention/access control is Telegram's, not the hub's.
- Attack scenario: household imagery (potentially faces, interior rooms, children, conversations via clip audio) is stored on and accessible through a third-party messaging cloud; the camera *name* is a location hint ("Kids room", "Gate"). Compromise of the Telegram account or of the user's devices exposes the history. There is no consent/opt-out per resident, no local-only fallback, and no way to purge Telegram-side history from the hub.
- Impact: privacy exposure to a third party by design of the feature; the face crop is the *most* identifying artifact and is preferred over the wider snapshot.
- Remediation: document the egress clearly (what is sent, including audio and camera name) in the settings UI; prefer the full snapshot over the face crop by default (or make it a choice); offer a camera-name-free caption mode (e.g. "Camera 2") and a no-audio profile (`FFMPEG_PROFILE_VIDEO_ONLY` already exists); consider a Telegram "local Bot API server" option for self-hosting; ensure retention/backup docs state that deletes on the hub do not delete Telegram history.
- Status: VERIFIED (static)
- Safe-test status: NOT SAFELY TESTED (no Telegram API call made, by rule)

### WRK-08 — LOW — Image decoding without dimension/pixel limits in both workers, and no container memory limits (decompression-bomb / resource DoS)
- Component: Python workers, image decode + runtime limits
- Location: `face-worker/pipeline.py:117-124` (`read_bytes` → `cv2.imdecode`), `object-worker/worker.py:287-295` (`cv2.imread` for detection-test snapshots), `src/server/events/snapshot.ts:10,62-63` (only a byte cap, no dimension check), `compose.yml` (no `mem_limit`/`pids_limit` for any service)
- Evidence: the only bound on a snapshot is `MAX_BYTES = 4 MB` and a JPEG magic check; nothing validates width×height before decoding. A 4 MB JPEG can legally decode to hundreds of megapixels (GBs of RAM). The face-worker reads the entire file into memory, decodes it, then keeps the full-size image while cropping; the object-worker `imread`s a DB-referenced file. Neither worker has a per-container memory cap in `compose.yml`, and the documented host is a 4 GB server.
- Attack scenario: a crafted or corrupt JPEG reaches `DATA_DIR/events` (from the DVR's picture endpoint — the hub only checks magic bytes and size — or from anyone with write access to the data dir, or an interrupted/corrupt file), then the face-worker (opt-in) OOM-kills, or the object-worker OOM-kills while an ADMIN polls a detection test. Repeatable crash → detection gaps and host pressure on a 4 GB box; unavailability of an enrichment feature, not of the hub itself.
- Impact: local availability impact on the worker container (and host memory pressure); note the hub itself is not affected.
- Remediation: after `imdecode` (or before, via a header probe) reject images above a pixel budget (e.g. 16 MP) and log a deterministic `decode_failed`; set `mem_limit`/`pids_limit` on the worker services; treat oversized images as a per-event deterministic failure (they already are, via `DETERMINISTIC_ERRORS`).
- Status: VERIFIED (static); exploitability depends on ability to place a crafted file in `DATA_DIR/events`
- Safe-test status: NOT SAFELY TESTED (would require feeding a crafted image to a worker; not run)

### WRK-09 — LOW — Backup verify/restore accept symlinks inside a backup tree, and the hub serves snapshot paths without a realpath check
- Component: Backups → snapshot serving chain (defense-in-depth)
- Location: `scripts/verify-backup.sh:114-127,136-149` (`[ -f "$SRC/events/$rel" ]` follows symlinks), `scripts/restore.sh:97-106,131-147` (`cp -R` preserves symlinks and swaps them into `DATA_DIR/events`), `src/lib/snapshot-path.ts:8-15` (`path.resolve` only — no `realpath`/`lstat`), `src/app/api/events/[id]/snapshot/route.ts:23-27`
- Evidence: `verify-backup.sh` only rejects `..`/absolute paths in DB values; it then tests existence with `-f`, which follows a symlink, so a symlinked `events/<rel>` passes verification. `restore.sh` copies with `cp -R` (symlinks copied as symlinks, no dereference and no rejection) straight into the live `DATA_DIR/events`. The serving path resolves lexically with `path.resolve` and never calls `fs.realpath`, so an authenticated request for that event id reads the symlink target — e.g. `/opt/home-cctv/.env`, a backup file, `/etc/passwd` — and returns it to any signed-in user (VIEWER included). The TS orphan sweeps are careful about symlinks (`src/server/events/orphan-snapshots.ts:39-49,60-66` refuses a symlinked root and skips symlink dirents) and `cleanup-orphan-snapshots.sh:58-61` refuses a symlinked root — the restore/verify step is the gap.
- Attack scenario: attacker who can tamper with a backup (shared backup volume, compromised backup host, or a malicious "backup" handed to an operator) plants `events/2026/10/09/1-evt_<24hex>.jpg` as a symlink to a sensitive file, plus a matching `events.snapshot_path` row. The operator restores the backup in good faith; the authenticated snapshot route then serves the target file to any user. Only relevant pre-restore/host-compromise threat models; still a real containment break in the restore path.
- Impact: arbitrary file read for authenticated users after a restore from a tampered backup; exposure of `.env` would hand over all secrets, including `SESSION_SECRET` (forge ADMIN) and the Telegram token.
- Remediation: in `verify-backup.sh` and `restore.sh`, reject any `-L` entry under `events/`/`face-crops/` (use `find … -type l` and fail; `cp -R --no-dereference` plus an explicit `find -type l` rejection) and fail on any symlink in the tree; in `snapshotFile`/`faceCropFile` use `fs.realpathSync` (or `lstat` + reject `isSymbolicLink`) and re-check containment after realpath; add these as tests.
- Status: VERIFIED (static)
- Safe-test status: NOT SAFELY TESTED (would require crafting a tampered backup / restore rehearsal; not run)

### WRK-10 — LOW — Backups hold private CCTV media and credential material with no integrity hash/signature, and `backups/` is not excluded from the container build context
- Component: Backup completeness/integrity and build hygiene
- Location: `scripts/backup.sh:143-191` (manifest contains only counts), `scripts/verify-backup.sh:73-151` (integrity check, not tamper-evidence), `.dockerignore:1-17` (no `backups` entry), `Dockerfile:13` (`COPY . .` in the builder stage)
- Evidence: `manifest.json` records `database_bytes`, `snapshot_files`, `face_crop_files` — no per-file SHA-256 and no signature, so a modified backup (e.g. a JPEG swapped, an event row altered) still verifies as long as SQLite is internally consistent and referenced files exist. Separately, `.dockerignore` excludes `data`, `.env`, model files and tests but **not** `backups/`, so `podman build` of the web image sends the entire `backups/` tree (currently ~233 MB: 4,901 snapshots + 348 face crops + a 9.2 MB DB of password hashes/session rows) as build context and `COPY . .` copies it into the builder stage. It does **not** reach the final runtime image (`Dockerfile:27-29` copies only `public`, `.next/standalone`, `.next/static`), but it does land in the local build cache / build-server storage.
- Attack scenario: (a) an operator restores a tampered backup believing verification proved it authentic → altered/planted CCTV data or account rows; (b) CI/build host or shared image cache retains private CCTV imagery and credential material from a routine `podman build`.
- Impact: loss of backup integrity assurance; unintended copies of private data in build artifacts/caches.
- Remediation: write a `sha256sum` list into the backup and verify it in `verify-backup.sh` (and optionally an HMAC using an operator key) so tampering is detectable; add `backups`, `object-worker/models`, `test-results`, `playwright-report`, `audit` to `.dockerignore`; document that backups must be protected as credential material (they contain `users`/`auth_sessions`).
- Status: VERIFIED (static + read-only backup inspection)
- Safe-test status: SAFELY TESTED (read-only `find`/`ls -l`/`du` and read-only SQLite queries against the backup copy)

### WRK-11 — INFO — Dependency/base-image pinning is partial; the object-worker downloads its model at container start (HTTPS + pinned SHA-256, verified on use)
- Component: Python workers supply chain
- Location: `object-worker/docker-entrypoint.sh:10-12`, `object-worker/scripts/download_model.py:21-22,30,34-35`, `face-worker/scripts/download_model.py:29-36,41,45-46`, `face-worker/requirements.txt:6-7`, `object-worker/requirements.txt:6-8`, `face-worker/requirements-dev.txt:4`, `face-worker/Dockerfile:14`, `object-worker/Dockerfile:10`
- Evidence: both model fetchers use a fixed HTTPS URL and verify a hard-coded SHA-256 *before* writing (checksum mismatch aborts; `urllib` does follow the GitHub redirect, but the hash check bounds that risk), and no `curl | sh`/dynamic script execution exists. `object-worker`'s entrypoint nonetheless performs a network fetch at every container start when the model is absent (and `--force` re-fetch on mismatch), i.e. the worker has runtime egress to GitHub; the face-worker only reads a `:ro` mount. Pinning is incomplete: base images are mutable tags (`python:3.12-slim`, no digest), `numpy>=1.26,<3` is a range (not exact) in both runtime requirement files, and face-worker dev deps use `pytest>=8.0`. The two runtime pins that do exist are specific (`opencv-python-headless==4.12.0.88`, `onnxruntime==1.23.2`).
- Attack scenario: mutable base tag or a loose `numpy` range resolves to a different artifact on a later rebuild than the one that was reviewed; a compromised GitHub release would be caught by the SHA-256 pin unless the repo file is also changed. `pip-audit`/`trivy` are not installed here, so no CVE assessment was possible.
- Impact: reproducibility/supply-chain drift; no confirmed vulnerability.
- Remediation: pin images by digest, pin `numpy`/`pytest` exactly, keep the requirements in a lock/hash file (`pip install --require-hashes`), remove the runtime download from the entrypoint (provision the model on the host and mount it `:ro`), and run `pip-audit -r …` in CI.
- Status: VERIFIED (static); CVE status UNVERIFIED (tooling absent)
- Safe-test status: NOT SAFELY TESTED (would perform network/download; not run)

### WRK-12 — INFO — SUSPECTED: object-worker stream credentials are embedded in the RTSP URL handed to OpenCV/FFmpeg, which may surface them in container logs
- Component: object-worker stream sampling
- Location: `object-worker/sampler.py:28-49` (builds `rtsp://user:pass@host/...`), `object-worker/worker.py:339-346` (`cv2.VideoCapture(url, CAP_FFMPEG)`), `object-worker/sampler.py:103-110` (only a generic "could not open" log), `compose.yml:102-106` (json-file logs, 3×10 MB)
- Evidence: the read credential (`MEDIAMTX_AUTH_USER`/`MEDIAMTX_AUTH_PASSWORD`, injected via the shared `.env` — see WRK-02) is placed in the URL authority and passed to FFmpeg, which logs its input URL in some error paths. The worker itself never logs the URL, but it also cannot control FFmpeg's stderr (unlike the hub's own clip path, which redacts with `redactRtspCredentials` in `src/server/notifications/event-clip.ts:184-187,330,348,356`). Whether FFmpeg/OpenCV actually prints the credential at the configured log level was not verified (would require running against a failing stream — out of scope by rule).
- Attack scenario: an operator pastes container logs into a ticket/chat for debugging and leaks the MediaMTX read credential; the logs are also on disk under the root-owned engine storage.
- Impact: LOW if confirmed (LAN media read access), not verified.
- Remediation: verify empirically in a lab; set `OPENCV_FFMPEG_CAPTURE_OPTIONS`/FFmpeg log level explicitly, or terminate RTSP with a short-lived token instead of a static user:pass, or route the worker through a loopback relay; do not inject `MEDIAMTX_AUTH_*` into containers that only need read access if a read-only credential can be used.
- Status: SUSPECTED
- Safe-test status: NOT SAFELY TESTED (requires a live MediaMTX failure path)

### WRK-13 — INFO — Migrations interpolate identifiers into SQL, but only from constant allow-lists; schema growth is additive and idempotent
- Component: SQLite schema/migrations (`event-store.ts`)
- Location: `src/server/events/event-store.ts:603-612` (`PRAGMA table_info(${table})`, `ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`), `:614-637`, `:643-667` (migration markers), `:1726-1752` (`openEventStore` PRAGMAs)
- Evidence: the only SQL built by string interpolation uses `table`/`column` values that are hard-coded call-site constants (`"events"`, `"priority"`, …), never request input; every user-influenced value in the codebase is bound (`query()` `where` fragments are static strings with `?` placeholders, `accounts.ts:275-302` audit filters use `u.username = ?`, `a.action = ?`, `a.created_at LIKE ?`). There is no `ATTACH`, no dynamic `ORDER BY`, no `LIKE` built by concatenation. Migrations each take a marker in `app_settings`, so they run once; there is no enclosing transaction, so a crash mid-migration leaves a partially migrated but re-runnable DB (acceptable here).
- Attack scenario: none identified. This finding records the audit conclusion rather than a weakness.
- Impact: none; confirms absence of SQL injection in the audited data layer (subject to the rest of `event-store.ts`, which was reviewed for all `prepare(`/`exec(` sites — all parameterized).
- Remediation: none required; if future dynamic table/column names are ever introduced, restrict them through an explicit allow-list.
- Status: VERIFIED (static)
- Safe-test status: NOT SAFELY TESTED (no injection probes were sent; analysis only)

---

## (1) SQLite schema summary and sensitive-field inventory

Database: `data/events.sqlite` (WAL mode, `page_size=4096`, `foreign_keys=ON` on the hub and worker connections, `busy_timeout=5000`, `journal_size_limit=64 MiB`). Current dev copy: 7,270 `events`, 348 `event_faces`, 4,898 `face_processing`, 2 `users`, 3 `auth_sessions`, 1,731 `audit_logs`, 10,349 `notification_history`, 30 `telegram_media_jobs`, 100 `object_detection_tracks`, 3 `object_detection_test_requests`, 9 `viewer_presence`, 0 `people`, 0 `person_face_references`.

Tables: `events`, `event_faces`, `face_processing`, `people`, `person_face_references`, `notification_rules`, `notification_history`, `app_settings`, `users`, `auth_sessions`, `audit_logs`, `viewer_presence`, `telegram_media_jobs`, `face_worker_heartbeat`, `object_worker_heartbeat`, `object_detection_settings`, `object_detection_camera_settings`, `object_detection_tracks`, `object_detection_test_requests`.

| Table.field | Sensitive? | Stored plaintext? | Notes / exposure |
|---|---|---|---|
| `users.password_hash` | Credential material | Yes (hash, not password) | `scrypt$…` (verified prefix only); offline crackable; 0644 DB (WRK-04) and backed up (WRK-10) |
| `users.username`, `role`, `last_login_at` | PII (account) | Yes | Usernames are household members; backed up |
| `auth_sessions.id` | Session handle | Yes | HMAC-bound in the cookie (`src/lib/session.ts`), so DB copy alone cannot forge without `SESSION_SECRET`; still a token-adjacent secret |
| `auth_sessions.ip_address`, `user_agent` | PII | Yes | Login network/device history |
| `audit_logs.ip_address`, `user_agent`, `metadata` | PII | Yes | 1,731 rows, never pruned (WRK-03); backed up |
| `events.camera_id`, `timestamp`, `classification`, `metadata` (detector bbox/track id), `snapshot_path` | Sensitive (behaviour) | Yes | Household presence pattern + exact storage layout; snapshot files themselves 0600 |
| `event_faces.crop_path`, `x/y/w/h`, `confidence`, `person_id` | Sensitive (biometric-adjacent) | Yes | Face images 0600; paths 0644 DB; person_id is always NULL today |
| `people.*`, `person_face_references.image_path`, `.embedding` (BLOB, reserved) | Sensitive (PII / future biometric) | Yes (unused) | Tables empty; a future embedding column would be plaintext biometric data |
| `notification_rules.*`, `notification_history.*` (camera ids, rule names, timestamps, status/reason) | Sensitive-ish | Yes | Behaviour/notification history |
| `telegram_media_jobs.camera_name`, `event_timestamp`, `snapshot_path`, `classification`, `confidence` | Sensitive-ish | Yes | No token, no chat id — verified absent |
| `viewer_presence.user_id`, `path`, `seen_at` | PII (presence) | Yes | Never pruned (WRK-03) |
| `object_detection_tracks.*` (camera, first/last seen, class, bbox, confidence, snapshot_path) | Sensitive (behaviour) | Yes | Outlives event retention; no FK to `events` (WRK-03) |
| `object_detection_settings`, `object_detection_camera_settings`, `object_detection_test_requests` | Config / detection output | Yes | No credentials; test results hold bbox JSON |
| `face_worker_heartbeat`, `object_worker_heartbeat` (status, metrics JSON, settings JSON, pid) | Low | Yes | No secrets (worker `settings_json()` deliberately excludes credentials) |
| `app_settings` | Low | Yes | Keys verified: only operational state/retention counters/backfill markers/face-test cursor. **No Telegram token, chat id, password or session secret is stored in the DB** (verified by key listing and by grepping all writes). One row has a `NULL` key with a 24-character value (data-quality oddity; unreachable via the settings API). |
| `cameras.json` (`names` only) | Low | Yes | Display names only; no DVR credentials (`data/cameras.json` inspected structurally, values not printed) |
| `.env` (outside DB) | **Secrets** | Yes (0600) | `HIKVISION_PASSWORD`, `APP_PASSWORD`, `SESSION_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `MEDIAMTX_AUTH_PASSWORD` — `[REDACTED]`; injected into every container (WRK-02) |

No encryption at rest anywhere: DB, WAL, snapshots, face crops and backups are plaintext files protected only by filesystem mode. The DB is **not** reachable through static file serving (`public/` contains only `robots.txt`; `data/` is never under `public/`; snapshot/face-crop reads go through authenticated routes with validation — see verified controls).

## (2) Backup content inventory (`backups/2026-10-21_204205`, inspected read-only)

| Item | Present | Contents / counts | Private data | Mode (verified) |
|---|---|---|---|---|
| `database.sqlite` | Yes | 9,605,120 B; `users` 2 (scrypt hashes), `auth_sessions` 44, `events` 5,260, `event_faces` 348, `audit_logs` 905, `notification_history`, `app_settings` (7 keys, no secrets) | Credential material + PII + behaviour | `0600` |
| `database.sqlite-wal` / `-shm` | Yes | 0 B / 32,768 B (artefacts of the `quick_check`), not listed in the manifest | Same schema | `0600` |
| `events/` | Yes | 4,901 JPEG snapshots, ~225 MB | Private CCTV imagery | dirs `0700`, files `0600` |
| `face-crops/` | Yes | 348 face crops, ~1.4 MB | Biometric-adjacent imagery | dirs `0700`, files `0600` |
| `cameras.json` | Yes | 40 B, display names only | Low | `0600` |
| `manifest.json` | Yes | status/created_at/counts; no per-file hashes, no signature | Metadata | `0600` |
| `backups/` root + timestamp dir | Yes | — | — | `0700` |
| `.env` / `SESSION_SECRET` / Telegram token / chat id | **No** (correctly excluded) | — | — | — |
| DVR recordings, MediaMTX, thumbnails, `telegram-clips`, models | **No** (by design) | — | — | — |
| Same tree as build context | **Yes** — `backups` missing from `.dockerignore`, `Dockerfile:13 COPY . .` | ~233 MB enters the builder stage (not the runtime image) | Private data in build cache | (WRK-10) |

Backup/restore scripts: atomic staging + `PRAGMA quick_check` before promotion (`scripts/backup.sh:140-195`), `umask 077` (`:43`), lock dir, manifest-gated retention (`:199-218`), `verify-backup.sh` rehearses integrity/FK/tables/file references without touching live data, `restore.sh` refuses to run while port 3000 listens, moves WAL/SHM aside with the old DB, and keeps `*.pre-restore-*` copies. Gaps are WRK-09 (symlinks) and WRK-10 (no tamper-evidence, build context).

## (3) Verified controls

1. **No worker network API/port.** Greps for `http.server`, `HTTPServer`, `BaseHTTPRequestHandler`, `uvicorn`, `flask`, `fastapi`, `socket.`, `bind(`, `listen(` across `face-worker/**` and `object-worker/**` return nothing; no `EXPOSE` in either Dockerfile; `compose.yml` publishes no ports for either worker (only mediamtx 8189 and web 3000). Container exposure: none.
2. **Worker image path safety.** Crop paths are composed only from a validated event id (`^evt_[a-f0-9]{24}$`), an integer index and a date, then re-resolved and confined (`face-worker/crops.py:25-51`); snapshot reads are confined and reject absolute/`..`/NUL/drive-letter paths (`face-worker/pipeline.py:60-77`); object-worker validates the test-request snapshot path the same way (`object-worker/worker.py:287-292`) and its own writes (`object-worker/store.py:285-300`). Symlink escapes are rejected because `.resolve()` happens before the containment check. Tested by `face-worker/tests/test_crop_paths.py` and `test_pipeline.py`.
3. **No SQL injection found in the audited layer.** All user-influenced values are bound; the only interpolated identifiers come from hard-coded constant call sites (`event-store.ts:603-612`); `LIKE` is bound (`accounts.ts:285-288`); no dynamic `ORDER BY`/`ATTACH`/`PRAGMA` from user data; `retention-face.test.ts:155` interpolates only a test-constant table name.
4. **Path traversal on image routes blocked.** `snapshotFile`/`faceCropFile` reject absolute paths, `..`, drive letters, NUL and re-check containment (`src/lib/snapshot-path.ts:8-15`, `src/lib/face-path.ts:17-31`); both routes validate the id format before any DB lookup and require an authenticated session (`src/app/api/events/[id]/snapshot/route.ts:16-24`, `src/app/api/faces/[id]/image/route.ts:22-41`); responses are `Cache-Control: private, no-store`. Face crop paths are never returned by the API (`mapFace` exposes only `hasCrop`), and the browser never supplies a path.
5. **Retention really deletes CCTV media.** `runRetention` deletes event rows (cascading `event_faces`/`face_processing` via `PRAGMA foreign_keys=ON`), then unlinks snapshots and face crops, then sweeps orphans with generated-name allow-lists that never follow symlinks (`retention.ts:80-133`, `orphan-snapshots.ts:16-96`). Telegram clips are unlinked after upload and swept at 30 min; media jobs are pruned after 7 days. Covered by `retention-face.test.ts` and `orphan-snapshots.test.ts`.
6. **Secrets are not stored in the database and not returned by APIs.** Telegram token/chat id and `SESSION_SECRET` are env-only; `telegramState()`/`telegramMediaStatus()` expose booleans/durations only; the settings API masks the DVR password (`src/server/settings.ts:3-12`); `/api/notifications/telegram/status` and `/test` are ADMIN-only and echo no credential (`src/app/api/notifications/telegram/status/route.ts:16`, `.../test/route.ts:21-38`); the Telegram failure text is redacted (`telegram.ts:177-182,286-300`); logs avoid the Bot API URL. Tested extensively in `telegram.test.ts:284-325` and `telegram-media.test.ts:470-520`.
7. **Telegram settings cannot be changed from the app.** They are read from the server environment only (no DB-backed settings UI, no request-body acceptance — the test route ignores its body). Sending a test message is ADMIN-only; the chat id is never user-supplied, so there is no SSRF/open-relay via chat selection.
8. **Telegram media handling is defensive.** Chat id from config, fixed upload filenames (`cctv-event.mp4`, `person.jpg`, `camera-snapshot.jpg`), captions HTML-escaped and length-capped, file size caps (10 MB photo / 50 MB video / 10-item album), container magic-byte + ffprobe h264 validation, temp clip deleted after a successful *or* failed upload, one durable job per event, bounded queue with oldest-drop, single-flight worker. Verified in `telegram-media.ts` and its tests.
9. **Worker DB writes are idempotent and constrained.** Deterministic event ids (`object-worker/store.py:111-116`), `UNIQUE(event_id, detection_index)` + delete-then-insert for faces, atomic `BEGIN IMMEDIATE` claim, `INSERT OR IGNORE` seeds that never override Admin settings, clamped config reads (`object-worker/settings.py:165-223`), and a shared WAL + busy timeout model that avoids write corruption.
10. **Backups are private by default and restore is rehearsed.** `umask 077`, 0700 dirs / 0600 files (verified on the real backup), `.env` excluded, live DB never copied file-wise (SQLite online backup API), `quick_check` gate, atomic promotion, port-check + verify-before-restore, WAL/SHM moved aside, previous data preserved as `*.pre-restore-*`. `backup-scripts.test.ts` exercises atomicity, retention, corrupt-backup rejection and the orphan sweep against temp fixtures.
11. **`/api/health` stays small; operational detail is ADMIN-only** (`src/app/api/system/health/route.ts:16`); detection status exposes no paths/credentials to VIEWERs.
12. **Face crops are written atomically at 0600** (`face-worker/crops.py:108-114`), snapshots at 0600 (`snapshot.ts:67`), object-worker snapshots at 0600 (`object-worker/store.py:295-299`), and model downloads are checksum-verified before use.

## (4) Unverified controls / production-state questions

1. **Actual container privilege model in production.** Rootful vs rootless Podman on the Ubuntu deployment (and whether `deploy/systemd` units match `compose.yml`) — determines whether WRK-01 is host-root or just data-level. Verify with `podman info --format '{{.Host.Security.Rootless}}'` and `podman inspect … | jq '.[].HostConfig'` on the server.
2. **Host umask / systemd `UMask=` for the web container** — decides whether WRK-04 is 0644 or 0600 in production; also whether the DB is root-owned. Verify `stat -c '%a %U:%G' /opt/home-cctv/data/events.sqlite*` on the host.
3. **Whether `data/` or `backups/` are reachable by anything else in production** (Nginx/Apache static root, Samba/NFS export, sync client, CI runner). Static serving in the app is ruled out (verified); host-level exposure was not.
4. **Whether FFmpeg/OpenCV logs the object-worker RTSP URL with credentials** (WRK-12) — needs a lab run with a failing stream; not performed.
5. **Whether the production backup timer actually runs and rotates** on Ubuntu — only the dev checkout's single backup and `data/backup-status.json` (`"status":"success"`, last success 2026-10-21) were observed.
6. **Dependency CVE status** — `pip-audit`/`trivy` absent from this checkout; no CVE conclusion possible without a networked scan of `opencv-python-headless==4.12.0.88`, `onnxruntime==1.23.2`, `numpy>=1.26,<3`, `python:3.12-slim`.
7. **Telegram-side retention/access control** for uploaded media — outside the hub, not testable here.
8. **Object-worker model file provenance in the deployed checkout** — the local `object-worker/models/` directory contents/mode were not checksum-verified against the pinned SHA-256 (the file's presence was observed; downloading/verifying would touch the network/model dir, so only the verification code path was reviewed).

## (5) Test-coverage assessment (what the existing tests would/would not catch)

| Test file | Covers | Would **not** catch |
|---|---|---|
| `face-worker/tests/test_crop_paths.py` | Path traversal, absolute paths, drive letters, index bounds, clamping, `clear_event_crops` scoping | Symlinks *inside* the crop tree (rejected by `.resolve()` logic but not tested), decompression bombs/huge dimensions, file modes (0600) |
| `face-worker/tests/test_pipeline.py`, `test_worker_flow.py`, `test_store.py` | Disabled-by-default flag, missing/corrupt snapshot, deterministic failures, idempotent reprocessing, restart, cascade deletion | Oversized-dimension images, DB/permission hardening, model-integrity failure, retention of tracker data |
| `object-worker/tests/test_settings.py` | Clamping out-of-range values from a hand-edited DB, master switch, per-camera overrides, safe defaults | SQL injection (parameterized anyway), missing tables, malicious `object_detection_test_requests.snapshot_path` (traversal is implemented but untested) |
| `object-worker/tests/test_worker.py`, `test_store.py`, `test_tracker.py`, `test_healthcheck.py` | Test-request success/missing-file, atomic snapshot in `events/` tree, bounded frame queue, deterministic event ids, heartbeat freshness | Missing-file only (no traversal/no symlink case), image bombs, env-secret scoping, retention gaps |
| `src/server/events/retention-face.test.ts` | Event cascade removes faces/jobs/crops; orphan crop sweep; non-generated files preserved; schema parity with the worker; WAL + FK pragmas | Object-track/audit-log/test-request retention (WRK-03), DB file permissions (WRK-04), stale DB copies (WRK-05) |
| `src/server/notifications/telegram.test.ts` / `telegram-media.test.ts` | Secret redaction (token/chat id/DVR source never in logs/results), disabled/not-configured gates, HTTP/`ok:false` handling, size/item caps, caption escaping, one-notification-per-event, queue durability/bounding, clip deletion after success/failure, crop-vs-snapshot preference | Temp-clip file **mode** (WRK-06), third-party egress/data-minimisation review (WRK-07) |
| `src/server/ops/backup-scripts.test.ts` | Atomic verified backup, status file, retention math, corrupt-DB rejection, verify-does-not-touch-live-data, orphan-snapshot dry-run/actual | Backup **permissions** (0600/0700), symlinks in a backup tree (WRK-09), manifest tamper-evidence (WRK-10), build-context exclusion |

## (6) Ranked summary

| ID | Severity | Status | Title | Key location |
|---|---|---|---|---|
| WRK-01 | HIGH | VERIFIED (static) | Workers/hub run as root with rw host binds; rootful Podman is the documented prod default | `compose.yml:83-93,133-140`; both Dockerfiles; `deploy/systemd/README.md:17` |
| WRK-02 | MEDIUM | VERIFIED (static) | Full `.env` (SESSION_SECRET, bot token, DVR creds) injected into every worker container | `compose.yml:12-13,43-44,83-84,133-134` |
| WRK-03 | MEDIUM | VERIFIED (static) | Retention misses `object_detection_tracks`, `audit_logs`, test requests, presence | `retention.ts:80-133`; `event-store.ts:995-1003,1606-1609` |
| WRK-04 | MEDIUM | VERIFIED | DB/WAL/SHM 0644 and data dirs 0755 — hashes, sessions, PII readable by other local users | `data/events.sqlite*`; `event-store.ts:1729-1730` |
| WRK-05 | LOW | VERIFIED | 0644 stale corrupt DB copy with 2 users / 388 sessions retained outside policy | `data/events.sqlite.corrupt-20261017-194428` |
| WRK-06 | LOW | VERIFIED | Telegram temp clips default 0644 in 0755 dir until upload/30-min sweep | `event-clip.ts:391-393,652-655` |
| WRK-07 | LOW | VERIFIED | Face crops/clips (incl. audio) + camera name/time uploaded to third-party cloud | `telegram-media.ts:264-343`; `telegram.ts:121-141` |
| WRK-08 | LOW | VERIFIED | No pixel/size bound on image decode + no container memory limits (bomb DoS) | `face-worker/pipeline.py:117-124`; `object-worker/worker.py:287-295` |
| WRK-09 | LOW | VERIFIED | Verify/restore accept symlinks; snapshot route resolves lexically → read outside DATA_DIR after tampered restore | `verify-backup.sh:114-149`; `restore.sh:97-147`; `snapshot-path.ts:8-15` |
| WRK-10 | LOW | VERIFIED | Backups lack tamper-evidence; `backups/` enters container build context (~233 MB private data) | `backup.sh:143-191`; `.dockerignore`; `Dockerfile:13` |
| WRK-11 | INFO | VERIFIED (CVE UNVERIFIED) | Partial pinning; object-worker downloads model at container start (verified SHA-256) | `docker-entrypoint.sh:10-12`; `scripts/download_model.py`; requirements |
| WRK-12 | INFO | SUSPECTED | RTSP credentials may reach worker container logs via FFmpeg stderr | `object-worker/sampler.py:28-49`; `worker.py:339-346` |
| WRK-13 | INFO | VERIFIED | Interpolated SQL identifiers are constant-only; no injection; migrations additive/idempotent | `event-store.ts:603-612` |

Severity counts: **CRITICAL 0 · HIGH 1 · MEDIUM 3 · LOW 6 · INFO 3** (13 findings). No SQL injection, no worker network listener, no secret-in-database, no unauthenticated image path, and no Telegram credential leak were found.

## Commands and tools used

- Read-only file inspection: `pwd`, `ls -la/-l/-ld`, `find … -type f/-maxdepth`, `wc -l`, `du -sh`, `cat` (source/config only, with secrets redacted), `sed -n`, `grep`/the `grep` tool for pattern searches (`http.server|uvicorn|flask|socket|subprocess|eval|exec|urlopen|curl|wget`, `ORDER BY ${`, `DELETE FROM`, secret field names).
- Read tool for every file quoted with line numbers.
- SQLite (read-only only): `sqlite3 -readonly data/events.sqlite ".tables"/".schema"/"select count(*)…"/"pragma journal_mode; pragma foreign_keys;"`, `select key,length(value) from app_settings` (keys and lengths, never values), `substr(password_hash,1,7)` (algorithm prefix only), and `sqlite3 -readonly "file:data/events.sqlite.corrupt-…?immutable=1"` / `"file:backups/…/database.sqlite?immutable=1"` for the WAL-mode copies.
- `python3 -c` one-liner that walked `data/cameras.json` and printed only key names, value types and lengths.
- Not used / not available: `pip-audit`, `trivy`, `osv-scanner` (absent); no `sqlite3` write operations; no container runtime commands; no DVR/MediaMTX/Telegram calls; no worker execution.
