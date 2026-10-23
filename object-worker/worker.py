"""Live object-detection worker.

Runs as the `object-worker` Podman service beside the hub. It reads the Admin's
configuration from the shared SQLite database, samples the H.264 camera
substreams through MediaMTX, runs YOLOX-Nano on the CPU, tracks objects and
writes one `object_detection_tracks` row per object. The hub's ingestion poller
turns those rows into events and runs the existing rule/notification pipeline.

It never inserts events, never reads the DVR API, never touches recording
configuration and never exposes a port. Detection stays OFF until an Admin
enables it on /settings/detection.
"""

from __future__ import annotations

import argparse
import json
import logging
import os
import resource
import signal
import sqlite3
import threading
import time
from collections import deque
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Callable

import cv2
import numpy as np

from config import MODEL_NAME, MODEL_VERSION, load_runtime
from detector import Detector, DetectorError
from sampler import CameraReader, build_stream_url
from settings import (
    CAMERA_IDS,
    DetectionConfig,
    EffectiveCamera,
    config_summary,
    default_config,
    load_config,
)
from store import TrackRow, WorkerStore, event_id_for, now_kolkata_iso, utc_now_iso
from tracker import CameraTracker, Track, TrackAction

log = logging.getLogger("object-worker")

EXIT_OK = 0
EXIT_CONFIG = 2
EXIT_DATABASE = 3

DETECTION_FLOOR = 0.30
SCHEDULER_TICK_S = 0.05
OVERLOAD_WINDOW_S = 5.0


class FrameQueue:
    """Bounded, newest-first queue: drops the oldest frame when full."""

    def __init__(self, size: int):
        self._lock = threading.Lock()
        self._not_empty = threading.Condition(self._lock)
        self._items: deque = deque(maxlen=size)
        self.dropped = 0

    def resize(self, size: int) -> None:
        with self._lock:
            current = list(self._items)
            self._items = deque(current[-size:], maxlen=size)

    def put_latest(self, item: tuple) -> None:
        with self._not_empty:
            if len(self._items) == self._items.maxlen:
                self.dropped += 1
            self._items.append(item)  # deque(maxlen) drops the oldest automatically
            self._not_empty.notify()

    def get(self, timeout: float = 0.5):
        with self._not_empty:
            if not self._items:
                self._not_empty.wait(timeout)
            if not self._items:
                return None
            return self._items.popleft()

    def depth(self) -> int:
        with self._lock:
            return len(self._items)


class Metrics:
    def __init__(self) -> None:
        self._lock = threading.Lock()
        self.frames_sampled = 0
        self.frames_inferred = 0
        self.inference_total_s = 0.0
        self.errors = 0
        self.last_inference_at: str | None = None
        self.last_detection_at: str | None = None
        self.started_monotonic = time.monotonic()
        self._cpu_last = time.process_time()
        self._cpu_wall = time.monotonic()

    def sample(self, inference_s: float, detections: int) -> None:
        with self._lock:
            self.frames_inferred += 1
            self.inference_total_s += inference_s
            self.last_inference_at = utc_now_iso()
            if detections:
                self.last_detection_at = utc_now_iso()

    def sampled_frame(self) -> None:
        with self._lock:
            self.frames_sampled += 1

    def error(self) -> None:
        with self._lock:
            self.errors += 1

    def cpu_percent(self) -> float | None:
        try:
            now_cpu = time.process_time()
            now_wall = time.monotonic()
            with self._lock:
                delta_cpu = now_cpu - self._cpu_last
                delta_wall = max(now_wall - self._cpu_wall, 1e-6)
                self._cpu_last = now_cpu
                self._cpu_wall = now_wall
            return round(delta_cpu / delta_wall * 100.0, 1)
        except Exception:  # noqa: BLE001 - metrics are best effort
            return None

    def ram_mb(self) -> float | None:
        try:
            usage = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
            # macOS reports bytes, Linux kilobytes.
            return round(usage / (1024 * 1024) if usage > 10_000_000 else usage / 1024, 1)
        except Exception:  # noqa: BLE001
            return None

    def snapshot(self) -> dict:
        with self._lock:
            average = (self.inference_total_s / self.frames_inferred * 1000.0) if self.frames_inferred else None
            return {
                "framesSampled": self.frames_sampled,
                "framesInferred": self.frames_inferred,
                "averageInferenceMs": round(average, 1) if average is not None else None,
                "lastInferenceAt": self.last_inference_at,
                "lastDetectionAt": self.last_detection_at,
                "errors": self.errors,
            }


class Worker:
    def __init__(
        self,
        runtime,
        store: WorkerStore,
        detector_factory: Callable[[], Detector] | None = None,
        reader_factory: Callable[[int], CameraReader] | None = None,
    ):
        self.runtime = runtime
        self.store = store
        self._detector_factory = detector_factory
        self._reader_factory = reader_factory
        self.config: DetectionConfig = default_config()
        self.detector: Detector | None = None
        # True while the model, inference threads, scheduler and readers are up.
        self.running = False
        self.detector_retry_at = 0.0
        self.trackers: dict[int, CameraTracker] = {}
        self.readers: dict[int, CameraReader] = {}
        self.queue = FrameQueue(1)
        self.executor_threads: list[threading.Thread] = []
        self.executor_stop = threading.Event()
        self.scheduler_stop = threading.Event()
        self.scheduler_thread: threading.Thread | None = None
        self.metrics = Metrics()
        self.boost_until: dict[int, float] = {}
        self.last_queued_sequence: dict[int, int] = {}
        self.next_due: dict[int, float] = {}
        self.dropped = 0
        self.last_drop_monotonic = 0.0
        self.state_lock = threading.Lock()
        self.status = "starting"
        self.detail: str | None = None

    # ------------------------------------------------------------- lifecycle
    def set_status(self, status: str, detail: str | None = None) -> None:
        with self.state_lock:
            self.status = status
            self.detail = detail

    def heartbeat(self) -> None:
        with self.state_lock:
            status, detail = self.status, self.detail
        config = self.config
        monitored = config.enabled_cameras()
        today_start = datetime.now(timezone.utc).astimezone().replace(hour=0, minute=0, second=0, microsecond=0)
        # Use IST midnight to match the rest of the hub.
        ist = timezone(timedelta(hours=5, minutes=30))
        ist_midnight = datetime.now(ist).replace(hour=0, minute=0, second=0, microsecond=0)
        since = ist_midnight.strftime("%Y-%m-%dT%H:%M:%S+05:30")
        queue_depth = self.queue.depth()
        overloaded = (time.monotonic() - self.last_drop_monotonic) <= OVERLOAD_WINDOW_S
        effective_status = "overloaded" if status == "running" and overloaded else status
        metrics = {
            "model": f"{MODEL_NAME} {MODEL_VERSION}",
            "cameras": len(CAMERA_IDS),
            "camerasMonitored": len(monitored),
            "currentFps": round(config.base_fps, 2),
            "inferenceFps": None,
            "averageInferenceMs": None,
            "queueDepth": queue_depth,
            "droppedFrames": self.dropped,
            "detectionsToday": self.store.count_tracks_since(since),
            "personDetectionsToday": self.store.count_tracks_since(since, "person"),
            "vehicleDetectionsToday": self.store.count_tracks_since(since, "vehicle"),
            "cpuPercent": self.metrics.cpu_percent(),
            "ramMb": self.metrics.ram_mb(),
            "lastInferenceAt": None,
            "lastDetectionAt": None,
            "errors": self.metrics.errors,
            "framesSampled": None,
            "framesInferred": None,
            "settings": {
                "enabled": config.enabled,
                "cameras": monitored,
                "baseFps": config.base_fps,
                "activeFps": config.active_fps,
                "maxFps": config.max_fps,
                "personConfidence": config.person_confidence,
                "vehicleConfidence": config.vehicle_confidence,
                "detectionSource": config.detection_source,
                "perCamera": [
                    {
                        "camera": camera,
                        "person": config.effective(camera).person_confidence,
                        "vehicle": config.effective(camera).vehicle_confidence,
                        "personEnabled": config.effective(camera).person,
                        "vehicleEnabled": config.effective(camera).vehicle,
                    }
                    for camera in monitored
                ],
            },
        }
        base = self.metrics.snapshot()
        metrics.update(
            {
                "averageInferenceMs": base["averageInferenceMs"],
                "lastInferenceAt": base["lastInferenceAt"],
                "lastDetectionAt": base["lastDetectionAt"],
                "framesSampled": base["framesSampled"],
                "framesInferred": base["framesInferred"],
            }
        )
        elapsed = max(time.monotonic() - self.metrics.started_monotonic, 1e-6)
        if base["framesInferred"]:
            metrics["inferenceFps"] = round(base["framesInferred"] / elapsed, 2)
        self.store.write_heartbeat(effective_status, detail, metrics)
        log.debug(
            "heartbeat status=%s sampled=%s inferred=%s queue=%s dropped=%s",
            effective_status,
            base["framesSampled"],
            base["framesInferred"],
            queue_depth,
            self.dropped,
        )

    def _run_test_requests(self) -> None:
        """Process the Admin's on-demand detection tests (bounded, best effort).

        A request analyses exactly the snapshot stored against an event and
        writes the raw detections back. It does not create events, does not
        notify and works even while detection is disabled.
        """
        try:
            requests = self.store.pending_test_requests(3)
        except sqlite3.Error:
            return
        for request in requests:
            request_id = str(request["id"])
            if not self.store.start_test_request(request_id):
                continue
            camera_id = int(request["camera_id"])
            relative = str(request["snapshot_path"])
            root = self.runtime.snapshots_dir.resolve()
            target = (root / relative).resolve()
            if not str(target).startswith(str(root) + os.sep):
                self.store.finish_test_request(request_id, "error", json.dumps({"error": "invalid_snapshot_path"}))
                continue
            frame = cv2.imread(str(target)) if target.is_file() else None
            if frame is None:
                self.store.finish_test_request(request_id, "error", json.dumps({"error": "image_unavailable"}))
                continue
            detector = self._ensure_detector()
            if detector is None:
                self.store.finish_test_request(request_id, "error", json.dumps({"error": "model_unavailable"}))
                continue
            started = time.perf_counter()
            detections = detector.detect(frame, floor=DETECTION_FLOOR)
            inference_ms = round((time.perf_counter() - started) * 1000, 1)
            effective = self.config.effective(camera_id)
            result = {
                "model": f"{MODEL_NAME} {MODEL_VERSION}",
                "cameraId": camera_id,
                "inferenceMs": inference_ms,
                "image": {"width": int(frame.shape[1]), "height": int(frame.shape[0])},
                "thresholds": {
                    "person": float(effective.person_confidence),
                    "vehicle": float(effective.vehicle_confidence),
                },
                "detections": [
                    {
                        "rawClass": detection.raw_class,
                        "classification": detection.classification,
                        "confidence": round(float(detection.confidence), 4),
                        "boundingBox": {
                            "x": round(float(detection.x), 1),
                            "y": round(float(detection.y), 1),
                            "width": round(float(detection.width), 1),
                            "height": round(float(detection.height), 1),
                        },
                        "accepted": detection.confidence
                        >= (
                            effective.person_confidence
                            if detection.classification == "person"
                            else effective.vehicle_confidence
                        ),
                    }
                    for detection in detections
                ],
            }
            self.store.finish_test_request(request_id, "done", json.dumps(result))
            log.info("detection test %s completed: %d detection(s)", request_id, len(detections))

    # --------------------------------------------------------------- cameras
    def _url_for(self, camera_id: int) -> str:
        return build_stream_url(
            self.runtime.stream_kind,
            self.runtime.stream_base,
            self.runtime.stream_user,
            self.runtime.stream_password,
            camera_id,
        )

    def _make_reader(self, camera_id: int) -> CameraReader:
        if self._reader_factory is not None:
            return self._reader_factory(camera_id)
        return CameraReader(
            camera_id=camera_id,
            url_provider=lambda cid=camera_id: self._url_for(cid),
            stale_after_s=self.runtime.frame_stale_s,
            reconnect_backoff_s=self.runtime.reconnect_backoff_s,
        )

    def _reconcile_readers(self, runnable: bool) -> None:
        """Start/stop camera readers so they follow the saved camera switches.

        Readers only run while detection is actually active; a disabled feature
        never holds MediaMTX streams open.
        """
        wanted = set(self.config.enabled_cameras()) if runnable else set()
        for camera_id in list(self.readers):
            if camera_id not in wanted:
                self.readers.pop(camera_id).stop()
                tracker = self.trackers.pop(camera_id, None)
                if tracker is not None:
                    self._end_all(camera_id, tracker)
                self.boost_until.pop(camera_id, None)
                self.next_due.pop(camera_id, None)
                self.last_queued_sequence.pop(camera_id, None)
        for camera_id in wanted:
            if camera_id not in self.readers:
                reader = self._make_reader(camera_id)
                reader.start()
                self.readers[camera_id] = reader
                self.trackers.setdefault(
                    camera_id, CameraTracker(camera_id, self.runtime.max_tracks_per_camera)
                )

    def apply_config(self, config: DetectionConfig) -> None:
        """Adopt a new configuration snapshot (readers and queue follow it)."""
        previous = self.config
        self.config = config
        if previous.queue_size != config.queue_size:
            self.queue.resize(config.queue_size)
        runnable = config.enabled and bool(config.enabled_cameras())
        self._reconcile_readers(runnable)
        if config_summary(previous) != config_summary(config):
            log.info("settings applied: %s", config_summary(config))

    def _ensure_detector(self) -> Detector | None:
        if self.detector is not None:
            return self.detector
        now = time.monotonic()
        if now < self.detector_retry_at:
            return None
        try:
            self.detector = (
                self._detector_factory() if self._detector_factory is not None else Detector(str(self.runtime.model_path))
            )
        except DetectorError as error:
            self.detector_retry_at = now + 10.0
            log.error("could not load the model: %s", error)
            return None
        return self.detector

    def _start_detection(self) -> bool:
        detector = self._ensure_detector()
        if detector is None:
            self.set_status("error", "model unavailable")
            return False
        self._start_inference_threads(self.config.max_concurrent)
        self._start_scheduler()
        self.running = True
        self.set_status("running")
        log.info(
            "detection started: cameras=%s person>=%.2f vehicle>=%.2f base_fps=%.1f",
            ",".join(str(camera) for camera in self.config.enabled_cameras()),
            self.config.person_confidence,
            self.config.vehicle_confidence,
            self.config.base_fps,
        )
        return True

    def _stop_detection(self, detail: str | None = None) -> None:
        if not self.running:
            return
        self.scheduler_stop.set()
        self._stop_inference_threads()
        if self.scheduler_thread is not None:
            self.scheduler_thread.join(timeout=2.0)
            self.scheduler_thread = None
        for reader in self.readers.values():
            reader.stop()
        self.readers.clear()
        for camera_id, tracker in list(self.trackers.items()):
            self._end_all(camera_id, tracker)
        self.trackers.clear()
        self.running = False
        self.set_status("disabled", detail)
        log.info("detection stopped: %s", detail or "disabled")

    def reconcile(self, config: DetectionConfig) -> None:
        """One supervisor step: adopt saved settings and start/stop detection.

        This is what makes a UI save take effect on a worker that was started
        while detection was OFF (the shipped default). It also handles the
        reverse transition without restarting the process, and restarts the
        inference threads when the concurrency setting changes.
        """
        was_running = self.running
        previous_max = self.config.max_concurrent
        previous_cameras = set(self.config.enabled_cameras()) if self.config.enabled else set()
        self.apply_config(config)
        runnable = config.enabled and bool(config.enabled_cameras())

        if runnable:
            if not self.running:
                self._start_detection()
            elif self.detector is not None and previous_max != config.max_concurrent:
                self._stop_inference_threads()
                self._start_inference_threads(config.max_concurrent)
        else:
            if self.running:
                self._stop_detection("disabled")
            else:
                self.set_status("disabled")

        # A model that failed to load should be retried even while idle.
        if runnable and self.detector is None:
            self._start_detection()

        cameras_now = set(self.config.enabled_cameras()) if self.config.enabled else set()
        if was_running and cameras_now != previous_cameras:
            log.info(
                "monitored cameras changed: %s",
                ",".join(str(camera) for camera in sorted(cameras_now)) or "none",
            )

    def _start_inference_threads(self, count: int) -> None:
        self.executor_stop.clear()
        self.executor_threads = []
        for index in range(max(1, count)):
            thread = threading.Thread(target=self._inference_loop, name=f"inference-{index}", daemon=True)
            thread.start()
            self.executor_threads.append(thread)

    def _stop_inference_threads(self) -> None:
        self.executor_stop.set()
        for thread in self.executor_threads:
            thread.join(timeout=2.0)
        self.executor_threads = []

    def _start_scheduler(self) -> None:
        self.scheduler_stop.clear()
        self.scheduler_thread = threading.Thread(target=self._schedule_loop, name="scheduler", daemon=True)
        self.scheduler_thread.start()

    def _schedule_loop(self) -> None:
        while not self.scheduler_stop.is_set():
            now = time.monotonic()
            config = self.config
            for camera_id, reader in list(self.readers.items()):
                effective = config.effective(camera_id)
                if not effective.enabled:
                    continue
                due = self.next_due.get(camera_id, 0.0)
                if now < due:
                    continue
                boosting = config.motion_boost and self.boost_until.get(camera_id, 0.0) > now
                target_fps = config.active_fps if boosting else config.base_fps
                target_fps = min(target_fps, config.max_fps)
                interval = 1.0 / max(target_fps, 0.1)
                self.next_due[camera_id] = now + interval
                latest = reader.get()
                if latest.frame is None:
                    continue
                if (now - latest.received_at) > self.runtime.frame_stale_s:
                    continue  # never infer a stale frame
                if self.last_queued_sequence.get(camera_id) == latest.sequence:
                    continue
                self.last_queued_sequence[camera_id] = latest.sequence
                self.metrics.sampled_frame()
                self.queue.put_latest((camera_id, latest.frame, datetime.now(timezone.utc), effective))
                if self.queue.dropped != self.dropped:
                    self.dropped = self.queue.dropped
                    self.last_drop_monotonic = time.monotonic()
            time.sleep(SCHEDULER_TICK_S)

    # ------------------------------------------------------------- inference
    def _inference_loop(self) -> None:
        while True:
            item = self.queue.get(timeout=0.5)
            if item is None:
                if self.executor_stop.is_set():
                    return
                continue
            if self.executor_stop.is_set():
                return
            camera_id, frame, captured_at, effective = item
            try:
                self._infer(camera_id, frame, captured_at, effective)
            except Exception as error:  # noqa: BLE001 - one bad frame must not kill the worker
                self.metrics.error()
                log.exception("inference failed for camera %s: %s", camera_id, type(error).__name__)
                self.set_status("error", "inference failed")

    def _infer(self, camera_id: int, frame: np.ndarray, captured_at: datetime, effective: EffectiveCamera) -> None:
        if self.detector is None:
            return
        started = time.perf_counter()
        detections = self.detector.detect(frame, floor=DETECTION_FLOOR)
        inference_s = time.perf_counter() - started

        accepted: list[tuple] = []
        for detection in detections:
            if detection.classification == "person":
                if effective.person and detection.confidence >= effective.person_confidence:
                    accepted.append((detection, effective.person_confidence))
            elif detection.classification == "vehicle":
                if effective.vehicle and detection.confidence >= effective.vehicle_confidence:
                    accepted.append((detection, effective.vehicle_confidence))
        self.metrics.sample(inference_s, len(accepted))

        tracker = self.trackers.get(camera_id)
        if tracker is None:
            return
        actions = tracker.update(accepted, captured_at, self.config.disappearance_timeout_s)
        if accepted:
            self.boost_until[camera_id] = time.monotonic() + self.config.activity_timeout_s
        self._persist_actions(camera_id, actions, frame, captured_at)

    def _persist_actions(self, camera_id: int, actions: list[TrackAction], frame: np.ndarray, now: datetime) -> None:
        if not actions:
            return
        jpeg: bytes | None = None
        for action in actions:
            track = action.track
            if action.kind == "ended":
                if track.persisted:
                    self.store.mark_track_ended(track.id)
                continue
            if action.kind == "started":
                # The exact analysed frame is the event image; encode it once.
                if track.snapshot_jpeg is None and frame is not None:
                    if jpeg is None:
                        ok, buffer = cv2.imencode(".jpg", frame, [int(cv2.IMWRITE_JPEG_QUALITY), 90])
                        jpeg = bytes(buffer) if ok else b""
                    track.snapshot_jpeg = jpeg or None
            if track.persisted:
                self._write_track(track)
                continue
            if track.duration_s < self.config.min_event_duration_s:
                continue
            self._write_track(track, persist=True)

    def _write_track(self, track: Track, persist: bool = False) -> None:
        first_seen = now_kolkata_iso(track.first_seen)
        last_seen = now_kolkata_iso(track.last_seen)
        event_id = track.event_id or event_id_for(track.camera_id, track.id, first_seen)
        snapshot_path = track.snapshot_path
        if persist and snapshot_path is None and track.snapshot_jpeg:
            snapshot_path = self.store.write_snapshot(
                self.runtime.snapshots_dir,
                track.camera_id,
                event_id,
                first_seen,
                track.snapshot_jpeg,
            )
        track.event_id = event_id
        track.snapshot_path = snapshot_path
        track.persisted = True
        row = TrackRow(
            id=track.id,
            camera_id=track.camera_id,
            classification=track.classification,
            raw_class=track.raw_class,
            confidence=track.confidence,
            threshold=track.threshold,
            x=int(round(track.bbox[0])),
            y=int(round(track.bbox[1])),
            width=int(round(track.bbox[2])),
            height=int(round(track.bbox[3])),
            first_seen=first_seen,
            last_seen=last_seen,
            detection_count=track.detection_count,
            snapshot_path=snapshot_path,
            event_id=event_id,
            status="ended" if track.ended else "active",
            detector=track.detector,
            model=track.model,
        )
        self.store.upsert_track(row)

    def _end_all(self, camera_id: int, tracker: CameraTracker) -> None:
        for track in tracker.tracks:
            if track.persisted:
                self.store.mark_track_ended(track.id)
        tracker.tracks = []

    # ------------------------------------------------------------------- run
    def run(self, stopping: threading.Event, once: bool = False) -> int:
        self.store.write_heartbeat("starting", None, {"model": f"{MODEL_NAME} {MODEL_VERSION}"})
        requeued = self.store.reset_stale_test_requests()
        if requeued:
            log.info("requeued %d stale detection test request(s)", requeued)

        last_heartbeat = 0.0
        try:
            while not stopping.is_set():
                # Re-read the Admin configuration on every step. This is the one
                # authoritative source; the worker never caches it across saves.
                config = load_config(self.store.connection)
                self.reconcile(config)

                now = time.monotonic()
                if now - last_heartbeat >= self.runtime.heartbeat_s:
                    self.heartbeat()
                    last_heartbeat = now
                self._run_test_requests()

                if once:
                    return EXIT_OK
                stopping.wait(min(1.0, self.runtime.settings_poll_s))
        except sqlite3.Error:
            self.metrics.error()
            self.set_status("error", "database unavailable")
            self.store.write_heartbeat("error", "database unavailable", {"model": f"{MODEL_NAME} {MODEL_VERSION}"})
        finally:
            self.scheduler_stop.set()
            self._stop_inference_threads()
            if self.scheduler_thread is not None:
                self.scheduler_thread.join(timeout=2.0)
                self.scheduler_thread = None
            for reader in self.readers.values():
                reader.stop()
            self.readers.clear()
            for camera_id, tracker in list(self.trackers.items()):
                self._end_all(camera_id, tracker)
            self.trackers.clear()
            self.running = False
            if once:
                # A diagnostic --once run reports the state it actually saw
                # (disabled, running or error), not "stopped".
                self.heartbeat()
            else:
                self.set_status("stopped")
                self.heartbeat()
        return EXIT_OK


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Home CCTV Hub live object-detection worker")
    parser.add_argument("--once", action="store_true", help="start, write one heartbeat, then exit")
    parser.add_argument("--verbose", action="store_true", help="debug logging")
    args = parser.parse_args(argv)

    logging.basicConfig(
        level=logging.DEBUG if args.verbose else logging.INFO,
        format="[object-worker] %(levelname)s %(message)s",
    )

    runtime = load_runtime()
    if not runtime.db_path.is_file():
        log.error("database not found at %s", runtime.db_path)
        log.error("start the hub once so it creates data/events.sqlite, or check DATA_DIR")
        return EXIT_DATABASE
    if not runtime.model_path.is_file():
        log.error("model not found at %s", runtime.model_path)
        log.error("fetch it once: python3 object-worker/scripts/download_model.py")
        return EXIT_CONFIG

    store = WorkerStore(runtime.db_path)
    stopping = threading.Event()

    def request_stop(signum, _frame):  # pragma: no cover - signal path
        log.info("received signal %s, stopping", signum)
        stopping.set()

    signal.signal(signal.SIGINT, request_stop)
    signal.signal(signal.SIGTERM, request_stop)

    try:
        return Worker(runtime, store).run(stopping, once=args.once)
    finally:
        store.close()


if __name__ == "__main__":
    raise SystemExit(main())
