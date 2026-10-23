#!/usr/bin/env python3
"""Fetch the local object-detection model once.

The worker never downloads anything while it runs: this script is a one-time
setup step. Model: YOLOX-Nano (ONNX), Apache-2.0, from the official Megvii
YOLOX release. It is ~3.6 MB and detects the COCO classes the hub maps to
person/vehicle.

    python3 object-worker/scripts/download_model.py
    python3 object-worker/scripts/download_model.py --force
"""

from __future__ import annotations

import argparse
import hashlib
import sys
import urllib.request
from pathlib import Path

URL = "https://github.com/Megvii-BaseDetection/YOLOX/releases/download/0.1.1rc0/yolox_nano.onnx"
SHA256 = "c789161ed43c8269fcd4e67c67eeeb4e80c622da2eb296a20bc6007bd18a0b7d"
FILENAME = "yolox_nano.onnx"
MODELS_DIR = Path(__file__).resolve().parent.parent / "models"


def download(target: Path) -> None:
    print(f"downloading {URL}")
    request = urllib.request.Request(URL, headers={"User-Agent": "home-cctv-hub-object-worker"})
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
    parser = argparse.ArgumentParser(description="Download the local YOLOX-Nano object-detection model")
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
