import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";

/**
 * Operational script rehearsal.
 *
 * These run the real shell scripts against a temporary data directory and a
 * temporary SQLite database. Nothing here touches ./data or ./backups.
 */
const ROOT = process.cwd();
const HAS_SQLITE = spawnSync("sh", ["-c", "command -v sqlite3"], { encoding: "utf8" }).status === 0;
const EVENT_ID = "evt_aaaaaaaaaaaaaaaaaaaaaaaa";
const SNAPSHOT = `2026/10/09/1-${EVENT_ID}.jpg`;
const CROP = `2026/10/${EVENT_ID}-face-1.jpg`;

type Fixture = { dataDir: string; backupDir: string };

function makeFixture(): Fixture {
  const root = mkdtempSync(path.join(os.tmpdir(), "cctv-scripts-"));
  const dataDir = path.join(root, "data");
  const backupDir = path.join(root, "backups");
  mkdirSync(path.join(dataDir, "events", "2026", "10", "09"), { recursive: true });
  mkdirSync(path.join(dataDir, "face-crops", "2026", "10"), { recursive: true });
  writeFileSync(path.join(dataDir, "events", SNAPSHOT), "snapshot");
  writeFileSync(path.join(dataDir, "face-crops", CROP), "crop");
  writeFileSync(path.join(dataDir, "cameras.json"), JSON.stringify({ 1: "Front door" }));

  const db = new DatabaseSync(path.join(dataDir, "events.sqlite"));
  db.exec(`
    CREATE TABLE events (id TEXT PRIMARY KEY, snapshot_path TEXT);
    CREATE TABLE users (id TEXT PRIMARY KEY, username TEXT NOT NULL);
    CREATE TABLE auth_sessions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL);
    CREATE TABLE notification_rules (id TEXT PRIMARY KEY);
    CREATE TABLE notification_history (id TEXT PRIMARY KEY);
    CREATE TABLE app_settings (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE audit_logs (id TEXT PRIMARY KEY);
    CREATE TABLE telegram_media_jobs (id INTEGER PRIMARY KEY);
    CREATE TABLE event_faces (id TEXT PRIMARY KEY, event_id TEXT, crop_path TEXT);
    CREATE TABLE face_processing (event_id TEXT PRIMARY KEY);
  `);
  db.prepare("INSERT INTO events (id, snapshot_path) VALUES (?, ?)").run(EVENT_ID, SNAPSHOT);
  db.prepare("INSERT INTO users (id, username) VALUES ('u1', 'home')").run();
  db.prepare("INSERT INTO event_faces (id, event_id, crop_path) VALUES ('face_111111111111111111111111', ?, ?)").run(
    EVENT_ID,
    CROP,
  );
  db.close();
  return { dataDir, backupDir };
}

function run(script: string, args: string[], fixture: Fixture, extra: Record<string, string> = {}) {
  return spawnSync("sh", [path.join(ROOT, "scripts", script), ...args], {
    cwd: ROOT,
    encoding: "utf8",
    env: {
      ...process.env,
      DATA_DIR: fixture.dataDir,
      BACKUP_DIR: fixture.backupDir,
      ...extra,
    },
    timeout: 60_000,
  });
}

function backups(fixture: Fixture): string[] {
  if (!existsSync(fixture.backupDir)) return [];
  return readdirSync(fixture.backupDir)
    .filter((name) => /^\d{4}-\d{2}-\d{2}_\d{6}$/.test(name))
    .sort()
    .reverse();
}

describe.skipIf(!HAS_SQLITE)("operational scripts", () => {
  it("creates an atomic, verified backup with a status file", () => {
    const fixture = makeFixture();
    const result = run("backup.sh", [], fixture, { BACKUP_RETENTION: "3" });
    expect(result.status, result.stderr).toBe(0);

    const [latest] = backups(fixture);
    expect(latest).toBeTruthy();
    const dir = path.join(fixture.backupDir, latest!);
    expect(existsSync(path.join(dir, "database.sqlite"))).toBe(true);
    expect(existsSync(path.join(dir, "events", SNAPSHOT))).toBe(true);
    expect(existsSync(path.join(dir, "face-crops", CROP))).toBe(true);
    expect(existsSync(path.join(dir, "manifest.json"))).toBe(true);
    expect(existsSync(path.join(dir, "manifest.json"))).toBe(true);

    const status = JSON.parse(readFileSync(path.join(fixture.dataDir, "backup-status.json"), "utf8")) as {
      status: string;
      last_success_at: string;
    };
    expect(status.status).toBe("success");
    expect(status.last_success_at).toBeTruthy();

    const verified = spawnSync("sh", [path.join(ROOT, "scripts", "verify-backup.sh"), dir], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(verified.status, verified.stderr).toBe(0);
    expect(verified.stdout).toContain("verify-backup: PASS");
  });

  it("retains only the configured number of complete backups", () => {
    const fixture = makeFixture();
    for (const name of ["2000-01-01_000000", "2000-01-02_000000"]) {
      const dir = path.join(fixture.backupDir, name);
      mkdirSync(dir, { recursive: true });
      writeFileSync(path.join(dir, "manifest.json"), JSON.stringify({ status: "complete" }));
    }
    const result = run("backup.sh", [], fixture, { BACKUP_RETENTION: "2" });
    expect(result.status, result.stderr).toBe(0);
    const remaining = backups(fixture);
    expect(remaining).toHaveLength(2);
    expect(existsSync(path.join(fixture.backupDir, "2000-01-01_000000"))).toBe(false);
    expect(existsSync(path.join(fixture.backupDir, "2000-01-02_000000"))).toBe(true);
  });

  it("fails loudly instead of producing a backup from an unreadable database", () => {
    const fixture = makeFixture();
    writeFileSync(path.join(fixture.dataDir, "events.sqlite"), "this is not a sqlite database");
    const result = run("backup.sh", [], fixture);
    expect(result.status).not.toBe(0);
    expect(backups(fixture)).toHaveLength(0);
    const status = JSON.parse(readFileSync(path.join(fixture.dataDir, "backup-status.json"), "utf8")) as {
      status: string;
    };
    expect(status.status).toBe("failed");
  });

  it("rejects a corrupt backup during verification and does not touch live data", () => {
    const fixture = makeFixture();
    const fake = path.join(fixture.backupDir, "2000-01-01_000000");
    mkdirSync(fake, { recursive: true });
    writeFileSync(path.join(fake, "manifest.json"), JSON.stringify({ status: "complete" }));
    writeFileSync(path.join(fake, "database.sqlite"), "not a database");
    const before = readFileSync(path.join(fixture.dataDir, "events.sqlite")).subarray(0, 16).toString("hex");

    const result = spawnSync("sh", [path.join(ROOT, "scripts", "verify-backup.sh"), fake], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
    });
    expect(result.status).not.toBe(0);
    const after = readFileSync(path.join(fixture.dataDir, "events.sqlite")).subarray(0, 16).toString("hex");
    expect(after).toBe(before);
  });

  it("removes only orphan snapshots, and supports dry-run", () => {
    const fixture = makeFixture();
    const orphan = "2026/10/09/2-evt_bbbbbbbbbbbbbbbbbbbbbbbb.jpg";
    const handwritten = "2026/10/09/notes.txt";
    writeFileSync(path.join(fixture.dataDir, "events", orphan), "orphan");
    writeFileSync(path.join(fixture.dataDir, "events", handwritten), "keep");

    const dry = run("cleanup-orphan-snapshots.sh", ["--dry-run"], fixture);
    expect(dry.status, dry.stderr).toBe(0);
    expect(dry.stdout).toContain("would delete");
    expect(existsSync(path.join(fixture.dataDir, "events", orphan))).toBe(true);

    const actual = run("cleanup-orphan-snapshots.sh", [], fixture);
    expect(actual.status, actual.stderr).toBe(0);
    expect(existsSync(path.join(fixture.dataDir, "events", orphan))).toBe(false);
    expect(existsSync(path.join(fixture.dataDir, "events", SNAPSHOT))).toBe(true);
    expect(existsSync(path.join(fixture.dataDir, "events", handwritten))).toBe(true);

    const repeat = run("cleanup-orphan-snapshots.sh", [], fixture);
    expect(repeat.status, repeat.stderr).toBe(0);
    expect(repeat.stdout).toContain("deleted 0");
  });
});
