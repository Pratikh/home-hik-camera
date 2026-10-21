#!/bin/sh
# Home CCTV hub — create a timestamped, consistent application-data backup.
#
# What is backed up:
#   - data/events.sqlite  (events, notification rules, notification history,
#                           users, sessions, audit log) via SQLite's online
#                           backup API so the copy is consistent even while the
#                           hub is running.
#   - data/events/        (event snapshots, written by this hub only)
#   - data/face-crops/    (detected-face crops, when face detection is on)
#   - data/cameras.json   (camera display names)
#
# What is intentionally NOT backed up:
#   - Hikvision DVR recordings (they live on the DVR, not here)
#   - MediaMTX streams/recordings
#   - generated playback thumbnails (rebuildable cache)
#   - node_modules, .next build output, caches
#   - .env (contains secrets; back it up by your own secure means if desired)
#
# Safety properties:
#   * The backup is built in a hidden staging directory and only renamed into
#     place after the database passes PRAGMA quick_check. A failed run leaves no
#     half-written backup, and never overwrites an existing one.
#   * A lock directory prevents two runs (manual + timer) from sharing a name.
#   * The newest N successful backups are retained (default 7); older ones are
#     removed only when they contain a manifest.json, so an unrelated directory
#     in BACKUP_DIR is never touched.
#   * data/backup-status.json records the last attempt for the admin health page.
#     It contains no data and no credentials.
#
# Usage:
#   ./scripts/backup.sh                     # default: ./backups/<timestamp>/
#   BACKUP_DIR=/path/to/backups ./scripts/backup.sh
#   BACKUP_RETENTION=14 ./scripts/backup.sh
#
# Requires the sqlite3 CLI on the host (Debian/Ubuntu: apt install sqlite3).
# A plain file copy while the hub is running can miss WAL pages, so this script
# refuses to run without a real SQLite backup.

set -eu
# Backups contain private CCTV data and password hashes (never plaintext
# passwords). Keep the whole tree private to the account running the timer.
umask 077

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
BACKUP_ROOT="${BACKUP_DIR:-$ROOT/backups}"
RETAIN="${BACKUP_RETENTION:-7}"
STATUS_FILE="$DATA_DIR/backup-status.json"
STAGING=""
LOCK=""
STAMP=""
STARTED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
PREVIOUS_SUCCESS=""

case "$RETAIN" in
  ''|*[!0-9]*)
    echo "backup: BACKUP_RETENTION must be a non-negative integer" >&2
    exit 1
    ;;
esac
if [ "$RETAIN" -lt 1 ]; then
  echo "backup: BACKUP_RETENTION must be at least 1; refusing to delete the only copy" >&2
  exit 1
fi

SQLITE3_BIN="${SQLITE3:-}"
if [ -z "$SQLITE3_BIN" ]; then
  SQLITE3_BIN="$(command -v sqlite3 || true)"
fi
if [ -z "$SQLITE3_BIN" ]; then
  echo "backup: sqlite3 is required for a consistent backup." >&2
  echo "backup: install it (apt install sqlite3) or set SQLITE3=/path/to/sqlite3." >&2
  exit 1
fi

if [ ! -d "$DATA_DIR" ]; then
  echo "backup: data directory not found: $DATA_DIR" >&2
  exit 1
fi
if [ ! -f "$DATA_DIR/events.sqlite" ]; then
  echo "backup: database not found: $DATA_DIR/events.sqlite" >&2
  exit 1
fi

mkdir -p "$BACKUP_ROOT"

# Preserve the last known good timestamp across a failed attempt.
if [ -f "$STATUS_FILE" ]; then
  PREVIOUS_SUCCESS="$(sed -n 's/.*"last_success_at"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$STATUS_FILE" | head -n 1)"
fi

json_escape() {
  printf '%s' "$1" | tr '\n\r\t' '   ' | sed 's/\\/\\\\/g; s/"/\\"/g'
}

write_status() {
  status="$1"
  error="$2"
  finished="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  last_success="$3"
  tmp="$DATA_DIR/.backup-status.$$"
  printf '{"status":"%s","started_at":"%s","finished_at":"%s","last_success_at":"%s","error":%s}\n' \
    "$status" "$STARTED_AT" "$finished" "$last_success" \
    "$(if [ -n "$error" ]; then printf '"%s"' "$(json_escape "$error")"; else printf 'null'; fi)" \
    > "$tmp"
  chmod 600 "$tmp" 2>/dev/null || true
  mv "$tmp" "$STATUS_FILE"
}

on_exit() {
  code="$?"
  if [ -n "$STAGING" ] && [ -d "$STAGING" ]; then
    rm -rf "$STAGING"
  fi
  if [ -n "$LOCK" ] && [ -d "$LOCK" ]; then
    rm -f "$LOCK/pid" 2>/dev/null || true
    rmdir "$LOCK" 2>/dev/null || true
  fi
  if [ "$code" -ne 0 ]; then
    write_status "failed" "backup run failed (exit $code)" "${PREVIOUS_SUCCESS:-}" 2>/dev/null || true
  fi
  exit "$code"
}
trap on_exit EXIT INT TERM

LOCK="$BACKUP_ROOT/.backup.lock"
if ! mkdir "$LOCK" 2>/dev/null; then
  echo "backup: another backup is running ($LOCK). If that is stale, remove it." >&2
  exit 1
fi
printf '%s\n' "$$" > "$LOCK/pid" 2>/dev/null || true

STAMP="$(date +%Y-%m-%d_%H%M%S)"
FINAL="$BACKUP_ROOT/$STAMP"
if [ -e "$FINAL" ]; then
  echo "backup: refusing to overwrite existing backup: $FINAL" >&2
  exit 1
fi
STAGING="$BACKUP_ROOT/.incomplete-$STAMP-$$"
mkdir "$STAGING"

# 1. SQLite database, via the online backup API while the hub keeps running.
"$SQLITE3_BIN" "$DATA_DIR/events.sqlite" ".backup '$STAGING/database.sqlite'"
chmod 600 "$STAGING/database.sqlite" 2>/dev/null || true

# Quick corruption check before this directory is allowed to become a backup.
CHECK="$("$SQLITE3_BIN" "$STAGING/database.sqlite" "PRAGMA quick_check;")"
if [ "$CHECK" != "ok" ]; then
  echo "backup: database quick_check failed: $CHECK" >&2
  exit 1
fi

# 2. Event snapshots (this hub's own files only).
if [ -d "$DATA_DIR/events" ]; then
  cp -R "$DATA_DIR/events" "$STAGING/events"
fi

# 2b. Face crops. They belong to the events above, so restoring one without the
# other would leave face rows pointing at missing images.
if [ -d "$DATA_DIR/face-crops" ]; then
  cp -R "$DATA_DIR/face-crops" "$STAGING/face-crops"
fi

# 3. Camera display names.
if [ -f "$DATA_DIR/cameras.json" ]; then
  cp "$DATA_DIR/cameras.json" "$STAGING/cameras.json"
fi

DB_BYTES="$(wc -c < "$STAGING/database.sqlite" | tr -d ' ')"
SNAPSHOT_FILES="$(find "$STAGING/events" -type f 2>/dev/null | wc -l | tr -d ' ')"
CROP_FILES="$(find "$STAGING/face-crops" -type f 2>/dev/null | wc -l | tr -d ' ')"
FINISHED_AT="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

# 4. The manifest is written last and is what restore/verify use to identify a
# complete backup.
cat > "$STAGING/manifest.json" <<EOF
{
  "status": "complete",
  "created_at": "$FINISHED_AT",
  "database": "database.sqlite",
  "snapshots": "events/",
  "face_crops": "face-crops/",
  "cameras": "cameras.json",
  "database_bytes": $DB_BYTES,
  "snapshot_files": $SNAPSHOT_FILES,
  "face_crop_files": $CROP_FILES,
  "notes": "Application data only. No DVR recordings, no generated thumbnails, no secrets (.env is excluded)."
}
EOF
chmod 600 "$STAGING/manifest.json" 2>/dev/null || true

# 5. Atomic promotion. Same filesystem, so a reader never sees a partial backup.
mv "$STAGING" "$FINAL"
STAGING=""

write_status "success" "" "$FINISHED_AT" || echo "backup: warning: could not write $STATUS_FILE" >&2

# 6. Retention: keep the newest N complete backups. Only directories with a
# manifest are eligible, so an unrelated directory is never removed.
REMOVED=0
COUNT=0
if [ -n "$(command -v find || true)" ]; then
  while IFS= read -r dir; do
    [ -n "$dir" ] || continue
    [ -f "$dir/manifest.json" ] || continue
    COUNT=$((COUNT + 1))
    if [ "$COUNT" -gt "$RETAIN" ]; then
      if rm -rf "$dir"; then
        REMOVED=$((REMOVED + 1))
      else
        echo "backup: warning: could not remove old backup: $dir" >&2
      fi
    fi
  done <<EOF
$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '????-??-??_*' -print 2>/dev/null | sort -r)
EOF
fi

echo "backup: $FINAL"
echo "backup: database      $(du -h "$FINAL/database.sqlite" 2>/dev/null | cut -f1 || echo "$DB_BYTES bytes")"
echo "backup: snapshots     $SNAPSHOT_FILES files"
echo "backup: face crops    $CROP_FILES files"
echo "backup: retained      up to $RETAIN complete backup(s); removed $REMOVED old backup(s)"
echo "backup: status        $STATUS_FILE"
echo "backup: done"
