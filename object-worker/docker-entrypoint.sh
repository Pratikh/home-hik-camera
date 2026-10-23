#!/bin/sh
# One-time, idempotent model initialisation before the worker starts.
#
# The model is intentionally kept outside the image: existing deployments may
# already have it in the mounted ./object-worker/models directory. When the file
# is present and its checksum matches, download_model.py only verifies it and
# makes no network request. Only a missing/corrupt model is fetched — once.
set -eu

python3 /app/scripts/download_model.py \
  || python3 /app/scripts/download_model.py --force \
  || echo "[object-worker] WARNING: model unavailable; the worker will report 'model unavailable' until it is provisioned"

exec "$@"
