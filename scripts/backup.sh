#!/bin/sh
# Home CCTV hub — create a timestamped, consistent application-data backup.
#
# What is backed up:
#   - data/events.sqlite  (events, notification rules, notification history,
#                           users, sessions, audit log) via SQLite's online
#                           backup API so the copy is consistent even while the
#                           hub is running.
#   - data/events/        (event snapshots, written by this hub only)
#   - data/cameras.json   (camera display names)
#
# What is intentionally NOT backed up:
#   - Hikvision DVR recordings (they live on the DVR, not here)
#   - MediaMTX streams/recordings
#   - node_modules, .next build output, caches
#   - .env (contains secrets; back it up by your own secure means if desired)
#
# The backup never copies .env, so it cannot leak DVR credentials or the
# session secret.
#
# Usage:
#   ./scripts/backup.sh                     # default: ./backups/<timestamp>/
#   BACKUP_DIR=/path/to/backups ./scripts/backup.sh
#
# Podman: run from the project directory on the host. `data/` is bind-mounted,
# so the files below are the live application data.

set -eu

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
BACKUP_ROOT="${BACKUP_DIR:-$ROOT/backups}"

# Prefer the local sqlite3; in a minimal Podman host it may be absent, so the
# script also accepts SQLITE3 as an override. If neither exists, fall back to a
# plain file copy with a warning (still safe, but not consistency-guaranteed).
SQLITE3_BIN="${SQLITE3:-}"
if [ -z "$SQLITE3_BIN" ]; then
  SQLITE3_BIN="$(command -v sqlite3 || true)"
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "backup: data directory not found: $DATA_DIR" >&2
  exit 1
fi

STAMP="$(date +%Y-%m-%d_%H%M%S)"
DEST="$BACKUP_ROOT/$STAMP"
mkdir -p "$DEST"

# 1. SQLite database, via online backup when sqlite3 is available.
if [ -n "$SQLITE3_BIN" ] && [ -f "$DATA_DIR/events.sqlite" ]; then
  "$SQLITE3_BIN" "$DATA_DIR/events.sqlite" ".backup '$DEST/database.sqlite'"
else
  echo "backup: sqlite3 not found; copying database file as-is." >&2
  if [ -f "$DATA_DIR/events.sqlite" ]; then
    cp "$DATA_DIR/events.sqlite" "$DEST/database.sqlite"
  fi
fi

# 2. Event snapshots (this hub's own files only).
if [ -d "$DATA_DIR/events" ]; then
  cp -R "$DATA_DIR/events" "$DEST/events"
fi

# 3. Camera display names.
if [ -f "$DATA_DIR/cameras.json" ]; then
  cp "$DATA_DIR/cameras.json" "$DEST/cameras.json"
fi

# 4. A manifest describing what this backup is and when it was taken.
cat > "$DEST/manifest.json" <<EOF
{
  "created_at": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "database": "database.sqlite",
  "snapshots": "events/",
  "cameras": "cameras.json",
  "notes": "Application data only. No DVR recordings, no secrets (.env is excluded)."
}
EOF

echo "backup: $DEST"
echo "backup: database      $(du -h "$DEST/database.sqlite" 2>/dev/null | cut -f1 || echo 'n/a')"
echo "backup: snapshots     $(find "$DEST/events" -type f 2>/dev/null | wc -l | tr -d ' ') files"
echo "backup: done"