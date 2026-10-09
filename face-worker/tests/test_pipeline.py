"""FACE-003 .. FACE-011, FACE-013, FACE-014, FACE-017, FACE-018.

The pipeline is exercised with a stub detector, so every assertion is about the
worker's own behaviour: what it stores, what it refuses to store, and what it
never touches.
"""

from __future__ import annotations

import sqlite3
from pathlib import Path

import cv2
import numpy as np
import pytest

from config import load_config
from helpers import (
    EVENT_ID,
    EVENT_ID_TWO,
    HUB_DDL,
    OLD_ENOUGH,
    SNAPSHOT_PATH,
    StubDetector,
    detection,
    enqueue_and_claim,
    make_jpeg,
    seed_event,
    seed_notification,
    write_snapshot,
)
from pipeline import process_event, select_detections
from store import COMPLETED, FAILED, PENDING, JobStore


def prepared(store: JobStore, data_dir: Path, payload: bytes | None = None) -> StubDetector:
    seed_event(store)
    write_snapshot(data_dir, SNAPSHOT_PATH, payload)
    return StubDetector([detection(100, 120, 60, 60, 0.91)])


# --------------------------------------------------------------------------
# FACE-003 / FACE-004
# --------------------------------------------------------------------------


def test_face_003_a_valid_snapshot_is_processed(store: JobStore, config, data_dir: Path) -> None:
    detector = prepared(store, data_dir)
    outcome = process_event(store, detector, config, EVENT_ID)

    assert outcome.status == COMPLETED
    assert outcome.faces == 1
    assert detector.calls == 1
    assert store.processing(EVENT_ID).status == COMPLETED


def test_face_004_face_metadata_is_stored(store: JobStore, config, data_dir: Path) -> None:
    prepared(store, data_dir)
    process_event(store, StubDetector([detection(100, 120, 60, 60, 0.91)]), config, EVENT_ID)

    faces = store.faces_for_event(EVENT_ID)
    assert len(faces) == 1
    face = faces[0]
    assert face["event_id"] == EVENT_ID
    # Unassigned: detection only, no identity.
    assert face["person_id"] is None
    assert face["detection_index"] == 0
    assert face["confidence"] == pytest.approx(0.91)
    assert face["detector"] == "stub"
    assert face["model"] == "stub-model"
    assert face["id"].startswith("face_") and len(face["id"]) == 29
    assert face["crop_path"] == f"2026/10/{EVENT_ID}-face-1.jpg"

    # The crop is on disk, is a real JPEG, and keeps the detector's box size.
    crop_file = data_dir / "face-crops" / face["crop_path"]
    assert crop_file.is_file()
    image = cv2.imread(str(crop_file))
    assert image is not None
    assert (image.shape[1], image.shape[0]) == (face["width"], face["height"])
    # The box is clamped, never enlarged beyond the snapshot.
    assert face["x"] >= 0 and face["y"] >= 0
    assert face["x"] + face["width"] <= 704
    assert face["y"] + face["height"] <= 576


# --------------------------------------------------------------------------
# FACE-005 / FACE-006 / FACE-007
# --------------------------------------------------------------------------


def test_face_005_multiple_faces_create_multiple_records(store: JobStore, config, data_dir: Path) -> None:
    prepared(store, data_dir)
    detector = StubDetector(
        [
            detection(50, 60, 40, 40, 0.95),
            detection(200, 60, 45, 45, 0.88),
            detection(400, 200, 50, 50, 0.77),
        ]
    )
    outcome = process_event(store, detector, config, EVENT_ID)

    assert outcome.faces == 3
    faces = store.faces_for_event(EVENT_ID)
    assert len(faces) == 3
    # Strongest first, indices contiguous from zero.
    assert [face["detection_index"] for face in faces] == [0, 1, 2]
    assert [round(face["confidence"], 2) for face in faces] == [0.95, 0.88, 0.77]
    assert len({face["crop_path"] for face in faces}) == 3


def test_face_006_confidence_threshold_is_applied(store: JobStore, data_dir: Path) -> None:
    config = load_config(
        {"DATA_DIR": str(data_dir), "FACE_DETECTION_ENABLED": "true", "FACE_DETECTION_CONFIDENCE": "0.60"}
    )
    prepared(store, data_dir)
    detector = StubDetector([detection(50, 60, 40, 40, 0.90), detection(200, 60, 40, 40, 0.59)])
    outcome = process_event(store, detector, config, EVENT_ID)

    assert outcome.faces == 1
    assert store.faces_for_event(EVENT_ID)[0]["confidence"] == pytest.approx(0.90)


def test_face_006_threshold_is_taken_from_configuration_not_hardcoded() -> None:
    detections = [detection(0, 0, 10, 10, 0.30), detection(0, 0, 10, 10, 0.95)]
    assert len(select_detections(detections, confidence=0.90, max_faces=10)) == 1
    assert len(select_detections(detections, confidence=0.10, max_faces=10)) == 2


def test_face_007_the_face_cap_keeps_the_strongest_detections(store: JobStore, data_dir: Path) -> None:
    config = load_config(
        {"DATA_DIR": str(data_dir), "FACE_DETECTION_ENABLED": "true", "FACE_DETECTION_MAX_FACES": "10"}
    )
    prepared(store, data_dir)
    # Twelve detections: confidences 0.99 down to 0.88.
    detections = [
        detection(20 + index * 20, 40, 30, 30, 0.99 - index * 0.01) for index in range(12)
    ]
    outcome = process_event(store, StubDetector(detections), config, EVENT_ID)

    assert outcome.faces == 10
    stored = [face["confidence"] for face in store.faces_for_event(EVENT_ID)]
    assert len(stored) == 10
    assert min(stored) == pytest.approx(0.90)
    # The two weakest detections were dropped, not an arbitrary ten.
    assert max(stored) == pytest.approx(0.99)
    assert 0.89 not in [round(value, 2) for value in stored]


# --------------------------------------------------------------------------
# FACE-008 / FACE-011
# --------------------------------------------------------------------------


def test_face_008_a_snapshot_without_faces_keeps_the_event_valid(store: JobStore, config, data_dir: Path) -> None:
    prepared(store, data_dir)
    outcome = process_event(store, StubDetector([]), config, EVENT_ID)

    assert outcome.status == COMPLETED
    assert outcome.faces == 0
    assert store.faces_for_event(EVENT_ID) == []
    # The event and its snapshot are untouched.
    assert store.event(EVENT_ID) is not None
    assert (data_dir / "events" / SNAPSHOT_PATH).is_file()


def test_face_011_processing_twice_does_not_duplicate(store: JobStore, config, data_dir: Path) -> None:
    prepared(store, data_dir)
    detector = StubDetector([detection(50, 60, 40, 40, 0.95), detection(200, 60, 40, 40, 0.90)])

    process_event(store, detector, config, EVENT_ID)
    first = {(face["detection_index"], round(face["confidence"], 3)) for face in store.faces_for_event(EVENT_ID)}

    process_event(store, detector, config, EVENT_ID)
    second_rows = store.faces_for_event(EVENT_ID)
    second = {(face["detection_index"], round(face["confidence"], 3)) for face in second_rows}

    assert first == second
    assert len(second_rows) == 2
    crops = list((data_dir / "face-crops" / "2026" / "10").glob(f"{EVENT_ID}-face-*.jpg"))
    assert len(crops) == 2


def test_face_011_survives_a_worker_restart(config, data_dir: Path) -> None:
    first = JobStore(data_dir / "events.sqlite")
    first.connection.executescript(HUB_DDL)
    seed_event(first)
    write_snapshot(data_dir, SNAPSHOT_PATH)
    process_event(first, StubDetector([detection(50, 60, 40, 40, 0.95)]), config, EVENT_ID)
    first.close()

    # A second process, same database: the work is already done and done once.
    second = JobStore(data_dir / "events.sqlite")
    try:
        assert len(second.faces_for_event(EVENT_ID)) == 1
        process_event(second, StubDetector([detection(50, 60, 40, 40, 0.95)]), config, EVENT_ID)
        assert len(second.faces_for_event(EVENT_ID)) == 1
        assert len(list((data_dir / "face-crops" / "2026" / "10").glob(f"{EVENT_ID}-face-*.jpg"))) == 1
    finally:
        second.close()


def test_a_later_run_with_fewer_faces_removes_the_stale_crop(store: JobStore, config, data_dir: Path) -> None:
    prepared(store, data_dir)
    process_event(
        store,
        StubDetector([detection(50, 60, 40, 40, 0.95), detection(200, 60, 40, 40, 0.90), detection(300, 60, 40, 40, 0.80)]),
        config,
        EVENT_ID,
    )
    month = data_dir / "face-crops" / "2026" / "10"
    assert len(list(month.glob(f"{EVENT_ID}-face-*.jpg"))) == 3

    process_event(store, StubDetector([detection(50, 60, 40, 40, 0.95)]), config, EVENT_ID)

    assert len(store.faces_for_event(EVENT_ID)) == 1
    assert len(list(month.glob(f"{EVENT_ID}-face-*.jpg"))) == 1


# --------------------------------------------------------------------------
# FACE-009 / FACE-010
# --------------------------------------------------------------------------


def test_face_009_a_detector_failure_is_recorded_and_isolated(store: JobStore, data_dir: Path) -> None:
    config = load_config(
        {"DATA_DIR": str(data_dir), "FACE_DETECTION_ENABLED": "true", "FACE_DETECTION_MAX_ATTEMPTS": "1"}
    )
    prepared(store, data_dir)
    seed_notification(store)
    event_id = enqueue_and_claim(store)[0]

    outcome = process_event(store, StubDetector(error=RuntimeError("boom")), config, event_id)

    assert outcome.status == FAILED
    assert outcome.error_code == "detector_error"
    assert "boom" in (outcome.error or "")
    # No partial or corrupt records.
    assert store.faces_for_event(EVENT_ID) == []
    # The event is untouched and still valid.
    event = store.event(EVENT_ID)
    assert event is not None
    assert event["timestamp"] == "2026-10-09T22:04:49+05:30"
    assert (data_dir / "events" / SNAPSHOT_PATH).is_file()


def test_face_010_a_detector_failure_does_not_touch_notification_history(store: JobStore, data_dir: Path) -> None:
    config = load_config(
        {"DATA_DIR": str(data_dir), "FACE_DETECTION_ENABLED": "true", "FACE_DETECTION_MAX_ATTEMPTS": "1"}
    )
    prepared(store, data_dir)
    seed_notification(store)
    before = store.connection.execute("SELECT * FROM notification_history").fetchall()
    notified_before = store.connection.execute("SELECT notified FROM events WHERE id = ?", (EVENT_ID,)).fetchone()
    event_id = enqueue_and_claim(store)[0]

    process_event(store, StubDetector(error=RuntimeError("boom")), config, event_id)

    after = store.connection.execute("SELECT * FROM notification_history").fetchall()
    assert [dict(row) for row in after] == [dict(row) for row in before]
    notified_after = store.connection.execute("SELECT notified FROM events WHERE id = ?", (EVENT_ID,)).fetchone()
    assert notified_after["notified"] == notified_before["notified"]


def test_a_retryable_failure_is_requeued_until_attempts_run_out(store: JobStore, data_dir: Path) -> None:
    config = load_config(
        {"DATA_DIR": str(data_dir), "FACE_DETECTION_ENABLED": "true", "FACE_DETECTION_MAX_ATTEMPTS": "3"}
    )
    prepared(store, data_dir)
    store.enqueue(OLD_ENOUGH, 50)

    expected = [PENDING, PENDING, FAILED]
    for wanted in expected:
        claimed = store.claim(1)
        assert claimed, "the job should still be claimable while attempts remain"
        outcome = process_event(store, StubDetector(error=RuntimeError("transient")), config, claimed[0])
        assert outcome.status == wanted
    assert store.processing(EVENT_ID).attempts == 3
    assert store.claim(1) == []


# --------------------------------------------------------------------------
# FACE-013 / FACE-014
# --------------------------------------------------------------------------


def test_face_013_a_missing_snapshot_is_handled_safely(store: JobStore, config) -> None:
    # Row present, file never written.
    seed_event(store)
    outcome = process_event(store, StubDetector([detection(0, 0, 40, 40, 0.9)]), config, EVENT_ID)

    assert outcome.status == FAILED
    assert outcome.error_code == "snapshot_missing"
    assert store.faces_for_event(EVENT_ID) == []
    assert store.event(EVENT_ID) is not None


def test_face_013_a_snapshot_row_pointing_outside_the_directory_is_refused(store: JobStore, config, data_dir: Path) -> None:
    secret = data_dir.parent / "outside.jpg"
    secret.write_bytes(make_jpeg())
    seed_event(store, snapshot_path="../../../outside.jpg")

    outcome = process_event(store, StubDetector([detection(0, 0, 40, 40, 0.9)]), config, EVENT_ID)

    assert outcome.status == FAILED
    assert outcome.error_code == "snapshot_missing"
    assert store.faces_for_event(EVENT_ID) == []


def test_face_014_a_corrupt_image_is_handled_safely(store: JobStore, config, data_dir: Path) -> None:
    prepared(store, data_dir, payload=b"\xff\xd8\xff\xe0 this is not really a jpeg")
    outcome = process_event(store, StubDetector([detection(0, 0, 40, 40, 0.9)]), config, EVENT_ID)

    assert outcome.status == FAILED
    assert outcome.error_code == "decode_failed"
    assert store.faces_for_event(EVENT_ID) == []


def test_a_face_crop_is_never_upscaled_into_distortion(store: JobStore, config, data_dir: Path) -> None:
    prepared(store, data_dir)
    # A 12x12 face: the crop is 12x12 (plus padding), never blown up.
    process_event(store, StubDetector([detection(300, 300, 12, 12, 0.9)]), config, EVENT_ID)
    face = store.faces_for_event(EVENT_ID)[0]
    image = cv2.imread(str(data_dir / "face-crops" / face["crop_path"]))
    assert image is not None
    assert (image.shape[1], image.shape[0]) == (face["width"], face["height"])
    assert face["width"] <= 20 and face["height"] <= 20


# --------------------------------------------------------------------------
# FACE-017 / FACE-018 (database half)
# --------------------------------------------------------------------------


def test_face_017_faces_reference_their_event(store: JobStore, config, data_dir: Path) -> None:
    prepared(store, data_dir)
    process_event(store, StubDetector([detection(50, 60, 40, 40, 0.9)]), config, EVENT_ID)

    faces = store.faces_for_event(EVENT_ID)
    assert faces and all(face["event_id"] == EVENT_ID for face in faces)

    # A face cannot exist without its event.
    with pytest.raises(sqlite3.IntegrityError):
        store.connection.execute(
            "INSERT INTO event_faces (id, event_id, confidence, x, y, width, height, detector, detection_index, created_at) "
            "VALUES ('face_000000000000000000000000', ?, 0.9, 1, 1, 10, 10, 'stub', 0, '2026-10-09T00:00:00+00:00')",
            ("evt_000000000000000000000000",),
        )


def test_face_018_deleting_an_event_removes_its_face_rows(store: JobStore, config, data_dir: Path) -> None:
    prepared(store, data_dir)
    process_event(store, StubDetector([detection(50, 60, 40, 40, 0.9)]), config, EVENT_ID)
    assert store.faces_for_event(EVENT_ID)

    store.connection.execute("DELETE FROM events WHERE id = ?", (EVENT_ID,))

    assert store.faces_for_event(EVENT_ID) == []
    assert store.processing(EVENT_ID) is None


def test_two_events_never_share_faces(store: JobStore, config, data_dir: Path) -> None:
    seed_event(store, event_id=EVENT_ID)
    seed_event(store, event_id=EVENT_ID_TWO, snapshot_path=SNAPSHOT_PATH.replace(EVENT_ID, EVENT_ID_TWO))
    write_snapshot(data_dir, SNAPSHOT_PATH)
    write_snapshot(data_dir, SNAPSHOT_PATH.replace(EVENT_ID, EVENT_ID_TWO))

    process_event(store, StubDetector([detection(50, 60, 40, 40, 0.9)]), config, EVENT_ID)
    process_event(store, StubDetector([detection(80, 90, 44, 44, 0.8), detection(120, 90, 44, 44, 0.7)]), config, EVENT_ID_TWO)

    assert len(store.faces_for_event(EVENT_ID)) == 1
    assert len(store.faces_for_event(EVENT_ID_TWO)) == 2
