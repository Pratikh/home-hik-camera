"use client";

import Link from "next/link";
import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { SkeletonRows } from "@/components/ui/States";
import { useEscapeToDismiss } from "@/components/hooks/useEscapeToDismiss";

type UserRow = { id: string; username: string; role: "ADMIN" | "VIEWER"; enabled: boolean };

function initials(username: string): string {
  return username.slice(0, 1).toUpperCase();
}

function accountCount(count: number): string {
  return `${count} account${count === 1 ? "" : "s"}`;
}

export function UsersView() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "VIEWER">("VIEWER");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<UserRow | null>(null);
  const [resetFor, setResetFor] = useState<UserRow | null>(null);
  const [resetValue, setResetValue] = useState("");
  const dismissConfirm = useCallback(() => setConfirmDelete(null), []);
  const dismissReset = useCallback(() => {
    setResetFor(null);
    setResetValue("");
  }, []);
  useEscapeToDismiss(confirmDelete !== null, dismissConfirm);
  useEscapeToDismiss(resetFor !== null, dismissReset);

  async function reload() {
    try {
      const body = await api<{ users: UserRow[] }>("/api/users");
      setUsers(body.users);
    } finally {
      setLoading(false);
    }
  }

  async function deleteUser(user: UserRow) {
    setError(null);
    setConfirmDelete(null);
    try {
      await api(`/api/users/${user.id}`, { method: "DELETE" });
      await reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  useEffect(() => {
    const timer = setTimeout(() => void reload().catch(() => undefined), 0);
    return () => clearTimeout(timer);
  }, []);

  async function create(event: FormEvent) {
    event.preventDefault();
    setError(null);
    try {
      await api("/api/users", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      setUsername("");
      setPassword("");
      await reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  async function update(id: string, patch: { enabled?: boolean; role?: "ADMIN" | "VIEWER"; password?: string }) {
    setError(null);
    try {
      await api(`/api/users/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
      await reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  async function resetPassword(user: UserRow) {
    setError(null);
    setNotice(null);
    if (resetValue.length < 8) {
      setError("Password must be at least 8 characters.");
      return;
    }
    try {
      await api(`/api/users/${user.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetValue }),
      });
      setResetFor(null);
      setResetValue("");
      setNotice(`Password reset for ${user.username}. All of their sessions were signed out.`);
      await reload();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  async function revokeSessions(user: UserRow) {
    setError(null);
    setNotice(null);
    try {
      const result = await api<{ revoked: number }>(`/api/users/${user.id}/sessions`, { method: "DELETE" });
      setNotice(`Signed out ${result.revoked} session(s) for ${user.username}.`);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <PageHeader
        eyebrow="Administration"
        title="Users"
        detail="Administrators manage the hub. Viewers can watch live video, playback, and events."
        actions={
          <>
            <span className="pill">
              <span className={`dot ${users.length > 0 ? "dot--online" : "dot--idle"}`} />
              {loading && users.length === 0 ? Messages.checking : accountCount(users.length)}
            </span>
            <Link href="/settings/audit-log" className="btn">
              <Icon name="file" className="icon icon-sm" />
              Audit log
            </Link>
          </>
        }
      />

      {error ? (
        <div className="notice notice--danger" role="alert">
          <Icon name="alert" />
          <span>{error}</span>
        </div>
      ) : null}
      {notice ? (
        <div className="notice notice--accent" role="status">
          <Icon name="check" />
          <span>{notice}</span>
        </div>
      ) : null}

      <section className="card" style={{ minWidth: 0 }}>
        <div className="card__head">
          <h2 className="card__title">
            <Icon name="users" className="icon icon-sm" />
            Users
          </h2>
          <span className="badge badge--mono">{accountCount(users.length)}</span>
        </div>

        {loading && users.length === 0 ? (
          <div className="card__body">
            <SkeletonRows rows={2} />
          </div>
        ) : null}

        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {users.map((user) => (
            <li
              key={user.id}
              style={{
                display: "grid",
                gap: 10,
                padding: "12px 16px",
                borderTop: "1px solid var(--line)",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap", minWidth: 0 }}>
                <span className="avatar" aria-hidden="true">
                  {initials(user.username)}
                </span>
                <span style={{ fontSize: "var(--fs-13)", fontWeight: 600, minWidth: 0 }}>{user.username}</span>
                <span className={`badge ${user.role === "ADMIN" ? "badge--accent" : ""}`}>{user.role}</span>
                <span className="status">
                  <span className={`dot ${user.enabled ? "dot--online" : "dot--offline"}`} aria-hidden="true" />
                  <span className="status__text">{user.enabled ? "Enabled" : "Disabled"}</span>
                </span>
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void update(user.id, { enabled: !user.enabled })}
                  >
                    {user.enabled ? "Disable" : "Enable"}
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => void update(user.id, { role: user.role === "ADMIN" ? "VIEWER" : "ADMIN" })}
                  >
                    Switch role
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      setResetFor(user);
                      setResetValue("");
                      setError(null);
                      setNotice(null);
                    }}
                  >
                    Reset password
                  </button>
                  <button type="button" className="btn btn--sm" onClick={() => void revokeSessions(user)}>
                    Sign out sessions
                  </button>
                  <button
                    type="button"
                    className="btn btn--sm btn--danger"
                    onClick={() => setConfirmDelete(user)}
                  >
                    Delete
                  </button>
                </div>
              </div>

              {resetFor?.id === user.id ? (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void resetPassword(user);
                  }}
                  aria-label={`Reset password for ${user.username}`}
                  style={{
                    display: "grid",
                    gap: 10,
                    padding: 12,
                    border: "1px solid var(--line-2)",
                    borderRadius: "var(--r-md)",
                    background: "var(--card-2)",
                  }}
                >
                  <p style={{ fontSize: "var(--fs-13)" }}>
                    Set a new password for <strong>{user.username}</strong>. Their existing sessions will be signed out.
                  </p>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <input
                      value={resetValue}
                      onChange={(event) => setResetValue(event.target.value)}
                      placeholder="New password (at least 8 characters)"
                      aria-label={`New password for ${user.username}`}
                      type="password"
                      autoComplete="new-password"
                      minLength={8}
                      maxLength={200}
                      className="input"
                      style={{ flex: "1 1 200px", minWidth: 0 }}
                      required
                    />
                    <button type="button" onClick={() => setResetFor(null)} className="btn">
                      Cancel
                    </button>
                    <button type="submit" className="btn btn--primary">
                      Reset password
                    </button>
                  </div>
                </form>
              ) : null}

              {confirmDelete?.id === user.id ? (
                <div
                  role="alertdialog"
                  aria-label={`Confirm delete user ${user.username}`}
                  className="notice notice--danger"
                  style={{ display: "grid", gap: 10 }}
                >
                  <div>
                    <strong>Delete user {user.username}?</strong> This cannot be undone.
                  </div>
                  <span className="section__hint">
                    Every session for this account is signed out immediately. Existing events, snapshots and audit rows
                    stay in place.
                  </span>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    <button type="button" onClick={() => setConfirmDelete(null)} className="btn">
                      Cancel
                    </button>
                    <button type="button" onClick={() => void deleteUser(user)} className="btn btn--danger">
                      Delete
                    </button>
                  </div>
                </div>
              ) : null}
            </li>
          ))}
        </ul>

        <div className="card__foot" style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, flexWrap: "wrap" }}>
          <span className="section__hint">Roles are changed by the hub administrator. No user data leaves the LAN.</span>
          <span className="status">
            <span className="dot dot--online" aria-hidden="true" />
            <span className="status__text">Session store healthy</span>
          </span>
        </div>
      </section>

      <div className="split">
        <form onSubmit={(event) => void create(event)} className="card" style={{ minWidth: 0 }}>
          <div className="card__head">
            <h2 className="card__title">
              <Icon name="plus" className="icon icon-sm" />
              Create user
            </h2>
            <span className="chip">Local account</span>
          </div>
          <div className="card__body" style={{ display: "grid", gap: 12 }}>
            <div className="field">
              <label className="field__label" htmlFor="new-username">
                Username
              </label>
              <input
                id="new-username"
                value={username}
                onChange={(event) => setUsername(event.target.value)}
                className="input"
                placeholder="e.g. security"
                autoComplete="off"
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="new-password">
                Password
              </label>
              <input
                id="new-password"
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="input"
                placeholder="At least 8 characters"
                type="password"
                autoComplete="new-password"
                required
              />
            </div>
            <div className="field">
              <label className="field__label" htmlFor="new-role">
                Role
              </label>
              <select
                id="new-role"
                value={role}
                onChange={(event) => setRole(event.target.value === "ADMIN" ? "ADMIN" : "VIEWER")}
                className="select"
              >
                <option value="VIEWER">Viewer</option>
                <option value="ADMIN">Admin</option>
              </select>
            </div>
            <button type="submit" className="btn btn--primary">
              <Icon name="plus" className="icon icon-sm" />
              Create user
            </button>
          </div>
          <div className="card__foot">
            <span className="section__hint">New accounts can sign in immediately. Passwords need at least 8 characters.</span>
          </div>
        </form>

        <section className="card" style={{ minWidth: 0 }}>
          <div className="card__head">
            <h2 className="card__title">
              <Icon name="shield" className="icon icon-sm" />
              Roles
            </h2>
          </div>
          <div className="card__body" style={{ display: "grid", gap: 12 }}>
            <div style={{ display: "grid", gap: 4 }}>
              <div>
                <span className="badge badge--accent">ADMIN</span>
              </div>
              <p className="section__hint">
                Manage users, notification rules, object detection, the audit log and system status. Full access to every
                camera.
              </p>
            </div>
            <div style={{ height: 1, background: "var(--line)" }} />
            <div style={{ display: "grid", gap: 4 }}>
              <div>
                <span className="badge">VIEWER</span>
              </div>
              <p className="section__hint">
                Watch live video, playback recordings and browse events. No access to Settings.
              </p>
            </div>
          </div>
          <div className="card__foot">
            <span className="section__hint">Administrators can disable an account at any time; its sessions end on the next request.</span>
          </div>
        </section>
      </div>
    </div>
  );
}
