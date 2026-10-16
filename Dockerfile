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
# ffmpeg converts the DVR's H.265 playback into the H.264 MP4 that Telegram
# needs for the optional event clip. It is not part of the live video path.
RUN apk add --no-cache wget ffmpeg \
  && mkdir -p /app/data
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
EXPOSE 3000
HEALTHCHECK --interval=15s --timeout=8s --start-period=25s --retries=5 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/api/health || exit 1
CMD ["node", "server.js"]
