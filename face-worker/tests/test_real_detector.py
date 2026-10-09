"""Real-detector smoke test.

Skipped unless the local model has been downloaded, so the rest of the suite
still runs on a machine that has not fetched it. `FACE_TEST_IMAGE` optionally
points at a JPEG containing a face; without it only the model load and the call
path are verified.
"""

from __future__ import annotations

import os
from pathlib import Path

import cv2
import numpy as np
import pytest

from detector import YuNetDetector
from helpers import make_jpeg

MODEL = Path(__file__).resolve().parent.parent / "models" / "face_detection_yunet_2023mar.onnx"

pytestmark = pytest.mark.skipif(
    not MODEL.is_file(),
    reason="local YuNet model not downloaded (python3 face-worker/scripts/download_model.py)",
)


def test_the_local_model_loads_and_runs_on_a_snapshot_sized_image() -> None:
    detector = YuNetDetector(MODEL, 0.6, 704)
    image = cv2.imdecode(np.frombuffer(make_jpeg(704, 576), np.uint8), cv2.IMREAD_COLOR)
    assert image is not None

    detections = list(detector.detect(image))

    assert detector.name == "yunet"
    assert detector.model == "face_detection_yunet_2023mar"
    # Whatever the model finds, every box must be a real box with a real score.
    for detection in detections:
        assert 0.0 <= detection.confidence <= 1.0
        assert detection.width > 0 and detection.height > 0


def test_a_real_face_is_detected_when_a_test_image_is_supplied() -> None:
    path = os.environ.get("FACE_TEST_IMAGE", "").strip()
    if not path:
        pytest.skip("set FACE_TEST_IMAGE to a JPEG containing a face to run this")

    image = cv2.imread(path)
    assert image is not None, f"could not read {path}"

    detections = list(YuNetDetector(MODEL, 0.6, 704).detect(image))

    assert detections, "expected at least one face in FACE_TEST_IMAGE"
    assert max(detection.confidence for detection in detections) >= 0.6
