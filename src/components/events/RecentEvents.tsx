"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { EventStatsResponse } from "@/lib/api-types";
import type { CctvEvent } from "@/lib/events";
import { eventTitle } from "@/lib/events";
import { api } from "@/lib/client-api";
import { formatKolkataClock } from "@/lib/time-kolkata";
import { PriorityBadge } from "@/components/events/PriorityBadge";

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
 * Recent Security Events. Only HIGH and CRITICAL priority events are requested,
 * so the dashboard never pulls the whole event table: the server does the
 * filtering and returns a short list.
 */
export function RecentEvents() {
  const [events, setEvents] = useState<CctvEvent[]>([]);
  const [stats, setStats] = useState<EventStatsResponse | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const reload = useCallback(async () => {
    const [recent, summary] = await Promise.all([
      api<{ events: CctvEvent[] }>("/api/events/recent?limit=5&important=true"),
      api<EventStatsResponse>("/api/events/stats?range=today"),
    ]);
    setEvents(recent.events);
    setStats(summary);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void reload().catch(() => undefined), 0);
    const onEvent = () => void reload().catch(() => undefined);
    window.addEventListener("cctv-event", onEvent);
    return () => {
      clearTimeout(timer);
      window.removeEventListener("cctv-event", onEvent);
    };
  }, [reload]);

  return (
    <section className="mt-6 min-w-0 rounded-xl border border-line bg-card p-4" aria-label="Recent security events">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-sm font-semibold">Recent security events</h2>
        <div className="flex gap-3">
          <Link href="/events/stats" className="text-sm text-teal">Statistics</Link>
          <Link href="/events" className="text-sm text-teal">All events</Link>
        </div>
      </div>
      {stats ? (
        <p className="mt-2 text-sm text-muted">
          Today: {stats.total} events. Person {stats.person}. Vehicle {stats.vehicle}. Motion {stats.motion}.
          {stats.critical > 0 ? ` Critical ${stats.critical}.` : ""}
        </p>
      ) : null}
      {events.length === 0 ? <p className="mt-3 text-sm text-muted">No important events today.</p> : null}
      <ul className="mt-3 flex flex-col gap-2">
        {events.map((event) => (
          <li key={event.id}>
            <Link
              href={`/events/${event.id}`}
              className="flex items-center gap-3 rounded-lg px-1 py-1 text-sm hover:bg-white/5"
            >
              <span className="min-w-0 flex-1 truncate">{eventTitle(event.type, event.classification)}</span>
              <PriorityBadge priority={event.priority} />
              <span className="text-muted">Camera {event.cameraId}</span>
              <span className="text-xs text-muted" title={formatKolkataClock(new Date(event.timestamp))}>
                {relativeTime(event.timestamp, now)}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}