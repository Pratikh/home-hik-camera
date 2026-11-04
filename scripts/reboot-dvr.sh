#!/usr/bin/env bash
# Reboot the Hikvision DVR through its ISAPI endpoint.
#
# Usage:
#   scripts/reboot-dvr.sh                 # request a full reboot now
#   scripts/reboot-dvr.sh --verify        # request it, then wait for the DVR
#   scripts/reboot-dvr.sh --check         # read-only: auth + status, no reboot
#   scripts/reboot-dvr.sh --dry-run       # show what would happen, no reboot
#
# The DVR credentials and address come from the existing protected .env
# (HIKVISION_IP, HIKVISION_USERNAME, HIKVISION_PASSWORD). Credentials are passed
# to curl through a private temporary config file, never on its command line,
# and never printed. The DVR stays on the home LAN; nothing is exposed.
set -euo pipefail
umask 077

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENV_FILE="${DVR_ENV_FILE:-${SCRIPT_DIR}/../.env}"
MODE="reboot"
VERIFY=0

for arg in "$@"; do
  case "$arg" in
    --check) MODE="check" ;;
    --dry-run) MODE="dry-run" ;;
    --verify) VERIFY=1 ;;
    --help|-h)
      sed -n '2,16p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "unknown option: $arg (use --check, --dry-run, --verify or --help)" >&2
      exit 64
      ;;
  esac
done

log() {
  local line="$1"
  echo "$line"
  if command -v logger >/dev/null 2>&1; then
    logger -t home-cctv-reboot-dvr -- "$line" 2>/dev/null || true
  fi
}

fail() {
  log "ERROR $1"
  exit "${2:-1}"
}

if [ ! -r "$ENV_FILE" ]; then
  fail "cannot read $ENV_FILE (run as root or set DVR_ENV_FILE)" 66
fi
# .env is shell-compatible KEY=value with no production secrets in process args.
set -a
# shellcheck disable=SC1090
. "$ENV_FILE"
set +a
: "${HIKVISION_IP:?HIKVISION_IP is missing from .env}"
: "${HIKVISION_USERNAME:?HIKVISION_USERNAME is missing from .env}"
: "${HIKVISION_PASSWORD:?HIKVISION_PASSWORD is missing from .env}"

BASE="http://${HIKVISION_IP}"
CURL_CONFIG="$(mktemp "${TMPDIR:-/tmp}/home-cctv-dvr.XXXXXX")"
trap 'rm -f "$CURL_CONFIG"' EXIT
{
  printf 'user = "%s:%s"\n' "$HIKVISION_USERNAME" "$HIKVISION_PASSWORD"
  printf 'digest\n'
  printf 'silent\n'
  printf 'show-error\n'
  printf 'connect-timeout = 8\n'
  printf 'max-time = 25\n'
} > "$CURL_CONFIG"

read_status() {
  # Prints currentDeviceTime and deviceUpTime on one line (safe fields only).
  curl --config "$CURL_CONFIG" --fail "$BASE/ISAPI/System/status" 2>/dev/null \
    | tr -d '\n' \
    | sed -nE 's/.*<currentDeviceTime>([^<]*)<\/currentDeviceTime>.*<deviceUpTime>([^<]*)<\/deviceUpTime>.*/\1 uptime=\2s/p'
}

case "$MODE" in
  check)
    line="$(read_status)" || true
    if [ -z "${line:-}" ]; then
      fail "DVR status read failed (check HIKVISION_IP/credentials and LAN) "
    fi
    log "DVR reachable: $line"
    exit 0
    ;;
  dry-run)
    log "DRY-RUN would PUT $BASE/ISAPI/System/reboot with <Reboot><mode>full</mode></Reboot>"
    exit 0
    ;;
esac

log "requesting DVR reboot at $(date -u +%Y-%m-%dT%H:%M:%SZ)"
http_code="$(
  curl --config "$CURL_CONFIG" -X PUT \
    -H 'Content-Type: application/xml' \
    --data '<Reboot><mode>full</mode></Reboot>' \
    -o /dev/null -w '%{http_code}' \
    "$BASE/ISAPI/System/reboot" || true
)"
case "$http_code" in
  200|204|000)
    # 000 here normally means the DVR closed the connection while rebooting.
    log "reboot request accepted (http=$http_code)"
    ;;
  *)
    fail "reboot request rejected (http=$http_code)" 2
    ;;
esac

if [ "$VERIFY" -ne 1 ]; then
  exit 0
fi

log "waiting for the DVR to come back (up to 4 minutes)"
for _ in $(seq 1 48); do
  sleep 5
  line="$(read_status)" || true
  if [ -n "${line:-}" ]; then
    uptime="${line##*uptime=}"
    uptime="${uptime%s}"
    if [ "${uptime:-999999}" -le 600 ] 2>/dev/null; then
      log "DVR is back: $line"
      exit 0
    fi
    log "DVR answered but uptime is still ${uptime}s; continuing to wait"
  fi
done
fail "DVR did not come back within 4 minutes; check the device" 3
