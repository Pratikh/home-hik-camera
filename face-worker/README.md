# Face-detection worker

Local, offline, CPU-only face **detection** for Home CCTV Hub. It reads event
snapshots from the hub's SQLite database, detects faces with a local model and
writes `event_faces` rows plus JPEG crops under `DATA_DIR/face-crops/`.

It does **not** recognise anyone, does not compute embeddings and never contacts
a network service.

Full documentation: [../docs/Face-Detection.md](../docs/Face-Detection.md).

## One-time model setup

The model is not committed. Fetch it once, with checksum verification:

```bash
python3 face-worker/scripts/download_model.py
```

That writes `face-worker/models/face_detection_yunet_2023mar.onnx` (232 KB, MIT,
from the OpenCV Zoo). See the docs for license and provenance.

## Run it

```bash
python3 -m venv .venv-face
.venv-face/bin/pip install -r face-worker/requirements.txt

FACE_DETECTION_ENABLED=true .venv-face/bin/python face-worker/worker.py
FACE_DETECTION_ENABLED=true .venv-face/bin/python face-worker/worker.py --once
```

With `FACE_DETECTION_ENABLED` unset or false the worker logs that detection is
off and exits without loading a model or writing anything.

## Container (Podman)

```bash
podman build -t home-cctv-face-worker -f face-worker/Dockerfile .
podman run --rm \
  -e FACE_DETECTION_ENABLED=true \
  -v "$PWD/data:/app/data" \
  -v "$PWD/face-worker/models:/app/models:ro" \
  home-cctv-face-worker
```

## Tests

```bash
.venv-face/bin/pip install -r face-worker/requirements-dev.txt
cd face-worker && ../.venv-face/bin/python -m pytest -q
```

The tests use an injected stub detector, so the pipeline, duplicate protection,
thresholds and path safety are verified without depending on a real face image.
