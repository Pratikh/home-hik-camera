"""Time helpers.

The hub stores timestamps in Asia/Kolkata with an explicit `+05:30` offset and
compares them as strings. The worker must use the same convention, otherwise its
"recent events" window would be off by the offset. India has had no daylight
saving since 1945, so a fixed offset is exact and needs no tz database (which a
slim container image may not ship).
"""

from __future__ import annotations

from datetime import datetime, timedelta, timezone

KOLKATA = timezone(timedelta(hours=5, minutes=30))


def utc_now() -> str:
    """Machine-facing timestamp for `created_at`/`updated_at` columns."""
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def kolkata_iso(value: datetime) -> str:
    """`YYYY-MM-DDTHH:MM:SS+05:30`, the format the hub stores events in."""
    return value.astimezone(KOLKATA).isoformat(timespec="seconds")


def kolkata_now() -> datetime:
    return datetime.now(KOLKATA)


def event_month(timestamp: str) -> tuple[int, int]:
    """Year and month of an event timestamp, falling back to now."""
    try:
        parsed = datetime.fromisoformat(timestamp)
    except (TypeError, ValueError):
        now = kolkata_now()
        return now.year, now.month
    return parsed.year, parsed.month
