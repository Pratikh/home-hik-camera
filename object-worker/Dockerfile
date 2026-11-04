# Live object-detection worker (CPU only, local and offline).
#
#   podman compose build object-worker
#   podman compose up -d object-worker
#
# It is part of the normal stack and idles cheaply when detection is disabled.
# The YOLOX-Nano model is intentionally kept outside the image (mounted
# read-only from ./object-worker/models) so it stays out of git and existing
# downloads are reused. It is provisioned ON THE HOST with
# `npm run object:model` (or `python3 object-worker/scripts/download_model.py`);
# docker-entrypoint.sh only verifies it and fails with an actionable message
# when it is missing. Nothing downloads at container start.
FROM python:3.12-slim

# opencv-python-headless links libglib/libgomp at import time; its bundled FFmpeg
# decodes the MediaMTX HLS (MPEG-TS) substream.
RUN apt-get update \
  && apt-get install -y --no-install-recommends libglib2.0-0 libgomp1 \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY object-worker/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt

COPY object-worker/*.py ./
COPY object-worker/scripts/ ./scripts/
COPY object-worker/docker-entrypoint.sh ./docker-entrypoint.sh
# uid/gid 10001 (name `cctv`) is shared by every image so the operator can own
# the whole ./data tree once. The worker never needs root: it only reads the
# read-only model mount and writes the shared SQLite database under DATA_DIR.
# compose.yml additionally makes the image filesystem read-only; /tmp stays
# writable through a tmpfs.
RUN chmod +x ./docker-entrypoint.sh \
  && groupadd --gid 10001 cctv \
  && useradd --uid 10001 --gid cctv --no-create-home --home-dir /tmp --shell /usr/sbin/nologin cctv \
  && mkdir -p /app/data /app/models \
  && chown cctv:cctv /app/data

ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/app/data
ENV OBJECT_DETECTION_MODEL_PATH=/app/models/yolox_nano.onnx
ENV MEDIAMTX_RTSP_URL=rtsp://mediamtx:8554
ENV OBJECT_DETECTION_STREAM=rtsp
# Any accidental per-user cache write (OpenCV/Python tooling) goes to the
# writable tmpfs instead of failing against the read-only root filesystem.
ENV HOME=/tmp

# Detection stays off until an Admin enables it in the hub; the worker then reads
# the settings from the shared database and starts sampling without a restart.
# The entrypoint only verifies the host-provisioned model (idempotent, no writes).
USER 10001:10001
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["python3", "worker.py"]
