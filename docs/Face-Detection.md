# Face Detection

Local, offline face **detection** for Home CCTV Hub.

> This feature answers one question only: **"is there a face here, and where?"**
> It does **not** answer "whose face is this?". There is no recognition, no
> embedding, no person matching and no network service of any kind. Every
> detected face is **Unassigned**.

## 1. What this phase does

| Does | Does not |
| --- | --- |
| Analyses existing event snapshots | Analyse the live WebRTC stream |
| Finds face locations with a local CPU model | Read the H.265 main recording stream |
| Stores confidence, bounding box and a crop | Identify anyone |
| Stores crops as JPEG files under `data/face-crops/` | Store image bytes in SQLite |
| Lists detections at `/faces` and on event detail | Create person records |
| Shoots for idempotent, crash-safe processing | Compute embeddings |
| Sends nothing off the machine | Talk to OpenAI/Google/AWS/Azure or any API |

Detection is **opt-in**. With `FACE_DETECTION_ENABLED=false` (the default) no
detector is initialised, no snapshot is read, no crop is written and no face row
exists. `/faces` still loads and says the feature is off.

## 2. Architecture

```
Hikvision DVR
   │
   ├── event (alarm log) ──► CCTV Hub ──► SQLite: events
   │                              │            + notification rules/history
   │                              └──► still picture ──► data/events/<y>/<m>/<d>/<camera>-<event>.jpg
   │
   └── (the live substream and the H.265 recordings are NOT used here)

                    existing snapshot on disk
                              │
                              ▼
                    face-worker (local Python)
                     • OpenCV YuNet, CPU only
                     • writes data/face-crops/…
                     • writes event_faces / face_processing
                              │
              ┌───────────────┼────────────────┐
              ▼               ▼                ▼
           /faces      event detail      future recognition
```

### Why snapshot-based

- A DVR event already produces the still picture that matters, so the work is
  bounded by events, not by time. A quiet night costs nothing.
- Continuous live analysis would burn CPU on a 4 GB server for no extra
  information and would compete with MediaMTX and the DVR poller.
- The main stream is H.265 and is used for recording; re-encoding it for
  detection would be wasteful and would need DVR/MediaMTX changes, which this
  phase deliberately avoids.
- Snapshots are already the hub's own data, already access-controlled, and
  already covered by retention.

### Why a separate worker, and not the Node process

1. The detector is OpenCV, which is a Python/native library. A Node binding
   would add a second native toolchain to a project that already builds cleanly
   on Node 24.
2. The hub's event loop owns the DVR poll and the notification engine. A
   synchronous CNN call inside `node:sqlite`'s event loop would stall the whole
   hub; a worker process cannot.
3. A crash, an OOM or a stuck model in the worker cannot affect event storage,
   snapshots, rules or notifications.
4. The worker reads work from the **existing** SQLite database. There is no new
   queue, broker, service or database — the hub does not even have to know the
   worker exists.

The hub is read-only with respect to faces: it serves them and cleans them up.

## 3. Detector and model

- **Detector:** OpenCV `cv2.FaceDetectorYN` (YuNet), CPU only, `cv2.setNumThreads(1)`.
- **Model:** `face_detection_yunet_2023mar.onnx`.
- **Runtime:** `opencv-python-headless` 4.12.0.88 (Apache-2.0), `numpy`.
- **Model size:** 232,589 bytes (232 KB).
- **Provenance:** OpenCV Zoo —
  <https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet>.
  The upstream project is <https://github.com/ShiqiYu/libfacedetection.train>.
- **Licence:** the model directory is **MIT** licensed (the OpenCV Zoo
  repository overall is Apache-2.0; OpenCV and the Python wheel are Apache-2.0).
- **Checksum:** `sha256:8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4`
  — verified by `face-worker/scripts/download_model.py`.
- **Detects:** faces of roughly 10×10 up to 300×300 pixels, which matches
  704×576 CCTV snapshots.

### Why YuNet

- **CPU-friendly and tiny.** 232 KB of weights and single-digit-to-tens-of-ms
  inference on a laptop CPU. It fits a 4 GB server with room to spare.
- **Accurate for its size** — 0.884 / 0.866 / 0.750 AP on the WIDER Face
  Easy/Medium/Hard splits, far better than a Haar cascade on CCTV faces.
- **No extra runtime.** `cv2.FaceDetectorYN` is part of the installed OpenCV
  wheel; there is no ONNX Runtime, TensorFlow Lite or model server to add.
- **Offline by construction.** One static file, loaded once at start-up. The
  worker never downloads anything at run time.

Rejected alternatives: **MediaPipe** (Apache-2.0, but pulls a TensorFlow Lite
runtime that is several times heavier in RAM than this feature justifies);
**OpenCV Haar cascades** (fast but a high false-positive rate on real CCTV
faces); **res10 SSD Caffe** (~10 MB with an unclear model licence).

## 4. Installation

```bash
# 1. Python environment (3.11+; tested on 3.14 locally and 3.12 in the image)
python3 -m venv .venv-face
.venv-face/bin/pip install -r face-worker/requirements.txt

# 2. Fetch the model once, with checksum verification
python3 face-worker/scripts/download_model.py
#    -> face-worker/models/face_detection_yunet_2023mar.onnx (232 KB, gitignored)

# 3. Enable it in .env
#    FACE_DETECTION_ENABLED=true

# 4. Run it (the hub must be running so data/events.sqlite exists)
FACE_DETECTION_ENABLED=true .venv-face/bin/python face-worker/worker.py
FACE_DETECTION_ENABLED=true .venv-face/bin/python face-worker/worker.py --once
```

`npm run face:model`, `npm run face:worker`, `npm run face:worker:once` and
`npm run test:face` are thin wrappers around the same commands (activate the
venv first, or use the venv's Python directly).

## 5. Podman

The image is a plain `python:3.12-slim` build; no Docker Desktop feature is used.

```bash
# Fetch the model on the host first (it is mounted, not baked in)
python3 face-worker/scripts/download_model.py

# Build and run
podman build -t home-cctv-face-worker -f face-worker/Dockerfile .
podman run --rm \
  -e FACE_DETECTION_ENABLED=true \
  -e DATA_DIR=/app/data \
  -v "$PWD/data:/app/data" \
  -v "$PWD/face-worker/models:/app/models:ro" \
  home-cctv-face-worker

# Or through compose, behind the "faces" profile so it is never started by
# accident and FACE_DETECTION_ENABLED=false stays the default
podman compose --profile faces up -d face-worker
podman compose --profile faces logs -f face-worker
podman compose --profile faces down
```

The service shares `./data`, so it uses the same SQLite database and the same
crop directory as the hub. It exits `0` immediately when detection is disabled.

## 6. Environment variables

Required (documented in `.env.example`):

| Variable | Default | Meaning |
| --- | --- | --- |
| `FACE_DETECTION_ENABLED` | `false` | Master switch. Only the exact string `true` enables it. |
| `FACE_DETECTION_CONFIDENCE` | `0.60` | Detections below this score are discarded. |
| `FACE_DETECTION_MAX_FACES` | `10` | Highest-confidence faces kept per snapshot. |

Read by the worker only (all optional, defaults shown):

| Variable | Default | Meaning |
| --- | --- | --- |
| `FACE_DETECTION_MODEL_PATH` | `face-worker/models/face_detection_yunet_2023mar.onnx` | Local model file. |
| `FACE_DETECTION_POLL_INTERVAL_MS` | `5000` | How often the queue is checked. |
| `FACE_DETECTION_BACKFILL_DAYS` | `7` | How far back to queue existing snapshots. |
| `FACE_DETECTION_MAX_ATTEMPTS` | `3` | Retries for a retryable failure. |
| `FACE_DETECTION_MAX_WIDTH` | `704` | Downscale for inference only; boxes are scaled back. |
| `FACE_DETECTION_JPEG_QUALITY` | `90` | Crop JPEG quality. |
| `FACE_DETECTION_BATCH_SIZE` | `5` | Snapshots per cycle. |

`DATA_DIR` is shared with the hub, so the worker always uses the same database
and the same `face-crops` directory.

Read by the **hub** for the temporary notification test mode (see section 16):

| Variable | Default | Meaning |
| --- | --- | --- |
| `FACE_DETECTION_TEST_NOTIFICATIONS` | `false` | Enables the temporary face notification. Off unless exactly `true`. |
| `FACE_DETECTION_TEST_NOTIFICATION_COOLDOWN_SECONDS` | `300` | Per-camera cooldown between test notifications. `0` disables the cooldown. |
| `FACE_DETECTION_TEST_UNTIL` | *(empty)* | ISO-8601 expiry **with a timezone offset**. Empty or invalid means test notifications stay off. |

## 7. Database changes

All in the existing `data/events.sqlite`. No second database.

```sql
event_faces(
  id TEXT PRIMARY KEY,                 -- face_<24 hex>
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id TEXT REFERENCES people(id) ON DELETE SET NULL,   -- NULL = Unassigned
  confidence REAL NOT NULL,
  x INTEGER, y INTEGER, width INTEGER, height INTEGER,       -- pixels in the snapshot
  crop_path TEXT,                      -- relative to DATA_DIR/face-crops
  detector TEXT NOT NULL,
  model TEXT,
  detection_index INTEGER NOT NULL,    -- per-event ordinal
  created_at TEXT NOT NULL,
  UNIQUE(event_id, detection_index)    -- duplicate guard
);
face_processing(
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL,                -- PENDING | PROCESSING | COMPLETED | FAILED
  attempts INTEGER NOT NULL DEFAULT 0,
  faces_found INTEGER NOT NULL DEFAULT 0,
  detector TEXT, model TEXT, error TEXT,
  started_at TEXT, finished_at TEXT, created_at TEXT, updated_at TEXT
);
-- Reserved for the future recognition phase. Created empty; nothing writes them.
people(id, name, notes, created_at, updated_at);
person_face_references(id, person_id, image_path, embedding, embedding_model, created_at);
```

Indexes: `event_faces(event_id)`, `event_faces(person_id)`,
`event_faces(created_at)`, `face_processing(status)`.

The hub opens the database with `journal_mode=WAL`, `busy_timeout=5000`,
`foreign_keys=ON` and `synchronous=NORMAL`, so the app and the worker can use it
concurrently and `ON DELETE CASCADE` is effective. The worker sets the same
pragmas.

**Duplicate protection** is database-level, not memory-level:
`face_processing.event_id` is a primary key (one queue row per event), `claim()`
moves a row to `PROCESSING` inside one transaction, and `replace_faces()` deletes
and re-inserts an event's faces in a single transaction under
`UNIQUE(event_id, detection_index)`. Processing an event twice — a retry, a
restart, or a manual re-run — converges on the same rows.

## 8. Face crop storage

```
data/
└── face-crops/
    └── 2026/
        └── 10/
            └── evt_248c04703553a9b578ca3e5f-face-1.jpg
```

- One JPEG per face, named only from a validated event id (`^evt_[a-f0-9]{24}$`),
  the event's month and an integer index. No camera name, no user input, no
  event text, no URL parameter ever reaches a filename.
- Written atomically (temporary file + `os.replace`) with mode `0600`, so a
  crash cannot leave a half-written crop and another local user cannot read it.
- **No image bytes are stored in SQLite.** The database holds the relative path.
- `str`-level rejection of `..`, absolute paths, Windows drive letters and NUL
  bytes, *plus* a resolved-path containment check against the crop root.
- The original event snapshot is never modified: crops are read-only slices of
  the decoded image, with a small padding, clamped to the image bounds and never
  upscaled.

## 9. Security

- Every face route goes through the existing `requireUser()` guard — the same
  session cookie and the same middleware as the rest of the app. There is no
  second authentication mechanism.
- `data/face-crops/` is **not** a static directory. There is no public mapping
  from the filesystem to the web root.
- `GET /api/faces/<id>/image` accepts a **face id**, validates it
  (`^face_[a-f0-9]{24}$`), looks it up in the database and resolves only the
  path stored on that row — and only if it stays inside the crop directory. A
  browser can never ask for a path.
- Responses are `Cache-Control: private, no-store` so private imagery is not
  cached by a shared proxy or the browser's disk cache.
- API responses never contain a filesystem path: only the face id, geometry and
  confidence. This is asserted by tests, including a scan of the JSON body.
- `/faces` and every face API require a session; an anonymous request gets
  `401` (API) or a redirect to `/login` (page). Both roles may read detected
  faces, because both roles can already read the events they belong to.
- Role behaviour is unchanged: ADMIN and VIEWER see the same faces; no face
  data is exposed to anyone who could not already see the event.

## 10. Privacy

Face crops are the most sensitive data this hub holds, so the rules are explicit:

- **Everything is local.** The model is a file on disk and inference runs in
  this process. The feature makes no outbound network request.
- **No cloud AI.** No OpenAI, Google, AWS, Azure or any vision API is used or
  referenced. There is no image upload path.
- **No recognition.** No identity is derived, stored or inferred. `person_id` is
  `NULL` for every row in this phase.
- **No telemetry.** Nothing about a detection leaves the machine. The audit log
  records sign-ins and account changes, not faces.
- Face images are included in the local backup and excluded from git, exactly
  like event snapshots.

## 11. Retention and cleanup

Retention runs hourly in the hub (`cleanup()` in `event-processor.ts`) and now
covers faces end to end:

1. Read the snapshot paths **and** crop paths belonging to events older than the
   retention window (default `EVENT_RETENTION_DAYS=30`, overridable at
   `/settings/notifications`).
2. Delete the event rows. `event_faces` and `face_processing` cascade away with
   them.
3. Unlink the snapshot files and the crop files.
4. **Sweep** `data/face-crops/` for any file that no `event_faces` row
   references any more — this catches a crash between the database delete and
   the unlink, and a re-processed snapshot that produced fewer faces. The sweep
   only considers filenames matching the generated pattern, so an unrelated file
   placed in that directory is never deleted.

The worker additionally clears an event's previous crops before writing new ones,
so a run that finds fewer faces cannot leave stale files behind.

`scripts/backup.sh` and `scripts/restore.sh` now include `data/face-crops/`
alongside `data/events/`, so a restore cannot leave face rows pointing at files
that do not exist. `scripts/verify-backup.sh` checks every stored crop reference
against the backup and fails if any file is missing. Neither script copies
`.env`.

## 11a. Liveness and admin visibility

The worker writes one row to `face_worker_heartbeat` at the start and end of every
cycle, including cycles with no work. The hub reads it on the ADMIN-only
`/api/system/health` endpoint and on `/settings/system`:

- `FACE_DETECTION_ENABLED=false` → the worker is reported as **disabled**, with
  no warning and no error.
- Enabled and the heartbeat is recent (within four poll intervals, minimum 30
  seconds) → **running**.
- Enabled but the heartbeat is missing or stale → **stopped**, with a warning and
  the number of jobs waiting. This is what makes a silent worker visible.
- A failed cycle records `status=error` with a short detail, which the admin page
  shows alongside the queue counts.

The check uses the same SQLite database and no new service. The heartbeat table
is created idempotently by both the hub and the worker.

In production the worker is started by `home-cctv-face-worker.service`
(`deploy/systemd/`). Install it only when detection is enabled; if it is not
installed while detection is on, the admin page says the worker has never checked
in and shows the pending queue.

## 12. Performance

Measured on the development machine (Apple Silicon macOS, Python 3.14,
OpenCV 4.12, single thread, model loaded once, warm) against **40 real 704×576
night snapshots copied from this hub's own event store**:

| Measurement | Result |
| --- | --- |
| Inference only, `FACE_DETECTION_MAX_WIDTH=704` | mean **18.0 ms**, p50 17.9 ms, p95 19.5 ms, max 20.0 ms |
| Inference only, `FACE_DETECTION_MAX_WIDTH=480` | mean **12.3 ms**, p95 14.1 ms (same 3 faces found) |
| Full pipeline (decode + detect + crop + DB write) | **20 ms per snapshot** — 40 snapshots in 0.79 s |
| Worker peak RSS | **147–186 MB** (Python + OpenCV + numpy + model) |
| Faces found | 3 of 40 snapshots, confidences 0.656–0.720, boxes 31×38 to 46×54 px |

Implications for the target server (Ubuntu LTS, 4 GB RAM, CPU only, old laptop):

- Detection is driven by events, not by time. At 20 ms per snapshot, 2,000
  events in a day cost roughly **40 seconds of CPU in total**, spread over the
  day by a 5-second poll.
- The worker is single-threaded and idles between cycles, so it never competes
  with MediaMTX or the DVR poller for a core.
- Under 200 MB of RAM leaves the rest of the 4 GB to the hub, MediaMTX and the
  OS.
- `FACE_DETECTION_MAX_WIDTH` is the CPU dial if a slower machine needs it:
  704 → 480 cut mean latency by about a third here with the same detections on
  this sample. Boxes are scaled back to the original snapshot, so crops keep
  full resolution either way.
- Reduce `FACE_DETECTION_BATCH_SIZE` (default 5) to make each cycle shorter.

## 13. Failure handling

Face detection is enrichment: it is never on the event critical path.

| Failure | Behaviour |
| --- | --- |
| Snapshot file missing | Job `FAILED`, error `snapshot_missing`. Event and notification untouched. |
| Snapshot row points outside the snapshot directory | `FAILED`, `snapshot_missing`. The path is never opened. |
| Corrupt / undecodable JPEG | `FAILED`, `decode_failed`. **No partial face rows.** |
| Detector exception | `FAILED` (or requeued) with `detector_error`. No face rows. |
| Crop cannot be written | Failed with `crop_write_failed`, retried up to `FACE_DETECTION_MAX_ATTEMPTS`. |
| No faces found | `COMPLETED` with `faces_found=0`. The event stays valid. |
| More faces than the cap | The strongest `FACE_DETECTION_MAX_FACES` are stored; the rest are ignored, never an error. |
| Low confidence | Below the threshold is discarded, never stored. |
| Duplicate processing | `UNIQUE(event_id, detection_index)` plus a delete-and-insert transaction: no duplicates, no orphans. |
| Worker killed mid-job | On restart, a `PROCESSING` row older than `FACE_DETECTION_STALE_AFTER_S` (default 900 s) is returned to `PENDING`. |
| Model missing | The worker logs the fix and exits `2` **without touching the queue**. |
| Detection disabled | The worker exits `0` before it opens the database or the model. |

Every failure is recorded on the job row (`error`, `attempts`, `finished_at`) so
`/faces` can report it, and in the worker log.

## 14. Limitations

- **False positives happen.** On real night footage from this hub, 3 of 40
  snapshots produced a detection and one of those was a bucket/chair, not a
  face. Detection is not verification: treat every crop as "something
  face-shaped was here". The confidence threshold is the dial.
- **Small and distant faces are missed.** The model targets roughly 10×10 to
  300×300 px. A face at the far end of a driveway at night may be a handful of
  pixels and score below any useful threshold.
- **Only snapshots are analysed.** If the DVR does not serve a still picture for
  an event (or the hub was off), that event has no faces. There is no
  retroactive analysis of recordings.
- **One frame per event.** A blink or a turn of the head can change the result.
- **Night image quality limits everything.** IR illumination, motion blur and
  JPEG artefacts all reduce accuracy; this is a property of the source.
- **`FACE_DETECTION_MAX_WIDTH` trades accuracy for CPU.** Downscaling can lose
  the smallest faces.
- **No identity, by design.** Nothing here can tell you *who* someone is, and
  no data has been collected to enable that yet.
- **The worker is a separate process.** If it is not running, snapshots stay
  queued in `PENDING`; the hub keeps working and `/faces` says so.
- **The model file is not committed.** A fresh clone must fetch it once; the
  worker will refuse to start (clearly) until it exists.
- **The face test notification is temporary and anonymous.** It reports "Face
  detected" with a count and a confidence; it cannot name anyone, and it stops
  by itself at `FACE_DETECTION_TEST_UNTIL`. Do not build on it as the final
  notification design — see section 15 for the intended recognition phase.
- **The test notification needs an open browser tab.** It is delivered over the
  app's own server-sent event stream, exactly like an ordinary event
  notification, so a notification is only shown while a tab with notification
  permission is connected. The decision is still recorded in
  `/notifications` either way.

## 15. Future recognition architecture (not implemented)

Nothing in this phase performs recognition. The schema and UI are shaped so the
next phase does not need a migration:

```
people                          (exists, empty)
  id, name, notes, created_at, updated_at

person_face_references          (exists, empty)
  id, person_id, image_path, embedding BLOB, embedding_model, created_at

event_faces.person_id           (exists, always NULL today)
```

The intended V7 flow:

1. An operator assigns a detected face to a new or existing person
   (`UPDATE event_faces SET person_id = ?`). This is the only change the current
   data model needs, and it is already possible.
2. The assigned crops become reference images in `person_face_references`
   (copying a crop into a reference path).
3. A local embedding model computes a vector for each reference image and stores
   it in `person_face_references.embedding` with its `embedding_model`. This is
   the first point at which a model other than the detector is involved, and it
   can stay local and CPU-only.
4. New detections are compared against those vectors; a match above a threshold
   suggests a person, and the operator confirms it.
5. `event_faces.person_id` is filled only from a confirmed match, so the gallery
   can show "Priyanka" instead of "Unassigned".

Deliberately deferred: person management UI, embeddings, matching, automatic
assignment. The `/faces` page already renders the assignment slot
(`faceAssignmentLabel()`), so step 1 is a UI change, not a redesign.

## 16. Temporary Face Detection Notification Test

### Purpose

A **temporary** mode, for a bounded window (typically 24–48 hours), that raises a
browser notification when a face is detected. It exists so real-world behaviour
can be observed: how many faces are detected, false positives, confidence
levels, which cameras produce detections, how often, whether browser
notifications arrive, and whether `/faces` fills up correctly.

It is **not** the final notification architecture. It is additive: motion and
person event notifications, their rules, their priorities and their cooldowns
are untouched. It never identifies anyone — a notification says **"Face
detected"**, never a name. No image is attached to the notification and nothing
leaves the machine.

### How it works

```
event snapshot ─► face worker ─► event_faces + face_processing (COMPLETED)
                                        │
                          hub poller (every 5 s, hub only)
                                        │
                     per-camera cooldown + expiry window
                                        │
                 existing notification_history  +  existing SSE stream
                                        │
                        existing browser Notification
```

**Telegram is rule-gated.** The browser test notification above is its own
documented decision, but a Telegram media job for a face detection is queued
only when the **existing notification rules** accept the underlying event. The
event's camera id, type/classification, priority, timestamp, schedule, days,
quiet-hours behaviour, enabled state and cooldown are evaluated by the same rule
engine used for DVR/AI events (`notificationRuleEligibility`). A face on a camera
that the rule does not select therefore produces **no Telegram message**, while
the selected cameras can still send media. Rule changes and deletions apply to
the next face job without restarting the hub. No second camera filter exists in
the Telegram path.

- The **worker stays detection-only**; the hub makes the notification decision,
  because the notification history and the browser delivery channel live there.
- The decision is recorded in the existing `notification_history` table with the
  rule id `face-detection-test` and the rule name `Face detected (test mode)`, so
  it is visible in `/notifications` next to the ordinary decisions.
- Delivery reuses the existing `/api/events/stream` server-sent events and the
  existing `EventNotifier` client. There is no second notification system.
- Only detections that complete **after** the mode becomes active are
  considered. A cursor in `app_settings` is parked on the newest completed job
  when the window activates, so enabling the test never replays old detections.

### Environment variables

```bash
FACE_DETECTION_ENABLED=true
FACE_DETECTION_TEST_NOTIFICATIONS=true
FACE_DETECTION_TEST_NOTIFICATION_COOLDOWN_SECONDS=300
FACE_DETECTION_TEST_UNTIL=2026-10-12T10:00:00+05:30
```

Change `FACE_DETECTION_TEST_UNTIL` to your own test window; the value above is
only an example. `.env.example` ships it empty and the flag `false`, so a fresh
checkout never sends test notifications.

`FACE_DETECTION_TEST_UNTIL` must be ISO-8601 **with an explicit timezone
offset**, and is interpreted as an absolute instant — the same convention the
rest of the hub uses for stored timestamps:

- `2026-10-12T10:00:00+05:30` — India time (what the UI displays)
- `2026-10-12T04:30:00Z` — the same instant in UTC
- `2026-10-12T10:00+05:30` — seconds are optional

Rejected, and therefore **off**: `2026-10-12` (no time), `2026-10-12T10:00:00`
(no zone), `tomorrow`, anything unparseable.

### Automatic expiry, and failing closed

Test notifications are active only when **all** of these hold:

1. `FACE_DETECTION_TEST_NOTIFICATIONS=true`, and
2. `FACE_DETECTION_TEST_UNTIL` is present and valid, and
3. the current time is **before** that instant.

Anything else means test notifications are **off**, and the hub logs why:

```
[face-test-notify] result=DISABLED reason=NOT_ENABLED
[face-test-notify] result=DISABLED reason=MISSING_UNTIL
[face-test-notify] result=DISABLED reason=INVALID_UNTIL
[face-test-notify] result=DISABLED reason=TEST_WINDOW_EXPIRED
```

With `FACE_DETECTION_TEST_NOTIFICATIONS=true` and an empty
`FACE_DETECTION_TEST_UNTIL`, the hub logs a clear configuration warning and
sends nothing. That is deliberate: a forgotten expiry cannot silently keep
notifying.

**Expiry only stops the notifications.** Face detection itself keeps running:
`FACE_DETECTION_ENABLED=true` continues to analyse snapshots, write `event_faces`
rows and crops, and fill `/faces`. The worker does not read the test variables at
all.

### Cooldown

Default **300 seconds (5 minutes), per camera**. The cooldown is measured
between *detections*, and the anchor is the most recent **sent** decision for
that camera in the notification history — so it survives a worker restart, a hub
restart, a browser refresh and a database reopen. Suppressed detections do not
extend it.

```
10:01  Parking                  → SENT
10:02  Parking                  → SUPPRESSED (cooldown)
10:03  Parking                  → SUPPRESSED (cooldown)
10:04  Parking                  → SUPPRESSED (cooldown)
10:06  Parking                  → SENT          (5 minutes since the last send)
10:02  Right Side Outside       → SENT          (its own cooldown)
```

Set `FACE_DETECTION_TEST_NOTIFICATION_COOLDOWN_SECONDS=0` to notify on every
detection.

### Duplicate safety

A single event produces **at most one** test notification, even across worker
retries, a hub restart, a browser refresh or a repeated pass:

- `notification_history` already has `UNIQUE(event_id, rule_id)`, so a second
  decision for the same event is impossible at the database level.
- The candidate query additionally excludes any event that already has a
  decision for this rule.
- The `(finished_at, event_id)` cursor means a restart resumes exactly where it
  stopped instead of re-scanning, and a busy second cannot be skipped.

### What the notification says

Title: `👤 Face detected`

Body, from real detected data:

| Detections | Body |
| --- | --- |
| 1 face | `Parking · 1 face · 82% confidence` |
| 3 faces | `Parking · 3 faces · max confidence 91%` |

Confidence is always a whole percentage. Clicking the notification opens the
**event detail page** (`/events/<id>`) — the snapshot, the crop, the confidence,
the camera and the timestamp in one place. No filesystem path is ever involved,
and the notification tag is `face:<eventId>` so it never replaces the event's
own notification.

### Status in the UI

While the window is active, `/faces` shows a small read-only line:

```
Face test notifications active until 12 Oct 2026, 10:00:00 · cooldown 5 minutes / camera
```

It is absent when the mode is off or expired, so the page never claims a test is
running when it is not. The same values are in `GET /api/faces`
(`testNotifications`), which is authenticated.

### Logs

One line per decision, plus one line for the window state:

```
[face-test-notify] event=evt_248c04703553a9b578ca3e5f camera=1 camera_name="Parking" faces=1 max_confidence=0.82 result=SENT
[face-test-notify] event=evt_4a7eeb9488c454d1e17fd2ad camera=1 camera_name="Parking" faces=1 max_confidence=0.79 result=SUPPRESSED reason=COOLDOWN
[face-test-notify] result=DISABLED reason=TEST_WINDOW_EXPIRED
```

No image bytes, paths, credentials or session tokens are logged.

### Running the real-world test

1. Fetch the model once if you have not: `python3 face-worker/scripts/download_model.py`.
2. Set the four variables in `.env` (see above), with `FACE_DETECTION_TEST_UNTIL`
   set to your desired end time.
3. Restart the hub (`npm run dev`, or `podman compose up -d web`) and start the
   worker (`FACE_DETECTION_ENABLED=true python3 face-worker/worker.py`, or
   `podman compose --profile faces up -d face-worker`).
4. Confirm the hub log says `[face-test-notify] result=ACTIVE reason=ACTIVE …`
   and that `/faces` shows the status line.
5. Allow browser notifications when the app asks (header → *Enable notifications*),
   and keep a tab open — the notification is delivered over the app's own stream.
6. Walk in front of a camera and wait for the motion event. Then verify, in
   order: the event exists, the snapshot exists, a face is detected,
   `event_faces` has a row, a card appears in `/faces`, and the browser
   notification appears.
7. Trigger another detection on the **same** camera within 5 minutes → the log
   shows `result=SUPPRESSED reason=COOLDOWN` and no second notification.
8. Trigger a detection on a **different** camera → it notifies (its own cooldown).
9. Wait out the cooldown and trigger again → it notifies again.
10. At expiry, the log shows `result=DISABLED reason=TEST_WINDOW_EXPIRED`;
    `/faces` no longer shows the status line; detections keep appearing in
    `/faces` but no further notifications are sent.

Quick command-line checks while it runs:

```bash
# Queue and results
sqlite3 data/events.sqlite "SELECT status, COUNT(*) FROM face_processing GROUP BY status;"
sqlite3 data/events.sqlite "SELECT status, reason, camera_id, created_at FROM notification_history WHERE rule_id='face-detection-test' ORDER BY created_at DESC LIMIT 10;"
# Cooldown anchor per camera (detection time of the last SENT decision)
sqlite3 data/events.sqlite "SELECT h.camera_id, MAX(fp.finished_at) FROM notification_history h JOIN face_processing fp ON fp.event_id=h.event_id WHERE h.rule_id='face-detection-test' AND h.status='sent' GROUP BY h.camera_id;"
```

### Disabling it

Set `FACE_DETECTION_TEST_NOTIFICATIONS=false` and restart the hub, or simply let
the window expire. Either way:

- Face detection, crops and `/faces` continue unchanged.
- No new test notification is sent, and none is recorded.
- The history of what was sent during the test remains in `/notifications`.

To stop detection as well, set `FACE_DETECTION_ENABLED=false` and stop the
worker.

### Telegram notifications (optional)

The same accepted face notification can also be delivered to Telegram. It is not
a second notification system: Telegram rides on the **existing** decision, so the
per-camera cooldown, the duplicate protection and `FACE_DETECTION_TEST_UNTIL` all
apply exactly as they do for the browser notification.

```
existing face-test decision
        │  (accepted, not suppressed)
        ├── browser notification   (server-sent events → Notification API)
        └── Telegram media         (Bot API sendVideo/sendPhoto, server-side only)
```

```bash
TELEGRAM_NOTIFICATIONS_ENABLED=true
TELEGRAM_BOT_TOKEN=123456:replace-me
TELEGRAM_CHAT_ID=-1001234567890
TELEGRAM_FACE_NOTIFICATIONS=true
TELEGRAM_EVENT_NOTIFICATIONS=false
TELEGRAM_COOLDOWN_SECONDS=300
```

| Variable | Meaning |
| --- | --- |
| `TELEGRAM_NOTIFICATIONS_ENABLED` | Master switch. Anything other than exactly `true` disables Telegram entirely. |
| `TELEGRAM_BOT_TOKEN` | Bot token from @BotFather. Server-side only. |
| `TELEGRAM_CHAT_ID` | Destination chat. Server-side only. |
| `TELEGRAM_FACE_NOTIFICATIONS` | Whether face detections may produce a Telegram message. The admin test button ignores this flag. |
| `TELEGRAM_EVENT_NOTIFICATIONS` | Whether an accepted Notification Rule decision (a matching camera event) may produce a Telegram message. Default `false`; independent of the face channel. See the main README. |
| `TELEGRAM_COOLDOWN_SECONDS` | Accepted for compatibility and informational only. Telegram does **not** keep its own cooldown: the effective cooldown is `FACE_DETECTION_TEST_NOTIFICATION_COOLDOWN_SECONDS`. |

**Media only.** A person/face notification is one media message, chosen in this
order:

```
1. the ~10 second event clip   (sendVideo)
2. the stored face crop        (sendPhoto)
3. the full camera snapshot    (sendPhoto)
4. nothing — log MEDIA_UNAVAILABLE
```

There is **no text fallback**: the old verbose "Face detected" message is never
sent. The media carries a short caption in Telegram's `caption` field:

```
👤 Face detected

📹 Camera: First Floor Passage
🕐 Time: 10 Oct 2026, 02:35 PM
🎯 Confidence: 82%
```

The camera name and timestamp come from the event itself (never the upload
time), and the confidence is the face detector's value. Face-test Telegram media
is only queued when an enabled notification rule accepts the event; rules remain
the single source of truth for Telegram eligibility. The face crop is read
from `DATA_DIR/face-crops` through the same path guard used by
`/api/faces/<id>/image`, so a filesystem path or a public URL never reaches
Telegram. This is still detection only: no person name and no embedding is ever
sent.

**Failure isolation.** A Telegram outage is logged (`telegram media send failed`
with the event id and a safe reason) and nothing else changes: the decision stays
recorded, the browser notification has already gone out, the worker keeps
detecting and the event pipeline keeps running. A clip that loses the DVR's
playback slot is retried once after three minutes; an accepted event produces at
most one media notification.

#### Image and clip sources

A real detection carries the face crop or the snapshot, and a short clip:

| Variable | Default | Meaning |
| --- | --- | --- |
| `TELEGRAM_EVENT_IMAGE` | `true` | Allow the image fallback: face crop first, then the full camera snapshot. (`TELEGRAM_FACE_IMAGE` is the older name and still works.) |
| `TELEGRAM_FACE_VIDEO` | `true` | Attach a short clip from the DVR recording. |
| `TELEGRAM_VIDEO_PRE_SECONDS` | `5` | Seconds of footage before the event timestamp. |
| `TELEGRAM_VIDEO_POST_SECONDS` | `5` | Seconds after. Default total: a 10 second clip. |
| `TELEGRAM_VIDEO_MAX_MB` | `45` | App cap for the clip, kept under Telegram's 50 MB bot limit. |
| `TELEGRAM_VIDEO_TIMEOUT_SECONDS` | `30` | How long FFmpeg may run for one clip. |
| `FFMPEG_PATH` | `ffmpeg` | FFmpeg executable, used only for the clip. |

`TELEGRAM_EVENT_IMAGE` enables the image fallback; the older
`TELEGRAM_FACE_IMAGE` name is still accepted. The image is only sent when no clip
could be produced.

- **Source frame.** The snapshot is a live still captured at ingestion, not the
  DVR's detection frame (this DVR's alarm log carries no image). A person far
  from the camera, or one who left before the poll, can therefore be tiny or
  absent in the still. Backfilled events (discovered after a restart) are never
  given a live still, because it would be unrelated to the event.
- **Image.** The stored **face crop** for the event is preferred, because it
  shows the detected person; when there is none, the **full camera event
  snapshot** is used. Both are read through their path guards and uploaded with
  `sendPhoto` together with the caption, so the bytes go to Telegram and a
  filesystem path never does. An event with neither image and no clip sends nothing and logs
  `MEDIA_UNAVAILABLE`.
- **Clip.** The DVR's own recording track is used, through the same playback
  search and RTSP URL builders as browser playback: the recording that covers
  the event is located, the 10 second window is cut with FFmpeg, and H.265 is
  converted to **H.264 MP4** (`yuv420p`, `+faststart`, capped at 1280px wide,
  never upscaled). Audio is offered as AAC when the playback stream carries it;
  if that upsets the source the conversion is retried video-only, so a silent or
  awkward source still produces a clip. It is uploaded with `sendVideo`, then the
  temporary file is deleted — after a successful upload and after a failed one.
  A successful upload means HTTP 2xx **and** `{"ok":true}` from Telegram: a 200
  with `ok:false` is treated as a failure.
- **The live stream is not involved.** The clip never touches MediaMTX, WebRTC
  or the browser playback path.
- **Nothing waits for it.** The decision queues a background job and returns;
  one worker drains that queue, one clip at a time. Event ingestion, face
  detection, the browser notification and the text message are never delayed by
  a DVR search or an FFmpeg run.
- **One clip per event.** Three faces in one event produce three crops and a
  single clip.
- **Temporary files** live in `data/telegram-clips/`, which is private (not in
  `public/`, not served by any route) and swept for stale files every ten
  minutes and after every upload.

FFmpeg is **required for the clip only**. It is not bundled with this project:
install it on the host (`brew install ffmpeg` on macOS, `apt install ffmpeg` on
Debian/Ubuntu) or use the container image, which includes it. When FFmpeg is
missing, the text and the face image are still delivered and the clip is
skipped with a log line.

**Troubleshooting**

| Symptom | Cause |
| --- | --- |
| Text and snapshot arrive, no clip | FFmpeg missing, no recording covers the event, or the clip exceeded the size limit. The log says which, and prints a full `[telegram-video]` diagnostic block. |
| `FFmpeg: not found` in the log | The hub runtime has no FFmpeg. Install it (`brew install ffmpeg`, `apt install ffmpeg`) or run the container image, which includes it. |
| `video=skipped reason=no_recording` | The DVR has no recording overlapping the window (or the search failed). Text and image are unaffected. |
| `/settings/notifications` shows `FFmpeg: not found` | The binary is not on `PATH`; set `FFMPEG_PATH` or install it. |
| Clip is shorter than 10 seconds | The recording started late or ended early; the available range is used. |
| Nothing at all for a detection | The existing cooldown suppressed it, or the test window expired. Check `result=SUPPRESSED` / `reason=TEST_WINDOW_EXPIRED` in the log. |

The status line on `/settings/notifications` shows whether Telegram is enabled,
whether the image and the clip are on, the clip length, and whether FFmpeg was
found — never a token, chat id or DVR detail.

**Test it without waiting for a detection.** Signed in as ADMIN, use the
*Send Telegram Test* button on `/settings/notifications`, or call the endpoint:

```bash
curl -sS -X POST http://localhost:3000/api/notifications/telegram/test \
  -H "Cookie: cctv_session=<your session cookie>"
```

The test endpoint is deliberately **text-only**: it never attaches a fake crop or
a fake clip. Real media only ever comes from a real detection.

The endpoint is ADMIN-only (a VIEWER gets `403`, an anonymous caller `401`), takes
no request body, and reads the credentials from the server environment only. It
returns a status and a safe sentence — never the token, the chat id or the Bot
API URL. Responses are `200` sent, `409` disabled, `503` not configured, `502`
Telegram refused or was unreachable.

**Security.** The token lives only in the server process: it is not in the client
bundle, not in any API response, not in an SSE payload and not in a log line.
`.env` stays gitignored. See the security review in the project report.

## 17. Tests

| Test ID | Where |
| --- | --- |
| FACE-001 (disabled by default) | `src/lib/config.test.ts` |
| FACE-002 (flag prevents detector init) | `face-worker/tests/test_flag_and_detector.py` |
| FACE-003 … FACE-011 | `face-worker/tests/test_pipeline.py`, `test_worker_flow.py` |
| FACE-012 (crop path cannot escape) | `face-worker/tests/test_crop_paths.py`, `src/lib/face-path.test.ts` |
| FACE-013, FACE-014 | `face-worker/tests/test_pipeline.py` |
| FACE-015, FACE-016 (image endpoint auth) | `src/app/api/faces/faces-api.test.ts` |
| FACE-017, FACE-018 | `face-worker/tests/test_pipeline.py`, `src/server/events/retention-face.test.ts`, `src/app/api/faces/faces-api.test.ts` |
| FACE-UI-001 … FACE-UI-008 | `tests/e2e/faces.spec.ts` |
| FACE-NOTIFY-001 … FACE-NOTIFY-016 | `src/server/events/face-notify.test.ts`, `src/lib/config.test.ts`, `src/app/api/faces/faces-api.test.ts` |
| Delivery link (hub → SSE → browser) | `src/app/api/events/stream/stream-route.test.ts` |
| FACE-NOTIFY-UI-001 … FACE-NOTIFY-UI-003 | `tests/e2e/face-notify.spec.ts` |
| TELEGRAM-MEDIA-005 … 010, 012, 013, 022, 023 | `src/server/notifications/event-clip.test.ts` |
| TELEGRAM-MEDIA-002 … 004, 011, 014, 017, 019, 020, 021 | `src/server/notifications/telegram-media.test.ts` |
| TELEGRAM-MEDIA-001, 015, 016, 017, 018 | `src/server/events/face-notify.test.ts` |
| TELEGRAM-MEDIA-023 (not served over HTTP) | `tests/e2e/telegram.spec.ts` |

The worker tests inject a stub detector, so the pipeline, threshold, cap,
duplicate protection, path safety and isolation are verified deterministically
without a real face image. `test_real_detector.py` exercises the real model when
it has been downloaded, and `FACE_TEST_IMAGE` optionally points at a JPEG with a
face.

Run them:

```bash
npm test                 # hub unit tests (vitest)
npm run test:face        # worker tests (pytest)
npm run test:e2e         # browser QA (Playwright, 1920x1080 Chromium)
```
