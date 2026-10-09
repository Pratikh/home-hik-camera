"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CamerasResponse, NotificationsResponse } from "@/lib/api-types";
import { CAMERA_IDS } from "@/lib/cameras";
import { ApiError, api } from "@/lib/client-api";
import { eventTitle, type NotificationRecord } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { formatKolkataClock } from "@/lib/time-kolkata";
import { PageIntro } from "@/components/ui/States";
import { PriorityBadge } from "@/components/events/PriorityBadge";

const STATUS_TONE: Record<string, string> = {
  sent: "text-online",
  suppressed: "text-muted",
  failed: "text-warn",
};

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

  return (
    <div className="min-w-0">
      <PageIntro
        title="Notification history"
        detail="Every notification decision this hub made. An event is stored whether or not it notified."
      />

      {data ? (
        <div className="mb-4 flex flex-wrap gap-4 text-sm">
          <span className="text-muted">Sent <strong className="text-online">{data.stats.sent}</strong></span>
          <span className="text-muted">Suppressed <strong className="text-ink">{data.stats.suppressed}</strong></span>
          <span className="text-muted">Failed <strong className="text-warn">{data.stats.failed}</strong></span>
        </div>
      ) : null}

      <form
        className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4"
        onSubmit={(event) => {
          event.preventDefault();
          void load(1);
        }}
      >
        <label className="text-sm">
          <span className="mb-1 block text-muted">Date</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Date" required />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Camera</span>
          <select value={camera} onChange={(event) => setCamera(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Camera">
            <option value="all">All cameras</option>
            {CAMERA_IDS.map((id) => <option key={id} value={id}>{name(id)}</option>)}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Status</span>
          <select value={status} onChange={(event) => setStatus(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Status">
            <option value="all">All</option>
            <option value="sent">Sent</option>
            <option value="suppressed">Suppressed</option>
            <option value="failed">Failed</option>
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-muted">Priority</span>
          <select value={priority} onChange={(event) => setPriority(event.target.value)} className="h-11 w-full rounded-lg border border-line bg-card px-3" aria-label="Priority">
            <option value="all">All</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="NORMAL">Normal</option>
            <option value="LOW">Low</option>
          </select>
        </label>
        <button type="submit" className="h-11 rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f] sm:col-span-2 xl:col-span-4 xl:w-fit">
          {loading ? "Loading..." : "Apply filters"}
        </button>
      </form>

      {error ? <p className="mb-3 text-sm text-warn" role="alert">{error}</p> : null}
      {!loading && data && data.notifications.length === 0 ? (
        <p className="text-sm text-muted">{Messages.noNotifications}</p>
      ) : null}

      <ul className="flex flex-col gap-2">
        {data?.notifications.map((record) => (
          <li key={record.id}>
            <NotificationRow record={record} cameraName={name(record.cameraId)} />
          </li>
        ))}
      </ul>

      {data && data.total > data.pageSize ? (
        <div className="mt-3 flex items-center gap-2">
          <button type="button" className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40" disabled={page <= 1} onClick={() => void load(page - 1)}>Previous</button>
          <span className="text-xs text-muted">Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}</span>
          <button type="button" className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40" disabled={page * data.pageSize >= data.total} onClick={() => void load(page + 1)}>Next</button>
        </div>
      ) : null}
    </div>
  );
}

function NotificationRow({ record, cameraName }: { record: NotificationRecord; cameraName: string }) {
  const label = record.eventType ? eventTitle(record.eventType, record.classification ?? null) : "Event";
  const when = record.eventTimestamp ? formatKolkataClock(new Date(record.eventTimestamp)) : formatKolkataClock(new Date(record.createdAt));
  return (
    <article className="rounded-xl border border-line bg-card px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-mono text-xs tabular-nums text-muted">{when}</span>
        <span className="text-sm font-medium">{label}</span>
        <span className="text-xs text-muted">{cameraName}</span>
        <PriorityBadge priority={record.priority} />
        <span className={`ml-auto text-xs font-medium uppercase ${STATUS_TONE[record.status] ?? "text-muted"}`}>
          {record.status}
        </span>
      </div>
      <p className="mt-1 text-xs text-muted">
        Rule: {record.ruleName ?? "No rule matched"}
        {record.reason ? ` · ${record.reason}` : ""}
      </p>
      {record.eventId ? (
        <Link href={`/events/${record.eventId}`} className="mt-2 inline-block text-xs text-teal">
          Open event
        </Link>
      ) : null}
    </article>
  );
}