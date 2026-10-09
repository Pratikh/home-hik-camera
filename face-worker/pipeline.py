"""Turn one event snapshot into `event_faces` rows.

This is detection only: it locates faces, crops them and stores where they are.
It never identifies anyone.

Failure policy: everything here is enrichment. A missing file, an undecodable
image or a detector crash is recorded on the job and never touches the event,
the snapshot or the notification history.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path

import cv2
import numpy as np

from config import WorkerConfig
from crops import (
    CropPathError,
    clamp_box,
    clear_event_crops,
    crop_relative_path,
    resolve_crop_path,
    write_jpeg,
)
from detector import Detector
from store import COMPLETED, FaceRecord, JobStore
from timeutil import event_month

log = logging.getLogger("face-worker")

#: A failure that a retry cannot fix; retrying would only burn CPU.
DETERMINISTIC_ERRORS = {"event_missing", "snapshot_missing", "decode_failed"}

#: Smallest usable crop. Detections are never upscaled, so a box below this is
#: too coarse to store as a face image.
MIN_CROP_PIXELS = 8


class ProcessError(Exception):
    def __init__(self, code: str, message: str):
        super().__init__(message)
        self.code = code
        self.retryable = code not in DETERMINISTIC_ERRORS


@dataclass
class ProcessOutcome:
    event_id: str
    status: str
    faces: int
    error: str | None = None
    error_code: str | None = None


def resolve_snapshot_path(snapshots_dir: Path, stored: str | None) -> Path | None:
    """Resolve the stored snapshot path inside DATA_DIR/events, or None.

    The value comes from our own database, but it is still treated as hostile:
    a crafted row must not be able to point the reader at an arbitrary file.
    """
    if not stored:
        return None
    cleaned = stored.replace("\\", "/").strip()
    if not cleaned or cleaned.startswith("/") or ":" in cleaned.split("/")[0]:
        return None
    if "\x00" in cleaned or any(part in ("", ".", "..") for part in cleaned.split("/")):
        return None
    root = snapshots_dir.resolve()
    target = (root / cleaned).resolve()
    if target == root or root not in target.parents:
        return None
    return target


def select_detections(detections, confidence: float, max_faces: int):
    """Apply the configured threshold and cap, strongest first.

    The threshold and the cap both come from configuration; neither is
    hardcoded in the detection logic.
    """
    kept = [detection for detection in detections if detection.confidence >= confidence]
    kept.sort(key=lambda detection: detection.confidence, reverse=True)
    return kept[:max_faces]


def process_event(store: JobStore, detector: Detector, config: WorkerConfig, event_id: str) -> ProcessOutcome:
    """Process one queued event. Never raises: failures are recorded."""
    try:
        faces = _detect_and_store(store, detector, config, event_id)
    except ProcessError as error:
        status = store.fail(event_id, f"{error.code}: {error}", error.retryable, config.max_attempts)
        log.warning("event %s: %s (%s)", event_id, error, status)
        return ProcessOutcome(event_id, status, 0, str(error), error.code)
    except Exception as error:  # never let one event stop the worker
        status = store.fail(event_id, f"internal_error: {error}", True, config.max_attempts)
        log.exception("event %s: unexpected failure", event_id)
        return ProcessOutcome(event_id, status, 0, str(error), "internal_error")

    store.complete(event_id, len(faces), detector.name, detector.model)
    return ProcessOutcome(event_id, COMPLETED, len(faces))


def _detect_and_store(store: JobStore, detector: Detector, config: WorkerConfig, event_id: str) -> list[FaceRecord]:
    row = store.event(event_id)
    if row is None:
        raise ProcessError("event_missing", "event row no longer exists")

    snapshot = resolve_snapshot_path(config.snapshots_dir, row["snapshot_path"])
    if snapshot is None or not snapshot.is_file():
        raise ProcessError("snapshot_missing", "snapshot file is missing")

    try:
        data = snapshot.read_bytes()
    except OSError as error:
        raise ProcessError("snapshot_missing", f"snapshot file is unreadable: {error}") from error

    image = cv2.imdecode(np.frombuffer(data, dtype=np.uint8), cv2.IMREAD_COLOR)
    if image is None:
        raise ProcessError("decode_failed", "snapshot is not a decodable image")

    try:
        detections = list(detector.detect(image))
    except Exception as error:
        raise ProcessError("detector_error", f"detector failed: {error}") from error

    selected = select_detections(detections, config.confidence, config.max_faces)
    height, width = image.shape[:2]
    year, month = event_month(row["timestamp"])
    when = datetime(year, month, 1, tzinfo=timezone.utc)

    records: list[FaceRecord] = []
    encoded: list[tuple[str, bytes]] = []
    for detection in selected:
        x, y, box_width, box_height = clamp_box(
            detection.x, detection.y, detection.width, detection.height, width, height
        )
        if box_width < MIN_CROP_PIXELS or box_height < MIN_CROP_PIXELS:
            continue
        crop = image[y : y + box_height, x : x + box_width]
        ok, buffer = cv2.imencode(".jpg", crop, [int(cv2.IMWRITE_JPEG_QUALITY), config.jpeg_quality])
        if not ok:
            raise ProcessError("crop_write_failed", "could not encode a face crop")
        relative = crop_relative_path(event_id, len(records), when)
        encoded.append((relative, buffer.tobytes()))
        records.append(
            FaceRecord(
                detection_index=len(records),
                confidence=float(detection.confidence),
                x=x,
                y=y,
                width=box_width,
                height=box_height,
                crop_path=relative,
            )
        )

    # Remove this event's previous crops first, so a run that finds fewer faces
    # cannot leave the older files behind.
    clear_event_crops(config.crops_dir, event_id, when)
    for relative, blob in encoded:
        try:
            write_jpeg(resolve_crop_path(config.crops_dir, relative), blob)
        except (OSError, CropPathError) as error:
            raise ProcessError("crop_write_failed", f"could not write a face crop: {error}") from error

    # One transaction: the event ends with exactly these faces, never a mix of
    # this run and the previous one.
    store.replace_faces(event_id, records, detector.name, detector.model)
    return records
