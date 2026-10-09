import "server-only";
import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { hashPassword } from "@/lib/password-hash";
import { openEventStore } from "@/server/events/event-store";

export type Role = "ADMIN" | "VIEWER";

export type UserRecord = {
  id: string;
  username: string;
  passwordHash: string;
  role: Role;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string | null;
};

type UserRow = {
  id: string;
  username: string;
  password_hash: string;
  role: string;
  enabled: number;
  created_at: string;
  updated_at: string;
  last_login_at: string | null;
};

function mapUser(row: UserRow): UserRecord {
  return {
    id: row.id,
    username: row.username,
    passwordHash: row.password_hash,
    role: row.role === "VIEWER" ? "VIEWER" : "ADMIN",
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastLoginAt: row.last_login_at,
  };
}

export class AccountStore {
  constructor(private readonly db: DatabaseSync) {}

  countEnabledAdmins(): number {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM users WHERE role = 'ADMIN' AND enabled = 1").get() as { count: number };
    return row.count;
  }

  ensureBootstrapAdmin(username: string, password: string): void {
    const row = this.db.prepare("SELECT COUNT(*) AS count FROM users").get() as { count: number };
    if (row.count > 0 || !username || !password) return;
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO users (id, username, password_hash, role, enabled, created_at, updated_at, last_login_at)
         VALUES (?, ?, ?, 'ADMIN', 1, ?, ?, NULL)`,
      )
      .run(randomUUID(), username, hashPassword(password), now, now);
  }

  findByUsername(username: string): UserRecord | null {
    const row = this.db.prepare("SELECT * FROM users WHERE username = ?").get(username) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  findById(id: string): UserRecord | null {
    const row = this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
    return row ? mapUser(row) : null;
  }

  listUsers(): Omit<UserRecord, "passwordHash">[] {
    const rows = this.db.prepare("SELECT * FROM users ORDER BY username").all() as unknown as UserRow[];
    return rows.map((row) => {
      const user = mapUser(row);
      const { passwordHash: _hidden, ...safe } = user;
      void _hidden;
      return safe;
    });
  }

  createUser(input: { username: string; password: string; role: Role }): UserRecord | null {
    const now = new Date().toISOString();
    const id = randomUUID();
    try {
      this.db
        .prepare(
          `INSERT INTO users (id, username, password_hash, role, enabled, created_at, updated_at, last_login_at)
           VALUES (?, ?, ?, ?, 1, ?, ?, NULL)`,
        )
        .run(id, input.username, hashPassword(input.password), input.role, now, now);
    } catch {
      return null;
    }
    return this.findById(id);
  }

  updateUser(id: string, patch: { enabled?: boolean; role?: Role; password?: string }): "ok" | "missing" | "last_admin" {
    const current = this.findById(id);
    if (!current) return "missing";
    const nextRole = patch.role ?? current.role;
    const nextEnabled = patch.enabled ?? current.enabled;
    const removesLastAdmin = current.role === "ADMIN" && current.enabled && (nextRole !== "ADMIN" || !nextEnabled) && this.countEnabledAdmins() <= 1;
    if (removesLastAdmin) return "last_admin";
    const now = new Date().toISOString();
    if (patch.password) {
      this.db.prepare("UPDATE users SET password_hash = ?, role = ?, enabled = ?, updated_at = ? WHERE id = ?").run(hashPassword(patch.password), nextRole, nextEnabled ? 1 : 0, now, id);
    } else {
      this.db.prepare("UPDATE users SET role = ?, enabled = ?, updated_at = ? WHERE id = ?").run(nextRole, nextEnabled ? 1 : 0, now, id);
    }
    if (!nextEnabled) this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(id);
    return "ok";
  }

  deleteUser(id: string): "ok" | "missing" | "last_admin" {
    const current = this.findById(id);
    if (!current) return "missing";
    if (current.role === "ADMIN" && current.enabled && this.countEnabledAdmins() <= 1) return "last_admin";
    this.db.prepare("DELETE FROM auth_sessions WHERE user_id = ?").run(id);
    this.db.prepare("DELETE FROM viewer_presence WHERE user_id = ?").run(id);
    this.db.prepare("DELETE FROM users WHERE id = ?").run(id);
    return "ok";
  }

  markLogin(id: string): void {
    const now = new Date().toISOString();
    this.db.prepare("UPDATE users SET last_login_at = ?, updated_at = ? WHERE id = ?").run(now, now, id);
  }

  createSession(input: { userId: string; ip: string | null; userAgent: string | null; expiresAt: number }): string {
    const id = randomUUID();
    const now = new Date().toISOString();
    this.db
      .prepare(
        `INSERT INTO auth_sessions (id, user_id, expires_at, created_at, last_seen_at, ip_address, user_agent)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(id, input.userId, input.expiresAt, now, now, input.ip, input.userAgent);
    return id;
  }

  getSession(id: string): { id: string; userId: string; username: string; role: Role; enabled: boolean; expiresAt: number } | null {
    const row = this.db
      .prepare(
        `SELECT s.id, s.user_id, s.expires_at, u.username, u.role, u.enabled
         FROM auth_sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`,
      )
      .get(id) as { id: string; user_id: string; expires_at: number; username: string; role: string; enabled: number } | undefined;
    if (!row) return null;
    return {
      id: row.id,
      userId: row.user_id,
      username: row.username,
      role: row.role === "VIEWER" ? "VIEWER" : "ADMIN",
      enabled: row.enabled === 1,
      expiresAt: row.expires_at,
    };
  }

  touchSession(id: string): void {
    this.db.prepare("UPDATE auth_sessions SET last_seen_at = ? WHERE id = ?").run(new Date().toISOString(), id);
  }

  deleteSession(id: string): void {
    this.db.prepare("DELETE FROM auth_sessions WHERE id = ?").run(id);
  }

  listSessions(): Array<{ id: string; username: string; role: Role; createdAt: string; lastSeenAt: string; ipAddress: string | null }> {
    const rows = this.db
      .prepare(
        `SELECT s.id, u.username, u.role, s.created_at, s.last_seen_at, s.ip_address
         FROM auth_sessions s JOIN users u ON u.id = s.user_id
         WHERE s.expires_at > ? ORDER BY s.last_seen_at DESC`,
      )
      .all(Date.now()) as Array<{ id: string; username: string; role: string; created_at: string; last_seen_at: string; ip_address: string | null }>;
    return rows.map((row) => ({
      id: row.id,
      username: row.username,
      role: row.role === "VIEWER" ? "VIEWER" : "ADMIN",
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
      ipAddress: row.ip_address,
    }));
  }

  writeAudit(input: { userId: string | null; action: string; resource?: string | null; metadata?: Record<string, string | number | boolean | null>; ip?: string | null; userAgent?: string | null }): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (id, user_id, action, resource, metadata, ip_address, user_agent, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        randomUUID(),
        input.userId,
        input.action,
        input.resource ?? null,
        input.metadata ? JSON.stringify(input.metadata) : null,
        input.ip ?? null,
        input.userAgent ?? null,
        new Date().toISOString(),
      );
  }

  listAudit(input: {
    user?: string | null;
    action?: string | null;
    date?: string | null;
    limit?: number | null;
    offset?: number | null;
  }): { logs: Array<{ id: string; username: string | null; action: string; resource: string | null; metadata: string | null; ipAddress: string | null; createdAt: string }>; total: number } {
    const where: string[] = [];
    const params: string[] = [];
    if (input.user) {
      where.push("u.username = ?");
      params.push(input.user);
    }
    if (input.action) {
      where.push("a.action = ?");
      params.push(input.action);
    }
    if (input.date) {
      where.push("a.created_at LIKE ?");
      params.push(`${input.date}%`);
    }
    const clause = where.length ? `WHERE ${where.join(" AND ")}` : "";
    const total = this.db
      .prepare(`SELECT COUNT(*) AS count FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id ${clause}`)
      .get(...params) as { count: number };
    // Clamp so a caller can never request an unbounded page.
    const limit = typeof input.limit === "number" && input.limit > 0 ? Math.min(input.limit, 100) : 100;
    const offset = typeof input.offset === "number" && input.offset > 0 ? input.offset : 0;
    const rows = this.db
      .prepare(
        `SELECT a.id, u.username, a.action, a.resource, a.metadata, a.ip_address, a.created_at
         FROM audit_logs a LEFT JOIN users u ON u.id = a.user_id
         ${clause} ORDER BY a.created_at DESC LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as Array<{ id: string; username: string | null; action: string; resource: string | null; metadata: string | null; ip_address: string | null; created_at: string }>;
    return {
      total: total.count,
      logs: rows.map((row) => ({
        id: row.id,
        username: row.username,
        action: row.action,
        resource: row.resource,
        metadata: row.metadata,
        ipAddress: row.ip_address,
        createdAt: row.created_at,
      })),
    };
  }

  touchPresence(userId: string, streamPath: string): void {
    this.db
      .prepare(
        `INSERT INTO viewer_presence (user_id, path, seen_at) VALUES (?, ?, ?)
         ON CONFLICT(user_id, path) DO UPDATE SET seen_at = excluded.seen_at`,
      )
      .run(userId, streamPath, Date.now());
  }

  presence(maxAgeMs = 30_000): Array<{ username: string; path: string }> {
    const rows = this.db
      .prepare(
        `SELECT u.username, p.path FROM viewer_presence p JOIN users u ON u.id = p.user_id WHERE p.seen_at > ?`,
      )
      .all(Date.now() - maxAgeMs) as Array<{ username: string; path: string }>;
    return rows;
  }
}

export function accountStore(dataDir: string): AccountStore {
  return new AccountStore(openEventStore(dataDir).db);
}
