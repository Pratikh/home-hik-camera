# Fully qualified on purpose: a fresh host has no unqualified-search-registries
# in /etc/containers/registries.conf, so a bare "bluenviron/..." fails to resolve.
FROM docker.io/bluenviron/mediamtx:1.21.1 AS mediamtx
# Alpine 3.21, for the same musl/Node-24 segfault described in ../Dockerfile.
FROM node:24-alpine3.21

RUN apk add --no-cache ca-certificates wget
COPY --from=mediamtx /mediamtx /usr/local/bin/mediamtx
COPY scripts/render-mediamtx-config.mjs /opt/cctv/render-mediamtx-config.mjs
COPY mediamtx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8888 8889 8189/tcp 8189/udp 9997
ENTRYPOINT ["/entrypoint.sh"]
