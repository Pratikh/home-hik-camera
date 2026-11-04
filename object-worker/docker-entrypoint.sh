#!/bin/sh
# One-time, idempotent model verification before the worker starts.
#
# The model is intentionally kept outside the image and is provisioned ON THE
# HOST (never downloaded at container start):
#
#   npm run object:model                 # python3 object-worker/scripts/download_model.py
#
# The container filesystem is read-only and ./object-worker/models is mounted
# read-only, so a missing model cannot be fetched here. Fail early with an
# actionable message instead of starting a worker that can only report
# "model unavailable". When the file exists it is checksum-verified with the
# existing host provisioner, which never downloads a present file.
set -eu

DEFAULT_MODEL_PATH=/app/models/yolox_nano.onnx
MODEL_PATH="${OBJECT_DETECTION_MODEL_PATH:-$DEFAULT_MODEL_PATH}"

if [ ! -f "$MODEL_PATH" ]; then
  echo "[object-worker] ERROR: object-detection model not found at $MODEL_PATH." >&2
  echo "[object-worker] The model is not baked into the image and the /app/models mount is read-only," >&2
  echo "[object-worker] so the container cannot download it. Provision it on the host first:" >&2
  echo "[object-worker]   npm run object:model        # dev machine with Node.js" >&2
  echo "[object-worker]   python3 object-worker/scripts/download_model.py   # production host" >&2
  echo "[object-worker] It is ~3.6 MB and checksum-verified. Then recreate this container:" >&2
  echo "[object-worker]   podman compose up -d --force-recreate object-worker" >&2
  exit 1
fi

if [ ! -r "$MODEL_PATH" ]; then
  echo "[object-worker] ERROR: $MODEL_PATH exists but is not readable by container uid $(id -u)." >&2
  echo "[object-worker] On the host (rootful Podman) run:" >&2
  echo "[object-worker]   sudo chown -R 10001:10001 object-worker/models" >&2
  echo "[object-worker] Then recreate this container. See docs/Container-Hardening.md." >&2
  exit 1
fi

if [ "$MODEL_PATH" = "$DEFAULT_MODEL_PATH" ]; then
  # Verify the existing file with the same checksum the host downloader uses.
  # Only a MISSING model would trigger a download, and we already checked that.
  if ! python3 /app/scripts/download_model.py; then
    echo "[object-worker] ERROR: the model at $MODEL_PATH exists but failed checksum verification." >&2
    echo "[object-worker] Re-provision it on the host with a fresh download:" >&2
    echo "[object-worker]   python3 object-worker/scripts/download_model.py --force" >&2
    exit 1
  fi
else
  echo "[object-worker] WARNING: custom model path $MODEL_PATH; only $DEFAULT_MODEL_PATH is checksum-verified." >&2
fi

exec "$@"
