# Container Hardening (Phase 2)

This document covers the Phase 2 container-hardening change for the Home CCTV
Hub: non-root containers, a read-only image filesystem, Linux capability and
resource limits, and per-service environments that stop broadcasting the whole
`.env`. It is the operator-facing migration guide — read it before rebuilding
the stack on an existing host.

**Status:** applied to `compose.yml` and the four Dockerfiles on
`security/immediate-hardening`. The production deployment model is unchanged:
**rootful Podman + the systemd units in `deploy/systemd`**. Rootless Podman is
documented at the end of this file but **is not enabled by default**, and network
segmentation is deliberately **not** part of this phase (Phase 3 owns it).

## 1. What changed

| Service | Image | User | Runtime filesystem |
| --- | --- | --- | --- |
| `web` (Next.js standalone) | `Dockerfile` | `cctv` — uid/gid **10001** | read-only; tmpfs `/tmp` (FFmpeg/thumbnail scratch) and `/app/.next/cache`; `./data` bind-mounted read-write |
| `mediamtx` | `mediamtx/Dockerfile` | `cctv` — uid/gid **10001** | read-only; tmpfs `/tmp` (rendered config) |
| `object-worker` | `object-worker/Dockerfile` | `cctv` — uid/gid **10001** | read-only; tmpfs `/tmp`; `./data` read-write; `./object-worker/models` **read-only** |
| `face-worker` | `face-worker/Dockerfile` | `cctv` — uid/gid **10001** | read-only; tmpfs `/tmp`; `./data` read-write; `./face-worker/models` read-only |

Every service also gets:

- `cap_drop: [ALL]` and `security_opt: ["no-new-privileges:true"]`;
- `mem_limit` (web `768m`, MediaMTX `384m`, workers `1g` each) and
  `pids_limit: 256`;
- a `stop_grace_period` (30 s web/workers, 15 s MediaMTX) so in-flight requests
  and SQLite writes can finish;
- the existing `restart` policies, healthchecks and JSON log rotation.

The limits fit the documented 4 GB production host with headroom for the OS and
Podman: `768m + 384m + 1g = 2.2 GB` for the default stack, plus the optional
face worker profile. tmpfs pages count against the container's memory limit, so
the tmpfs sizes are upper bounds for scratch data, not additional reservations.

### Per-service environments

Only the **web** container keeps `env_file: .env`. It is the one process that
genuinely needs the application secret set (session signing, login, DVR access,
Telegram, detection settings, shared SQLite). The other services get explicit
`environment:` entries, filled by Compose interpolation from `.env`
(`${VAR:-}`) at container-create time.

| Service | Variables passed | Not passed (on purpose) |
| --- | --- | --- |
| `mediamtx` | `DVR_HOST`, `HIKVISION_IP`, `DVR_RTSP_PORT`, `DVR_USERNAME`, `HIKVISION_USERNAME`, `DVR_PASSWORD`, `HIKVISION_PASSWORD`, `MEDIAMTX_AUTH_USER`, `MEDIAMTX_AUTH_PASSWORD`, `MEDIAMTX_ALLOW_ANONYMOUS` (development escape hatch), `WEBRTC_ADDITIONAL_HOST` | `SESSION_SECRET`, `TELEGRAM_*`, `APP_*`, `DVR_HTTP_PORT`, detection/thumbnail settings |
| `object-worker` | `DATA_DIR`, `OBJECT_DETECTION_MODEL_PATH`, `MEDIAMTX_RTSP_URL`, `OBJECT_DETECTION_STREAM`, `MEDIAMTX_AUTH_USER`, `MEDIAMTX_AUTH_PASSWORD`, `OBJECT_DETECTION_SETTINGS_POLL_MS`, `OBJECT_DETECTION_HEARTBEAT_MS`, `OBJECT_DETECTION_FRAME_STALE_MS`, `OBJECT_DETECTION_RECONNECT_BACKOFF_MS`, `OBJECT_DETECTION_MAX_TRACKS_PER_CAMERA` | `SESSION_SECRET`, `TELEGRAM_*`, `APP_*`, `DVR_*`/`HIKVISION_*` (the worker reads MediaMTX, never the DVR), face/thumbnail settings |
| `face-worker` | `DATA_DIR`, `FACE_DETECTION_MODEL_PATH`, `FACE_DETECTION_ENABLED`, `FACE_DETECTION_CONFIDENCE`, `FACE_DETECTION_MAX_FACES`, `FACE_DETECTION_POLL_INTERVAL_MS`, `FACE_DETECTION_BACKFILL_DAYS`, `FACE_DETECTION_MAX_ATTEMPTS`, `FACE_DETECTION_STALE_AFTER_S`, `FACE_DETECTION_BATCH_SIZE`, `FACE_DETECTION_MAX_WIDTH`, `FACE_DETECTION_JPEG_QUALITY` | `SESSION_SECRET`, `TELEGRAM_*`, `APP_*`, `DVR_*`/`HIKVISION_*`, MediaMTX credentials |

An empty variable (`${VAR:-}` with `VAR` unset) means "use the default in the
code", exactly as before. Compose still reads the project `.env` for the
interpolation itself; it is not mounted into any container and is still
`root:root` `0600`. Remember the existing rule from the README: a `$` inside a
`.env` value must be written as `$$` so Compose does not treat it as
interpolation.

### Object-worker model: provisioned on the host, mounted read-only

Before this phase the object-worker entrypoint downloaded the 3.66 MB
YOLOX-Nano model into `./object-worker/models` on first start. That required a
read-write bind mount, network access at start-up and an entrypoint running with
write permission. It is now a deliberate host step:

```bash
# On the host, once (the container never downloads):
npm run object:model                         # dev machine with Node.js
# or, on the production host (python3 is enough):
python3 object-worker/scripts/download_model.py
```

Both paths verify the model's pinned SHA-256. The file is mounted **read-only**
into `/app/models`. If it is missing, `docker-entrypoint.sh` exits non-zero with
an actionable message naming the command above, instead of starting a worker
that can only report "model unavailable". If the file exists but fails the
checksum, the entrypoint says so and tells the operator to re-download with
`--force` on the host.

**Fresh-install order therefore is:** provision the model on the host first, then
`podman compose up -d`. The web container is not blocked on the worker
(`depends_on: service_started`), so the hub and live view keep working if the
worker is down, but the worker will restart-loop (with the actionable log) until
the model exists.

### Fresh install: own the directories before the first start

On a brand-new host `./data` does not exist yet, and Compose would create the
bind-mount source as **root**; the non-root hub then cannot write it. Create and
own the trees first, then start the stack:

```bash
cd /opt/home-cctv
mkdir -p data backups object-worker/models face-worker/models

# Provision the object-detection model (see §1), then hand everything to 10001.
sudo python3 object-worker/scripts/download_model.py
sudo chown -R 10001:10001 data backups object-worker/models face-worker/models
sudo chmod 700 data backups

# .env stays root-only and is never mounted into a container.
sudo chown root:root .env && sudo chmod 600 .env

sudo podman compose up -d --build
```

`face-worker/models` is listed for completeness; it is only required when the
`faces` profile is used (download its model with
`python3 face-worker/scripts/download_model.py`).

## 2. Migrating an existing rootful host

These steps assume the documented production layout: `/opt/home-cctv`, rootful
Podman, `sudo podman compose` available, systemd units installed. The container
user uid/gid **10001** maps directly to host uid/gid 10001 under rootful Podman,
but the existing `./data` tree was written by containers running as **root** and
is therefore root-owned. Without the ownership fix below the containers start
but cannot write SQLite, snapshots, face crops, thumbnails or backups.

### 2.1 Prepare (backup first)

```bash
cd /opt/home-cctv

# 1. Back up while the old stack is still running and still owns the data.
sudo ./scripts/backup.sh
sudo ./scripts/verify-backup.sh ./backups/<newest-timestamp>

# 2. Make sure the object-detection model is on the host (see §1). If it is not:
sudo python3 object-worker/scripts/download_model.py
```

Do this in a quiet period: `podman compose up -d --force-recreate` replaces
containers, so **there is brief downtime** (seconds — in-flight web requests
fail, containers are recreated). DVR recordings are unaffected; only the hub's
own availability. No database migration is needed — the files and schema are
unchanged.

### 2.2 Fix host ownership (required)

```bash
cd /opt/home-cctv

# The three trees the containers must read/write under the new uid.
sudo chown -R 10001:10001 data backups object-worker/models

# Private: only the container user (and root) reads the CCTV data. This also
# addresses the world-readable database finding from the audit.
sudo chmod 700 data backups

# Model tree: the container user owns it; the file stays readable by that user.
sudo chmod 755 object-worker/models
sudo chmod 644 object-worker/models/yolox_nano.onnx

# Optional: only when the face-worker profile is used.
sudo chown -R 10001:10001 face-worker/models
sudo chmod 755 face-worker/models
sudo chmod 644 face-worker/models/face_detection_yunet_2023mar.onnx

# Never chown .env: it is not mounted into any container. Keep it root-only.
sudo chown root:root .env
sudo chmod 600 .env
```

Why `backups` too: a restore copies files back into `data/`, and keeping one
owner for the data tree avoids mixes of root-owned and 10001-owned files that
would break later container writes. The nightly backup unit runs as root by
default, so it can still read `data/` (`700`) and write `backups/`;
`verify-backup.sh` and `restore.sh` now need `sudo` because the trees are no
longer world-readable.

Why the model tree: the mount is `:ro`, but the container user must still be
able to **read** the file. If it is root-owned `0600`, the worker fails with a
permission error even though the mount itself is read-only.

### 2.3 Operator scripts must write as the same uid

Two root-owned writes would otherwise break the non-root containers:

- `scripts/backup.sh` writes `data/backup-status.json` with `umask 077`. Run from
  the root systemd unit, that file becomes `root:root 0600` and the web process
  (uid 10001) can no longer read it, so `/settings/system` loses the backup
  status. Run the backup unit as the service user instead (recommended):

  ```bash
  sudo systemctl edit home-cctv-backup.service
  # In the drop-in:
  #   [Service]
  #   User=10001
  #   Group=10001
  sudo systemctl daemon-reload
  sudo systemctl start home-cctv-backup.service   # test one run
  ```

  If you prefer to keep the unit as root, fix ownership after every run:
  `sudo chown 10001:10001 data/backup-status.json`.

- `scripts/restore.sh` runs with `umask 077` and creates/moves files into
  `data/`. Run it as uid 10001 (`sudo -u '#10001' ./scripts/restore.sh ...`,
  from a shell where `/opt/home-cctv` is traversable) or run it as root and then
  `sudo chown -R 10001:10001 data` before the containers start again. Either
  way, restore the stack only after the ownership is correct.

Optional extra hardening (matches the audit's world-readable-files finding):
`sudo chmod 600 data/events.sqlite data/events.sqlite-wal data/events.sqlite-shm
2>/dev/null || true`. The `700` data directory already prevents other local
accounts from traversing the tree.

### 2.4 Rebuild and recreate

The images changed (new user, ownership, entrypoint), so rebuild before
recreating — `podman compose up -d` alone keeps the old images.

```bash
cd /opt/home-cctv

sudo podman compose build web mediamtx object-worker
sudo podman compose --profile faces build face-worker    # optional profile

sudo podman compose up -d --remove-orphans
# or, when using the systemd units:
sudo systemctl reload home-cctv

# If the face profile is installed:
sudo podman compose --profile faces up -d face-worker
```

If the build cache complains about changed owners, a `sudo podman compose build
--no-cache web` is enough; there is no application-code change in this phase.

### 2.5 If something goes wrong

The migration is reversible and no data is transformed. See §4 for rollback.

## 3. Verification

Run these after the recreate. Replace container names if your Compose project
name differs (`podman ps` shows them, e.g. `home-cctv-web-1`).

```bash
# 1. Every container runs as uid/gid 10001, never root.
for c in home-cctv-web-1 home-cctv-mediamtx-1 home-cctv-object-worker-1; do
  echo "== $c"; podman inspect "$c" --format '{{.Config.User}}'; podman exec "$c" id
done
# expected: 10001:10001 and uid=10001 gid=10001 groups=10001 (face worker: same)

# 2. Hardening flags are actually applied by the runtime.
podman inspect home-cctv-web-1 --format \
  'readonly={{.HostConfig.ReadonlyRootfs}} capdrop={{.HostConfig.CapDrop}} secopt={{.HostConfig.SecurityOpt}} mem={{.HostConfig.Memory}} pids={{.HostConfig.PidsLimit}}'
# expected: readonly=true capdrop=[ALL] secopt=[no-new-privileges:true] mem≈805306368 pids=256

# 3. The workers and MediaMTX never see the hub's application secrets.
podman exec home-cctv-mediamtx-1 env | grep -E 'SESSION_SECRET|TELEGRAM_|APP_' || echo "OK: no app secrets in mediamtx"
podman exec home-cctv-object-worker-1 env | grep -E 'SESSION_SECRET|TELEGRAM_|APP_|DVR_|HIKVISION_' \
  || echo "OK: no app/DVR secrets in object-worker"
podman exec home-cctv-face-worker-1 env | grep -E 'SESSION_SECRET|TELEGRAM_|APP_|DVR_|HIKVISION_|MEDIAMTX_AUTH' \
  || echo "OK: no app/DVR/MediaMTX secrets in face-worker"
# The web container still has them (it needs them); that is expected.

# 4. Healthchecks and the public health endpoint.
podman compose ps                       # STATE should be "healthy"/"running"
podman inspect home-cctv-web-1 --format '{{.State.Health.Status}}'      # healthy
podman inspect home-cctv-mediamtx-1 --format '{{.State.Health.Status}}' # healthy
podman inspect home-cctv-object-worker-1 --format '{{.State.Health.Status}}' # healthy
curl -fsS http://127.0.0.1:3000/api/health

# 5. SQLite is writable by the container user.
podman exec home-cctv-web-1 sh -c \
  'test -w /app/data && touch /app/data/.phase2-write-test && rm /app/data/.phase2-write-test && echo "data dir writable"'
podman exec home-cctv-web-1 node -e \
  'const {DatabaseSync}=require("node:sqlite");const db=new DatabaseSync("/app/data/events.sqlite");console.log(db.prepare("PRAGMA quick_check").all());db.close()'
# expected: [{ quick_check: "ok" }] (field name may be "quick_check" or the column alias)

# 6. The model mount is read-only and the worker read it.
podman inspect home-cctv-object-worker-1 --format '{{json .Mounts}}' | tr ',' '\n' | grep models
# expected: a mount whose "RW":false
podman exec home-cctv-object-worker-1 sh -c 'ls -l /app/models'
podman exec home-cctv-object-worker-1 python3 scripts/healthcheck.py; echo "healthcheck exit=$?"

# 7. Scratch paths are writable tmpfs, not the image filesystem.
podman exec home-cctv-web-1 sh -c 'df -h /tmp /app/.next/cache | tail -n +2'
podman exec home-cctv-mediamtx-1 sh -c 'test -w /tmp && echo "mediamtx /tmp writable"'

# 8. Logs show no permission or read-only errors.
podman logs --tail 50 home-cctv-web-1
podman logs --tail 50 home-cctv-mediamtx-1
podman logs --tail 50 home-cctv-object-worker-1
```

### Application smoke checks

1. **Hub + live view:** open `http://127.0.0.1:3000`, log in, confirm the four
   camera tiles show live video (WebRTC or HLS). A failure here is usually a
   MediaMTX config-render problem, which shows in `podman logs
   home-cctv-mediamtx-1` without printing secrets.
2. **Event snapshot write:** trigger a motion/person event (or wait for one) and
   confirm a new file appears under `data/events/` owned by 10001:
   `sudo find data/events -type f -newermt '-15 minutes' | head`.
3. **Face crops** (only with `FACE_DETECTION_ENABLED=true` and the face worker
   running): keep detection enabled, wait for a qualifying event, then
   `sudo find data/face-crops -type f -newermt '-15 minutes' | head` and
   `sudo ls -ln data/face-crops | head`. New crops must be owned by 10001, and
   `/settings/system` must show a fresh face-worker heartbeat.
4. **Thumbnails:** hover a playback timeline; sprite files appear under
   `data/playback-thumbnails/` (owner 10001). If they do not, check the web log
   for `/tmp` or FFmpeg errors.
5. **Backup:** `sudo systemctl start home-cctv-backup.service &&
   sudo journalctl -u home-cctv-backup -n 30 --no-pager`, then
   `sudo ls -lt backups | head` and
   `sudo ./scripts/verify-backup.sh backups/<timestamp>` — expected `PASS`.
   Confirm the web process can read the status file it displays:
   `podman exec home-cctv-web-1 sh -c 'test -r /app/data/backup-status.json &&
   echo "backup status readable"'`. If that fails, the backup unit still runs as
   root — see §2.3.
6. **Retention:** open `/settings/system` (ADMIN) and confirm storage, retention
   and last-backup state are healthy; snapshots/crops older than the retention
   window are still pruned by the web process (now as uid 10001).
7. **Restore rehearsal:** after a restore, confirm the data tree is back under
   the container uid (`sudo ls -ln data | head` should show 10001) and the hub
   can write again (§2.3).

## 4. Rollback

Rollback restores root containers and the pre-Phase-2 compose/Dockerfiles. It
does not need a data migration: files owned by 10001 remain readable and
writable by root containers. Expect brief downtime again.

```bash
cd /opt/home-cctv

# 1. Back up the current state first.
sudo ./scripts/backup.sh

# 2. Revert the Phase 2 files (compose.yml, the four Dockerfiles, the
#    object-worker entrypoint) to the previous commit, e.g.:
sudo git checkout <previous-commit> -- compose.yml Dockerfile \
  face-worker/Dockerfile object-worker/Dockerfile object-worker/docker-entrypoint.sh \
  mediamtx/Dockerfile

# 3. Rebuild and recreate the old images.
sudo podman compose build web mediamtx object-worker
sudo podman compose up -d --force-recreate

# Optional: return ownership to root (not required; root containers can read
# 10001-owned files). Keep the private modes even when rolling back:
sudo chown -R root:root data backups object-worker/models
```

Keep the rollback window short: reverting re-introduces root containers, the
shared `.env` in every container and the read-write model mount. Fix forward if
possible.

## 5. Known limits and residual risks

- **Network segmentation is not done yet.** Phase 2 does not define `networks:`;
  Phase 3 adds the `edge`/`media` split. Until then a compromised worker can
  still reach the web container and MediaMTX on the flat bridge network.
- **Workers still mount the whole `./data` tree read-write** (SQLite is shared by
  design). A worker compromise can still corrupt live application data; a
  dedicated database / narrower mounts is later work.
- **Rootful Podman remains the documented production default.** Container user
  10001 is not host root, which removes the "container compromise = host root"
  step, but the Podman daemon and the host still need patching.
- **The web container legitimately holds every application secret** (`env_file:
  .env`). Worker and MediaMTX compromise no longer yields `SESSION_SECRET`, the
  Telegram token, the hub login or the DVR password; a web compromise still does.
- **Rotate exposed secrets separately.** If the old stack ran in production,
  rotate `SESSION_SECRET` (logs everyone out), the Telegram bot token, the DVR
  password and `MEDIAMTX_AUTH_PASSWORD`, then recreate. This phase does not
  rotate anything for you.
- **SELinux hosts:** this compose file does not add `:Z`/`:z` relabel options,
  matching the documented Ubuntu deployment. On an enforcing SELinux host the
  bind mounts would need relabeling; that is out of scope for this phase.
- **macOS + Podman Desktop development:** the `./data` share is provided by the
  Podman machine's virtual filesystem, whose ownership mapping is not the Linux
  host's. A non-root container may therefore not be able to write it even after
  a host `chown`. The documented development path is `npm run dev` on the host
  with MediaMTX in Podman (the hub process then runs as your macOS user); the
  full container stack is the Linux production path. The ownership guarantees
  in this guide target the documented Ubuntu host.
- **Rootless Podman stays documented, not enabled** (see below). The systemd
  units, the nightly backup and this migration guide assume rootful Podman.

## 6. Rootless Podman (documented, NOT enabled)

Rootless Podman is a reasonable later hardening step, but it changes the uid
mapping and is **not** the supported default in this repository. If you migrate:

```bash
# Container uid 10001 is not host uid 10001 under rootless Podman: it maps to a
# subuid (normally 100000 + uid - 1, e.g. 110000). A plain host chown to 10001
# therefore does NOT give the container access; apply the ownership inside the
# user namespace instead:
podman unshare chown -R 10001:10001 /opt/home-cctv/data /opt/home-cctv/backups \
  /opt/home-cctv/object-worker/models
podman unshare chmod 700 /opt/home-cctv/data /opt/home-cctv/backups
```

Check your mapping first (`grep "$USER" /etc/subuid /etc/subgid`) and keep it
stable; a different mapping after a reboot invalidates the ownership. The
systemd units become per-user units and the backup timer runs as that user
(`deploy/systemd/README.md` has the per-user unit commands). Verify with
`podman unshare ls -ln data` — the files must show as `10001:10001` inside the
namespace.
