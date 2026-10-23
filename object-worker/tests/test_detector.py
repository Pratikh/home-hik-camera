import numpy as np
import pytest

from detector import Detector, classification_for


class FakeInput:
    name = "images"
    shape = [1, 3, 416, 416]


class FakeSession:
    def __init__(self, output):
        self.output = output

    def get_inputs(self):
        return [FakeInput()]

    def run(self, _names, _feed):
        return [self.output]


def blank_output():
    return np.zeros((1, 3549, 85), dtype=np.float32)


def test_class_mapping():
    assert classification_for("person") == "person"
    for raw in ("car", "motorcycle", "bus", "truck"):
        assert classification_for(raw) == "vehicle"


def test_decodes_a_person_anchor_and_scales_the_box():
    output = blank_output()
    # First stride-8 grid is 52x52. Place one person at grid cell (10, 10):
    # centre = (10*8, 10*8) = (80, 80), size = exp(log(40/8)) * 8 = 40.
    index = 10 * 52 + 10
    output[0, index, 0] = 0.0  # cx raw
    output[0, index, 1] = 0.0  # cy raw
    output[0, index, 2] = np.log(40 / 8)
    output[0, index, 3] = np.log(40 / 8)
    output[0, index, 4] = 0.9  # objectness
    output[0, index, 5 + 0] = 0.95  # person

    detector = Detector("unused.onnx", session=FakeSession(output))
    frame = np.zeros((576, 704, 3), dtype=np.uint8)
    detections = detector.detect(frame)

    assert len(detections) == 1
    detection = detections[0]
    assert detection.raw_class == "person"
    assert detection.classification == "person"
    assert detection.confidence == pytest.approx(0.9 * 0.95, abs=1e-5)
    # 80/416 * 704 = 135.38, 40/416 * 704 = 67.69
    assert detection.x == pytest.approx((80 - 20) / 416 * 704, abs=0.5)
    assert detection.y == pytest.approx((80 - 20) / 416 * 576, abs=0.5)
    assert detection.width == pytest.approx(40 / 416 * 704, abs=0.5)
    assert detection.height == pytest.approx(40 / 416 * 576, abs=0.5)


def test_maps_a_car_to_vehicle():
    output = blank_output()
    index = 0
    output[0, index, 2] = np.log(60 / 8)
    output[0, index, 3] = np.log(40 / 8)
    output[0, index, 4] = 0.9
    output[0, index, 5 + 2] = 0.9  # COCO car

    detector = Detector("unused.onnx", session=FakeSession(output))
    detections = detector.detect(np.zeros((576, 704, 3), dtype=np.uint8))
    assert [item.raw_class for item in detections] == ["car"]
    assert detections[0].classification == "vehicle"


def test_drops_unmapped_classes_and_low_scores():
    output = blank_output()
    # COCO class 16 (dog) is not part of the product.
    output[0, 0, 2] = np.log(2)
    output[0, 0, 3] = np.log(2)
    output[0, 0, 4] = 0.99
    output[0, 0, 5 + 16] = 0.99
    detector = Detector("unused.onnx", session=FakeSession(output))
    assert detector.detect(np.zeros((576, 704, 3), dtype=np.uint8)) == []


def test_blank_frame_has_no_detections():
    output = blank_output()
    output[0, :, 4] = 0.1
    detector = Detector("unused.onnx", session=FakeSession(output))
    assert detector.detect(np.zeros((576, 704, 3), dtype=np.uint8)) == []
