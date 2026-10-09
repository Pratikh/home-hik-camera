"""The local face detector.

DETECTION ONLY: this module answers "is there a face here, and where". It does
not recognise anyone, does not compute embeddings and does not contact any
service. The model is a local ONNX file loaded once at start-up.

The detector is selected by `build_detector()`. Today it is OpenCV's YuNet,
which ships as a ~230 KB ONNX model and runs on CPU in a few milliseconds at
704x576. MediaPipe and the older Viola-Jones cascades were rejected: MediaPipe
pulls in a TensorFlow Lite runtime that is heavier in RAM than this feature
justifies on a 4 GB server, and a Haar cascade produces far more false
positives on CCTV faces.
"""

from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Protocol, Sequence

from config import WorkerConfig

DEFAULT_NMS_THRESHOLD = 0.3
DEFAULT_TOP_K = 5000


class DetectorError(RuntimeError):
    """The detector could not be created or failed while running."""


@dataclass(frozen=True)
class Detection:
    """A box in the coordinates of the image that was passed in."""

    x: int
    y: int
    width: int
    height: int
    confidence: float


class Detector(Protocol):
    name: str
    model: str

    def detect(self, image) -> Sequence[Detection]:  # pragma: no cover - protocol
        ...


class YuNetDetector:
    """OpenCV YuNet (`cv2.FaceDetectorYN`), CPU only, single-threaded."""

    name = "yunet"

    def __init__(self, model_path: Path, score_threshold: float, max_detection_width: int = 704):
        try:
            import cv2
        except ImportError as error:  # pragma: no cover - environment problem
            raise DetectorError("opencv-python-headless is not installed") from error

        if not model_path.is_file():
            raise DetectorError(f"model file not found: {model_path}")

        # One thread: the hub and the DVR poller share this machine, and the
        # worker must never saturate the CPU of a 4 GB server.
        cv2.setNumThreads(1)
        self._cv2 = cv2
        self.model = model_path.stem
        self._max_width = max_detection_width
        try:
            self._detector = cv2.FaceDetectorYN.create(
                str(model_path),
                "",
                (320, 320),
                score_threshold,
                DEFAULT_NMS_THRESHOLD,
                DEFAULT_TOP_K,
            )
        except Exception as error:  # pragma: no cover - corrupt model
            raise DetectorError(f"could not load {model_path.name}: {error}") from error

    def detect(self, image) -> Sequence[Detection]:
        cv2 = self._cv2
        height, width = image.shape[:2]
        scale = 1.0
        work = image
        # Downscale only for inference; the box is scaled back to the original
        # image, so crops keep full snapshot resolution.
        if self._max_width and width > self._max_width:
            scale = self._max_width / float(width)
            work = cv2.resize(
                image,
                (self._max_width, max(1, int(round(height * scale)))),
                interpolation=cv2.INTER_AREA,
            )
        work_height, work_width = work.shape[:2]
        try:
            self._detector.setInputSize((work_width, work_height))
            _, faces = self._detector.detect(work)
        except Exception as error:  # pragma: no cover - cv2 failure
            raise DetectorError(f"detection failed: {error}") from error

        if faces is None:
            return []
        detections: list[Detection] = []
        for row in faces:
            x, y, box_width, box_height = float(row[0]), float(row[1]), float(row[2]), float(row[3])
            score = float(row[-1])
            if scale != 1.0:
                x, y, box_width, box_height = x / scale, y / scale, box_width / scale, box_height / scale
            detections.append(
                Detection(
                    x=int(round(x)),
                    y=int(round(y)),
                    width=int(round(box_width)),
                    height=int(round(box_height)),
                    confidence=score,
                )
            )
        return detections


def build_detector(config: WorkerConfig) -> Detector | None:
    """Create the detector, or return None when detection is switched off.

    With the flag off this function must not touch the model file or import a
    vision library: no detector is initialised and no work happens.
    """
    if not config.enabled:
        return None
    return YuNetDetector(config.model_path, config.confidence, config.max_detection_width)
