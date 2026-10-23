"""Read the Admin's object-detection configuration from SQLite.

The hub owns the schema and the Admin UI owns the values. This module only
reads them and clamps anything out of range, so a hand-edited database or a
future version cannot make the worker run unsafe values.

The same resolution rules as `src/lib/object-detection.ts` are implemented here:
a camera only runs when the master switch and its own switch are on, and a
per-camera confidence of NULL means "use the global value".
"""

from __future__ import annotations

import json
import sqlite3
from dataclasses import dataclass, field

RAW_CLASSES = ("person", "car", "motorcycle", "bus", "truck")
DETECTION_SOURCES = ("ai_only", "dvr_only", "ai_both")

CAMERA_IDS = (1, 2, 3, 4)

CONFIDENCE_MIN = 0.50
CONFIDENCE_MAX = 0.99
FPS_MIN = 0.5
FPS_MAX = 5.0
MAX_CONCURRENT_MIN = 1
MAX_CONCURRENT_MAX = 4
QUEUE_MIN = 1
QUEUE_MAX = 10
DISAPPEARANCE_MIN = 1
DISAPPEARANCE_MAX = 10
ACTIVITY_TIMEOUT_MIN = 1
ACTIVITY_TIMEOUT_MAX = 60


def _bool(value: object, fallback: bool) -> bool:
    if value is None:
        return fallback
    try:
        return bool(int(value))  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback


def _number(value: object, fallback: float, low: float, high: float) -> float:
    try:
        parsed = float(value)  # type: ignore[arg-type]
    except (TypeError, ValueError):
        return fallback
    if parsed != parsed or parsed < low or parsed > high:  # NaN or out of range
        return fallback
    return parsed


@dataclass(frozen=True)
class CameraConfig:
    camera_id: int
    enabled: bool
    person_enabled: bool
    person_confidence: float | None
    vehicle_enabled: bool
    vehicle_confidence: float | None


@dataclass(frozen=True)
class DetectionConfig:
    enabled: bool
    person_enabled: bool
    person_confidence: float
    vehicle_enabled: bool
    vehicle_confidence: float
    base_fps: float
    active_fps: float
    max_fps: float
    motion_boost: bool
    activity_timeout_s: float
    disappearance_timeout_s: float
    max_concurrent: int
    queue_size: int
    min_event_duration_s: float
    detection_source: str
    cameras: tuple[CameraConfig, ...] = field(default_factory=tuple)

    def camera(self, camera_id: int) -> CameraConfig:
        for camera in self.cameras:
            if camera.camera_id == camera_id:
                return camera
        return CameraConfig(camera_id, False, True, None, True, None)

    def effective(self, camera_id: int) -> "EffectiveCamera":
        camera = self.camera(camera_id)
        if not self.enabled or not camera.enabled:
            return EffectiveCamera(
                camera_id=camera_id,
                enabled=False,
                person=False,
                person_confidence=camera.person_confidence or self.person_confidence,
                vehicle=False,
                vehicle_confidence=camera.vehicle_confidence or self.vehicle_confidence,
            )
        return EffectiveCamera(
            camera_id=camera_id,
            enabled=True,
            person=self.person_enabled and camera.person_enabled,
            person_confidence=camera.person_confidence
            if camera.person_confidence is not None
            else self.person_confidence,
            vehicle=self.vehicle_enabled and camera.vehicle_enabled,
            vehicle_confidence=camera.vehicle_confidence
            if camera.vehicle_confidence is not None
            else self.vehicle_confidence,
        )

    def enabled_cameras(self) -> list[int]:
        return [camera_id for camera_id in CAMERA_IDS if self.effective(camera_id).enabled]


@dataclass(frozen=True)
class EffectiveCamera:
    camera_id: int
    enabled: bool
    person: bool
    person_confidence: float
    vehicle: bool
    vehicle_confidence: float


def _row_to_camera(row: sqlite3.Row) -> CameraConfig:
    return CameraConfig(
        camera_id=int(row["camera_id"]),
        enabled=_bool(row["enabled"], False),
        person_enabled=_bool(row["person_enabled"], True),
        person_confidence=(
            None if row["person_confidence"] is None else round(_number(row["person_confidence"], 0.7, CONFIDENCE_MIN, CONFIDENCE_MAX), 2)
        ),
        vehicle_enabled=_bool(row["vehicle_enabled"], True),
        vehicle_confidence=(
            None if row["vehicle_confidence"] is None else round(_number(row["vehicle_confidence"], 0.7, CONFIDENCE_MIN, CONFIDENCE_MAX), 2)
        ),
    )


def default_config() -> DetectionConfig:
    return DetectionConfig(
        enabled=False,
        person_enabled=True,
        person_confidence=0.7,
        vehicle_enabled=True,
        vehicle_confidence=0.7,
        base_fps=1.0,
        active_fps=3.0,
        max_fps=5.0,
        motion_boost=True,
        activity_timeout_s=10.0,
        disappearance_timeout_s=3.0,
        max_concurrent=1,
        queue_size=2,
        min_event_duration_s=0.0,
        detection_source="ai_only",
        cameras=tuple(CameraConfig(camera_id, False, True, None, True, None) for camera_id in CAMERA_IDS),
    )


def load_config(connection: sqlite3.Connection) -> DetectionConfig:
    """Read and clamp the Admin configuration. Never raises for bad values."""
    try:
        row = connection.execute("SELECT * FROM object_detection_settings WHERE id = 1").fetchone()
    except sqlite3.Error:
        row = None
    try:
        camera_rows = connection.execute(
            "SELECT * FROM object_detection_camera_settings ORDER BY camera_id"
        ).fetchall()
    except sqlite3.Error:
        camera_rows = []

    fallback = default_config()
    if row is None:
        return fallback

    base = _number(row["base_fps"], fallback.base_fps, FPS_MIN, FPS_MAX)
    active = _number(row["active_fps"], fallback.active_fps, FPS_MIN, FPS_MAX)
    maximum = _number(row["max_fps"], fallback.max_fps, FPS_MIN, FPS_MAX)
    # Keep the ordering the UI promises even if the row was edited by hand.
    active = max(active, base)
    maximum = max(maximum, active)
    source = str(row["detection_source"] or "ai_only")
    if source not in DETECTION_SOURCES:
        source = "ai_only"

    by_id = {int(camera["camera_id"]): _row_to_camera(camera) for camera in camera_rows}
    cameras = tuple(by_id.get(camera_id, CameraConfig(camera_id, False, True, None, True, None)) for camera_id in CAMERA_IDS)

    return DetectionConfig(
        enabled=_bool(row["enabled"], False),
        person_enabled=_bool(row["person_enabled"], True),
        person_confidence=round(_number(row["person_confidence"], 0.7, CONFIDENCE_MIN, CONFIDENCE_MAX), 2),
        vehicle_enabled=_bool(row["vehicle_enabled"], True),
        vehicle_confidence=round(_number(row["vehicle_confidence"], 0.7, CONFIDENCE_MIN, CONFIDENCE_MAX), 2),
        base_fps=round(base, 2),
        active_fps=round(active, 2),
        max_fps=round(maximum, 2),
        motion_boost=_bool(row["motion_boost"], True),
        activity_timeout_s=float(
            int(_number(row["activity_timeout_s"], fallback.activity_timeout_s, ACTIVITY_TIMEOUT_MIN, ACTIVITY_TIMEOUT_MAX))
        ),
        disappearance_timeout_s=float(
            int(
                _number(
                    row["disappearance_timeout_s"],
                    fallback.disappearance_timeout_s,
                    DISAPPEARANCE_MIN,
                    DISAPPEARANCE_MAX,
                )
            )
        ),
        max_concurrent=int(_number(row["max_concurrent"], fallback.max_concurrent, MAX_CONCURRENT_MIN, MAX_CONCURRENT_MAX)),
        queue_size=int(_number(row["queue_size"], fallback.queue_size, QUEUE_MIN, QUEUE_MAX)),
        min_event_duration_s=_number(row["min_event_duration_s"], 0.0, 0.0, 60.0),
        detection_source=source,
        cameras=cameras,
    )


def config_summary(config: DetectionConfig) -> str:
    """One safe log line; never contains a credential."""
    enabled = ",".join(str(camera) for camera in config.enabled_cameras()) or "none"
    return (
        f"enabled={config.enabled} cameras={enabled} base_fps={config.base_fps} "
        f"active_fps={config.active_fps} max_fps={config.max_fps} "
        f"person>= {config.person_confidence:.2f} vehicle>= {config.vehicle_confidence:.2f} "
        f"queue={config.queue_size} concurrent={config.max_concurrent} source={config.detection_source}"
    )


def settings_json(config: DetectionConfig) -> str:
    """Compact snapshot for the heartbeat (no secrets, no credentials)."""
    return json.dumps(
        {
            "enabled": config.enabled,
            "cameras": config.enabled_cameras(),
            "baseFps": config.base_fps,
            "activeFps": config.active_fps,
            "maxFps": config.max_fps,
            "personConfidence": config.person_confidence,
            "vehicleConfidence": config.vehicle_confidence,
            "source": config.detection_source,
        },
        separators=(",", ":"),
    )
