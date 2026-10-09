#!/bin/sh
# Home CCTV hub — restore application data from a backup made by backup.sh.
#
# The restore replaces the *live* data directory contents, so it must be run
# while the hub is stopped to avoid a torn database. It never touches DVR
# recordings or MediaMTX (those are not part of the backup).
#
# Safety: the target backup directory must contain a manifest.json, so this
# script will not wipe the data directory from an accidental path. It also
# refuses to run if the hub web port appears to be listening.
#
# Usage:
#   ./scripts/restore.sh ./backups/2026-10-09_103000
#
# Steps for Podman:
#   1. podman compose down web        # stop the app (or the whole stack)
#   2. ./scripts/restore.sh <backup>
#   3. podman compose up -d web
#
# Set DRY_RUN=1 to preview the files that would be restored without changing
# anything.

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
SRC="${1:-}"

if [ -z "$SRC" ]; then
  echo "restore: usage: $0 <backup-directory>" >&2
  exit 1
fi

SRC="$(cd "$SRC" 2>/dev/null && pwd || echo '')"
if [ -z "$SRC" ] || [ ! -f "$SRC/manifest.json" ]; then
  echo "restore: $1 is not a backup (missing manifest.json). Refusing." >&2
  exit 1
fi

# Refuse to run if the app appears to be up, to avoid corrupting the database.
PORT="${PORT:-3000}"
if [ "${SKIP_PORT_CHECK:-0}" != "1" ]; then
  if (command -v lsof >/dev/null 2>&1 && lsof -nP -iTCP:"$PORT" -sTCP:LISTEN >/dev/null 2>&1) || \
     (command -v ss >/dev/null 2>&1 && ss -ltn 2>/dev/null | grep -q ":$PORT "); then
    echo "restore: the hub appears to be running on port $PORT. Stop it first." >&2
    echo "restore:   podman compose down web   (or ctrl-c the dev server)" >&2
    exit 1
  fi
fi

echo "restore: source  $SRC"
echo "restore: target  $DATA_DIR"

if [ "${DRY_RUN:-0}" = "1" ]; then
  echo "restore: DRY RUN — no files were changed."
  if [ -f "$SRC/database.sqlite" ]; then echo "restore: would restore database.sqlite"; fi
  if [ -d "$SRC/events" ]; then echo "restore: would restore events/ ($(find "$SRC/events" -type f | wc -l | tr -d ' ') files)"; fi
  if [ -d "$SRC/face-crops" ]; then echo "restore: would restore face-crops/ ($(find "$SRC/face-crops" -type f | wc -l | tr -d ' ') files)"; fi
  if [ -f "$SRC/cameras.json" ]; then echo "restore: would restore cameras.json"; fi
  exit 0
fi

mkdir -p "$DATA_DIR"

# Keep a safety copy of the current database so a mistaken restore is reversible.
if [ -f "$DATA_DIR/events.sqlite" ]; then
  cp "$DATA_DIR/events.sqlite" "$DATA_DIR/events.sqlite.pre-restore"
  echo "restore: kept previous database as data/events.sqlite.pre-restore"
fi

if [ -f "$SRC/database.sqlite" ]; then
  cp "$SRC/database.sqlite" "$DATA_DIR/events.sqlite"
  echo "restore: restored database.sqlite -> data/events.sqlite"
fi

if [ -d "$SRC/events" ]; then
  rm -rf "$DATA_DIR/events"
  cp -R "$SRC/events" "$DATA_DIR/events"
  echo "restore: restored event snapshots -> data/events/"
fi

# Face crops belong to the restored events. Replacing them together keeps the
# face rows in the restored database pointing at files that exist.
if [ -d "$SRC/face-crops" ]; then
  rm -rf "$DATA_DIR/face-crops"
  cp -R "$SRC/face-crops" "$DATA_DIR/face-crops"
  echo "restore: restored face crops -> data/face-crops/"
fi

if [ -f "$SRC/cameras.json" ]; then
  cp "$SRC/cameras.json" "$DATA_DIR/cameras.json"
  echo "restore: restored cameras.json"
fi

echo "restore: done. Start the hub to pick up the restored data."