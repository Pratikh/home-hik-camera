"""YOLOX-Nano object detector (ONNX Runtime, CPU only).

The model is the official YOLOX-Nano ONNX export (Apache-2.0): input
`images` [1, 3, 416, 416] float32 in 0..255 BGR order, output
`output` [1, 3549, 85] — 3549 anchor predictions with
[cx, cy, w, h, objectness, class0..class79], already sigmoid-activated for the
scores and with raw exponential box sizes, exactly as the YOLOX demo decodes it.

Only the classes the product supports are returned: person, car, motorcycle,
bus and truck. Everything else is dropped.
"""

from __future__ import annotations

from dataclasses import dataclass

import cv2
import numpy as np

MODEL_NAME = "YOLOX-Nano"
MODEL_VERSION = "0.1.1"
INPUT_SIZE = 416
STRIDES = (8, 16, 32)
IOU_THRESHOLD = 0.45
# Any lower-confidence detection is discarded before the per-class threshold is
# applied; this is only a floor to keep the NMS list small.
DEFAULT_FLOOR = 0.30

# COCO class ids used by YOLOX.
RAW_CLASS_BY_COCO = {0: "person", 2: "car", 3: "motorcycle", 5: "bus", 7: "truck"}


@dataclass(frozen=True)
class Detection:
    raw_class: str
    classification: str  # "person" | "vehicle"
    confidence: float
    # Bounding box in the original frame's pixel coordinates.
    x: float
    y: float
    width: float
    height: float


class DetectorError(RuntimeError):
    pass


def classification_for(raw_class: str) -> str:
    return "person" if raw_class == "person" else "vehicle"


def _nms(boxes: np.ndarray, scores: np.ndarray, iou_threshold: float) -> list[int]:
    if len(boxes) == 0:
        return []
    order = scores.argsort()[::-1]
    keep: list[int] = []
    while order.size > 0:
        index = int(order[0])
        keep.append(index)
        if order.size == 1:
            break
        rest = order[1:]
        xx1 = np.maximum(boxes[index, 0], boxes[rest, 0])
        yy1 = np.maximum(boxes[index, 1], boxes[rest, 1])
        xx2 = np.minimum(boxes[index, 2], boxes[rest, 2])
        yy2 = np.minimum(boxes[index, 3], boxes[rest, 3])
        inter = np.clip(xx2 - xx1, 0, None) * np.clip(yy2 - yy1, 0, None)
        area_index = max(0.0, boxes[index, 2] - boxes[index, 0]) * max(0.0, boxes[index, 3] - boxes[index, 1])
        area_rest = np.clip(boxes[rest, 2] - boxes[rest, 0], 0, None) * np.clip(
            boxes[rest, 3] - boxes[rest, 1], 0, None
        )
        iou = inter / np.maximum(area_index + area_rest - inter, 1e-9)
        order = rest[iou <= iou_threshold]
    return keep


class Detector:
    def __init__(self, model_path: str, input_size: int = INPUT_SIZE, session=None):
        self.input_size = input_size
        if session is not None:
            self.session = session
        else:
            try:
                import onnxruntime as ort
            except ImportError as error:  # pragma: no cover - container always has it
                raise DetectorError("onnxruntime is not installed") from error
            try:
                self.session = ort.InferenceSession(model_path, providers=["CPUExecutionProvider"])
            except Exception as error:  # noqa: BLE001 - surfaced as DetectorError
                raise DetectorError(f"could not load model: {error}") from error
        self.input_name = self.session.get_inputs()[0].name

    def preprocess(self, frame_bgr: np.ndarray) -> np.ndarray:
        resized = cv2.resize(frame_bgr, (self.input_size, self.input_size), interpolation=cv2.INTER_LINEAR)
        rgb = cv2.cvtColor(resized, cv2.COLOR_BGR2RGB)
        chw = rgb.transpose(2, 0, 1).astype(np.float32)
        # YOLOX's ONNX export expects raw 0..255 values; no mean/std division.
        return np.ascontiguousarray(chw[None, ...])

    def detect(self, frame_bgr: np.ndarray, floor: float = DEFAULT_FLOOR) -> list[Detection]:
        height, width = frame_bgr.shape[:2]
        if height <= 0 or width <= 0:
            return []
        tensor = self.preprocess(frame_bgr)
        output = self.session.run(None, {self.input_name: tensor})[0]
        predictions = np.asarray(output, dtype=np.float32).reshape(-1, 85)

        boxes_per_class: dict[int, list[tuple[list[float], float]]] = {}
        offset = 0
        for stride in STRIDES:
            grid_h = self.input_size // stride
            grid_w = self.input_size // stride
            current = predictions[offset : offset + grid_h * grid_w]
            offset += grid_h * grid_w
            if current.size == 0:
                continue
            grid = np.stack(
                np.meshgrid(np.arange(grid_w), np.arange(grid_h), indexing="xy"), axis=2
            ).reshape(-1, 2)
            current = current.copy()
            # Decode exactly as the YOLOX demo does: centre = (raw + grid) * stride,
            # size = exp(raw) * stride.
            current[:, 0:2] = (current[:, 0:2] + grid) * stride
            current[:, 2:4] = np.exp(current[:, 2:4]) * stride
            scores = current[:, 4:5] * current[:, 5:]
            class_ids = np.argmax(scores, axis=1)
            class_scores = scores[np.arange(len(current)), class_ids]
            mask = class_scores >= floor
            for row, class_id, score in zip(current[mask], class_ids[mask], class_scores[mask]):
                coco = int(class_id)
                if coco not in RAW_CLASS_BY_COCO:
                    continue
                cx, cy, w, h = float(row[0]), float(row[1]), float(row[2]), float(row[3])
                box = [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2]
                boxes_per_class.setdefault(coco, []).append((box, float(score)))

        scale_x = width / self.input_size
        scale_y = height / self.input_size
        detections: list[Detection] = []
        for coco, entries in boxes_per_class.items():
            boxes = np.array([entry[0] for entry in entries], dtype=np.float32)
            scores = np.array([entry[1] for entry in entries], dtype=np.float32)
            for index in _nms(boxes, scores, IOU_THRESHOLD):
                x1, y1, x2, y2 = boxes[index]
                x1 = max(0.0, x1 * scale_x)
                y1 = max(0.0, y1 * scale_y)
                x2 = min(float(width), x2 * scale_x)
                y2 = min(float(height), y2 * scale_y)
                if x2 - x1 < 2 or y2 - y1 < 2:
                    continue
                raw = RAW_CLASS_BY_COCO[coco]
                detections.append(
                    Detection(
                        raw_class=raw,
                        classification=classification_for(raw),
                        confidence=float(scores[index]),
                        x=x1,
                        y=y1,
                        width=x2 - x1,
                        height=y2 - y1,
                    )
                )
        detections.sort(key=lambda item: item.confidence, reverse=True)
        return detections
