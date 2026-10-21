#!/bin/sh
# Home CCTV hub — restore application data from a backup made by backup.sh.
#
# The restore replaces the *live* data directory contents, so it must be run
# while the hub is stopped to avoid a torn database. It never touches DVR
# recordings or MediaMTX (those are not part of the backup).
#
# Safety:
#   * the source must contain manifest.json and pass verify-backup.sh first;
#   * the script refuses to run if the hub web port appears to be listening;
#   * every replacement is staged and checked before the live path is swapped;
#   * the previous database, snapshots and face crops are moved aside with a
#     timestamp, never deleted, so a mistaken restore is reversible;
#   * `.env` is not restored because it is never part of a backup.
#
# Usage:
#   ./scripts/restore.sh ./backups/2026-10-09_103000
#
# Steps for Podman:
#   1. systemctl stop home-cctv        # or: podman compose down
#   2. ./scripts/restore.sh <backup>
#   3. systemctl start home-cctv       # or: podman compose up -d
#
# Set DRY_RUN=1 to preview. Set SKIP_VERIFY=1 only if sqlite3 is unavailable and
# you accept that the source has not been rehearsed.

set -eu
umask 077

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
    echo "restore:   systemctl stop home-cctv   (or podman compose down)" >&2
    exit 1
  fi
fi

# Rehearse the backup before touching live data.
if [ "${SKIP_VERIFY:-0}" != "1" ]; then
  if ! sh "$ROOT/scripts/verify-backup.sh" "$SRC"; then
    echo "restore: backup verification failed; live data was not changed." >&2
    exit 1
  fi
else
  echo "restore: WARNING: SKIP_VERIFY=1 — the backup was not rehearsed." >&2
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
STAMP="$(date +%Y-%m-%d_%H%M%S)"

# Stage everything first. Nothing live is touched until every copy exists.
STAGE_DB="$DATA_DIR/.events.sqlite.restore-$STAMP"
if [ -f "$SRC/database.sqlite" ]; then
  cp "$SRC/database.sqlite" "$STAGE_DB"
  chmod 600 "$STAGE_DB" 2>/dev/null || true
  if command -v sqlite3 >/dev/null 2>&1; then
    CHECK="$(sqlite3 "$STAGE_DB" "PRAGMA quick_check;")"
    if [ "$CHECK" != "ok" ]; then
      echo "restore: staged database failed quick_check; live data was not changed." >&2
      rm -f "$STAGE_DB"
      exit 1
    fi
  fi
fi

STAGE_EVENTS=""
if [ -d "$SRC/events" ]; then
  STAGE_EVENTS="$DATA_DIR/.events.restore-$STAMP"
  cp -R "$SRC/events" "$STAGE_EVENTS"
fi

STAGE_CROPS=""
if [ -d "$SRC/face-crops" ]; then
  STAGE_CROPS="$DATA_DIR/.face-crops.restore-$STAMP"
  cp -R "$SRC/face-crops" "$STAGE_CROPS"
fi

STAGE_CAMERAS=""
if [ -f "$SRC/cameras.json" ]; then
  STAGE_CAMERAS="$DATA_DIR/.cameras.json.restore-$STAMP"
  cp "$SRC/cameras.json" "$STAGE_CAMERAS"
fi

# Swap the database. Move the WAL/SHM companions with it: leaving an old WAL
# next to a restored database could replay writes that belong to the old data.
if [ -f "$STAGE_DB" ]; then
  if [ -f "$DATA_DIR/events.sqlite" ]; then
    mv "$DATA_DIR/events.sqlite" "$DATA_DIR/events.sqlite.pre-restore-$STAMP"
    if [ -f "$DATA_DIR/events.sqlite-wal" ]; then
      mv "$DATA_DIR/events.sqlite-wal" "$DATA_DIR/events.sqlite.pre-restore-$STAMP-wal"
    fi
    if [ -f "$DATA_DIR/events.sqlite-shm" ]; then
      mv "$DATA_DIR/events.sqlite-shm" "$DATA_DIR/events.sqlite.pre-restore-$STAMP-shm"
    fi
    echo "restore: kept previous database as data/events.sqlite.pre-restore-$STAMP"
  fi
  mv "$STAGE_DB" "$DATA_DIR/events.sqlite"
  echo "restore: restored database.sqlite -> data/events.sqlite"
fi

if [ -n "$STAGE_EVENTS" ]; then
  if [ -d "$DATA_DIR/events" ]; then
    mv "$DATA_DIR/events" "$DATA_DIR/events.pre-restore-$STAMP"
    echo "restore: kept previous snapshots as data/events.pre-restore-$STAMP"
  fi
  mv "$STAGE_EVENTS" "$DATA_DIR/events"
  echo "restore: restored event snapshots -> data/events/"
fi

if [ -n "$STAGE_CROPS" ]; then
  if [ -d "$DATA_DIR/face-crops" ]; then
    mv "$DATA_DIR/face-crops" "$DATA_DIR/face-crops.pre-restore-$STAMP"
    echo "restore: kept previous face crops as data/face-crops.pre-restore-$STAMP"
  fi
  mv "$STAGE_CROPS" "$DATA_DIR/face-crops"
  echo "restore: restored face crops -> data/face-crops/"
fi

if [ -n "$STAGE_CAMERAS" ]; then
  if [ -f "$DATA_DIR/cameras.json" ]; then
    mv "$DATA_DIR/cameras.json" "$DATA_DIR/cameras.json.pre-restore-$STAMP"
  fi
  mv "$STAGE_CAMERAS" "$DATA_DIR/cameras.json"
  echo "restore: restored cameras.json"
fi

# The backup does not contain .env. Remind the operator rather than guessing.
if [ ! -f "$ROOT/.env" ]; then
  echo "restore: warning: $ROOT/.env is missing. Restore it separately (chmod 600)." >&2
fi

echo "restore: done. Start the hub to pick up the restored data."
