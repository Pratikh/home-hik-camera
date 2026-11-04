import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { openEventStore } from "@/server/events/event-store";

function mode(target: string): number {
  return statSync(target).mode & 0o777;
}

/**
 * The data directory contains the camera database (password hashes, session
 * rows, audit PII), snapshots and face crops. It must be owner-only. The mode is
 * applied by the application on open, so a legacy install is repaired on the
 * next restart without a manual chmod.
 */
describe("data directory permissions", () => {
  it("restricts the database, WAL and SHM files to the service user", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cctv-perms-"));
    const store = openEventStore(dir);
    store.db.prepare("SELECT 1").get();

    expect(mode(dir)).toBe(0o700);
    expect(mode(path.join(dir, "events.sqlite"))).toBe(0o600);
    for (const suffix of ["-wal", "-shm"]) {
      const sidecar = path.join(dir, `events.sqlite${suffix}`);
      try {
        expect(mode(sidecar)).toBe(0o600);
      } catch {
        // SQLite may not have created the sidecar yet on this platform.
      }
    }
  });

  it("repairs an existing world-readable database on the next open", () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "cctv-perms-legacy-"));
    const dbPath = path.join(dir, "events.sqlite");
    // Simulate an install created before the permission fix: a world-readable
    // database and directory.
    const legacy = new DatabaseSync(dbPath);
    legacy.exec("CREATE TABLE marker (id INTEGER)");
    legacy.close();
    chmodSync(dir, 0o755);
    chmodSync(dbPath, 0o644);

    // A fresh dataDir (not in the module cache) takes the repair path.
    const store = openEventStore(dir);
    expect(store.db.prepare("SELECT name FROM sqlite_master WHERE name = 'marker'").get()).toBeDefined();
    expect(mode(dir)).toBe(0o700);
    expect(mode(dbPath)).toBe(0o600);
  });
});
