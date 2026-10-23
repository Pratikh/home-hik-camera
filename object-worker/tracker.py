"""Lightweight per-camera tracker (IoU + centroid), one event per object.

No heavy multi-object-tracking framework: detections are matched to the nearest
existing track of the same classification by IoU, falling back to centroid
distance. A track starts when an accepted detection first appears and ends after
the configured disappearance timeout, so a person walking past produces one
event, not one per frame.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Iterable

from detector import Detection, classification_for
from store import new_track_id

MATCH_IOU = 0.15
MATCH_CENTROID_PX = 80.0


@dataclass
class Track:
    id: str
    camera_id: int
    raw_class: str
    classification: str
    confidence: float
    threshold: float
    bbox: tuple[float, float, float, float]
    first_seen: datetime
    last_seen: datetime
    detection_count: int
    snapshot_jpeg: bytes | None = None
    snapshot_path: str | None = None
    event_id: str | None = None
    persisted: bool = False
    ended: bool = False
    detector: str = "yolox"
    model: str = "yolox-nano"

    @property
    def duration_s(self) -> float:
        return max(0.0, (self.last_seen - self.first_seen).total_seconds())


def _iou(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax1, ay1, aw, ah = a
    bx1, by1, bw, bh = b
    ax2, ay2 = ax1 + aw, ay1 + ah
    bx2, by2 = bx1 + bw, by1 + bh
    inter_w = max(0.0, min(ax2, bx2) - max(ax1, bx1))
    inter_h = max(0.0, min(ay2, by2) - max(ay1, by1))
    inter = inter_w * inter_h
    union = max(aw * ah + bw * bh - inter, 1e-9)
    return inter / union


def _centroid_distance(a: tuple[float, float, float, float], b: tuple[float, float, float, float]) -> float:
    ax, ay = a[0] + a[2] / 2, a[1] + a[3] / 2
    bx, by = b[0] + b[2] / 2, b[1] + b[3] / 2
    return ((ax - bx) ** 2 + (ay - by) ** 2) ** 0.5


@dataclass(frozen=True)
class TrackAction:
    """What the worker should persist after one tracker update."""

    kind: str  # "started" | "updated" | "ended"
    track: Track


@dataclass
class CameraTracker:
    camera_id: int
    max_tracks: int = 20
    tracks: list[Track] = field(default_factory=list)

    def update(
        self,
        detections: Iterable[tuple[Detection, float]],
        now: datetime,
        disappearance_timeout_s: float,
    ) -> list[TrackAction]:
        """Match this frame's detections, then close stale tracks.

        `detections` pairs each accepted detection with the threshold that
        accepted it; the threshold is stored on the event for auditing.
        """
        accepted = list(detections)
        actions: list[TrackAction] = []
        matched_detections: set[int] = set()

        for track in self.tracks:
            if track.ended:
                continue
            best_index = None
            best_score = 0.0
            for index, (detection, _threshold) in enumerate(accepted):
                if index in matched_detections:
                    continue
                if detection.classification != track.classification:
                    continue
                overlap = _iou(
                    (track.bbox[0], track.bbox[1], track.bbox[2], track.bbox[3]),
                    (detection.x, detection.y, detection.width, detection.height),
                )
                distance = _centroid_distance(
                    (track.bbox[0], track.bbox[1], track.bbox[2], track.bbox[3]),
                    (detection.x, detection.y, detection.width, detection.height),
                )
                score = overlap if overlap >= MATCH_IOU else (0.05 if distance <= MATCH_CENTROID_PX else 0.0)
                if score > best_score:
                    best_score = score
                    best_index = index
            if best_index is None:
                continue
            matched_detections.add(best_index)
            detection, threshold = accepted[best_index]
            track.last_seen = now
            track.confidence = detection.confidence
            track.bbox = (detection.x, detection.y, detection.width, detection.height)
            track.detection_count += 1
            # Keep the strongest threshold that was actually relevant; it is
            # only stored for the event metadata, so the first one is fine.
            track.threshold = threshold
            actions.append(TrackAction("updated", track))

        for index, (detection, threshold) in enumerate(accepted):
            if index in matched_detections:
                continue
            if len(self.tracks) >= self.max_tracks:
                break
            track = Track(
                id=new_track_id(),
                camera_id=self.camera_id,
                raw_class=detection.raw_class,
                classification=classification_for(detection.raw_class),
                confidence=detection.confidence,
                threshold=threshold,
                bbox=(detection.x, detection.y, detection.width, detection.height),
                first_seen=now,
                last_seen=now,
                detection_count=1,
            )
            self.tracks.append(track)
            actions.append(TrackAction("started", track))

        for track in self.tracks:
            if track.ended:
                continue
            stale_for = (now - track.last_seen).total_seconds()
            if stale_for > disappearance_timeout_s:
                track.ended = True
                actions.append(TrackAction("ended", track))

        # Bound memory: drop ended tracks that were never persisted (short noise).
        self.tracks = [track for track in self.tracks if not (track.ended and not track.persisted)]
        return actions
