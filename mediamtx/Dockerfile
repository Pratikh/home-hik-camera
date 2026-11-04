# Fully qualified on purpose: a fresh host has no unqualified-search-registries
# in /etc/containers/registries.conf, so a bare "bluenviron/..." fails to resolve.
FROM docker.io/bluenviron/mediamtx:1.21.1 AS mediamtx
# Alpine 3.21, for the same musl/Node-24 segfault described in ../Dockerfile.
FROM node:24-alpine3.21

RUN apk add --no-cache ca-certificates wget
COPY --from=mediamtx /mediamtx /usr/local/bin/mediamtx
COPY scripts/render-mediamtx-config.mjs /opt/cctv/render-mediamtx-config.mjs
COPY mediamtx/entrypoint.sh /entrypoint.sh
# uid/gid 10001 (name `cctv`) is shared by every image. MediaMTX only needs to
# bind high ports (8554/8888/8889/8189/9997), read its rendered config and keep
# its state in memory; it never needs root. compose.yml makes the image
# filesystem read-only and mounts /tmp as a tmpfs, because entrypoint.sh renders
# the config there.
RUN chmod +x /entrypoint.sh \
  && addgroup -g 10001 -S cctv \
  && adduser -u 10001 -S -D -H -G cctv -h /tmp -s /sbin/nologin cctv
# Any accidental per-user cache write (Node tooling) goes to the writable tmpfs.
ENV HOME=/tmp

EXPOSE 8888 8889 8189/tcp 8189/udp 9997
USER 10001:10001
ENTRYPOINT ["/entrypoint.sh"]
