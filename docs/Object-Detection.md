# Live object detection (person / vehicle)

The hub detects **people and vehicles** itself on the existing H.264 camera
substreams, instead of relying on the DVR's `Human`/`Vehicle` labels.

Detection is **off by default**. Nothing is enabled by deployment: an Admin turns
it on in **Settings → Object detection** (`/settings/detection`).

## 1. Architecture

```
Hikvision DVR ─ H.264 substream (704×576, 102/202/302/402)
      │
      ▼
MediaMTX  camN_sub  (internal RTSP :8554, never published on the LAN)
      │
      ▼
object-worker (Podman service, CPU only, no ports)
   ├─ samples frames at the configured FPS (base / active boost / max cap)
   ├─ YOLOX-Nano ONNX on the CPU
   ├─ IoU + centroid tracker → one event per object
   ├─ writes the EXACT analysed frame to data/events/…
   └─ writes object_detection_tracks + heartbeat/metrics
      │
      ▼ shared SQLite (data/events.sqlite)
hub ingestion poller (web process, every 2 s)
   ├─ creates the event (source = object-detection-worker)
   ├─ attaches the analysed frame as the snapshot
   ├─ runs the existing rule engine / cooldown / dedupe / history
   └─ queues the existing media-only Telegram delivery
```

The browser never runs inference and no media is exposed publicly. The DVR,
recording configuration, H.265 main track, WebRTC, playback and Cloudflare /
Tailscale setup are unchanged.

**Why RTSP and not HLS from MediaMTX?** MediaMTX's HLS endpoint authenticates
with a browser cookie handshake that FFmpeg/OpenCV cannot complete, while its
RTSP listener accepts the read credential directly. `scripts/render-mediamtx-
config.mjs` therefore enables MediaMTX's RTSP listener on `:8554`, **internal to
the compose network only** (the production compose file publishes no such port).
HLS remains available for the worker with `OBJECT_DETECTION_STREAM=hls`.

## 2. Model

| Item | Value |
| --- | --- |
| Model | YOLOX-Nano ONNX, version 0.1.1 |
| Licence | Apache-2.0 |
| Size | 3.66 MB |
| Input | 416 × 416 |
| Raw classes | person, car, motorcycle, bus, truck (all other COCO classes dropped) |
| App classes | person → **PERSON**; car/motorcycle/bus/truck → **VEHICLE** |
| Runtime | onnxruntime CPU, no GPU, no cloud, offline |
| File | `object-worker/models/yolox_nano.onnx`, mounted read-only |
| Measured inference | ~21 ms/frame on the development host (Apple Silicon) |
| Measured worker footprint | ~214 MB RAM, ~28 % of one core at 2 cameras @ 1 FPS |

Confidence always comes from the detector. The DVR's Human/Vehicle label is never
used as a confidence value.

Fetch the model once (checksum verified, nothing downloads at runtime):

```bash
python3 object-worker/scripts/download_model.py
```

## 3. Settings (SQLite, Admin UI)

Stored in `object_detection_settings` / `object_detection_camera_settings` and
edited on `/settings/detection`. The worker re-reads them every 3 s; a saved
change applies without restarting a container.

| Setting | Default | Range |
| --- | --- | --- |
| Enable object detection | off | on/off |
| Person detection | on (when enabled) | on/off |
| Person confidence | 70 % | 50–99 % |
| Vehicle detection | on (when enabled) | on/off |
| Vehicle confidence | 70 % | 50–99 % |
| Base AI FPS (per camera) | 1 | 0.5–5 |
| Active AI FPS | 3 | 0.5–5 |
| Maximum AI FPS | 5 | 0.5–5 |
| Motion-triggered boost | on | on/off |
| Activity timeout | 10 s | 1–60 |
| Object disappearance timeout | 3 s | 1–10 |
| Maximum concurrent inference | 1 | 1–4 |
| Inference queue size | 2 | 1–10 |
| Minimum event duration | 0 s (off) | 0–60 |
| Detection source | AI only | AI only / DVR only / AI + DVR |

Per camera: detection on/off, person on/off, vehicle on/off, and optional
confidence overrides with a “use global” toggle. Validation is server-side; the
browser form is a convenience, not a trust boundary. Every save is audited.

### Detection source

- **AI only (default):** only object-worker events raise person/vehicle
  notifications. DVR person/vehicle events are stored and searchable, but do not
  notify.
- **DVR only:** the historical behaviour; the DVR labels notify.
- **AI + DVR:** both notify; existing cooldown and notification history remain
  the duplicate guard.

Rules, schedules, quiet hours, priority, cooldown, deduplication and notification
history are unchanged in every mode.

## 4. Events, snapshots and the UI

One tracked object = one event:

- start = first accepted detection; the event is updated while the object stays
  visible and ends after the disappearance timeout;
- stored: raw class, confidence, threshold used, bounding box, detector/model,
  track id, first/last seen, duration;
- `source = object-detection-worker`; DVR events keep `source = hikvision`;
- **the snapshot is the exact frame passed to the detector**, never a later live
  still and never “the latest snapshot”;
- the event detail page draws the stored bounding box over the snapshot and
  lists detector, raw class, threshold and track id. Display only.

## 5. Telegram

Accepted events enter the existing notification pipeline. Person/vehicle
notifications are media only: the event image (the analysed frame) or the
event-time clip, with a short caption in Telegram's `caption` field:

```
🚨 Person detected            🚗 Vehicle detected

📹 Camera: Parking            📹 Camera: Left Side Outside
🕐 Time: 23 Oct 2026, 06:34 PM
🎯 Confidence: 87%            🎯 Confidence: 70%
```

The camera name and timestamp come from the stored event (never the upload
time), and the confidence is the detector's own value — 87 % is `0.87`. If the
source has no confidence (a DVR-only event), that line is omitted rather than
invented. Rules, cooldown, dedupe and quiet hours still apply. If media cannot
be prepared nothing is sent — no text fallback, no unrelated image.

**DVR clock offset:** AI detection times use the server clock, while the DVR
indexes recordings by its own clock (measured ~20 s behind here). The hub shifts
the clip search timestamp by the measured offset so the event-time video covers
the right seconds; the event itself keeps the real detection time.

## 6. CPU safety

- one inference at a time by default (1–4 allowed);
- bounded queue (default 2) that **drops the oldest frame**; the newest frame is
  always preferred, stale frames (>1 s) are never inferred;
- per-camera sampling at the configured FPS with a hard `max_fps` cap;
- adaptive boost only after activity, for a bounded timeout;
- status and metrics (FPS, inference ms, queue, dropped frames, CPU, RAM,
  detections today) on the settings page and in `object_worker_heartbeat`.

Start with Parking only, watch the metrics, then add cameras gradually.

## 7. Install / run

The worker is part of the normal stack and starts automatically:

```bash
podman compose up -d               # web, MediaMTX and object-worker
podman compose ps                  # object-worker should be healthy
podman compose logs -f object-worker
```

No profile flag and no manual model step are needed. On the first start the
container provisions the YOLOX-Nano model once into `./object-worker/models`
(checksum verified, ~3.6 MB). If the file is already present it is verified and
reused, so later starts are offline-safe; to pre-fetch it on an air-gapped host:

```bash
npm run object:model               # python3 object-worker/scripts/download_model.py
```

Then enable detection and at least one camera in `/settings/detection`. That is
the only switch: Compose controls whether the worker process exists, SQLite
(Settings) controls whether it analyses frames. With detection off the container
stays running and healthy (heartbeat `disabled`) with no inference; toggling it
on starts detection without restarting the container.

The healthcheck reads the worker's existing heartbeat: fresh heartbeat is healthy
whether detection is enabled or disabled; a crashed/hung process (or a model
error) is unhealthy. Restart policy is `unless-stopped`, so the worker returns
after a container crash, Podman restart or server reboot.

Local development without Podman for the worker:

```bash
# once: a Python 3.12/3.13 venv with the worker dependencies
python3 -m venv .venv-object
.venv-object/bin/pip install -r object-worker/requirements-dev.txt

# MediaMTX must keep the development port overlay (internal RTSP on loopback)
podman compose -f compose.yml -f compose.dev.yml up -d mediamtx

# stop the container worker so the host worker is the only one running
podman compose stop object-worker

# run the worker on the host (reads the same ./data and MediaMTX)
npm run object:worker:local
```

**Note for macOS:** keep the worker on the host rather than the container for
local development. The Podman VM sees `./data` through a virtual filesystem, and
several SQLite writers across that boundary can produce stale reads or index
inconsistencies; the container is the deployment path for the Linux host, where
`./data` is a local filesystem. A long-running dev server can also cache a stale
SQLite view after heavy external writes — restart `npm run dev` if settings or
events appear out of date.

`npm run test:object` runs the Python tests; `npm run object:model` fetches the
model.

## 8. Run detection test

The Diagnostics section on `/settings/detection` has **Run detection test**. It
queues a durable request for the most recent event snapshot; the worker analyses
exactly that image and reports every raw detection with its confidence, box and
whether it passes the current threshold. It creates no event and sends nothing.
If the worker is not running the request stays pending and is picked up when the
worker starts.

## 9. Disable

Switch detection off on `/settings/detection` (the worker idles and loads no
model), or stop the service: `podman compose stop object-worker`. Choose
**DVR only** as the detection source to restore the historical DVR behaviour.

## 10. Troubleshooting

| Symptom | Check |
| --- | --- |
| Worker status “Not running” | `podman ps`; is the `object-worker` service up? |
| Status “Disabled” | Master switch off, or no camera enabled. |
| Status “Overloaded” | Lower base/active FPS or disable cameras; check inference ms. |
| Status “Error” | Worker log; usually the model file is missing. |
| No detections | Camera enabled? Threshold too high? Check the Run detection test result. |
| Dev page reloads repeatedly | Clear the Turbopack cache (`rm -rf .next`) and restart `npm run dev`. |
| Stream connect failures | Is MediaMTX healthy and is its internal RTSP port enabled? |

## 11. Limitations and measurements

- **Accuracy:** the detector recognises reasonably sized people and vehicles. On
  the previously investigated “Left Side Outside” frame (a tiny distant
  pedestrian at the top edge) YOLOX-Nano returns **no detection above its 0.30
  floor**, so the AI-only pipeline does not notify for it. Clear subjects score
  well: a walking person 0.83, a motorcycle rider 0.80, a passing car ~0.70.
  Very distant, tiny or heavily occluded subjects are intentionally filtered.
- **H.264 substream only:** 704×576, no H.265, no transcoding, no DVR changes.
- **RTSP input:** MediaMTX's RTSP listener is enabled internally; it is never
  published and does not change the camera or recording architecture.
- **CPU:** the model is small enough for a 2-core i3-5005U at 1 FPS per camera;
  test one camera first. Inference time on that CPU will be higher than the
  ~21 ms measured on the development host (budget 100–200 ms/frame).
- **Face detection is separate and unchanged.** No face recognition is done here.
- **Tracking** is a lightweight IoU/centroid tracker, not a heavy MOT framework.
- **Startup backfill:** only the hub's DVR poller has the old snapshot-association
  guard; AI events always carry their own analysed frame.
