"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CameraView, CamerasResponse, EventStatsResponse } from "@/lib/api-types";
import type { CctvEvent } from "@/lib/events";
import { api } from "@/lib/client-api";
import { usePoll } from "@/components/hooks/usePoll";
import { useCameraFocus } from "@/components/hooks/useCameraFocus";
import { CameraTile } from "@/components/camera/CameraTile";
import { ErrorBanner } from "@/components/ui/States";
import { PageHeader } from "@/components/ui/PageHeader";
import { Icon } from "@/components/ui/Icon";
import { RecentEvents } from "@/components/events/RecentEvents";
import { useSystemHealth } from "@/components/hooks/useSystemHealth";
import { humanizeSecondsInText } from "@/lib/time-kolkata";

type NotificationStats = { sent: number; suppressed: number; failed: number };

function tileMessage(snapshot: CamerasResponse, camera: CameraView): string | null {
  if (snapshot.dvr === "not_configured" || snapshot.dvr === "auth_failed" || snapshot.dvr === "disconnected") {
    return snapshot.dvrMessage;
  }
  if (snapshot.videoGateway === "disconnected") return "Video gateway unavailable";
  if (camera.online === false) return "Camera unavailable";
  return null;
}

export function DashboardView() {
  const { data, error, loading, reload } = usePoll<CamerasResponse>("/api/cameras");
  const [focusId, setFocusId] = useState<number | null>(null);
  const focused = data?.cameras.find((camera) => camera.id === focusId) ?? null;
  const isFocused = focusId !== null;

  const [stats, setStats] = useState<EventStatsResponse | null>(null);
  const [recent, setRecent] = useState<CctvEvent[]>([]);
  const [alerts, setAlerts] = useState<NotificationStats | null>(null);
  const [now, setNow] = useState(() => Date.now());

  const { setFocused } = useCameraFocus();
  const { health, role } = useSystemHealth();

  // Focus containment, Escape handling and focus restoration live in CameraTile
  // via the shared focus-trap hook.
  const exitFocus = useCallback(() => setFocusId(null), []);

  const loadSummary = useCallback(async () => {
    const [summary, recentBody, notificationStats] = await Promise.all([
      api<EventStatsResponse>("/api/events/stats?range=today"),
      api<{ events: CctvEvent[] }>("/api/events/recent?limit=4&important=true"),
      api<NotificationStats>("/api/notifications/stats?range=today"),
    ]);
    setStats(summary);
    setRecent(recentBody.events);
    setAlerts(notificationStats);
    setNow(Date.now());
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void loadSummary().catch(() => undefined), 0);
    const onEvent = () => void loadSummary().catch(() => undefined);
    window.addEventListener("cctv-event", onEvent);
    const refresh = setInterval(() => void loadSummary().catch(() => undefined), 60_000);
    return () => {
      clearTimeout(timer);
      clearInterval(refresh);
      window.removeEventListener("cctv-event", onEvent);
    };
  }, [loadSummary]);

  /*
   * Tell the shell whether a camera is focused, so it can hide the header,
   * sidebar and navigation. Entering/leaving focus never unmounts a player, so
   * the WebRTC sessions stay alive.
   */
  useEffect(() => {
    setFocused(isFocused);
    return () => setFocused(false);
  }, [isFocused, setFocused]);

  const cameras = data?.cameras ?? [];
  const onlineCount = cameras.filter((camera) => camera.online === true).length;
  const totalCameras = cameras.length;
  const important = stats ? stats.high + stats.critical : null;
  const cameraNames = Object.fromEntries(cameras.map((camera) => [camera.id, camera.name]));
  const eventsFor = (id: number) => stats?.cameras.find((entry) => entry.cameraId === id)?.total ?? null;
  const maxCameraEvents = stats ? Math.max(1, ...stats.cameras.map((entry) => entry.total)) : 1;

  return (
    <>
      {/*
        The grid stays mounted at all times so every LivePlayer keeps its WebRTC
        session. In focus mode only the non-focused tiles are hidden (via
        `hidden` on the tile itself), and the focused tile becomes `fixed`, so
        nothing is unmounted or reconnected.
      */}
      <section className="flex min-h-0 flex-col">
        {isFocused ? null : (
          <PageHeader
            eyebrow="Live monitoring"
            title="Dashboard"
            detail="Four-camera live view over the local gateway. H.264 sub streams only — the DVR is never exposed beyond this hub."
            actions={
              <>
                <span className="pill">
                  <span className="dot dot--live" />
                  {onlineCount} of {totalCameras || 4} streams live
                </span>
                <Link href="/events" className="btn">
                  <Icon name="events" className="icon icon-sm" />
                  Events
                </Link>
                <Link href="/playback" className="btn btn--primary">
                  <Icon name="playback" className="icon icon-sm" />
                  Playback
                </Link>
              </>
            }
          />
        )}

        {!isFocused && loading && !data ? (
          <div aria-hidden="true">
            <div className="stat-row">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="skeleton" style={{ height: 66 }} />
              ))}
            </div>
            <div className="live-wall">
              {Array.from({ length: 4 }, (_, index) => (
                <div key={index} className="skeleton" style={{ height: 280 }} />
              ))}
            </div>
          </div>
        ) : null}
        {!isFocused && error && !data ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}

        {!isFocused && data ? (
          <div className="stat-row">
            <div className="stat stat--accent">
              <div className="stat__icon">
                <Icon name="camera" />
              </div>
              <div>
                <div className="stat__label">Cameras online</div>
                <div className="stat__value">
                  {onlineCount}
                  <small> / {totalCameras || 4}</small>
                </div>
                <div className="stat__delta">
                  <strong>{onlineCount === totalCameras && totalCameras > 0 ? "All nominal" : "Check cameras"}</strong> · 704×576 sub
                </div>
              </div>
            </div>
            <div className="stat">
              <div className="stat__icon">
                <Icon name="events" />
              </div>
              <div>
                <div className="stat__label">Events today</div>
                <div className="stat__value">{stats ? stats.total : "—"}</div>
                <div className="stat__delta">
                  {stats ? `${stats.person} person · ${stats.vehicle} vehicle` : "Loading summary"}
                </div>
              </div>
            </div>
            <div className="stat stat--info">
              <div className="stat__icon">
                <Icon name="scan" />
              </div>
              <div>
                <div className="stat__label">Important today</div>
                <div className="stat__value">{important ?? "—"}</div>
                <div className="stat__delta">HIGH + CRITICAL priority</div>
              </div>
            </div>
            <div className="stat stat--warn">
              <div className="stat__icon">
                <Icon name="bell" />
              </div>
              <div>
                <div className="stat__label">Alerts sent today</div>
                <div className="stat__value">{alerts ? alerts.sent : "—"}</div>
                <div className="stat__delta">{alerts ? `${alerts.suppressed} suppressed by rules` : "Loading summary"}</div>
              </div>
            </div>
          </div>
        ) : null}

        {data ? (
          /*
            Viewport-fitting layout:
            - below 1024px: one column, natural 4:3 tiles, the page scrolls.
            - 1024px and up: the 4:3 wall is sized from the viewport height so
              all four cameras stay above the fold; from 1760px a "today by
              camera" column joins the wall, and the right rail carries events,
              system state and quick links.
          */
          <div className="dash">
            <div className="dash__main">
              <div className="live-wall">
                {cameras.map((camera) => (
                  <CameraTile
                    key={camera.id}
                    camera={camera}
                    suspended={tileMessage(data, camera)}
                    /* Every stream stays active; focus only changes presentation. */
                    active
                    focused={focusId === camera.id}
                    hidden={isFocused && focusId !== camera.id}
                    eventCount={eventsFor(camera.id)}
                    onExpand={() => setFocusId(camera.id)}
                    onExitFocus={exitFocus}
                  />
                ))}
              </div>

              <div className="today-col" inert={isFocused ? true : undefined} aria-hidden={isFocused ? true : undefined}>
                <section className="card">
                  <div className="card__head">
                    <div className="card__title">
                      <Icon name="activity" className="icon icon-sm" />
                      Today by camera
                    </div>
                  </div>
                  <div className="card__body by-camera">
                    {cameras.map((camera) => {
                      const count = eventsFor(camera.id) ?? 0;
                      return (
                        <div className="by-camera__row" key={camera.id}>
                          <span className="by-camera__name">{camera.name}</span>
                          <span className="by-camera__bar">
                            <span className="by-camera__fill" style={{ width: `${Math.round((count / maxCameraEvents) * 100)}%` }} />
                          </span>
                          <span className="by-camera__count">{count}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="card__foot">
                    <Link href="/events/stats" className="btn btn--sm btn--ghost">
                      All statistics
                      <Icon name="arrowRight" className="icon icon-sm" />
                    </Link>
                  </div>
                </section>
              </div>
            </div>

            <aside className="dash__rail" inert={isFocused ? true : undefined} aria-hidden={isFocused ? true : undefined}>
              <RecentEvents events={recent} stats={stats} cameraNames={cameraNames} now={now} />

              <section className="card">
                <div className="card__head">
                  <div className="card__title">
                    <Icon name="database" className="icon icon-sm" />
                    System snapshot
                  </div>
                  <span
                    className={`badge ${
                      health
                        ? health.status === "healthy"
                          ? "badge--online"
                          : health.status === "degraded"
                            ? "badge--warn"
                            : "badge--danger"
                        : data.dvr === "connected" && data.videoGateway === "connected"
                          ? "badge--online"
                          : "badge--warn"
                    }`}
                  >
                    {health
                      ? health.status === "healthy"
                        ? "Healthy"
                        : health.status === "degraded"
                          ? "Degraded"
                          : "Unhealthy"
                      : data.dvr === "connected" && data.videoGateway === "connected"
                        ? "DVR & streams healthy"
                        : "Degraded"}
                  </span>
                </div>
                <div className="card__body" style={{ display: "grid", gap: 10 }}>
                  <div className="status" style={{ justifyContent: "space-between" }}>
                    <span>
                      <span className={`dot ${data.dvr === "connected" ? "dot--online" : "dot--offline"}`} /> DVR connection
                    </span>
                    <span className="section__hint">{data.dvrMessage}</span>
                  </div>
                  <div className="status" style={{ justifyContent: "space-between" }}>
                    <span>
                      <span className={`dot ${data.videoGateway === "connected" ? "dot--online" : "dot--offline"}`} /> Video gateway
                    </span>
                    <span className="section__hint">{data.videoGateway === "connected" ? "Online" : "Offline"}</span>
                  </div>
                  <div className="status" style={{ justifyContent: "space-between" }}>
                    <span>
                      <span className="dot dot--idle" /> Cameras reporting
                    </span>
                    <span className="section__hint">
                      {onlineCount} / {totalCameras || 4}
                    </span>
                  </div>
                  {health ? (
                    <div className="status" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                      <span>
                        <span className={`dot ${health.status === "healthy" ? "dot--online" : health.status === "degraded" ? "dot--warn" : "dot--offline"}`} />{" "}
                        Services
                      </span>
                      <span className="section__hint" style={{ textAlign: "right" }} title={health.warnings.map((w) => humanizeSecondsInText(w)).join(" ")}>
                        {[
                          health.storage.usedPercent === null ? null : `Storage ${health.storage.usedPercent}%`,
                          health.faceDetection.enabled
                            ? `worker ${health.faceDetection.worker === "running" ? "running" : "stopped"}`
                            : null,
                          health.backups.status === "stale" ? "backups stale" : null,
                        ]
                          .filter(Boolean)
                          .join(" · ") || "No warnings"}
                      </span>
                    </div>
                  ) : null}
                </div>
                {role === "ADMIN" ? (
                  <div className="card__foot">
                    <Link href="/settings/system" className="btn btn--sm btn--ghost">
                      System health
                      <Icon name="arrowRight" className="icon icon-sm" />
                    </Link>
                  </div>
                ) : null}
              </section>
            </aside>
          </div>
        ) : null}
      </section>

      {/* Announce the mode change to assistive technology. */}
      {focused ? (
        <>
          <p className="sr-only" role="status">
            Focused on {focused.name}. Press Escape or the Exit button to return to the four-camera grid.
          </p>
          <p className="focus-hint">Press Esc to return to the grid</p>
        </>
      ) : null}
    </>
  );
}
