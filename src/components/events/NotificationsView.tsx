"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CamerasResponse, NotificationsResponse } from "@/lib/api-types";
import { CAMERA_IDS } from "@/lib/cameras";
import { ApiError, api } from "@/lib/client-api";
import { eventTitle, type NotificationRecord } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { formatKolkataClock } from "@/lib/time-kolkata";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorBanner, SkeletonRows } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import { PriorityBadge } from "@/components/events/PriorityBadge";

/**
 * Notification history.
 *
 * One card per decision the hub actually made, with the alert that triggered it
 * and the rule that produced it. Nothing here is a live feed: this is the audit
 * trail of "sent / suppressed / failed", so the counters must always come from
 * the API's own stats for the chosen day.
 */
export function NotificationsView({ initialDate }: { initialDate: string }) {
  const [cameras, setCameras] = useState<Record<number, string>>({});
  const [date, setDate] = useState(initialDate);
  const [camera, setCamera] = useState("all");
  const [status, setStatus] = useState("all");
  const [priority, setPriority] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<NotificationsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void api<CamerasResponse>("/api/cameras")
      .then((body) => {
        const names: Record<number, string> = {};
        for (const item of body.cameras) names[item.id] = item.name;
        setCameras(names);
      })
      .catch(() => undefined);
  }, []);

  const load = useCallback(
    async (nextPage = 1) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({ date, camera, status, priority, page: String(nextPage), pageSize: "25" });
      try {
        const body = await api<NotificationsResponse>(`/api/notifications?${params.toString()}`);
        setData(body);
        setPage(nextPage);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) return;
        setError(caught instanceof Error ? caught.message : Messages.backendDown);
      } finally {
        setLoading(false);
      }
    },
    [date, camera, status, priority],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(1), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const name = (id: number) => cameras[id] ?? `Camera ${id}`;
  const filtersActive = camera !== "all" || status !== "all" || priority !== "all";
  const pageSize = data?.pageSize ?? 25;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const clearFilters = () => {
    setCamera("all");
    setStatus("all");
    setPriority("all");
  };

  const decisions = data ? data.stats.sent + data.stats.suppressed + data.stats.failed : 0;

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Investigate"
        title="Notification history"
        detail="Every notification decision this hub made. An event is stored whether or not it notified."
      />

      <div className="stat-row">
        <div className="stat stat--accent">
          <div className="stat__icon">
            <Icon name="send" />
          </div>
          <div>
            <div className="stat__label">Sent</div>{" "}
            <div className="stat__value">{data ? data.stats.sent : "—"}</div>
            <div className="stat__delta">Delivered to Telegram</div>
          </div>
        </div>
        <div className="stat">
          <div className="stat__icon">
            <Icon name="eye" />
          </div>
          <div>
            <div className="stat__label">Suppressed</div>{" "}
            <div className="stat__value">{data ? data.stats.suppressed : "—"}</div>
            <div className="stat__delta">Stored, not notified</div>
          </div>
        </div>
        <div className="stat stat--warn">
          <div className="stat__icon">
            <Icon name="alert" />
          </div>
          <div>
            <div className="stat__label">Failed</div>{" "}
            <div className="stat__value">{data ? data.stats.failed : "—"}</div>
            <div className="stat__delta">Delivery errors</div>
          </div>
        </div>
        <div className="stat stat--info">
          <div className="stat__icon">
            <Icon name="activity" />
          </div>
          <div>
            <div className="stat__label">Decisions</div>{" "}
            <div className="stat__value">{data ? decisions : "—"}</div>
            <div className="stat__delta">Sent + suppressed + failed</div>
          </div>
        </div>
      </div>

      <form
        className="filter-panel"
        onSubmit={(event) => {
          event.preventDefault();
          void load(1);
        }}
      >
        <div className="filter-grid">
          <label className="field">
            <span className="field__label">Date</span>
            <input
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              className="input input--mono"
              aria-label="Date"
              required
            />
          </label>
          <label className="field">
            <span className="field__label">Camera</span>
            <select
              value={camera}
              onChange={(event) => setCamera(event.target.value)}
              className="select"
              aria-label="Camera"
            >
              <option value="all">All cameras</option>
              {CAMERA_IDS.map((id) => (
                <option key={id} value={id}>
                  {name(id)}
                </option>
              ))}
            </select>
          </label>
          <label className="field">
            <span className="field__label">Status</span>
            <select
              value={status}
              onChange={(event) => setStatus(event.target.value)}
              className="select"
              aria-label="Status"
            >
              <option value="all">All</option>
              <option value="sent">Sent</option>
              <option value="suppressed">Suppressed</option>
              <option value="failed">Failed</option>
            </select>
          </label>
          <label className="field">
            <span className="field__label">Priority</span>
            <select
              value={priority}
              onChange={(event) => setPriority(event.target.value)}
              className="select"
              aria-label="Priority"
            >
              <option value="all">All</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="NORMAL">Normal</option>
              <option value="LOW">Low</option>
            </select>
          </label>
        </div>
        <div className="filter-panel__foot">
          <button type="submit" className="btn btn--primary">
            <Icon name="filter" className="icon icon-sm" />
            {loading ? "Loading..." : "Apply filters"}
          </button>
          <button type="button" className="btn btn--ghost" onClick={clearFilters}>
            Clear filters
          </button>
          <span className="section__hint" style={{ marginLeft: "auto" }}>
            {data ? `${total} decision${total === 1 ? "" : "s"} in this period` : "Reading the hub's own records"}
          </span>
        </div>
      </form>

      {error ? <ErrorBanner message={error} onRetry={() => void load(page)} /> : null}

      {!error ? (
        <section className="section" aria-label="Notification decisions" aria-busy={loading}>
          <p className="sr-only" role="status" aria-live="polite">
            {loading ? "Loading notification decisions." : `${total} notification decisions${filtersActive ? " match the filters" : " in this period"}.`}
          </p>
          <div className="section__head">
            <h2 className="section__title">Decisions</h2>
            <span className="section__hint">{filtersActive ? "Filtered" : "All rules and cooldowns"}</span>
          </div>

          {loading && !data ? <SkeletonRows rows={4} /> : null}

          {!loading && data && data.notifications.length === 0 ? (
            <EmptyState
              icon="bell"
              title={Messages.noNotifications}
              detail="Every stored event appears here whether it was sent, suppressed by a rule or failed to deliver. Try another date or clear the filters."
              action={
                filtersActive ? (
                  <button type="button" className="btn" onClick={clearFilters}>
                    Clear filters
                  </button>
                ) : undefined
              }
            />
          ) : null}

          <ul className="event-list">
            {data?.notifications.map((record) => (
              <li key={record.id}>
                <NotificationRow record={record} cameraName={name(record.cameraId)} />
              </li>
            ))}
          </ul>

          {data && total > pageSize ? (
            <div className="pagination">
              <span className="pagination__count">
                Page {page} of {totalPages} · {pageSize} per page
              </span>
              <span className="toolbar__spacer" />
              <button
                type="button"
                className="icon-btn"
                aria-label="Previous page"
                disabled={page <= 1}
                onClick={() => void load(page - 1)}
              >
                <Icon name="chevronLeft" className="icon icon-sm" />
              </button>
              <button
                type="button"
                className="icon-btn"
                aria-label="Next page"
                disabled={page * pageSize >= total}
                onClick={() => void load(page + 1)}
              >
                <Icon name="chevronRight" className="icon icon-sm" />
              </button>
              <span className="section__hint" style={{ marginLeft: 4 }}>
                {total} total
              </span>
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * Status is encoded with a border, a distinct glyph, and a text label, so it is
 * never conveyed by colour alone. The words `Sent` / `Failed` are part of the
 * tested contract; the glyph is decorative and hidden from screen readers.
 */
const STATUS_STYLE: Record<string, { className: string; glyph: string; label: string }> = {
  sent: { className: "badge badge--online", glyph: "✓", label: "Sent" },
  suppressed: { className: "badge", glyph: "⊘", label: "Suppressed" },
  failed: { className: "badge badge--danger", glyph: "!", label: "Failed" },
};

function StatusBadge({ status }: { status: string }) {
  const style = STATUS_STYLE[status] ?? { className: "badge", glyph: "•", label: status };
  return (
    <span className={style.className}>
      <span aria-hidden="true">{style.glyph}</span>
      {style.label}
    </span>
  );
}

function NotificationRow({ record, cameraName }: { record: NotificationRecord; cameraName: string }) {
  const label = record.eventType ? eventTitle(record.eventType, record.classification ?? null) : "Event";
  const when = record.eventTimestamp
    ? formatKolkataClock(new Date(record.eventTimestamp))
    : formatKolkataClock(new Date(record.createdAt));

  return (
    <article className="card card--pad">
      <div style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8 }}>
        <span className="badge badge--mono">{when}</span>
        <span style={{ fontSize: "var(--fs-13)", fontWeight: 600 }}>{label}</span>
        <span className="section__hint">{cameraName}</span>
        <PriorityBadge priority={record.priority} />
        <span style={{ marginLeft: "auto" }}>
          <StatusBadge status={record.status} />
        </span>
      </div>
      <div className="section__hint" style={{ marginTop: 6 }}>
        Rule: {record.ruleName ?? "No rule matched"}
        {record.reason ? ` · ${record.reason}` : ""}
      </div>
      {record.eventId ? (
        <Link
          href={`/events/${record.eventId}`}
          style={{
            marginTop: 8,
            display: "inline-flex",
            alignItems: "center",
            gap: 4,
            minHeight: 24,
            padding: "3px 0",
            fontSize: "var(--fs-12)",
            color: "var(--accent)",
          }}
        >
          Open event
          <Icon name="arrowRight" className="icon icon-sm" />
        </Link>
      ) : null}
    </article>
  );
}
