"""Object-detection worker environment configuration.

Only plumbing lives here. Every detection setting (thresholds, cameras, FPS,
timeouts, source mode) is stored in SQLite and edited by the Admin in the hub;
the worker re-reads it every few seconds. Environment variables therefore only
describe *where* things are, not *what* to detect.
"""

from __future__ import annotations

import os
from dataclasses import dataclass
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
WORKER_ROOT = Path(__file__).resolve().parent

DEFAULT_MODEL_FILE = "yolox_nano.onnx"
MODEL_NAME = "YOLOX-Nano"
MODEL_VERSION = "0.1.1"
DEFAULT_SETTINGS_POLL_MS = 3000
DEFAULT_HEARTBEAT_MS = 5000
DEFAULT_FRAME_STALE_MS = 1000
DEFAULT_RECONNECT_BACKOFF_MS = 2000
DEFAULT_MAX_TRACKS_PER_CAMERA = 20


def _as_int(value: str | None, fallback: int, low: int, high: int) -> int:
    try:
        parsed = int((value or "").strip())
    except (TypeError, ValueError):
        return fallback
    if parsed < low or parsed > high:
        return fallback
    return parsed


def _as_float(value: str | None, fallback: float, low: float, high: float) -> float:
    try:
        parsed = float((value or "").strip())
    except (TypeError, ValueError):
        return fallback
    if parsed != parsed or parsed < low or parsed > high:
        return fallback
    return parsed


@dataclass(frozen=True)
class WorkerRuntime:
    data_dir: Path
    model_path: Path
    stream_kind: str
    stream_base: str
    stream_user: str
    stream_password: str
    settings_poll_s: float
    heartbeat_s: float
    frame_stale_s: float
    reconnect_backoff_s: float
    max_tracks_per_camera: int

    @property
    def db_path(self) -> Path:
        return self.data_dir / "events.sqlite"

    @property
    def snapshots_dir(self) -> Path:
        return self.data_dir / "events"


def load_runtime(env: dict[str, str] | None = None) -> WorkerRuntime:
    source = os.environ if env is None else env

    data_dir_value = (source.get("DATA_DIR") or "./data").strip() or "./data"
    data_dir = Path(data_dir_value)
    if not data_dir.is_absolute():
        data_dir = (PROJECT_ROOT / data_dir).resolve()

    model_value = (source.get("OBJECT_DETECTION_MODEL_PATH") or "").strip()
    model_path = Path(model_value).resolve() if model_value else WORKER_ROOT / "models" / DEFAULT_MODEL_FILE

    kind = (source.get("OBJECT_DETECTION_STREAM") or "rtsp").strip().lower()
    if kind not in ("rtsp", "hls"):
        kind = "rtsp"
    if kind == "hls":
        base = (source.get("MEDIAMTX_HLS_URL") or "http://mediamtx:8888").strip().rstrip("/")
    else:
        base = (source.get("MEDIAMTX_RTSP_URL") or "rtsp://mediamtx:8554").strip().rstrip("/")
    return WorkerRuntime(
        data_dir=data_dir,
        model_path=model_path,
        stream_kind=kind,
        stream_base=base,
        stream_user=(source.get("MEDIAMTX_AUTH_USER") or "").strip(),
        stream_password=(source.get("MEDIAMTX_AUTH_PASSWORD") or "").strip(),
        settings_poll_s=_as_int(source.get("OBJECT_DETECTION_SETTINGS_POLL_MS"), DEFAULT_SETTINGS_POLL_MS, 500, 60_000) / 1000.0,
        heartbeat_s=_as_int(source.get("OBJECT_DETECTION_HEARTBEAT_MS"), DEFAULT_HEARTBEAT_MS, 500, 60_000) / 1000.0,
        frame_stale_s=_as_int(source.get("OBJECT_DETECTION_FRAME_STALE_MS"), DEFAULT_FRAME_STALE_MS, 100, 10_000) / 1000.0,
        reconnect_backoff_s=_as_float(
            source.get("OBJECT_DETECTION_RECONNECT_BACKOFF_MS"),
            float(DEFAULT_RECONNECT_BACKOFF_MS),
            200,
            60_000,
        )
        / 1000.0,
        max_tracks_per_camera=_as_int(
            source.get("OBJECT_DETECTION_MAX_TRACKS_PER_CAMERA"),
            DEFAULT_MAX_TRACKS_PER_CAMERA,
            1,
            100,
        ),
    )
