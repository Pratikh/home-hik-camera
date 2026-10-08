#!/bin/sh
set -eu
export MEDIAMTX_CONFIG_STDOUT=1
node /opt/cctv/render-mediamtx-config.mjs > /tmp/mediamtx.yml
exec /usr/local/bin/mediamtx /tmp/mediamtx.yml
