"""FACE-012: crop paths can never escape the crop directory."""

from __future__ import annotations

import re
from datetime import datetime, timezone
from pathlib import Path

import pytest

from crops import (
    EVENT_ID_RE,
    CropPathError,
    clamp_box,
    clear_event_crops,
    crop_relative_path,
    resolve_crop_path,
)

EVENT_ID = "evt_0123456789abcdef01234567"
WHEN = datetime(2026, 10, 9, tzinfo=timezone.utc)


def test_face_012_relative_path_is_generated_only_from_validated_parts(tmp_path: Path) -> None:
    relative = crop_relative_path(EVENT_ID, 0, WHEN)
    assert relative == "2026/10/evt_0123456789abcdef01234567-face-1.jpg"
    assert resolve_crop_path(tmp_path / "face-crops", relative).is_relative_to((tmp_path / "face-crops").resolve())


def test_face_012_rejects_invalid_event_ids() -> None:
    for bad in ["../../etc/passwd", "evt_short", "1-evt_0123456789abcdef01234567", "", None, "evt_0123456789abcdef0123456g"]:
        with pytest.raises(CropPathError):
            crop_relative_path(bad, 0, WHEN)  # type: ignore[arg-type]
    assert not EVENT_ID_RE.match("../../etc/passwd")


def test_face_012_rejects_indices_outside_the_allowed_range() -> None:
    for bad in (-1, 1000, 12345):
        with pytest.raises(CropPathError):
            crop_relative_path(EVENT_ID, bad, WHEN)


def test_face_012_resolver_refuses_traversal_and_absolute_paths(tmp_path: Path) -> None:
    root = tmp_path / "face-crops"
    root.mkdir()
    evil = [
        "../outside.jpg",
        "2026/10/../../../outside.jpg",
        "/etc/passwd",
        "C:/windows/system32/config",
        "2026/10//x.jpg",
        "2026\\..\\..\\outside.jpg",
        "",
        ".",
        "..",
    ]
    for value in evil:
        with pytest.raises(CropPathError):
            resolve_crop_path(root, value)


def test_clamp_box_stays_inside_the_image() -> None:
    # A box that overlaps every edge is clamped, never negative and never larger
    # than the picture.
    x, y, width, height = clamp_box(-40, -30, 900, 700, 704, 576)
    assert x >= 0 and y >= 0
    assert x + width <= 704
    assert y + height <= 576
    assert width >= 1 and height >= 1


def test_clamp_box_adds_padding_without_upscaling() -> None:
    unpadded = clamp_box(100, 100, 80, 80, 704, 576, padding=0.0)
    padded = clamp_box(100, 100, 80, 80, 704, 576, padding=0.25)
    assert unpadded == (100, 100, 80, 80)
    assert padded[0] < unpadded[0] and padded[2] > unpadded[2]


def test_clear_event_crops_removes_only_this_events_files(tmp_path: Path) -> None:
    root = tmp_path / "face-crops"
    directory = root / "2026" / "10"
    directory.mkdir(parents=True)
    mine = [f"{EVENT_ID}-face-{index}.jpg" for index in (1, 2, 3)]
    other = "evt_ffffffffffffffffffffffff-face-1.jpg"
    unrelated = "notes.txt"
    for name in [*mine, other, unrelated]:
        (directory / name).write_bytes(b"x")

    removed = clear_event_crops(root, EVENT_ID, WHEN)
    assert removed == 3
    assert (directory / other).is_file()
    assert (directory / unrelated).is_file()
    assert not any((directory / name).exists() for name in mine)


def test_crop_file_pattern_matches_what_we_generate() -> None:
    name = Path(crop_relative_path(EVENT_ID, 4, WHEN)).name
    assert re.match(r"^evt_[a-f0-9]{24}-face-[0-9]{1,4}\.jpg$", name)
