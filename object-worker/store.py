"""SQLite access for the object-detection worker.

The hub owns the database schema; this module creates the same tables
idempotently so a worker started against a fresh hub database still works. Both
processes use WAL and a busy timeout.

The worker writes:
  * `object_detection_tracks` — one row per tracked object, with the event id and
    the exact analysed frame's snapshot path;
  * `object_worker_heartbeat` — a single row with status and metrics.

The hub's ingestion poller turns each track into its own `events` row; the
worker never inserts events itself.
"""

from __future__ import annotations

import json
import os
import secrets
import sqlite3
import threading
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

SCHEMA = """
CREATE TABLE IF NOT EXISTS object_detection_tracks (
  id TEXT PRIMARY KEY,
  camera_id INTEGER NOT NULL,
  classification TEXT NOT NULL,
  raw_class TEXT NOT NULL,
  confidence REAL NOT NULL,
  threshold REAL NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen TEXT NOT NULL,
  detection_count INTEGER NOT NULL DEFAULT 1,
  snapshot_path TEXT,
  event_id TEXT,
  status TEXT NOT NULL DEFAULT 'active',
  detector TEXT,
  model TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS object_detection_tracks_status ON object_detection_tracks(status, updated_at);
CREATE INDEX IF NOT EXISTS object_detection_tracks_event ON object_detection_tracks(event_id);
CREATE INDEX IF NOT EXISTS object_detection_tracks_camera ON object_detection_tracks(camera_id, status);
CREATE TABLE IF NOT EXISTS object_detection_settings (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  enabled INTEGER NOT NULL DEFAULT 0,
  person_enabled INTEGER NOT NULL DEFAULT 1,
  person_confidence REAL NOT NULL DEFAULT 0.7,
  vehicle_enabled INTEGER NOT NULL DEFAULT 1,
  vehicle_confidence REAL NOT NULL DEFAULT 0.7,
  base_fps REAL NOT NULL DEFAULT 1,
  active_fps REAL NOT NULL DEFAULT 3,
  max_fps REAL NOT NULL DEFAULT 5,
  motion_boost INTEGER NOT NULL DEFAULT 1,
  activity_timeout_s INTEGER NOT NULL DEFAULT 10,
  disappearance_timeout_s INTEGER NOT NULL DEFAULT 3,
  max_concurrent INTEGER NOT NULL DEFAULT 1,
  queue_size INTEGER NOT NULL DEFAULT 2,
  min_event_duration_s REAL NOT NULL DEFAULT 0,
  detection_source TEXT NOT NULL DEFAULT 'ai_only',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS object_detection_camera_settings (
  camera_id INTEGER PRIMARY KEY,
  enabled INTEGER NOT NULL DEFAULT 0,
  person_enabled INTEGER NOT NULL DEFAULT 1,
  person_confidence REAL,
  vehicle_enabled INTEGER NOT NULL DEFAULT 1,
  vehicle_confidence REAL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS object_detection_test_requests (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL,
  camera_id INTEGER NOT NULL,
  snapshot_path TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  result TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS object_detection_test_requests_status
  ON object_detection_test_requests(status, created_at);
CREATE TABLE IF NOT EXISTS object_worker_heartbeat (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  status TEXT NOT NULL,
  detail TEXT,
  metrics TEXT,
  updated_at TEXT NOT NULL
);
"""

CAMERA_IDS = (1, 2, 3, 4)


def new_track_id() -> str:
    return f"trk_{secrets.token_hex(12)}"


def event_id_for(camera_id: int, track_id: str, first_seen: str) -> str:
    """Deterministic event id: a retried write can never create a second event."""
    import hashlib

    digest = hashlib.sha256(f"object|{camera_id}|{track_id}|{first_seen}".encode()).hexdigest()
    return "evt_" + digest[:24]


def now_kolkata_iso(at: datetime | None = None) -> str:
    moment = at or datetime.now(timezone.utc)
    offset = moment.astimezone(timezone.utc) + __import__("datetime").timedelta(hours=5, minutes=30)
    return offset.strftime("%Y-%m-%dT%H:%M:%S+05:30")


def utc_now_iso(at: datetime | None = None) -> str:
    return (at or datetime.now(timezone.utc)).astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z"


def snapshot_relative_path(camera_id: int, event_id: str, timestamp_iso: str) -> str:
    """Same layout the hub uses for DVR snapshots: events/<yyyy>/<mm>/<dd>/."""
    day = timestamp_iso[:10]  # already +05:30, so this is the IST calendar date
    year, month, day_of_month = day.split("-")
    return f"{year}/{month}/{day_of_month}/{camera_id}-{event_id}.jpg"


@dataclass(frozen=True)
class TrackRow:
    id: str
    camera_id: int
    classification: str
    raw_class: str
    confidence: float
    threshold: float
    x: int
    y: int
    width: int
    height: int
    first_seen: str
    last_seen: str
    detection_count: int
    snapshot_path: str | None
    event_id: str | None
    status: str
    detector: str
    model: str


class WorkerStore:
    """Thread-safe wrapper around the shared SQLite database."""

    def __init__(self, db_path: Path, busy_timeout_ms: int = 5000):
        self.db_path = db_path
        self.connection = sqlite3.connect(
            str(db_path),
            timeout=busy_timeout_ms / 1000.0,
            isolation_level=None,
            check_same_thread=False,
        )
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.execute(f"PRAGMA busy_timeout = {int(busy_timeout_ms)}")
        self.connection.execute("PRAGMA journal_size_limit = 67108864")
        self._lock = threading.Lock()
        self.ensure_schema()

    def ensure_schema(self) -> None:
        self.connection.executescript(SCHEMA)
        # Seed the safe defaults exactly like the hub migration does. INSERT OR
        # IGNORE means an Admin configuration is never overwritten.
        now = utc_now_iso()
        self.connection.execute(
            """INSERT OR IGNORE INTO object_detection_settings
                 (id, enabled, person_enabled, person_confidence, vehicle_enabled, vehicle_confidence,
                  base_fps, active_fps, max_fps, motion_boost, activity_timeout_s,
                  disappearance_timeout_s, max_concurrent, queue_size, min_event_duration_s,
                  detection_source, created_at, updated_at)
               VALUES (1, 0, 1, 0.7, 1, 0.7, 1, 3, 5, 1, 10, 3, 1, 2, 0, 'ai_only', ?, ?)""",
            (now, now),
        )
        for camera_id in CAMERA_IDS:
            self.connection.execute(
                """INSERT OR IGNORE INTO object_detection_camera_settings
                     (camera_id, enabled, person_enabled, person_confidence, vehicle_enabled, vehicle_confidence, created_at, updated_at)
                   VALUES (?, 0, 1, NULL, 1, NULL, ?, ?)""",
                (camera_id, now, now),
            )

    # ---------------------------------------------------------------- tracks
    def upsert_track(self, track: TrackRow, now: str | None = None) -> None:
        updated = now or utc_now_iso()
        with self._lock:
            self.connection.execute(
                """
                INSERT INTO object_detection_tracks
                  (id, camera_id, classification, raw_class, confidence, threshold,
                   x, y, width, height, first_seen, last_seen, detection_count,
                   snapshot_path, event_id, status, detector, model, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  confidence = excluded.confidence,
                  threshold = excluded.threshold,
                  x = excluded.x,
                  y = excluded.y,
                  width = excluded.width,
                  height = excluded.height,
                  last_seen = excluded.last_seen,
                  detection_count = excluded.detection_count,
                  status = excluded.status,
                  snapshot_path = COALESCE(object_detection_tracks.snapshot_path, excluded.snapshot_path),
                  event_id = COALESCE(object_detection_tracks.event_id, excluded.event_id),
                  updated_at = excluded.updated_at
                """,
                (
                    track.id,
                    track.camera_id,
                    track.classification,
                    track.raw_class,
                    track.confidence,
                    track.threshold,
                    track.x,
                    track.y,
                    track.width,
                    track.height,
                    track.first_seen,
                    track.last_seen,
                    track.detection_count,
                    track.snapshot_path,
                    track.event_id,
                    track.status,
                    track.detector,
                    track.model,
                    updated,
                    updated,
                ),
            )

    def mark_track_ended(self, track_id: str, now: str | None = None) -> None:
        with self._lock:
            self.connection.execute(
            "UPDATE object_detection_tracks SET status = 'ended', updated_at = ? WHERE id = ?",
            (now or utc_now_iso(), track_id),
        )

    def count_tracks_since(self, since_iso: str, classification: str | None = None) -> int:
        with self._lock:
            if classification is None:
                row = self.connection.execute(
                    "SELECT COUNT(*) AS count FROM object_detection_tracks WHERE first_seen >= ?",
                    (since_iso,),
                ).fetchone()
            else:
                row = self.connection.execute(
                    "SELECT COUNT(*) AS count FROM object_detection_tracks WHERE first_seen >= ? AND classification = ?",
                    (since_iso, classification),
                ).fetchone()
        return int(row["count"]) if row else 0

    # ------------------------------------------------------------- heartbeat
    def write_heartbeat(self, status: str, detail: str | None, metrics: dict, now: str | None = None) -> None:
        with self._lock:
            self.connection.execute(
            """
                INSERT INTO object_worker_heartbeat (id, status, detail, metrics, updated_at)
                VALUES (1, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                  status = excluded.status,
                  detail = excluded.detail,
                  metrics = excluded.metrics,
                  updated_at = excluded.updated_at
                """,
                (status, detail, json.dumps(metrics, separators=(",", ":")), now or utc_now_iso()),
            )

    # -------------------------------------------------------------- snapshots
    def write_snapshot(self, snapshots_root: Path, camera_id: int, event_id: str, timestamp_iso: str, jpeg: bytes) -> str | None:
        """Write the exact analysed frame. Atomic, mode 0600, inside DATA_DIR/events."""
        if not jpeg:
            return None
        relative = snapshot_relative_path(camera_id, event_id, timestamp_iso)
        root = Path(snapshots_root).resolve()
        target = (root / relative).resolve()
        if not str(target).startswith(str(root) + os.sep):
            return None
        target.parent.mkdir(parents=True, exist_ok=True)
        temporary = target.with_suffix(target.suffix + ".part")
        with open(temporary, "wb") as handle:
            handle.write(jpeg)
        os.chmod(temporary, 0o600)
        temporary.replace(target)
        return relative

    # ---------------------------------------------------------- test requests
    def reset_stale_test_requests(self) -> int:
        """A request left 'running' by a crashed worker is retried once."""
        with self._lock:
            result = self.connection.execute(
                "UPDATE object_detection_test_requests SET status = 'pending', updated_at = ? WHERE status = 'running'",
                (utc_now_iso(),),
            )
        return result.rowcount

    def pending_test_requests(self, limit: int = 5) -> list[sqlite3.Row]:
        with self._lock:
            return self.connection.execute(
                "SELECT * FROM object_detection_test_requests WHERE status = 'pending' ORDER BY created_at ASC LIMIT ?",
                (limit,),
            ).fetchall()

    def start_test_request(self, request_id: str) -> bool:
        with self._lock:
            result = self.connection.execute(
                "UPDATE object_detection_test_requests SET status = 'running', updated_at = ? WHERE id = ? AND status = 'pending'",
                (utc_now_iso(), request_id),
            )
        return result.rowcount > 0

    def finish_test_request(self, request_id: str, status: str, result_json: str | None) -> None:
        with self._lock:
            self.connection.execute(
                "UPDATE object_detection_test_requests SET status = ?, result = ?, updated_at = ? WHERE id = ?",
                (status, result_json, utc_now_iso(), request_id),
            )

    def close(self) -> None:
        self.connection.close()
