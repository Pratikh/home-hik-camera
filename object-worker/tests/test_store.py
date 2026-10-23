import os
import stat

from store import TrackRow, WorkerStore, event_id_for, now_kolkata_iso, utc_now_iso


def make_store(tmp_path):
    return WorkerStore(tmp_path / "events.sqlite")


def test_schema_seeds_safe_defaults(tmp_path):
    store = make_store(tmp_path)
    assert store.connection.execute("SELECT COUNT(*) AS c FROM object_detection_settings").fetchone()["c"] == 1
    assert store.connection.execute("SELECT COUNT(*) AS c FROM object_detection_camera_settings").fetchone()["c"] == 4
    row = store.connection.execute("SELECT enabled FROM object_detection_settings WHERE id=1").fetchone()
    assert row["enabled"] == 0
    store.close()


def test_track_upsert_keeps_event_and_snapshot(tmp_path):
    store = make_store(tmp_path)
    first = now_kolkata_iso()
    track = TrackRow(
        id="trk_1", camera_id=1, classification="person", raw_class="person",
        confidence=0.8, threshold=0.7, x=10, y=20, width=30, height=40,
        first_seen=first, last_seen=first, detection_count=1,
        snapshot_path="2026/10/23/1-evt_x.jpg", event_id="evt_x",
        status="active", detector="yolox", model="yolox-nano",
    )
    store.upsert_track(track)
    later = now_kolkata_iso()
    updated = TrackRow(
        id="trk_1", camera_id=1, classification="person", raw_class="person",
        confidence=0.9, threshold=0.7, x=12, y=22, width=30, height=40,
        first_seen=first, last_seen=later, detection_count=5,
        snapshot_path=None, event_id=None,
        status="active", detector="yolox", model="yolox-nano",
    )
    store.upsert_track(updated)

    row = store.connection.execute("SELECT * FROM object_detection_tracks WHERE id='trk_1'").fetchone()
    assert row["confidence"] == 0.9
    assert row["detection_count"] == 5
    assert row["snapshot_path"] == "2026/10/23/1-evt_x.jpg"  # not cleared by an update
    assert row["event_id"] == "evt_x"

    store.mark_track_ended("trk_1")
    assert store.connection.execute("SELECT status FROM object_detection_tracks WHERE id='trk_1'").fetchone()["status"] == "ended"
    store.close()


def test_counts_since_and_heartbeat(tmp_path):
    store = make_store(tmp_path)
    first = "2026-10-23T09:00:00+05:30"
    for index, classification in enumerate(("person", "person", "vehicle")):
        store.upsert_track(
            TrackRow(
                id=f"trk_{index}", camera_id=1, classification=classification, raw_class=classification,
                confidence=0.8, threshold=0.7, x=0, y=0, width=10, height=10,
                first_seen=first, last_seen=first, detection_count=1,
                snapshot_path=None, event_id=f"evt_{index}", status="active",
                detector="yolox", model="yolox-nano",
            )
        )
    assert store.count_tracks_since("2026-10-23T00:00:00+05:30") == 3
    assert store.count_tracks_since("2026-10-23T00:00:00+05:30", "person") == 2
    assert store.count_tracks_since("2026-10-23T10:00:00+05:30") == 0

    store.write_heartbeat("running", None, {"model": "yolox-nano", "cameras": 2})
    row = store.connection.execute("SELECT * FROM object_worker_heartbeat WHERE id=1").fetchone()
    assert row["status"] == "running"
    assert '"cameras":2' in row["metrics"]
    store.close()


def test_snapshot_written_atomically_in_the_events_tree(tmp_path):
    store = make_store(tmp_path)
    event_id = event_id_for(1, "trk_abc", "2026-10-23T09:21:00+05:30")
    payload = b"\xff\xd8\xff\xe0" + b"snapshot" * 8
    relative = store.write_snapshot(tmp_path / "events", 1, event_id, "2026-10-23T09:21:00+05:30", payload)
    assert relative == f"2026/10/23/1-{event_id}.jpg"
    absolute = tmp_path / "events" / relative
    assert absolute.read_bytes() == payload
    # Private CCTV image, like the hub's own snapshots.
    mode = stat.S_IMODE(os.stat(absolute).st_mode)
    assert mode == 0o600
    # No temporary file is left behind.
    assert list(absolute.parent.glob("*.part")) == []
    store.close()


def test_event_id_is_deterministic():
    first = event_id_for(2, "trk_xyz", "2026-10-23T09:21:00+05:30")
    second = event_id_for(2, "trk_xyz", "2026-10-23T09:21:00+05:30")
    assert first == second
    assert first.startswith("evt_") and len(first) == 28
    assert event_id_for(3, "trk_xyz", "2026-10-23T09:21:00+05:30") != first
