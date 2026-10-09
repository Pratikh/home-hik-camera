"""Queue behaviour, the main loop and the disabled-flag guarantees."""

from __future__ import annotations

from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

import worker as worker_module
from config import load_config
from helpers import (
    EVENT_ID,
    EVENT_ID_TWO,
    OLD_ENOUGH,
    SNAPSHOT_PATH,
    StubDetector,
    detection,
    seed_event,
    write_snapshot,
)
from store import COMPLETED, FAILED, PENDING, PROCESSING, JobStore
from timeutil import KOLKATA, kolkata_iso, utc_now


def recent_timestamp() -> str:
    """A timestamp inside the backfill window, whenever the tests are run."""
    return kolkata_iso(datetime.now(timezone.utc) - timedelta(hours=1))


def test_enqueue_only_takes_events_that_have_a_snapshot(store: JobStore) -> None:
    seed_event(store, event_id=EVENT_ID, timestamp=recent_timestamp(), snapshot_path=SNAPSHOT_PATH)
    seed_event(store, event_id=EVENT_ID_TWO, timestamp=recent_timestamp(), snapshot_path=None)

    queued = store.enqueue(OLD_ENOUGH, 50)

    assert queued == 1
    assert store.processing(EVENT_ID) is not None
    assert store.processing(EVENT_ID_TWO) is None


def test_enqueue_ignores_events_older_than_the_backfill_window(store: JobStore) -> None:
    seed_event(store, event_id=EVENT_ID, timestamp="2020-05-05T10:00:00+05:30", snapshot_path=SNAPSHOT_PATH)
    # A window that starts after the event: it is outside the backfill.
    assert store.enqueue("2021-01-01T00:00:00+05:30", 50) == 0


def test_enqueue_is_idempotent(store: JobStore) -> None:
    seed_event(store, timestamp=recent_timestamp())
    assert store.enqueue(OLD_ENOUGH, 50) == 1
    # Running the cycle again must not add a second row for the same event.
    assert store.enqueue(OLD_ENOUGH, 50) == 0
    assert store.summary()[PENDING] == 1


def test_claim_moves_a_job_to_processing_and_counts_the_attempt(store: JobStore) -> None:
    seed_event(store, timestamp=recent_timestamp())
    store.enqueue(OLD_ENOUGH, 50)

    claimed = store.claim(1)

    assert claimed == [EVENT_ID]
    row = store.processing(EVENT_ID)
    assert row.status == PROCESSING
    assert row.attempts == 1
    # A claimed job is not handed out twice.
    assert store.claim(1) == []


def test_a_stalled_job_is_reclaimed_after_a_restart(store: JobStore) -> None:
    seed_event(store, timestamp=recent_timestamp())
    store.enqueue(OLD_ENOUGH, 50)
    store.claim(1)

    # Simulate a worker that died mid-job an hour ago.
    stale = kolkata_iso(datetime.now(timezone.utc) - timedelta(hours=1))
    store.connection.execute("UPDATE face_processing SET started_at = ? WHERE event_id = ?", (stale, EVENT_ID))

    assert store.reclaim_stale(kolkata_iso(datetime.now(timezone.utc) - timedelta(minutes=5))) == 1
    assert store.processing(EVENT_ID).status == PENDING
    assert store.claim(1) == [EVENT_ID]


def test_run_once_processes_a_queued_snapshot(store: JobStore, config, data_dir: Path) -> None:
    seed_event(store, timestamp=recent_timestamp())
    write_snapshot(data_dir, SNAPSHOT_PATH)

    outcomes = worker_module.run_once(store, StubDetector([detection(50, 60, 40, 40, 0.95)]), config)

    assert len(outcomes) == 1
    assert outcomes[0].status == COMPLETED
    assert outcomes[0].faces == 1
    assert len(store.faces_for_event(EVENT_ID)) == 1


def test_run_once_twice_does_not_duplicate_work(store: JobStore, config, data_dir: Path) -> None:
    seed_event(store, timestamp=recent_timestamp())
    write_snapshot(data_dir, SNAPSHOT_PATH)
    detector = StubDetector([detection(50, 60, 40, 40, 0.95)])

    worker_module.run_once(store, detector, config)
    second = worker_module.run_once(store, detector, config)

    assert second == []
    assert len(store.faces_for_event(EVENT_ID)) == 1
    assert detector.calls == 1


def test_main_does_nothing_at_all_when_detection_is_disabled(tmp_path: Path, monkeypatch, caplog) -> None:
    missing_data_dir = tmp_path / "never-created"
    monkeypatch.setenv("FACE_DETECTION_ENABLED", "false")
    monkeypatch.setenv("DATA_DIR", str(missing_data_dir))

    with caplog.at_level("INFO"):
        assert worker_module.main(["--once"]) == worker_module.EXIT_OK

    assert "FACE_DETECTION_ENABLED is not true" in caplog.text
    # No database, no crops, no detector: the feature is completely inert.
    assert not missing_data_dir.exists()


def test_main_reports_a_missing_model_without_touching_the_queue(tmp_path: Path, monkeypatch, caplog) -> None:
    data_dir = tmp_path / "data"
    data_dir.mkdir()
    database = JobStore(data_dir / "events.sqlite")
    database.close()

    monkeypatch.setenv("FACE_DETECTION_ENABLED", "true")
    monkeypatch.setenv("DATA_DIR", str(data_dir))
    monkeypatch.setenv("FACE_DETECTION_MODEL_PATH", str(tmp_path / "absent.onnx"))

    with caplog.at_level("INFO"):
        assert worker_module.main(["--once"]) == worker_module.EXIT_CONFIG

    assert "download_model.py" in caplog.text
    # The queue was never touched: nothing was enqueued or marked failed.
    reopened = JobStore(data_dir / "events.sqlite")
    try:
        assert reopened.summary() == {PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0}
    finally:
        reopened.close()


def test_main_exits_cleanly_when_the_database_is_absent(tmp_path: Path, monkeypatch) -> None:
    monkeypatch.setenv("FACE_DETECTION_ENABLED", "true")
    monkeypatch.setenv("DATA_DIR", str(tmp_path / "empty"))

    assert worker_module.main(["--once"]) == worker_module.EXIT_DATABASE
