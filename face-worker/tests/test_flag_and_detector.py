"""FACE-001 / FACE-002: the flag defaults to off and gates the detector."""

from __future__ import annotations

from pathlib import Path

import pytest

from config import DEFAULT_CONFIDENCE, DEFAULT_MAX_FACES, load_config
from detector import DetectorError, build_detector


def test_face_001_detection_is_disabled_by_default() -> None:
    config = load_config({})
    assert config.enabled is False
    assert config.confidence == DEFAULT_CONFIDENCE == 0.60
    assert config.max_faces == DEFAULT_MAX_FACES == 10


def test_face_001_flag_must_be_exactly_true() -> None:
    for value in ("false", "0", "no", "", "yes", "on", "1"):
        assert load_config({"FACE_DETECTION_ENABLED": value}).enabled is False
    # Surrounding whitespace and case do not matter.
    assert load_config({"FACE_DETECTION_ENABLED": "true"}).enabled is True
    assert load_config({"FACE_DETECTION_ENABLED": " TRUE "}).enabled is True


def test_confidence_and_cap_are_configurable_and_validated() -> None:
    config = load_config({"FACE_DETECTION_CONFIDENCE": "0.8", "FACE_DETECTION_MAX_FACES": "3"})
    assert config.confidence == 0.8
    assert config.max_faces == 3

    # Nonsense values fall back to the documented defaults rather than failing
    # the whole worker or silently becoming 0.
    assert load_config({"FACE_DETECTION_CONFIDENCE": "banana"}).confidence == DEFAULT_CONFIDENCE
    assert load_config({"FACE_DETECTION_CONFIDENCE": "1.5"}).confidence == DEFAULT_CONFIDENCE
    assert load_config({"FACE_DETECTION_MAX_FACES": "-4"}).max_faces == DEFAULT_MAX_FACES


def test_face_002_disabled_never_initialises_a_detector(tmp_path: Path) -> None:
    # A model path that does not exist: with the flag off this must not even be
    # looked at, so no exception and no detector.
    config = load_config(
        {
            "FACE_DETECTION_ENABLED": "false",
            "FACE_DETECTION_MODEL_PATH": str(tmp_path / "does-not-exist.onnx"),
        }
    )
    assert build_detector(config) is None


def test_face_002_enabled_reports_a_missing_model_instead_of_crashing_later(tmp_path: Path) -> None:
    config = load_config(
        {
            "FACE_DETECTION_ENABLED": "true",
            "FACE_DETECTION_MODEL_PATH": str(tmp_path / "does-not-exist.onnx"),
        }
    )
    with pytest.raises(DetectorError):
        build_detector(config)
