# Local face-detection worker (detection only).
#
# Podman-compatible; no Docker Desktop features are used.
#   podman build -t home-cctv-face-worker -f face-worker/Dockerfile .
#   podman run --rm \
#     -e FACE_DETECTION_ENABLED=true \
#     -e DATA_DIR=/app/data \
#     -v "$PWD/data:/app/data" \
#     -v "$PWD/face-worker/models:/app/models:ro" \
#     home-cctv-face-worker
#
# The model is mounted rather than baked in, so it can be fetched once on the
# host (python3 face-worker/scripts/download_model.py) and kept out of git.
FROM python:3.12-slim

# opencv-python-headless still links libglib and OpenMP at import time.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY face-worker/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY face-worker/*.py ./
# uid/gid 10001 (name `cctv`) is shared by every image so the operator can own
# the whole ./data tree once. The worker never needs root: it only reads the
# read-only model mount and writes the shared SQLite database and face crops
# under DATA_DIR. compose.yml additionally makes the image filesystem read-only;
# /tmp stays writable through a tmpfs.
RUN groupadd --gid 10001 cctv \
  && useradd --uid 10001 --gid cctv --no-create-home --home-dir /tmp --shell /usr/sbin/nologin cctv \
  && mkdir -p /app/data /app/models \
  && chown cctv:cctv /app/data

ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/app/data
ENV FACE_DETECTION_MODEL_PATH=/app/models/face_detection_yunet_2023mar.onnx
# Any accidental per-user cache write (OpenCV/Python tooling) goes to the
# writable tmpfs instead of failing against the read-only root filesystem.
ENV HOME=/tmp

# Exits 0 immediately when FACE_DETECTION_ENABLED is not true.
USER 10001:10001
CMD ["python3", "worker.py"]
