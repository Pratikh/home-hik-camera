"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/client-api";
import { PageIntro } from "@/components/ui/States";

type Log = { id: string; username: string | null; action: string; resource: string | null; createdAt: string };

export default function AuditLogPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [action, setAction] = useState("");
  const [user, setUser] = useState("");
  const [date, setDate] = useState("");

  function load(next?: { action?: string; user?: string; date?: string }) {
    const params = new URLSearchParams();
    const chosen = { action, user, date, ...next };
    if (chosen.action) params.set("action", chosen.action);
    if (chosen.user) params.set("user", chosen.user);
    if (chosen.date) params.set("date", chosen.date);
    void api<{ logs: Log[] }>(`/api/audit?${params.toString()}`).then((body) => setLogs(body.logs)).catch(() => undefined);
  }

  useEffect(() => {
    const timer = setTimeout(() => {
      void api<{ logs: Log[] }>("/api/audit").then((body) => setLogs(body.logs)).catch(() => undefined);
    }, 0);
    return () => clearTimeout(timer);
  }, []);

  return (
    <div className="min-w-0">
      <PageIntro title="Audit log" detail="Sign-ins and account changes. Passwords and DVR credentials are not recorded." />
      <form className="mb-4 flex flex-wrap gap-2" onSubmit={(event) => { event.preventDefault(); load(); }}>
        <input value={user} onChange={(event) => setUser(event.target.value)} aria-label="User" placeholder="User" className="h-11 rounded-lg border border-line bg-card px-3" />
        <input value={action} onChange={(event) => setAction(event.target.value)} aria-label="Action" placeholder="Action" className="h-11 rounded-lg border border-line bg-card px-3" />
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Date" className="h-11 rounded-lg border border-line bg-card px-3" />
        <button type="submit" className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]">Filter</button>
      </form>
      <ul className="flex flex-col gap-2">
        {logs.map((log) => (
          <li key={log.id} className="rounded-xl border border-line bg-card px-3 py-3 text-sm">
            <span className="font-medium">{log.action}</span>
            <span className="text-muted"> {log.username ?? "unknown"} {log.resource ?? ""}</span>
            <span className="mt-1 block font-mono text-xs text-muted">{log.createdAt}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
