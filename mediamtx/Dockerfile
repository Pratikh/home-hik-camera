FROM bluenviron/mediamtx:1.21.1 AS mediamtx
FROM node:24-alpine

RUN apk add --no-cache ca-certificates wget
COPY --from=mediamtx /mediamtx /usr/local/bin/mediamtx
COPY scripts/render-mediamtx-config.mjs /opt/cctv/render-mediamtx-config.mjs
COPY mediamtx/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8888 8889 8189/tcp 8189/udp 9997
ENTRYPOINT ["/entrypoint.sh"]
