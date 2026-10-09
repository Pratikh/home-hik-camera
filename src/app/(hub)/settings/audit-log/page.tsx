"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { formatKolkataDateTimeFromIso } from "@/lib/time-kolkata";
import { PageIntro } from "@/components/ui/States";

type Log = { id: string; username: string | null; action: string; resource: string | null; createdAt: string };
type AuditResponse = { logs: Log[]; total: number; page: number; pageSize: number };

export default function AuditLogPage() {
  const [logs, setLogs] = useState<Log[]>([]);
  const [action, setAction] = useState("");
  const [user, setUser] = useState("");
  const [date, setDate] = useState("");
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [pageSize, setPageSize] = useState(25);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(
    async (nextPage = 1, filters?: { action?: string; user?: string; date?: string }) => {
      setLoading(true);
      setError(null);
      const chosen = { action, user, date, ...filters };
      const params = new URLSearchParams({ page: String(nextPage), pageSize: "25" });
      if (chosen.action) params.set("action", chosen.action);
      if (chosen.user) params.set("user", chosen.user);
      if (chosen.date) params.set("date", chosen.date);
      try {
        const body = await api<AuditResponse>(`/api/audit?${params.toString()}`);
        setLogs(body.logs);
        setTotal(body.total);
        setPageSize(body.pageSize);
        setPage(body.page);
        setLoaded(true);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) return;
        setError(caught instanceof Error ? caught.message : Messages.backendDown);
      } finally {
        setLoading(false);
      }
    },
    [action, user, date],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(1), 0);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="min-w-0">
      <PageIntro title="Audit log" detail="Sign-ins and account changes, in India time. Passwords and DVR credentials are not recorded." />
      <form
        className="mb-4 flex flex-wrap gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          void load(1);
        }}
      >
        <input value={user} onChange={(event) => setUser(event.target.value)} aria-label="User" placeholder="User" className="h-11 rounded-lg border border-line bg-card px-3" />
        <input value={action} onChange={(event) => setAction(event.target.value)} aria-label="Action" placeholder="Action" className="h-11 rounded-lg border border-line bg-card px-3" />
        <input type="date" value={date} onChange={(event) => setDate(event.target.value)} aria-label="Date" className="h-11 rounded-lg border border-line bg-card px-3" />
        <button type="submit" className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f]">Filter</button>
      </form>

      {loading && !loaded ? <p className="text-sm text-muted">Loading audit log...</p> : null}
      {error ? (
        <div className="mt-2 flex items-center gap-3 text-sm text-warn" role="alert">
          <span>Unable to load audit log.</span>
          <button type="button" onClick={() => void load(page)} className="rounded-lg border border-line px-3 py-1">Retry</button>
        </div>
      ) : null}
      {!loading && !error && logs.length === 0 ? <p className="text-sm text-muted">No audit entries yet.</p> : null}

      <ul className="flex flex-col gap-2">
        {logs.map((log) => (
          <li key={log.id} className="rounded-xl border border-line bg-card px-3 py-3 text-sm">
            <span className="font-medium">{log.action}</span>
            <span className="text-muted"> {log.username ?? "unknown"} {log.resource ?? ""}</span>
            {/* Rendered in India time, matching the rest of the app. */}
            <time dateTime={log.createdAt} className="mt-1 block font-mono text-xs text-muted">
              {formatKolkataDateTimeFromIso(log.createdAt)}
            </time>
          </li>
        ))}
      </ul>

      {total > pageSize ? (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40" disabled={page <= 1} onClick={() => void load(page - 1)}>Previous</button>
          <span className="text-xs text-muted">Page {page} of {Math.max(1, Math.ceil(total / pageSize))} · {total} entries</span>
          <button type="button" className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40" disabled={page * pageSize >= total} onClick={() => void load(page + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  );
}