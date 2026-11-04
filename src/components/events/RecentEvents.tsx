"use client";

import Link from "next/link";
import type { EventStatsResponse } from "@/lib/api-types";
import type { CctvEvent } from "@/lib/events";
import { eventTitle } from "@/lib/events";
import { formatKolkataClock } from "@/lib/time-kolkata";
import { PriorityBadge } from "@/components/events/PriorityBadge";
import { Icon } from "@/components/ui/Icon";

function relativeTime(timestamp: string, now: number): string {
  const ms = now - new Date(timestamp).getTime();
  if (!Number.isFinite(ms)) return "";
  const minutes = Math.floor(ms / 60000);
  if (minutes < 1) return "just now";
  if (minutes === 1) return "1 minute ago";
  if (minutes < 60) return `${minutes} minutes ago`;
  const hours = Math.floor(minutes / 60);
  if (hours === 1) return "1 hour ago";
  if (hours < 24) return `${hours} hours ago`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "yesterday" : `${days} days ago`;
}

/**
 * Recent Security Events rail on the dashboard.
 *
 * Presentational: the dashboard owns the fetch so the KPI strip and this list
 * share one polled response. Only HIGH and CRITICAL priority events are shown —
 * the server does the filtering, the browser never downloads the event table.
 */
export function RecentEvents({
  events,
  stats,
  cameraNames,
  now,
}: {
  events: CctvEvent[];
  stats: EventStatsResponse | null;
  cameraNames: Record<number, string>;
  now: number;
}) {
  const name = (id: number) => cameraNames[id] ?? `Camera ${id}`;
  return (
    <section className="card" aria-label="Recent security events">
      <div className="card__head">
        <div className="card__title">
          <Icon name="zap" className="icon icon-sm" />
          Recent security events
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <Link href="/events/stats" className="btn btn--sm btn--ghost">
            Statistics
          </Link>
          <Link href="/events" className="btn btn--sm btn--ghost">
            All events
          </Link>
        </div>
      </div>
      {stats ? (
        <div className="rail-row rail-summary" style={{ gap: 6, flexWrap: "wrap" }}>
          <span className="section__hint">
            Today: <strong className="text-ink">{stats.total}</strong> events · Person {stats.person} · Vehicle{" "}
            {stats.vehicle} · Motion {stats.motion}
            {stats.critical > 0 ? ` · Critical ${stats.critical}` : ""}
          </span>
        </div>
      ) : null}
      {events.length === 0 ? (
        <p className="section__hint" style={{ padding: "14px 16px" }}>
          No important events today.
        </p>
      ) : (
        <div className="rail-list">
          {events.map((event) => (
            <Link key={event.id} href={`/events/${event.id}`} className="rail-row">
              <span className="rail-row__time">{formatKolkataClock(new Date(event.timestamp)).slice(0, 5)}</span>
              <span className="rail-row__main">
                <span className="rail-row__title">{eventTitle(event.type, event.classification)}</span>
                <span className="rail-row__sub">
                  {name(event.cameraId)} · {relativeTime(event.timestamp, now)}
                </span>
              </span>
              <span className="rail-row__flag">
                <PriorityBadge priority={event.priority} />
              </span>
            </Link>
          ))}
        </div>
      )}
      <div className="card__foot" style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <span className="section__hint">HIGH + CRITICAL only</span>
        <Link href="/events" className="btn btn--sm">
          Open timeline
          <Icon name="arrowRight" className="icon icon-sm" />
        </Link>
      </div>
    </section>
  );
}
