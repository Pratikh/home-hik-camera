# Production autostart (Ubuntu Server + Podman)

These units start the **existing** Podman Compose stack after a reboot. They do
not change the architecture, add Docker, or start anything from application code.

- `home-cctv.service` — MediaMTX + web (`podman compose up -d`). Compose's
  `depends_on: service_healthy` keeps the web container waiting for MediaMTX, and
  both services use `restart: unless-stopped` for a crashed process.
- `home-cctv-face-worker.service` — optional; install only when
  `FACE_DETECTION_ENABLED=true` and the model is present.
- `home-cctv-backup.service` + `.timer` — daily `scripts/backup.sh` at 03:30
  with `Persistent=true`.

## Assumptions

- Deployment directory: `/opt/home-cctv`
- Rootful Podman with `podman compose` available to root (`podman compose
  version` must work under `sudo`). Rootless is covered below.
- `sqlite3` is installed on the host for consistent backups and verification:

```bash
sudo apt-get update && sudo apt-get install -y sqlite3
```

## Install

```bash
cd /opt/home-cctv
sudo install -m 644 deploy/systemd/home-cctv.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/home-cctv-backup.service /etc/systemd/system/
sudo install -m 644 deploy/systemd/home-cctv-backup.timer /etc/systemd/system/
# Optional, only when face detection is enabled:
sudo install -m 644 deploy/systemd/home-cctv-face-worker.service /etc/systemd/system/
sudo systemctl daemon-reload

# .env contains DVR credentials, the session secret, the Telegram token and the
# MediaMTX password. Only the service account should be able to read it.
sudo chown root:root /opt/home-cctv/.env
sudo chmod 600 /opt/home-cctv/.env

sudo systemctl enable --now home-cctv.service
sudo systemctl enable --now home-cctv-backup.timer
# Optional:
sudo systemctl enable --now home-cctv-face-worker.service
```

## Verify

```bash
systemctl is-enabled home-cctv.service
systemctl status home-cctv.service --no-pager
systemctl list-timers home-cctv-backup.timer --no-pager
podman compose -f /opt/home-cctv/compose.yml ps
curl -fsS http://127.0.0.1:3000/api/health
```

After a reboot, `home-cctv.service` should be `active (exited)` with both
containers running. `ExecStop` shuts the stack down cleanly.

A manual backup and restore rehearsal:

```bash
sudo systemctl start home-cctv-backup.service
journalctl -u home-cctv-backup.service -n 50 --no-pager
sudo -u root /opt/home-cctv/scripts/verify-backup.sh /opt/home-cctv/backups/<timestamp>
```

The same backup status appears on `/settings/system` (last successful backup,
age and failure state).

## Rootless Podman

If the stack runs as an unprivileged user, use the same unit files as per-user
units instead of `multi-user.target`:

```bash
mkdir -p ~/.config/systemd/user
cp /opt/home-cctv/deploy/systemd/home-cctv.service ~/.config/systemd/user/
cp /opt/home-cctv/deploy/systemd/home-cctv-backup.service ~/.config/systemd/user/
cp /opt/home-cctv/deploy/systemd/home-cctv-backup.timer ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now home-cctv.service
systemctl --user enable --now home-cctv-backup.timer
loginctl enable-linger "$USER"      # start the user manager at boot
```

Keep `/opt/home-cctv` and `data/` owned by that account, and confirm
`podman compose version` works as that user **before** enabling the units. A
system unit with `User=` is a different setup and needs a correctly configured
rootless Podman environment; the per-user units above are the simpler path.

## Notes

- Never place secrets in `/etc/default/home-cctv`. It is for non-secret paths
  such as `DATA_DIR` and `BACKUP_DIR`; Compose reads `.env` separately.
- `podman stop`/`podman kill` is an explicit stop and is not undone by
  `restart: unless-stopped`. After a manual stop, use `systemctl start
  home-cctv` or `podman compose up -d`.
- To apply a changed `.env` (DVR address, MediaMTX password), run
  `sudo systemctl reload home-cctv`; the reload target recreates the containers
  so MediaMTX re-renders its configuration.
- The timer keeps 7 daily backups by default. Change `BACKUP_RETENTION` in
  `home-cctv-backup.service` or `/etc/default/home-cctv`.
