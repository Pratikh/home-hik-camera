# Live object-detection worker (CPU only, local and offline).
#
#   podman build -t home-cctv-object-worker -f object-worker/Dockerfile .
#   podman compose --profile objects up -d object-worker
#
# The model is mounted rather than baked in, so it can be fetched once on the
# host and kept out of git. The worker publishes no ports.
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
RUN mkdir -p /app/models

ENV PYTHONUNBUFFERED=1
ENV DATA_DIR=/app/data
ENV OBJECT_DETECTION_MODEL_PATH=/app/models/yolox_nano.onnx
ENV MEDIAMTX_RTSP_URL=rtsp://mediamtx:8554
ENV OBJECT_DETECTION_STREAM=rtsp

# Detection stays off until an Admin enables it in the hub; the worker then reads
# the settings from the shared database and starts sampling.
CMD ["python3", "worker.py"]
