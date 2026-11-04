# Alpine 3.24 ships musl 1.2.5, and the Node 24 binary segfaults on startup under
# it on newer kernels (reproduced on Ubuntu 26.04 / kernel 7.0: `node --version`
# dies with SIGSEGV, while `node:22-alpine`, `node:24-alpine3.21` and glibc
# images all run). Pinning to Alpine 3.21 keeps Node 24 and the small musl image.
FROM node:24-alpine3.21 AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci

FROM node:24-alpine3.21 AS builder
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

FROM node:24-alpine3.21 AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0
# Everything the hub may need to write at runtime is either a bind mount
# (./data -> /app/data) or a tmpfs declared in compose.yml (/tmp for FFmpeg clip
# and thumbnail scratch files, /app/.next/cache for the Next.js cache). The
# image filesystem itself is read-only at runtime (compose.yml `read_only`).
# ffmpeg converts the DVR's H.265 playback into the H.264 MP4 that Telegram
# needs for the optional event clip. It is not part of the live video path.
#
# The service user is uid/gid 10001 and is deliberately shared by all four
# images: one host `chown -R 10001:10001` (documented in
# docs/Container-Hardening.md) is then enough for the shared ./data tree.
# 10001 is above the usual system range and below the default rootless subuid
# block, so it can be chowned explicitly on the host. Rootless Podman needs the
# user-namespace chown documented there; production remains rootful.
RUN apk add --no-cache wget ffmpeg \
  && addgroup -g 10001 -S cctv \
  && adduser -u 10001 -S -D -H -G cctv -h /tmp -s /sbin/nologin cctv \
  && mkdir -p /app/data /app/.next/cache \
  && chown -R cctv:cctv /app/data /app/.next/cache
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
# Any accidental per-user cache write (Node/tooling) goes to the writable tmpfs
# instead of failing against the read-only root filesystem.
ENV HOME=/tmp
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=8s --start-period=25s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
# Numeric USER: no passwd lookup, and it matches `podman inspect ... Config.User`.
USER 10001:10001
CMD ["node", "server.js"]
