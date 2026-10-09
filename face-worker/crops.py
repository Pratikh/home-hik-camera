"""Safe face-crop paths, bounding-box clamping and JPEG writing.

Crop paths are never built from user input. They are composed from a validated
event id, a small integer and a date, and every resolved path is checked to be
inside the configured crop directory before it is used.
"""

from __future__ import annotations

import os
import re
from datetime import datetime
from pathlib import Path

EVENT_ID_RE = re.compile(r"^evt_[a-f0-9]{24}$")
CROP_FILE_RE = re.compile(r"^evt_[a-f0-9]{24}-face-[0-9]{1,4}\.jpg$")
MAX_FACES_PER_EVENT = 1000
DEFAULT_PADDING = 0.25


class CropPathError(ValueError):
    """A path that is not a valid crop location inside the crop directory."""


def is_valid_event_id(value: object) -> bool:
    return isinstance(value, str) and bool(EVENT_ID_RE.match(value))


def crop_relative_path(event_id: str, index: int, when: datetime) -> str:
    """`<yyyy>/<mm>/<eventId>-face-<n>.jpg`, built only from validated parts."""
    if not is_valid_event_id(event_id):
        raise CropPathError("invalid event id")
    if not isinstance(index, int) or index < 0 or index >= MAX_FACES_PER_EVENT:
        raise CropPathError("invalid face index")
    return f"{when.year:04d}/{when.month:02d}/{event_id}-face-{index + 1}.jpg"


def resolve_crop_path(crops_dir: Path, relative: str) -> Path:
    """Resolve a stored relative crop path, refusing anything outside the root."""
    if not isinstance(relative, str):
        raise CropPathError("invalid crop path")
    cleaned = relative.replace("\\", "/").strip()
    if not cleaned or cleaned.startswith("/") or ":" in cleaned.split("/")[0]:
        raise CropPathError("absolute crop path")
    if "\x00" in cleaned or any(part in ("", ".", "..") for part in cleaned.split("/")):
        raise CropPathError("unsafe crop path")
    root = crops_dir.resolve()
    target = (root / cleaned).resolve()
    if target == root or root not in target.parents:
        raise CropPathError("crop path escapes the crop directory")
    return target


def clamp_box(
    x: float,
    y: float,
    width: float,
    height: float,
    image_width: int,
    image_height: int,
    padding: float = DEFAULT_PADDING,
) -> tuple[int, int, int, int]:
    """Clamp a detector box to the image, with a little padding.

    Coordinates come back inside [0, image_width] x [0, image_height] and are
    at least one pixel wide, so a crop can never be empty or out of bounds.
    """
    pad_x = width * max(0.0, padding)
    pad_y = height * max(0.0, padding)
    left = int(round(x - pad_x))
    top = int(round(y - pad_y))
    right = int(round(x + width + pad_x))
    bottom = int(round(y + height + pad_y))

    left = max(0, min(left, image_width - 1))
    top = max(0, min(top, image_height - 1))
    right = max(left + 1, min(right, image_width))
    bottom = max(top + 1, min(bottom, image_height))
    return left, top, right - left, bottom - top


def clear_event_crops(crops_dir: Path, event_id: str, when: datetime) -> int:
    """Remove every crop this event wrote in its month directory.

    Re-processing an event that now yields fewer faces must not leave the older
    crops behind. Only files named for this event are touched.
    """
    if not is_valid_event_id(event_id):
        return 0
    directory = crops_dir / f"{when.year:04d}" / f"{when.month:02d}"
    if not directory.is_dir():
        return 0
    prefix = f"{event_id}-face-"
    removed = 0
    for entry in directory.iterdir():
        if not entry.is_file() or not entry.name.startswith(prefix):
            continue
        if not CROP_FILE_RE.match(entry.name):
            continue
        try:
            entry.unlink()
            removed += 1
        except OSError:
            continue
    return removed


def write_jpeg(path: Path, data: bytes) -> None:
    """Write a JPEG atomically, so a crash cannot leave a half-written crop."""
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    temporary.write_bytes(data)
    os.chmod(temporary, 0o600)
    os.replace(temporary, path)
