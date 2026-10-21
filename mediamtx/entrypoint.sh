#!/bin/sh
set -eu
# The rendered config contains the DVR RTSP URL and the MediaMTX read
# credential. Keep it readable only by this container user.
umask 077
export MEDIAMTX_CONFIG_STDOUT=1
node /opt/cctv/render-mediamtx-config.mjs > /tmp/mediamtx.yml
exec /usr/local/bin/mediamtx /tmp/mediamtx.yml
