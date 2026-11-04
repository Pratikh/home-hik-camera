"use client";

import { useCallback, useEffect, useState } from "react";
import type { CamerasResponse, EventStatsResponse } from "@/lib/api-types";
import { ApiError, api } from "@/lib/client-api";
import { isStatRange, STAT_RANGES, type StatRange } from "@/lib/events";
import { Messages } from "@/lib/messages";
import { formatKolkataDateTimeFromIso } from "@/lib/time-kolkata";
import { PageHeader } from "@/components/ui/PageHeader";
import { ErrorBanner } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";

const RANGE_LABEL: Record<StatRange, string> = {
  today: "Today",
  yesterday: "Yesterday",
  "7d": "Last 7 days",
  "30d": "Last 30 days",
};

/** "04 Nov 2026, 00:00:00" → "04 Nov 2026". */
function dayLabel(iso: string): string {
  const formatted = formatKolkataDateTimeFromIso(iso);
  return formatted.split(",")[0] ?? formatted;
}

/**
 * Event statistics.
 *
 * A count-only view over the hub's own event rows: no charts library, no second
 * endpoint. The range control maps 1:1 to the `/api/events/stats?range=` values
 * the API already supports, and every number on the page comes from that single
 * response.
 */
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
  const classified = stats ? stats.person + stats.vehicle : 0;
  const windowLabel = stats
    ? stats.days > 1
      ? `${dayLabel(stats.start)} → ${dayLabel(stats.end)}`
      : dayLabel(stats.start)
    : "";

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Investigate"
        title="Event statistics"
        detail="Counts from this hub's own event rows, in India time. Motion counts unclassified motion, so person and vehicle events are not counted twice."
        actions={
          <div className="seg" role="group" aria-label="Statistics range">
            {STAT_RANGES.map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={range === item}
                onClick={() => choose(item)}
                className="seg__item"
              >
                {RANGE_LABEL[item]}
              </button>
            ))}
          </div>
        }
      />

      {error ? <ErrorBanner message={error} onRetry={() => void load(range)} /> : null}

      {loading && !stats ? (
        <div aria-hidden="true">
          <div className="stat-row">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="skeleton" style={{ height: 74 }} />
            ))}
          </div>
          <div className="grid-2">
            <div className="skeleton" style={{ height: 190 }} />
            <div className="skeleton" style={{ height: 190 }} />
          </div>
        </div>
      ) : null}

      {stats ? (
        <>
          <div className="stat-row">
            <div className="stat stat--accent">
              <div className="stat__icon">
                <Icon name="events" />
              </div>
              <div>
                <div className="stat__label">Total events</div>
                <div className="stat__value">{stats.total}</div>
                <div className="stat__delta">
                  <strong>{RANGE_LABEL[range]}</strong> · {windowLabel} IST
                </div>
              </div>
            </div>
            <div className="stat stat--info">
              <div className="stat__icon">
                <Icon name="user" />
              </div>
              <div>
                <div className="stat__label">Person</div>
                <div className="stat__value">{stats.person}</div>
                <div className="stat__delta">{classified} person + vehicle classified</div>
              </div>
            </div>
            <div className="stat">
              <div className="stat__icon">
                <Icon name="monitor" />
              </div>
              <div>
                <div className="stat__label">Vehicle</div>
                <div className="stat__value">{stats.vehicle}</div>
                <div className="stat__delta">Classified by the DVR or the detector</div>
              </div>
            </div>
            <div className="stat">
              <div className="stat__icon">
                <Icon name="activity" />
              </div>
              <div>
                <div className="stat__label">Motion</div>
                <div className="stat__value">{stats.motion}</div>
                <div className="stat__delta">Unclassified motion only</div>
              </div>
            </div>
          </div>

          <div className="grid-2">
            <section className="card" aria-label="Camera activity">
              <div className="card__head">
                <div className="card__title">
                  <Icon name="camera" className="icon icon-sm" />
                  Camera activity
                </div>
                <span className="section__hint">{RANGE_LABEL[range]}</span>
              </div>
              <div className="card__body">
                {stats.cameras.length === 0 ? (
                  <p className="section__hint">No events in this period.</p>
                ) : (
                  <div className="by-camera">
                    {stats.cameras.map((item) => (
                      <div key={item.cameraId} className="by-camera__row" title={name(item.cameraId)}>
                        <span className="by-camera__name">{name(item.cameraId)}</span>
                        <span className="by-camera__bar">
                          <div
                            className="by-camera__fill"
                            style={{ width: `${Math.round((item.total / maxCamera) * 100)}%` }}
                          />
                        </span>
                        <span className="by-camera__count">{item.total}</span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </section>

            <section className="card" aria-label="Priority breakdown">
              <div className="card__head">
                <div className="card__title">
                  <Icon name="alert" className="icon icon-sm" />
                  Priority
                </div>
                <span className="section__hint">{stats.total} events</span>
              </div>
              <div className="card__body">
                <div className="by-camera">
                  <div className="by-camera__row">
                    <span className="by-camera__name">High priority</span>
                    <span className="by-camera__bar">
                      <div
                        className="by-camera__fill"
                        style={{ width: `${Math.round((stats.high / Math.max(1, stats.total)) * 100)}%` }}
                      />
                    </span>
                    <span className="by-camera__count">{stats.high}</span>
                  </div>
                  <div className="by-camera__row">
                    <span className="by-camera__name">Critical</span>
                    <span className="by-camera__bar">
                      <div
                        className="by-camera__fill"
                        style={{ width: `${Math.round((stats.critical / Math.max(1, stats.total)) * 100)}%` }}
                      />
                    </span>
                    <span className="by-camera__count">{stats.critical}</span>
                  </div>
                  <div className="by-camera__row">
                    <span className="by-camera__name">Normal / low</span>
                    <span className="by-camera__bar">
                      <div
                        className="by-camera__fill"
                        style={{
                          width: `${Math.round(
                            ((stats.total - stats.high - stats.critical) / Math.max(1, stats.total)) * 100,
                          )}%`,
                        }}
                      />
                    </span>
                    <span className="by-camera__count">{Math.max(0, stats.total - stats.high - stats.critical)}</span>
                  </div>
                </div>
                <p className="section__hint" style={{ marginTop: 12 }}>
                  Priority is stored per event; HIGH and CRITICAL are the bands that can raise a notification.
                </p>
              </div>
            </section>
          </div>
        </>
      ) : null}
    </div>
  );
}
