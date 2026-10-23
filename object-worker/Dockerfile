# Live object-detection worker (CPU only, local and offline).
#
#   podman compose up -d
#
# It is part of the normal stack and idles cheaply when detection is disabled.
# The YOLOX-Nano model is intentionally kept outside the image (mounted from
# ./object-worker/models) so it stays out of git and existing downloads are
# reused; docker-entrypoint.sh initialises it once and is offline-safe when the
# file is already present. The worker publishes no ports.
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
RUN chmod +x ./docker-entrypoint.sh && mkdir -p /app/models

ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/app/data
ENV OBJECT_DETECTION_MODEL_PATH=/app/models/yolox_nano.onnx
ENV MEDIAMTX_RTSP_URL=rtsp://mediamtx:8554
ENV OBJECT_DETECTION_STREAM=rtsp

# Detection stays off until an Admin enables it in the hub; the worker then reads
# the settings from the shared database and starts sampling without a restart.
# The entrypoint only provisions the model when it is missing (idempotent).
ENTRYPOINT ["./docker-entrypoint.sh"]
CMD ["python3", "worker.py"]
