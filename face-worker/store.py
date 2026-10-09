"""SQLite access for the face worker.

The hub owns the schema; this module creates the same tables idempotently so a
worker that starts before the first web request still works. Both processes use
WAL and a busy timeout, so they can read and write the same file concurrently.

Duplicate protection lives here:
  * `face_processing` has one row per event (PRIMARY KEY event_id), so an event
    can only be queued once no matter how often the worker restarts.
  * `claim()` moves a row PENDING -> PROCESSING inside one transaction.
  * `replace_faces()` deletes this event's faces and re-inserts them in a single
    transaction, and `event_faces` carries UNIQUE(event_id, detection_index).
    Processing the same event twice therefore converges on the same rows.
"""

from __future__ import annotations

import secrets
import sqlite3
from dataclasses import dataclass
from pathlib import Path

from timeutil import utc_now

PENDING = "PENDING"
PROCESSING = "PROCESSING"
COMPLETED = "COMPLETED"
FAILED = "FAILED"

SCHEMA = """
CREATE TABLE IF NOT EXISTS event_faces (
  id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  person_id TEXT,
  confidence REAL NOT NULL,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  crop_path TEXT,
  detector TEXT NOT NULL,
  model TEXT,
  detection_index INTEGER NOT NULL,
  created_at TEXT NOT NULL,
  UNIQUE(event_id, detection_index)
);
CREATE INDEX IF NOT EXISTS event_faces_event_id ON event_faces(event_id);
CREATE INDEX IF NOT EXISTS event_faces_person_id ON event_faces(person_id);
CREATE INDEX IF NOT EXISTS event_faces_created_at ON event_faces(created_at);
CREATE TABLE IF NOT EXISTS face_processing (
  event_id TEXT PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  status TEXT NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  faces_found INTEGER NOT NULL DEFAULT 0,
  detector TEXT,
  model TEXT,
  error TEXT,
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS face_processing_status ON face_processing(status);
"""


def new_face_id() -> str:
    """`face_` plus 24 hex characters, matching the hub's FACE_ID_PATTERN."""
    return f"face_{secrets.token_hex(12)}"


@dataclass(frozen=True)
class FaceRecord:
    detection_index: int
    confidence: float
    x: int
    y: int
    width: int
    height: int
    crop_path: str | None


@dataclass(frozen=True)
class ProcessingRow:
    event_id: str
    status: str
    attempts: int
    faces_found: int
    error: str | None
    started_at: str | None
    finished_at: str | None


class JobStore:
    def __init__(self, db_path: Path, busy_timeout_ms: int = 5000):
        self.db_path = db_path
        self.connection = sqlite3.connect(
            str(db_path),
            timeout=busy_timeout_ms / 1000.0,
            isolation_level=None,  # explicit transactions
        )
        self.connection.row_factory = sqlite3.Row
        self.connection.execute("PRAGMA journal_mode = WAL")
        self.connection.execute(f"PRAGMA busy_timeout = {int(busy_timeout_ms)}")
        self.connection.execute("PRAGMA foreign_keys = ON")
        self.connection.executescript(SCHEMA)

    def close(self) -> None:
        self.connection.close()

    # -- queue ---------------------------------------------------------------

    def enqueue(self, since_iso: str, limit: int) -> int:
        """Queue recent events that have a snapshot and were never queued.

        `face_processing.event_id` is the primary key, so an event that is
        already PENDING/PROCESSING/COMPLETED/FAILED is left exactly as it is.
        """
        now = utc_now()
        cursor = self.connection.execute(
            """
            INSERT INTO face_processing (event_id, status, created_at, updated_at)
            SELECT e.id, ?, ?, ?
            FROM events e
            WHERE e.snapshot_path IS NOT NULL
              AND e.snapshot_path <> ''
              AND e.timestamp >= ?
              AND e.id NOT IN (SELECT event_id FROM face_processing)
            ORDER BY e.timestamp DESC
            LIMIT ?
            """,
            (PENDING, now, now, since_iso, limit),
        )
        return cursor.rowcount or 0

    def reclaim_stale(self, older_than_iso: str) -> int:
        """Return jobs abandoned by a crash to the queue."""
        cursor = self.connection.execute(
            """
            UPDATE face_processing
            SET status = ?, error = 'reclaimed after a stalled attempt', updated_at = ?
            WHERE status = ? AND started_at IS NOT NULL AND started_at < ?
            """,
            (PENDING, utc_now(), PROCESSING, older_than_iso),
        )
        return cursor.rowcount or 0

    def claim(self, limit: int) -> list[str]:
        """Atomically take up to `limit` PENDING jobs."""
        now = utc_now()
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            rows = self.connection.execute(
                "SELECT event_id FROM face_processing WHERE status = ? ORDER BY created_at ASC, event_id ASC LIMIT ?",
                (PENDING, limit),
            ).fetchall()
            event_ids = [row["event_id"] for row in rows]
            for event_id in event_ids:
                self.connection.execute(
                    """
                    UPDATE face_processing
                    SET status = ?, attempts = attempts + 1, started_at = ?, updated_at = ?
                    WHERE event_id = ? AND status = ?
                    """,
                    (PROCESSING, now, now, event_id, PENDING),
                )
            self.connection.execute("COMMIT")
        except Exception:
            self.connection.execute("ROLLBACK")
            raise
        return event_ids

    def complete(self, event_id: str, faces_found: int, detector: str, model: str | None) -> None:
        now = utc_now()
        self._ensure_row(event_id)
        self.connection.execute(
            """
            UPDATE face_processing
            SET status = ?, faces_found = ?, detector = ?, model = ?, error = NULL,
                finished_at = ?, updated_at = ?
            WHERE event_id = ?
            """,
            (COMPLETED, faces_found, detector, model, now, now, event_id),
        )

    def fail(self, event_id: str, error: str, retryable: bool, max_attempts: int) -> str:
        """Record a failure. Returns the resulting status."""
        self._ensure_row(event_id)
        row = self.connection.execute(
            "SELECT attempts FROM face_processing WHERE event_id = ?", (event_id,)
        ).fetchone()
        attempts = int(row["attempts"]) if row else 1
        status = PENDING if retryable and attempts < max_attempts else FAILED
        now = utc_now()
        self.connection.execute(
            """
            UPDATE face_processing
            SET status = ?, error = ?, finished_at = ?, updated_at = ?
            WHERE event_id = ?
            """,
            (status, error[:500], now, now, event_id),
        )
        return status

    def _ensure_row(self, event_id: str) -> None:
        """Make sure this event has a queue row.

        The row is normally created by `enqueue()`. Creating it here as well
        means a processing result can always be recorded, even if the queue row
        was removed by hand or the event was processed directly.
        """
        now = utc_now()
        self.connection.execute(
            """
            INSERT INTO face_processing (event_id, status, created_at, updated_at)
            VALUES (?, ?, ?, ?)
            ON CONFLICT(event_id) DO NOTHING
            """,
            (event_id, PENDING, now, now),
        )

    # -- reads ---------------------------------------------------------------

    def event(self, event_id: str) -> sqlite3.Row | None:
        return self.connection.execute(
            "SELECT id, camera_id, timestamp, snapshot_path FROM events WHERE id = ?",
            (event_id,),
        ).fetchone()

    def processing(self, event_id: str) -> ProcessingRow | None:
        row = self.connection.execute(
            "SELECT * FROM face_processing WHERE event_id = ?", (event_id,)
        ).fetchone()
        if row is None:
            return None
        return ProcessingRow(
            event_id=row["event_id"],
            status=row["status"],
            attempts=int(row["attempts"]),
            faces_found=int(row["faces_found"]),
            error=row["error"],
            started_at=row["started_at"],
            finished_at=row["finished_at"],
        )

    def faces_for_event(self, event_id: str) -> list[sqlite3.Row]:
        return self.connection.execute(
            "SELECT * FROM event_faces WHERE event_id = ? ORDER BY detection_index ASC", (event_id,)
        ).fetchall()

    def summary(self) -> dict[str, int]:
        summary = {PENDING: 0, PROCESSING: 0, COMPLETED: 0, FAILED: 0}
        for row in self.connection.execute(
            "SELECT status, COUNT(*) AS count FROM face_processing GROUP BY status"
        ):
            if row["status"] in summary:
                summary[row["status"]] = int(row["count"])
        return summary

    def crop_paths(self) -> set[str]:
        rows = self.connection.execute(
            "SELECT crop_path FROM event_faces WHERE crop_path IS NOT NULL AND crop_path <> ''"
        ).fetchall()
        return {row["crop_path"] for row in rows}

    # -- writes --------------------------------------------------------------

    def replace_faces(
        self,
        event_id: str,
        faces: list[FaceRecord],
        detector: str,
        model: str | None,
        created_at: str | None = None,
    ) -> None:
        """Replace this event's faces in one transaction.

        Delete-then-insert plus UNIQUE(event_id, detection_index) is what makes
        re-processing idempotent: the event always ends with exactly the faces
        the latest run found, never with duplicates.
        """
        stamp = created_at or utc_now()
        self.connection.execute("BEGIN IMMEDIATE")
        try:
            self.connection.execute("DELETE FROM event_faces WHERE event_id = ?", (event_id,))
            for face in faces:
                self.connection.execute(
                    """
                    INSERT INTO event_faces
                      (id, event_id, person_id, confidence, x, y, width, height,
                       crop_path, detector, model, detection_index, created_at)
                    VALUES (?, ?, NULL, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        new_face_id(),
                        event_id,
                        float(face.confidence),
                        int(face.x),
                        int(face.y),
                        int(face.width),
                        int(face.height),
                        face.crop_path,
                        detector,
                        model,
                        int(face.detection_index),
                        stamp,
                    ),
                )
            self.connection.execute("COMMIT")
        except Exception:
            self.connection.execute("ROLLBACK")
            raise

    def delete_faces(self, event_id: str) -> int:
        cursor = self.connection.execute("DELETE FROM event_faces WHERE event_id = ?", (event_id,))
        return cursor.rowcount or 0
