#!/bin/sh
# Home CCTV hub — verify a backup without touching live data.
#
# This is a rehearsal, not a restore:
#   * the backup database is copied into a temporary directory and opened there;
#   * the live data/events.sqlite is never opened, moved or replaced;
#   * SQLite integrity and foreign-key checks run against the copy;
#   * the expected tables must exist;
#   * every stored snapshot path must resolve to a file inside the backup, so a
#     restore cannot leave broken references.
#
# Usage:
#   ./scripts/verify-backup.sh ./backups/2026-10-09_103000
#
# Exit status is 0 only when every check passes. Requires the sqlite3 CLI.

set -eu
umask 077

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
SRC="${1:-}"

if [ -z "$SRC" ]; then
  echo "verify-backup: usage: $0 <backup-directory>" >&2
  exit 2
fi
if [ ! -d "$SRC" ]; then
  echo "verify-backup: not a directory: $SRC" >&2
  exit 1
fi
SRC="$(cd "$SRC" && pwd)"

if [ ! -f "$SRC/manifest.json" ]; then
  echo "verify-backup: $SRC is not a backup (missing manifest.json)" >&2
  exit 1
fi
if [ ! -f "$SRC/database.sqlite" ]; then
  echo "verify-backup: $SRC has no database.sqlite" >&2
  exit 1
fi

SQLITE3_BIN="${SQLITE3:-}"
if [ -z "$SQLITE3_BIN" ]; then
  SQLITE3_BIN="$(command -v sqlite3 || true)"
fi
if [ -z "$SQLITE3_BIN" ]; then
  echo "verify-backup: sqlite3 is required; install it or set SQLITE3=/path/to/sqlite3" >&2
  exit 1
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/home-cctv-verify.XXXXXX")"
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

DB="$TMP/database.sqlite"
cp "$SRC/database.sqlite" "$DB"
chmod 600 "$DB" 2>/dev/null || true

fail() {
  echo "verify-backup: FAIL: $1" >&2
  exit 1
}

query() {
  "$SQLITE3_BIN" "$DB" "$1"
}

echo "verify-backup: source $SRC"
echo "verify-backup: manifest status $(sed -n 's/.*"status"[[:space:]]*:[[:space:]]*"\([^"]*\)".*/\1/p' "$SRC/manifest.json" | head -n 1)"

# 1. Structural integrity.
INTEGRITY="$(query "PRAGMA integrity_check;")"
[ "$INTEGRITY" = "ok" ] || {
  echo "$INTEGRITY" >&2
  fail "SQLite integrity_check did not return ok"
}
echo "verify-backup: integrity_check ok"

FOREIGN="$(query "PRAGMA foreign_key_check;")"
[ -z "$FOREIGN" ] || {
  echo "$FOREIGN" >&2
  fail "SQLite foreign_key_check reported violations"
}
echo "verify-backup: foreign_key_check ok"

# 2. Expected tables. Old backups may or may not contain the (now inactive)
# face-detection tables; they are not required for a valid backup and are not
# checked.
table_exists() {
  [ "$(query "SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='$1';")" = "1" ]
}
for table in events users auth_sessions notification_rules notification_history app_settings audit_logs telegram_media_jobs; do
  table_exists "$table" || fail "missing table: $table"
done
echo "verify-backup: expected tables present"

# 3. Representative data and file references.
USERS="$(query "SELECT COUNT(*) FROM users;")"
[ "$USERS" -ge 1 ] || fail "no users in the backup; the restored hub would have no accounts"
EVENTS="$(query "SELECT COUNT(*) FROM events;")"
NOTIFICATIONS="$(query "SELECT COUNT(*) FROM notification_history;")"
echo "verify-backup: users=$USERS events=$EVENTS notification_history=$NOTIFICATIONS"

SNAPSHOTS_CHECKED=0
SNAPSHOTS_MISSING=0
if [ "$EVENTS" -gt 0 ]; then
  SNAPSHOT_LIST="$TMP/snapshots.txt"
  query "SELECT snapshot_path FROM events WHERE snapshot_path IS NOT NULL AND snapshot_path <> '';" > "$SNAPSHOT_LIST"
  while IFS= read -r rel; do
    [ -n "$rel" ] || continue
    case "$rel" in
      /*|*..*)
        fail "unsafe snapshot path in database: $rel"
        ;;
    esac
    SNAPSHOTS_CHECKED=$((SNAPSHOTS_CHECKED + 1))
    if [ ! -f "$SRC/events/$rel" ]; then
      SNAPSHOTS_MISSING=$((SNAPSHOTS_MISSING + 1))
      echo "verify-backup: missing snapshot file: events/$rel" >&2
    fi
  done < "$SNAPSHOT_LIST"
fi
[ "$SNAPSHOTS_MISSING" -eq 0 ] || fail "$SNAPSHOTS_MISSING snapshot file(s) referenced but missing"
echo "verify-backup: snapshot references checked: $SNAPSHOTS_CHECKED"

echo "verify-backup: PASS ($SRC is structurally sound; live data was not touched)"
exit 0
