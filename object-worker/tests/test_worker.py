import dataclasses
import threading

import numpy as np
from datetime import datetime, timedelta, timezone
from pathlib import Path

from config import WorkerRuntime
from settings import default_config
from store import WorkerStore
from tracker import Track, TrackAction
from worker import FrameQueue, Worker

JPEG_A = b"\xff\xd8\xff\xe0" + b"first-frame" * 10


def make_runtime(tmp_path) -> WorkerRuntime:
    return WorkerRuntime(
        data_dir=tmp_path,
        model_path=tmp_path / "model.onnx",
        stream_kind="rtsp",
        stream_base="rtsp://127.0.0.1:8554",
        stream_user="hub",
        stream_password="secret",
        settings_poll_s=0.1,
        heartbeat_s=0.1,
        frame_stale_s=1.0,
        reconnect_backoff_s=0.2,
        max_tracks_per_camera=20,
    )


def make_track(event_time: datetime | None = None, jpeg: bytes = JPEG_A) -> Track:
    start = event_time or datetime(2026, 10, 23, 9, 21, 0, tzinfo=timezone.utc)
    return Track(
        id="trk_persist",
        camera_id=1,
        raw_class="person",
        classification="person",
        confidence=0.82,
        threshold=0.7,
        bbox=(100.0, 100.0, 40.0, 80.0),
        first_seen=start,
        last_seen=start,
        detection_count=1,
        snapshot_jpeg=jpeg,
    )


def test_frame_queue_drops_the_oldest_frame():
    queue = FrameQueue(2)
    queue.put_latest(("frame", 1))
    queue.put_latest(("frame", 2))
    queue.put_latest(("frame", 3))
    assert queue.depth() == 2
    assert queue.dropped == 1
    first = queue.get(timeout=0.01)
    second = queue.get(timeout=0.01)
    # The newest two survive; the stale first frame was dropped.
    assert first == ("frame", 2)
    assert second == ("frame", 3)


def test_started_track_writes_the_exact_analysed_frame(tmp_path):
    store = WorkerStore(tmp_path / "events.sqlite")
    worker = Worker(make_runtime(tmp_path), store)
    worker.config = dataclasses.replace(default_config(), min_event_duration_s=0)
    track = make_track()

    now = datetime(2026, 10, 23, 9, 21, 0, tzinfo=timezone.utc)
    worker._persist_actions(1, [TrackAction("started", track)], frame=None, now=now)  # type: ignore[arg-type]

    row = store.connection.execute("SELECT * FROM object_detection_tracks WHERE id='trk_persist'").fetchone()
    assert row is not None
    assert row["event_id"].startswith("evt_")
    assert row["snapshot_path"] == f"2026/10/23/1-{row['event_id']}.jpg"
    snap = tmp_path / "events" / row["snapshot_path"]
    # The bytes are the first analysed frame, never a later one.
    assert snap.read_bytes() == JPEG_A
    store.close()


def test_minimum_event_duration_defers_the_event_but_keeps_the_first_frame(tmp_path):
    store = WorkerStore(tmp_path / "events.sqlite")
    worker = Worker(make_runtime(tmp_path), store)
    worker.config = dataclasses.replace(default_config(), min_event_duration_s=5)
    track = make_track()

    start = track.first_seen
    worker._persist_actions(1, [TrackAction("started", track)], frame=None, now=start)  # type: ignore[arg-type]
    assert store.connection.execute("SELECT COUNT(*) AS c FROM object_detection_tracks").fetchone()["c"] == 0

    track.last_seen = start + timedelta(seconds=6)
    track.detection_count = 3
    # Later frames keep flowing in, but they must never replace the stored image.
    later_frame = np.zeros((576, 704, 3), dtype=np.uint8)
    worker._persist_actions(1, [TrackAction("updated", track)], frame=later_frame, now=track.last_seen)  # type: ignore[arg-type]

    row = store.connection.execute("SELECT * FROM object_detection_tracks WHERE id='trk_persist'").fetchone()
    assert row["snapshot_path"] == f"2026/10/23/1-{row['event_id']}.jpg"
    assert (tmp_path / "events" / row["snapshot_path"]).read_bytes() == JPEG_A
    store.close()


def test_ended_action_closes_the_stored_track(tmp_path):
    store = WorkerStore(tmp_path / "events.sqlite")
    worker = Worker(make_runtime(tmp_path), store)
    worker.config = default_config()
    track = make_track()
    now = datetime(2026, 10, 23, 9, 21, 0, tzinfo=timezone.utc)
    worker._persist_actions(1, [TrackAction("started", track)], frame=None, now=now)  # type: ignore[arg-type]
    track.ended = True
    track.last_seen = now + timedelta(seconds=4)
    worker._persist_actions(1, [TrackAction("ended", track)], frame=None, now=track.last_seen)  # type: ignore[arg-type]
    assert store.connection.execute("SELECT status FROM object_detection_tracks WHERE id='trk_persist'").fetchone()["status"] == "ended"
    store.close()


def test_disabled_worker_writes_a_disabled_heartbeat_and_exits(tmp_path):
    runtime = make_runtime(tmp_path)
    store = WorkerStore(runtime.db_path)
    stopping = threading.Event()
    code = Worker(runtime, store).run(stopping, once=True)
    assert code == 0
    row = store.connection.execute("SELECT status FROM object_worker_heartbeat WHERE id=1").fetchone()
    assert row["status"] == "disabled"
    store.close()


class StubDetector:
    def detect(self, _frame, floor=0.3):
        from detector import Detection

        return [
            Detection(
                raw_class="person",
                classification="person",
                confidence=0.81,
                x=10.0,
                y=20.0,
                width=30.0,
                height=40.0,
            )
        ]


def test_detection_test_request_analyses_the_events_snapshot(tmp_path):
    import cv2
    import numpy as np

    from store import now_kolkata_iso

    runtime = make_runtime(tmp_path)
    store = WorkerStore(runtime.db_path)
    worker = Worker(runtime, store)
    worker.config = dataclasses.replace(default_config(), person_confidence=0.7, vehicle_confidence=0.7)

    snapshot_dir = runtime.snapshots_dir / "2026/10/23"
    snapshot_dir.mkdir(parents=True)
    snapshot = snapshot_dir / "1-evt_test.jpg"
    cv2.imwrite(str(snapshot), np.zeros((576, 704, 3), dtype=np.uint8))

    now = now_kolkata_iso()
    store.connection.execute(
        """INSERT INTO object_detection_test_requests
             (id, event_id, camera_id, snapshot_path, status, result, created_at, updated_at)
           VALUES ('odt_test', 'evt_test', 1, '2026/10/23/1-evt_test.jpg', 'pending', NULL, ?, ?)""",
        (now, now),
    )

    worker.detector = StubDetector()
    worker._run_test_requests()

    row = store.connection.execute("SELECT status, result FROM object_detection_test_requests WHERE id='odt_test'").fetchone()
    assert row["status"] == "done"
    result = __import__("json").loads(row["result"])
    assert result["model"] == "YOLOX-Nano 0.1.1"
    assert result["image"] == {"width": 704, "height": 576}
    assert result["detections"][0]["rawClass"] == "person"
    assert result["detections"][0]["accepted"] is True
    store.close()


def test_detection_test_request_rejects_a_missing_snapshot(tmp_path):
    import json

    from store import now_kolkata_iso

    runtime = make_runtime(tmp_path)
    store = WorkerStore(runtime.db_path)
    worker = Worker(runtime, store)
    worker.detector = StubDetector()
    now = now_kolkata_iso()
    store.connection.execute(
        """INSERT INTO object_detection_test_requests
             (id, event_id, camera_id, snapshot_path, status, result, created_at, updated_at)
           VALUES ('odt_missing', 'evt_test', 1, '2026/10/23/missing.jpg', 'pending', NULL, ?, ?)""",
        (now, now),
    )
    worker._run_test_requests()
    row = store.connection.execute("SELECT status, result FROM object_detection_test_requests WHERE id='odt_missing'").fetchone()
    assert row["status"] == "error"
    assert json.loads(row["result"])["error"] == "image_unavailable"
    store.close()


class FakeDetector:
    def __init__(self):
        self.calls = 0

    def detect(self, _frame, floor=0.3):
        return []


class FakeReader:
    def __init__(self):
        self.started = 0
        self.stopped = 0
        self.latest = type("Latest", (), {"frame": None, "received_at": 0.0, "sequence": 0})()

    def start(self):
        self.started += 1

    def stop(self):
        self.stopped += 1

    def get(self):
        return self.latest


def camera_on(config, camera_id: int):
    return dataclasses.replace(
        config,
        cameras=tuple(
            dataclasses.replace(camera, enabled=(camera.camera_id == camera_id)) for camera in config.cameras
        ),
    )


def supervisor_worker(tmp_path, detector_factory=None, reader_factory=None):
    store = WorkerStore(tmp_path / "events.sqlite")
    detector = FakeDetector()
    readers: list[FakeReader] = []

    def make_detector():
        detector.calls += 1
        return detector

    def make_reader(_camera_id):
        reader = FakeReader()
        readers.append(reader)
        return reader

    worker = Worker(
        make_runtime(tmp_path),
        store,
        detector_factory=detector_factory or make_detector,
        reader_factory=reader_factory or make_reader,
    )
    return worker, store, detector, readers


def test_enabling_detection_starts_a_worker_that_booted_disabled(tmp_path):
    """Regression: the shipped default is OFF, so the common path is a worker
    started disabled followed by an Admin save. That used to leave the worker
    stuck in "disabled" with no model and no inference until a restart."""
    worker, store, detector, readers = supervisor_worker(tmp_path)
    disabled = default_config()
    worker.reconcile(disabled)
    assert worker.running is False
    assert worker.status == "disabled"
    assert detector.calls == 0
    assert readers == []

    enabled = camera_on(dataclasses.replace(disabled, enabled=True), 1)
    worker.reconcile(enabled)
    assert worker.running is True
    assert worker.status == "running"
    assert detector.calls == 1
    assert len(readers) == 1 and readers[0].started == 1

    # Dynamic changes are adopted by the running worker without a restart.
    tuned = dataclasses.replace(enabled, person_confidence=0.9, vehicle_confidence=0.88, base_fps=2.0)
    worker.reconcile(tuned)
    assert worker.config.person_confidence == 0.9
    assert worker.config.vehicle_confidence == 0.88
    assert worker.config.base_fps == 2.0
    assert worker.config.effective(1).person_confidence == 0.9
    # Same process, same detector, same reader: only config values changed.
    assert detector.calls == 1
    assert readers[0].started == 1

    # Disabling stops inference and readers but keeps the loaded model.
    worker.reconcile(disabled)
    assert worker.running is False
    assert worker.status == "disabled"
    assert readers[0].stopped == 1
    assert detector.calls == 1

    # Re-enabling starts again without reloading/rebuilding anything. A fresh
    # reader object is created (the stopped one is discarded), the model stays.
    worker.reconcile(enabled)
    assert worker.running is True
    assert detector.calls == 1
    assert len(readers) == 2 and readers[1].started == 1
    store.close()


def test_camera_override_reaches_the_runtime_configuration(tmp_path):
    worker, store, _detector, _readers = supervisor_worker(tmp_path)
    base = dataclasses.replace(default_config(), enabled=True, person_confidence=0.7)
    overridden = dataclasses.replace(
        base,
        cameras=tuple(
            dataclasses.replace(camera, enabled=camera.camera_id == 1, person_confidence=0.9)
            if camera.camera_id == 1
            else camera
            for camera in base.cameras
        ),
    )
    worker.reconcile(overridden)
    assert worker.running is True
    # Global stays 0.70; the enabled camera's override wins.
    assert worker.config.person_confidence == 0.7
    assert worker.config.effective(1).person_confidence == 0.9
    # Disabled cameras cannot accidentally inherit enabled=true from the global switch.
    assert worker.config.effective(2).enabled is False
    store.close()


def test_disabling_a_camera_stops_only_that_reader(tmp_path):
    worker, store, _detector, readers = supervisor_worker(tmp_path)
    base = dataclasses.replace(default_config(), enabled=True)
    two_cameras = dataclasses.replace(
        base,
        cameras=tuple(dataclasses.replace(camera, enabled=camera.camera_id in (1, 2)) for camera in base.cameras),
    )
    worker.reconcile(two_cameras)
    assert len(readers) == 2

    one_camera = dataclasses.replace(
        base,
        cameras=tuple(dataclasses.replace(camera, enabled=camera.camera_id == 1) for camera in base.cameras),
    )
    worker.reconcile(one_camera)
    assert worker.running is True
    assert len(worker.readers) == 1
    assert sum(reader.stopped for reader in readers) == 1
    store.close()
