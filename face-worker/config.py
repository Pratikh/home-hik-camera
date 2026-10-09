"""Face-detection worker configuration.

Reads the same `.env` values as the hub. The detector is local and offline;
nothing here contacts a network service.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

DEFAULT_CONFIDENCE = 0.60
DEFAULT_MAX_FACES = 10
DEFAULT_POLL_INTERVAL_S = 5.0
DEFAULT_BACKFILL_DAYS = 7
DEFAULT_MAX_ATTEMPTS = 3
DEFAULT_STALE_AFTER_S = 900
DEFAULT_BATCH_SIZE = 5
DEFAULT_MAX_DETECTION_WIDTH = 704
DEFAULT_JPEG_QUALITY = 90
DEFAULT_MODEL_FILE = "face_detection_yunet_2023mar.onnx"

# <repo>/face-worker/config.py -> <repo>
PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORKER_ROOT = Path(__file__).resolve().parent


def _as_bool(value: str | None) -> bool:
    return (value or "").strip().lower() == "true"


def _as_float(value: str | None, fallback: float, low: float, high: float) -> float:
    try:
        parsed = float((value or "").strip())
    except (TypeError, ValueError):
        return fallback
    if parsed != parsed or parsed < low or parsed > high:  # NaN or out of range
        return fallback
    return parsed


def _as_int(value: str | None, fallback: int, low: int, high: int) -> int:
    try:
        parsed = int((value or "").strip())
    except (TypeError, ValueError):
        return fallback
    if parsed < low or parsed > high:
        return fallback
    return parsed


@dataclass(frozen=True)
class WorkerConfig:
    enabled: bool
    confidence: float
    max_faces: int
    data_dir: Path
    model_path: Path
    poll_interval_s: float
    backfill_days: int
    max_attempts: int
    stale_after_s: int
    batch_size: int
    detector: str
    model_name: str
    max_detection_width: int
    jpeg_quality: int

    @property
    def db_path(self) -> Path:
        return self.data_dir / "events.sqlite"

    @property
    def snapshots_dir(self) -> Path:
        return self.data_dir / "events"

    @property
    def crops_dir(self) -> Path:
        return self.data_dir / "face-crops"


def load_config(env: dict[str, str] | None = None) -> WorkerConfig:
    source = os.environ if env is None else env

    data_dir_value = (source.get("DATA_DIR") or "./data").strip() or "./data"
    data_dir = Path(data_dir_value)
    if not data_dir.is_absolute():
        # Same convention as the hub: a relative DATA_DIR is relative to the
        # project root, not to whatever directory the process was started in.
        data_dir = (PROJECT_ROOT / data_dir).resolve()

    model_value = (source.get("FACE_DETECTION_MODEL_PATH") or "").strip()
    model_path = Path(model_value).resolve() if model_value else WORKER_ROOT / "models" / DEFAULT_MODEL_FILE

    return WorkerConfig(
        enabled=_as_bool(source.get("FACE_DETECTION_ENABLED")),
        confidence=_as_float(source.get("FACE_DETECTION_CONFIDENCE"), DEFAULT_CONFIDENCE, 0.0, 1.0),
        max_faces=_as_int(source.get("FACE_DETECTION_MAX_FACES"), DEFAULT_MAX_FACES, 1, 100),
        data_dir=data_dir,
        model_path=model_path,
        poll_interval_s=_as_float(source.get("FACE_DETECTION_POLL_INTERVAL_MS"), DEFAULT_POLL_INTERVAL_S * 1000, 500, 600_000) / 1000.0,
        backfill_days=_as_int(source.get("FACE_DETECTION_BACKFILL_DAYS"), DEFAULT_BACKFILL_DAYS, 1, 3650),
        max_attempts=_as_int(source.get("FACE_DETECTION_MAX_ATTEMPTS"), DEFAULT_MAX_ATTEMPTS, 1, 20),
        stale_after_s=_as_int(source.get("FACE_DETECTION_STALE_AFTER_S"), DEFAULT_STALE_AFTER_S, 60, 86_400),
        batch_size=_as_int(source.get("FACE_DETECTION_BATCH_SIZE"), DEFAULT_BATCH_SIZE, 1, 50),
        detector="yunet",
        model_name=DEFAULT_MODEL_FILE.removesuffix(".onnx"),
        max_detection_width=_as_int(source.get("FACE_DETECTION_MAX_WIDTH"), DEFAULT_MAX_DETECTION_WIDTH, 0, 4096),
        jpeg_quality=_as_int(source.get("FACE_DETECTION_JPEG_QUALITY"), DEFAULT_JPEG_QUALITY, 50, 100),
    )
