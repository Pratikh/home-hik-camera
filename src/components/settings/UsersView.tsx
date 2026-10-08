"use client";

import { FormEvent, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { PageIntro } from "@/components/ui/States";

type UserRow = { id: string; username: string; role: "ADMIN" | "VIEWER"; enabled: boolean };

export function UsersView() {
  const [users, setUsers] = useState<UserRow[]>([]);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [role, setRole] = useState<"ADMIN" | "VIEWER">("VIEWER");
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const body = await api<{ users: UserRow[] }>("/api/users");
    setUsers(body.users);
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

  return (
    <div className="min-w-0">
      <PageIntro title="Users" detail="Administrators manage the hub. Viewers can watch live video, playback, and events." />
      {error ? <p className="mb-3 text-sm text-warn" role="alert">{error}</p> : null}
      <ul className="mb-4 flex flex-col gap-2">
        {users.map((user) => (
          <li key={user.id} className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-card px-3 py-3 text-sm">
            <span className="min-w-0 flex-1 font-medium">{user.username}</span>
            <span className="text-muted">{user.role}</span>
            <span className={user.enabled ? "text-online" : "text-offline"}>{user.enabled ? "Enabled" : "Disabled"}</span>
            <button type="button" className="h-10 rounded-lg border border-line px-3" onClick={() => void update(user.id, { enabled: !user.enabled })}>{user.enabled ? "Disable" : "Enable"}</button>
            <button type="button" className="h-10 rounded-lg border border-line px-3" onClick={() => void update(user.id, { role: user.role === "ADMIN" ? "VIEWER" : "ADMIN" })}>Switch role</button>
            <button type="button" className="h-10 rounded-lg border border-line px-3" onClick={() => void api(`/api/users/${user.id}`, { method: "DELETE" }).then(() => reload()).catch((caught: unknown) => setError(caught instanceof Error ? caught.message : Messages.backendDown))}>Delete</button>
          </li>
        ))}
      </ul>
      <form onSubmit={(event) => void create(event)} className="grid max-w-xl gap-3 rounded-xl border border-line bg-card p-4">
        <h2 className="text-sm font-semibold">Create user</h2>
        <input value={username} onChange={(event) => setUsername(event.target.value)} placeholder="Username" aria-label="Username" className="h-11 rounded-lg border border-line bg-bg px-3" required />
        <input value={password} onChange={(event) => setPassword(event.target.value)} placeholder="Password" aria-label="Password" type="password" className="h-11 rounded-lg border border-line bg-bg px-3" required />
        <select value={role} onChange={(event) => setRole(event.target.value === "ADMIN" ? "ADMIN" : "VIEWER")} aria-label="Role" className="h-11 rounded-lg border border-line bg-bg px-3">
          <option value="VIEWER">Viewer</option>
          <option value="ADMIN">Admin</option>
        </select>
        <button type="submit" className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]">Create user</button>
      </form>
    </div>
  );
}
