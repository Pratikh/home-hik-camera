"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, navigate } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { formatKolkataDateTimeFromIso } from "@/lib/time-kolkata";

type SessionRow = {
  id: string;
  createdAt: string;
  lastSeenAt: string;
  expiresAt: number;
  ipAddress: string | null;
  userAgent: string | null;
  current: boolean;
};

type SessionResponse = { username: string; role: "ADMIN" | "VIEWER" };

function formatWhen(iso: string): string {
  return formatKolkataDateTimeFromIso(iso);
}

const SESSION_PAGE_SIZE = 8;

function shortAgent(value: string | null): string {
  if (!value) return "Unknown browser";
  return value.length > 90 ? `${value.slice(0, 87)}...` : value;
}

/**
 * Self-service account page.
 *
 * Password change, session list and revocation behave exactly as before; only
 * the presentation moved to the Sentinel card/form language. Session rows never
 * contain a token, and the password form keeps its tested labels.
 */
export function AccountView() {
  const [account, setAccount] = useState<SessionResponse | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAllSessions, setShowAllSessions] = useState(false);

  const orderedSessions = [...sessions].sort((a, b) => Number(b.current) - Number(a.current));
  const visibleSessions = showAllSessions ? orderedSessions : orderedSessions.slice(0, SESSION_PAGE_SIZE);

  const load = useCallback(async () => {
    setError(null);
    try {
      const [who, list] = await Promise.all([
        api<SessionResponse>("/api/auth/session"),
        api<{ sessions: SessionRow[] }>("/api/auth/sessions"),
      ]);
      setAccount(who);
      setSessions(list.sessions);
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function changePassword(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setNotice(null);
    if (newPassword !== confirmPassword) {
      setError("The new passwords do not match.");
      return;
    }
    setBusy(true);
    try {
      const result = await api<{ ok: boolean; sessionsRevoked?: number; message?: string }>("/api/auth/password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ currentPassword, newPassword }),
      });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      setNotice(
        result.message ??
          `Password changed.${result.sessionsRevoked ? ` ${result.sessionsRevoked} existing session(s) were revoked and this browser was signed in again.` : ""}`,
      );
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    } finally {
      setBusy(false);
    }
  }

  async function revoke(scope: "others" | "all") {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const result = await api<{ revoked: number }>("/api/auth/sessions", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (scope === "all") {
        navigate("/login");
        return;
      }
      setNotice(`${result.revoked} other session(s) signed out.`);
      await load();
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-w-0" style={{ maxWidth: 880, margin: "0 auto" }}>
      <PageHeader
        eyebrow="Account"
        title="Account"
        detail="Change your own password and manage the browsers that are signed in as you."
      />

      {account ? (
        <p className="section__hint" style={{ marginBottom: 14 }}>
          Signed in as <strong style={{ color: "var(--ink)" }}>{account.username}</strong> ({account.role})
        </p>
      ) : null}

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

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <h2 className="card__title">
            <Icon name="lock" className="icon icon-sm" />
            Change password
          </h2>
        </div>
        <form onSubmit={(event) => void changePassword(event)} className="card__body" style={{ display: "grid", gap: 14 }}>
          <p className="section__hint" style={{ maxWidth: "62ch" }}>
            Changing it signs out every other session, including any device you no longer use.
          </p>

          <label className="field" htmlFor="current-password">
            <span className="field__label">Current password</span>
            <input
              id="current-password"
              value={currentPassword}
              onChange={(event) => setCurrentPassword(event.target.value)}
              type="password"
              autoComplete="current-password"
              className="input"
              required
            />
          </label>

          <label className="field" htmlFor="new-password">
            <span className="field__label">New password</span>
            <input
              id="new-password"
              value={newPassword}
              onChange={(event) => setNewPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
              className="input"
              required
            />
          </label>
          <p className="field__hint" style={{ marginTop: -8 }}>
            At least 8 characters.
          </p>

          <label className="field" htmlFor="confirm-password">
            <span className="field__label">Confirm new password</span>
            <input
              id="confirm-password"
              value={confirmPassword}
              onChange={(event) => setConfirmPassword(event.target.value)}
              type="password"
              autoComplete="new-password"
              minLength={8}
              maxLength={200}
              className="input"
              required
            />
          </label>

          <div>
            <button type="submit" disabled={busy} className="btn btn--primary">
              Change password
            </button>
          </div>
        </form>
      </section>

      <section className="card" style={{ marginTop: 16 }}>
        <div className="card__head" style={{ flexWrap: "wrap" }}>
          <h2 className="card__title">
            <Icon name="user" className="icon icon-sm" />
            Signed-in sessions ({sessions.length})
          </h2>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
            <button
              type="button"
              onClick={() => void revoke("others")}
              disabled={busy || sessions.length < 2}
              className="btn btn--sm"
            >
              Sign out other sessions
            </button>
            <button
              type="button"
              onClick={() => void revoke("all")}
              disabled={busy}
              className="btn btn--sm btn--danger"
            >
              Sign out everywhere
            </button>
          </div>
        </div>
        <ul style={{ display: "grid" }}>
          {visibleSessions.map((session) => (
            <li
              key={session.id}
              style={{ padding: "11px 16px", borderBottom: "1px solid var(--line)", display: "grid", gap: 3 }}
            >
              <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
                {session.current ? (
                  <span className="badge badge--accent">This device</span>
                ) : (
                  <span className="badge">Signed in</span>
                )}
                {session.ipAddress ? <span className="badge badge--mono">{session.ipAddress}</span> : null}
              </div>
              <p className="section__hint">Created {formatWhen(session.createdAt)}</p>
              <p className="section__hint">Last active {formatWhen(session.lastSeenAt)}</p>
              <p className="section__hint" style={{ fontFamily: "var(--font-mono)", overflowWrap: "anywhere" }}>
                {shortAgent(session.userAgent)}
              </p>
            </li>
          ))}
          {sessions.length > SESSION_PAGE_SIZE ? (
            <li style={{ padding: "10px 16px", borderBottom: "1px solid var(--line)" }}>
              <button type="button" className="btn btn--sm" onClick={() => setShowAllSessions((value) => !value)}>
                {showAllSessions ? "Show fewer sessions" : `Show all ${sessions.length} sessions`}
              </button>
              <span className="section__hint" style={{ marginLeft: 10 }}>
                Showing {visibleSessions.length} of {sessions.length}
              </span>
            </li>
          ) : null}
          {sessions.length === 0 ? (
            <li style={{ padding: "11px 16px" }} className="section__hint">
              No active sessions found.
            </li>
          ) : null}
        </ul>
      </section>
    </div>
  );
}
