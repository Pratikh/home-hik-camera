#!/usr/bin/env python3
"""Fetch the local face-detection model once.

The worker never downloads anything while it runs: this script is a one-time
setup step, and `worker.py` only ever reads the file from disk. Nothing is sent
anywhere; the model is a static ONNX file.

Model: `face_detection_yunet_2023mar.onnx` from the OpenCV Zoo
(<https://github.com/opencv/opencv_zoo/tree/main/models/face_detection_yunet>).
It is MIT licensed, ~232 KB, and detects faces of roughly 10x10 up to 300x300
pixels. The SHA-256 below was taken from the repository's Git-LFS pointer and is
verified after download.

Usage:
    python3 face-worker/scripts/download_model.py
    python3 face-worker/scripts/download_model.py --force
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

# raw.githubusercontent.com serves the Git-LFS pointer file, so the media
# endpoint is used instead.
URL = (
    "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/"
    "models/face_detection_yunet/face_detection_yunet_2023mar.onnx"
)
SHA256 = "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4"
FILENAME = "face_detection_yunet_2023mar.onnx"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def download(target: Path) -> None:
    print(f"downloading {URL}")
    request = urllib.request.Request(URL, headers={"User-Agent": "home-cctv-hub-face-worker"})
    with urllib.request.urlopen(request, timeout=120) as response:  # noqa: S310 - pinned https URL
        payload = response.read()

    digest = hashlib.sha256(payload).hexdigest()
    if digest != SHA256:
        raise SystemExit(f"checksum mismatch: expected {SHA256}, got {digest}\nNothing was written.")

    target.parent.mkdir(parents=True, exist_ok=True)
    temporary = target.with_suffix(".onnx.part")
    temporary.write_bytes(payload)
    temporary.replace(target)
    print(f"wrote {target} ({len(payload)} bytes, sha256 verified)")


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Download the local YuNet face-detection model")
    parser.add_argument("--force", action="store_true", help="overwrite an existing file")
    args = parser.parse_args(argv)

    target = MODELS_DIR / FILENAME
    if target.is_file() and not args.force:
        digest = hashlib.sha256(target.read_bytes()).hexdigest()
        if digest == SHA256:
            print(f"{target} is already present and verified")
            return 0
        print(f"{target} exists but does not match the expected checksum; re-run with --force", file=sys.stderr)
        return 1

    download(target)
    return 0


if __name__ == "__main__":
    sys.exit(main())
