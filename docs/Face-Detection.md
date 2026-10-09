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
that do not exist. Neither script copies `.env`.

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

## 16. Tests

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
