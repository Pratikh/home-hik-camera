"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import { ApiError, api, navigate } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { PageIntro } from "@/components/ui/States";

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
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return iso;
  return date.toLocaleString();
}

function shortAgent(value: string | null): string {
  if (!value) return "Unknown browser";
  return value.length > 90 ? `${value.slice(0, 87)}...` : value;
}

export function AccountView() {
  const [account, setAccount] = useState<SessionResponse | null>(null);
  const [sessions, setSessions] = useState<SessionRow[]>([]);
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

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
    <div className="min-w-0 max-w-2xl">
      <PageIntro
        title="Account"
        detail="Change your own password and manage the browsers that are signed in as you."
      />

      {account ? (
        <p className="mb-4 text-sm text-muted">
          Signed in as <span className="font-medium text-ink">{account.username}</span> ({account.role})
        </p>
      ) : null}
      {error ? <p className="mb-3 text-sm text-warn" role="alert">{error}</p> : null}
      {notice ? <p className="mb-3 text-sm text-online" role="status">{notice}</p> : null}

      <form onSubmit={(event) => void changePassword(event)} className="mb-6 grid gap-3 rounded-xl border border-line bg-card p-4">
        <h2 className="text-sm font-semibold">Change password</h2>
        <p className="text-xs text-muted">
          Changing it signs out every other session, including any device you no longer use.
        </p>
        <input
          value={currentPassword}
          onChange={(event) => setCurrentPassword(event.target.value)}
          placeholder="Current password"
          aria-label="Current password"
          type="password"
          autoComplete="current-password"
          className="h-11 rounded-lg border border-line bg-bg px-3"
          required
        />
        <input
          value={newPassword}
          onChange={(event) => setNewPassword(event.target.value)}
          placeholder="New password (at least 8 characters)"
          aria-label="New password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          className="h-11 rounded-lg border border-line bg-bg px-3"
          required
        />
        <input
          value={confirmPassword}
          onChange={(event) => setConfirmPassword(event.target.value)}
          placeholder="Confirm new password"
          aria-label="Confirm new password"
          type="password"
          autoComplete="new-password"
          minLength={8}
          maxLength={200}
          className="h-11 rounded-lg border border-line bg-bg px-3"
          required
        />
        <button
          type="submit"
          disabled={busy}
          className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f] disabled:opacity-60"
        >
          Change password
        </button>
      </form>

      <section className="rounded-xl border border-line bg-card p-4 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-sm font-semibold">Signed-in sessions ({sessions.length})</h2>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void revoke("others")}
              disabled={busy || sessions.length < 2}
              className="h-10 rounded-lg border border-line px-3 text-xs disabled:opacity-60"
            >
              Sign out other sessions
            </button>
            <button
              type="button"
              onClick={() => void revoke("all")}
              disabled={busy}
              className="h-10 rounded-lg border border-warn/50 px-3 text-xs text-warn disabled:opacity-60"
            >
              Sign out everywhere
            </button>
          </div>
        </div>
        <ul className="mt-3 space-y-2">
          {sessions.map((session) => (
            <li key={session.id} className="rounded-lg border border-line bg-bg px-3 py-2">
              <p className="text-xs">
                {session.current ? <span className="text-teal">This device</span> : <span className="text-muted">Signed in</span>}
                {session.ipAddress ? <span className="text-muted"> · {session.ipAddress}</span> : null}
              </p>
              <p className="mt-1 text-xs text-muted">Created {formatWhen(session.createdAt)}</p>
              <p className="text-xs text-muted">Last active {formatWhen(session.lastSeenAt)}</p>
              <p className="mt-1 break-all font-mono text-[11px] text-muted">{shortAgent(session.userAgent)}</p>
            </li>
          ))}
          {sessions.length === 0 ? <li className="text-muted">No active sessions found.</li> : null}
        </ul>
      </section>
    </div>
  );
}
