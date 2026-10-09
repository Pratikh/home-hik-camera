"""Shared stubs and database helpers for the worker tests.

The tests inject a `StubDetector`, so the pipeline, the database behaviour, the
threshold, the face cap and the path safety are all verified deterministically
without depending on a real face image. A separate test loads the real YuNet
model when it is present on disk.
"""

from __future__ import annotations

from pathlib import Path

import cv2
import numpy as np

from detector import Detection
from store import JobStore

# The hub owns these tables; the worker only reads `events` and inserts into
# `event_faces`/`face_processing`. A real database is created by the hub, so the
# tests create the same minimal shape.
HUB_DDL = """
CREATE TABLE IF NOT EXISTS events (
  id TEXT PRIMARY KEY,
  dedupe_key TEXT,
  camera_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  classification TEXT,
  timestamp TEXT NOT NULL,
  end_timestamp TEXT,
  confidence REAL,
  snapshot_path TEXT,
  recording_start TEXT,
  recording_end TEXT,
  source TEXT NOT NULL,
  metadata TEXT,
  created_at TEXT NOT NULL,
  priority TEXT NOT NULL DEFAULT 'NORMAL',
  notified INTEGER NOT NULL DEFAULT 0,
  read_at TEXT
);
CREATE TABLE IF NOT EXISTS notification_history (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  rule_id TEXT,
  rule_name TEXT,
  camera_id INTEGER NOT NULL,
  priority TEXT NOT NULL,
  status TEXT NOT NULL,
  reason TEXT,
  created_at TEXT NOT NULL,
  event_timestamp TEXT
);
"""

EVENT_ID = "evt_aaaaaaaaaaaaaaaaaaaaaaaa"
EVENT_ID_TWO = "evt_bbbbbbbbbbbbbbbbbbbbbbbb"
OTHER_EVENT_ID = "evt_cccccccccccccccccccccccc"
SNAPSHOT_PATH = "2026/10/09/1-evt_aaaaaaaaaaaaaaaaaaaaaaaa.jpg"
EVENT_TIMESTAMP = "2026-10-09T22:04:49+05:30"
OLD_ENOUGH = "2020-01-01T00:00:00+05:30"


def make_jpeg(width: int = 704, height: int = 576) -> bytes:
    """A valid snapshot-shaped JPEG. The stub detector decides what it finds."""
    image = np.zeros((height, width, 3), dtype=np.uint8)
    image[:, :] = (40, 60, 80)
    cv2.rectangle(image, (20, 20), (width - 20, height - 20), (200, 200, 200), 2)
    ok, buffer = cv2.imencode(".jpg", image)
    assert ok
    return buffer.tobytes()


def detection(x: int, y: int, w: int, h: int, confidence: float) -> Detection:
    return Detection(x=x, y=y, width=w, height=h, confidence=confidence)


class StubDetector:
    """Deterministic stand-in for the real detector."""

    name = "stub"
    model = "stub-model"

    def __init__(self, detections: list[Detection] | None = None, error: Exception | None = None):
        self._detections = list(detections or [])
        self._error = error
        self.calls = 0

    def detect(self, image):  # noqa: ANN001 - test double
        self.calls += 1
        if self._error is not None:
            raise self._error
        return list(self._detections)


def seed_event(
    store: JobStore,
    event_id: str = EVENT_ID,
    timestamp: str = EVENT_TIMESTAMP,
    snapshot_path: str | None = SNAPSHOT_PATH,
    camera_id: int = 1,
) -> None:
    store.connection.execute(
        """
        INSERT INTO events (id, dedupe_key, camera_id, type, classification, timestamp,
                            snapshot_path, source, created_at, priority, notified)
        VALUES (?, ?, ?, 'motion', 'person', ?, ?, 'hikvision', ?, 'HIGH', 1)
        """,
        (event_id, f"dedupe-{event_id}", camera_id, timestamp, snapshot_path, timestamp),
    )


def write_snapshot(data_dir: Path, relative: str, payload: bytes | None = None) -> Path:
    target = data_dir / "events" / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_bytes(payload if payload is not None else make_jpeg())
    return target


def seed_notification(store: JobStore, event_id: str = EVENT_ID) -> None:
    store.connection.execute(
        """
        INSERT INTO notification_history (id, event_id, rule_id, rule_name, camera_id, priority,
                                          status, reason, created_at, event_timestamp)
        VALUES (?, ?, 'rule-person', 'Person detected', 1, 'HIGH', 'sent', NULL, ?, ?)
        """,
        (f"notif-{event_id}", event_id, "2026-10-09T22:04:50+05:30", EVENT_TIMESTAMP),
    )


def enqueue_and_claim(store: JobStore, limit: int = 1) -> list[str]:
    """Queue recent snapshots the way the worker's main loop does, then claim."""
    store.enqueue(OLD_ENOUGH, 50)
    return store.claim(limit)
