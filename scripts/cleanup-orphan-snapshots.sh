#!/bin/sh
# Home CCTV hub — remove generated event snapshots that no database row
# references.
#
# Safety:
#   * only files under DATA_DIR/events are considered;
#   * only names this hub generates are eligible:
#         <yyyy>/<mm>/<dd>/<camera>-evt_<24 hex>.jpg
#   * symbolic links are never followed or deleted;
#   * if the database cannot be read, the script exits non-zero and deletes
#     nothing rather than guessing;
#   * --dry-run reports what would be deleted without changing anything.
#
# The same sweep also runs inside the hub's hourly retention pass, so this is an
# operator tool for a one-off check or after a manual recovery.
#
# Usage:
#   ./scripts/cleanup-orphan-snapshots.sh --dry-run
#   ./scripts/cleanup-orphan-snapshots.sh
#
# Requires the sqlite3 CLI. Exit status is non-zero on an inspection failure.

set -eu
umask 077

ROOT="$(CDPATH= cd -- "$(dirname -- "$0")/.." && pwd)"
DATA_DIR="${DATA_DIR:-$ROOT/data}"
EVENTS_DIR="$DATA_DIR/events"
DB="$DATA_DIR/events.sqlite"
DRY_RUN=0

case "${1:-}" in
  --dry-run) DRY_RUN=1 ;;
  "") ;;
  -h|--help)
    echo "usage: $0 [--dry-run]"
    exit 0
    ;;
  *)
    echo "cleanup-orphan-snapshots: unknown option: $1" >&2
    echo "usage: $0 [--dry-run]" >&2
    exit 2
    ;;
esac

SQLITE3_BIN="${SQLITE3:-}"
if [ -z "$SQLITE3_BIN" ]; then
  SQLITE3_BIN="$(command -v sqlite3 || true)"
fi
if [ -z "$SQLITE3_BIN" ]; then
  echo "cleanup-orphan-snapshots: sqlite3 is required; nothing was deleted" >&2
  exit 1
fi
if [ ! -f "$DB" ]; then
  echo "cleanup-orphan-snapshots: database not found: $DB; nothing was deleted" >&2
  exit 1
fi
if [ -L "$EVENTS_DIR" ]; then
  echo "cleanup-orphan-snapshots: $EVENTS_DIR is a symbolic link; refusing to follow it. Nothing was deleted." >&2
  exit 1
fi
if [ ! -d "$EVENTS_DIR" ]; then
  echo "cleanup-orphan-snapshots: no events directory at $EVENTS_DIR"
  echo "cleanup-orphan-snapshots: inspected 0 files, deleted 0"
  exit 0
fi

TMP="$(mktemp -d "${TMPDIR:-/tmp}/home-cctv-orphans.XXXXXX")"
cleanup() {
  rm -rf "$TMP"
}
trap cleanup EXIT INT TERM

KNOWN="$TMP/known.txt"
"$SQLITE3_BIN" "$DB" "SELECT snapshot_path FROM events WHERE snapshot_path IS NOT NULL AND snapshot_path <> '';" > "$KNOWN"

INSPECTED=0
KEPT=0
DELETED=0
FAILED=0

# `find` does not follow symlinks unless -L is given; -type f also excludes them.
find "$EVENTS_DIR" -type f -name '*.jpg' -print > "$TMP/files.txt"
while IFS= read -r file; do
  [ -n "$file" ] || continue
  rel="${file#"$EVENTS_DIR"/}"

  # Generated name only: date/camera/event id, nothing else.
  parent="${rel%/*}"
  base="${rel##*/}"
  case "$parent" in
    [0-9][0-9][0-9][0-9]/[0-9][0-9]/[0-9][0-9]) ;;
    *) continue ;;
  esac
  case "$base" in
    [1-4]-evt_*.jpg) ;;
    *) continue ;;
  esac
  printf '%s\n' "$base" | grep -Eq '^[1-4]-evt_[a-f0-9]{24}\.jpg$' || continue

  INSPECTED=$((INSPECTED + 1))
  if grep -Fqx "$rel" "$KNOWN"; then
    KEPT=$((KEPT + 1))
    continue
  fi

  if [ "$DRY_RUN" -eq 1 ]; then
    echo "would delete: $rel"
    DELETED=$((DELETED + 1))
    continue
  fi
  if rm -f -- "$file"; then
    echo "deleted: $rel"
    DELETED=$((DELETED + 1))
  else
    echo "cleanup-orphan-snapshots: could not delete $rel" >&2
    FAILED=$((FAILED + 1))
  fi
done < "$TMP/files.txt"

if [ "$DRY_RUN" -eq 1 ]; then
  echo "cleanup-orphan-snapshots: DRY RUN — inspected $INSPECTED generated snapshot(s), kept $KEPT referenced, would delete $DELETED"
else
  echo "cleanup-orphan-snapshots: inspected $INSPECTED generated snapshot(s), kept $KEPT referenced, deleted $DELETED, failed $FAILED"
fi

[ "$FAILED" -eq 0 ] || exit 1
exit 0
