"use client";

import { useCallback, useEffect, useState } from "react";
import type { CamerasResponse, EventStatsResponse } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import { isStatRange, STAT_RANGES, type StatRange } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { PageIntro } from "@/components/ui/States";

const RANGE_LABEL: Record<StatRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

export function EventStatsView() {
  const [range, setRange] = useState<StatRange>("today");
  const [stats, setStats] = useState<EventStatsResponse | null>(null);
  const [cameras, setCameras] = useState<Record<number, string>>({});
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

  const load = useCallback(async (next: StatRange) => {
    setLoading(true);
    setError(null);
    try {
      setStats(await api<EventStatsResponse>(`/api/events/stats?range=${next}`));
    } catch (caught) {
      if (caught instanceof ApiError && caught.status === 401) return;
      setError(caught instanceof Error ? caught.message : Messages.backendDown);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load("today"), 0);
    return () => clearTimeout(timer);
  }, [load]);

  function choose(next: string) {
    if (!isStatRange(next)) return;
    setRange(next);
    void load(next);
  }

  const name = (id: number) => cameras[id] ?? `Camera ${id}`;
  const maxCamera = stats ? Math.max(1, ...stats.cameras.map((item) => item.total)) : 1;

  return (
    <div className="min-w-0 max-w-3xl">
      <PageIntro title="Event statistics" detail="Counts from this hub's own event rows, in India time." />

      <div className="mb-4 flex flex-wrap gap-2" role="group" aria-label="Statistics range">
        {STAT_RANGES.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={range === item}
            onClick={() => choose(item)}
            className={`h-10 rounded-lg border px-3 text-sm ${
              range === item ? "border-teal text-teal" : "border-line text-muted"
            }`}
          >
            {RANGE_LABEL[item]}
          </button>
        ))}
      </div>

      {error ? <p className="mb-3 text-sm text-warn" role="alert">{error}</p> : null}
      {loading && !stats ? <p className="text-sm text-muted">Loading...</p> : null}

      {stats ? (
        <>
          <section className="rounded-xl border border-line bg-card p-4" aria-label="Totals">
            <h2 className="text-sm font-semibold">{RANGE_LABEL[range]}</h2>
            <dl className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-3">
              <Metric label="Total" value={stats.total} />
              <Metric label="Person" value={stats.person} />
              <Metric label="Vehicle" value={stats.vehicle} />
              <Metric label="Motion" value={stats.motion} />
              <Metric label="High priority" value={stats.high} />
              <Metric label="Critical" value={stats.critical} />
            </dl>
            <p className="mt-3 text-xs text-muted">
              {stats.start.slice(0, 10)} onwards, India time. Motion counts unclassified motion, so person and
              vehicle events are not counted twice.
            </p>
          </section>

          <section className="mt-4 rounded-xl border border-line bg-card p-4" aria-label="Camera activity">
            <h2 className="text-sm font-semibold">Camera activity</h2>
            {stats.cameras.length === 0 ? (
              <p className="mt-2 text-sm text-muted">No events in this period.</p>
            ) : (
              <ul className="mt-3 flex flex-col gap-3">
                {stats.cameras.map((item) => (
                  <li key={item.cameraId}>
                    <div className="flex items-center justify-between text-sm">
                      <span>{name(item.cameraId)}</span>
                      <span className="font-mono tabular-nums text-muted">{item.total}</span>
                    </div>
                    <div className="mt-1 h-2 overflow-hidden rounded-full bg-white/5">
                      <span
                        className="block h-full rounded-full bg-teal"
                        style={{ width: `${Math.round((item.total / maxCamera) * 100)}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </>
      ) : null}
    </div>
  );
}

function Metric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-line bg-bg px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums">{value}</dd>
    </div>
  );
}