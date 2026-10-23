#!/usr/bin/env python3
"""Container healthcheck: is the object-detection worker process alive?

The worker writes `object_worker_heartbeat` every few seconds. A fresh row means
the process loop is running — whether detection is enabled ("running") or
disabled ("disabled"), which are both healthy states. Only a missing/stale
heartbeat or an explicit error status is unhealthy.

This uses the worker's existing status mechanism; it does not start inference or
touch MediaMTX.
"""

from __future__ import annotations

import os
import sqlite3
import sys
from datetime import datetime, timezone

# 120 s tolerates a loaded 2-core host; the worker writes a heartbeat every 5 s.
MAX_AGE_SECONDS = 120


def heartbeat_age_seconds(now: datetime | None = None) -> tuple[float | None, str | None]:
    """Return (age_seconds, status); (None, None) when no usable heartbeat exists."""
    data_dir = os.environ.get("DATA_DIR", "/app/data")
    path = os.path.join(data_dir, "events.sqlite")
    try:
        # mode=rw opens an existing database but never creates an empty one.
        connection = sqlite3.connect(f"file:{path}?mode=rw", uri=True, timeout=3)
        try:
            row = connection.execute(
                "SELECT updated_at, status FROM object_worker_heartbeat WHERE id = 1"
            ).fetchone()
        finally:
            connection.close()
    except sqlite3.Error:
        return None, None
    if not row or not row[0]:
        return None, None
    try:
        updated = datetime.fromisoformat(str(row[0]).replace("Z", "+00:00"))
    except ValueError:
        return None, None
    if updated.tzinfo is None:
        updated = updated.replace(tzinfo=timezone.utc)
    reference = now or datetime.now(timezone.utc)
    return (reference - updated).total_seconds(), str(row[1] or "unknown")


def main() -> int:
    age, status = heartbeat_age_seconds()
    if age is None:
        return 1
    if status == "error":
        return 1
    return 0 if age <= MAX_AGE_SECONDS else 1


if __name__ == "__main__":
    sys.exit(main())
