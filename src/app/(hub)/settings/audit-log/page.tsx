"use client";

import { useCallback, useEffect, useState } from "react";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { formatKolkataDateTimeFromIso } from "@/lib/time-kolkata";
import { Icon } from "@/components/ui/Icon";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState } from "@/components/ui/States";

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

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div style={{ display: "grid", gap: 14, minWidth: 0 }}>
      <PageHeader
        eyebrow="Administration"
        title="Audit log"
        detail="Sign-ins and account changes, in India time. Passwords and DVR credentials are not recorded."
        actions={
          <>
            <span className="pill">
              <span className={`dot ${total > 0 ? "dot--online" : "dot--idle"}`} />
              {total > 0 ? `${total} entr${total === 1 ? "y" : "ies"}` : "No entries yet"}
            </span>
          </>
        }
      />

      <form
        className="filter-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void load(1);
        }}
      >
        <div className="form-grid form-grid--3">
          <div className="field">
            <label className="field__label" htmlFor="audit-user">
              User
            </label>
            <input
              id="audit-user"
              className="input"
              value={user}
              onChange={(event) => setUser(event.target.value)}
              placeholder="home"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="audit-action">
              Action
            </label>
            <input
              id="audit-action"
              className="input input--mono"
              value={action}
              onChange={(event) => setAction(event.target.value)}
              placeholder="LOGIN"
              autoComplete="off"
            />
          </div>
          <div className="field">
            <label className="field__label" htmlFor="audit-date">
              Date
            </label>
            <input
              id="audit-date"
              className="input input--mono"
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          </div>
        </div>
        <div className="filter-panel__foot">
          <button type="submit" className="btn btn--primary">
            <Icon name="filter" className="icon icon-sm" />
            Filter
          </button>
          <span className="section__hint">
            Filter by exact username, action code, or a single day in Asia/Kolkata.
          </span>
        </div>
      </form>

      {loading && !loaded ? <p className="section__hint">Loading audit log...</p> : null}

      {error ? (
        <div className="notice notice--danger" role="alert" style={{ alignItems: "center" }}>
          <Icon name="alert" />
          <span>Unable to load audit log.</span>
          <button type="button" onClick={() => void load(page)} className="btn btn--sm" style={{ marginLeft: "auto" }}>
            Retry
          </button>
        </div>
      ) : null}

      <section className="card" style={{ minWidth: 0 }}>
        <div className="card__head">
          <h2 className="card__title">
            <Icon name="file" className="icon icon-sm" />
            Audit log
          </h2>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span className="badge badge--mono">Asia/Kolkata</span>
            <span className="status">
              <span className={`dot ${loading ? "dot--warn" : "dot--online"}`} aria-hidden="true" />
              <span className="status__text">{loading ? "Loading" : "Live"}</span>
            </span>
          </div>
        </div>

        {!error && !loading && logs.length === 0 ? (
          <div className="card__body">
            <EmptyState
              icon="file"
              title="No audit entries yet."
              detail="Sign-ins and account changes appear here as soon as they happen."
            />
          </div>
        ) : (
          <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
            {logs.map((log) => (
              <li
                key={log.id}
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  gap: 12,
                  flexWrap: "wrap",
                  padding: "10px 14px",
                  borderTop: "1px solid var(--line)",
                }}
              >
                <time
                  dateTime={log.createdAt}
                  className="num"
                  style={{ flex: "none", minWidth: 168, fontSize: "var(--fs-12)", color: "var(--muted)" }}
                >
                  {formatKolkataDateTimeFromIso(log.createdAt)}
                </time>
                <span className="badge badge--mono">{log.action}</span>
                <span style={{ fontSize: "var(--fs-12)", fontWeight: 600 }}>{log.username ?? "unknown"}</span>
                <span className="section__hint" style={{ minWidth: 0 }}>
                  {log.resource ?? "—"}
                </span>
              </li>
            ))}
          </ul>
        )}

        <div className="card__foot">
          <div className="pagination" style={{ marginTop: 0, justifyContent: "space-between", flexWrap: "wrap" }}>
            <span className="pagination__count">
              {total > 0
                ? `Showing ${(page - 1) * pageSize + 1}–${Math.min(page * pageSize, total)} of ${total} entries`
                : "No entries"}
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <button
                type="button"
                className="btn btn--sm"
                disabled={page <= 1 || loading}
                onClick={() => void load(page - 1)}
              >
                Previous
              </button>
              <span className="badge badge--mono">
                Page {page} of {pageCount}
              </span>
              <button
                type="button"
                className="btn btn--sm"
                disabled={page * pageSize >= total || loading}
                onClick={() => void load(page + 1)}
              >
                Next
              </button>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
