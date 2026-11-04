"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import type { CamerasResponse } from "@/lib/api-types";
import { CAMERA_IDS } from "@/lib/cameras";
import type { DetectedFace, FaceListResponse } from "@/lib/faces";
import { DEFAULT_FACE_PAGE_SIZE } from "@/lib/faces";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { formatKolkataClock, formatKolkataDateTimeFromIso, todayInKolkata } from "@/lib/time-kolkata";
import { PageHeader } from "@/components/ui/PageHeader";
import { EmptyState, ErrorBanner } from "@/components/ui/States";
import { Icon } from "@/components/ui/Icon";
import { FaceCard } from "@/components/faces/FaceCard";

/** "5 minutes" / "1 minute" / "30 seconds", for the test-mode status line. */
function formatCooldown(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "no";
  if (seconds < 60) return `${Math.round(seconds)} seconds`;
  const minutes = seconds / 60;
  return `${Number.isInteger(minutes) ? minutes : minutes.toFixed(1)} minutes`;
}

const CONFIDENCE_OPTIONS = ["all", "0.5", "0.6", "0.7", "0.8", "0.9"] as const;

/** The only summary the API does not already return: how many faces were seen today. */
type TodaySummary = { total: number; last: DetectedFace | null };

/**
 * Detected Faces.
 *
 * A gallery of detections, not a recognition screen: every face is Unassigned
 * because no identity is computed. The page works whether or not detection is
 * enabled — with the flag off it explains that plainly instead of showing
 * fabricated zero counters.
 *
 * The four KPI tiles are read from the real `/api/faces` response (`total`,
 * `processing`) plus one *filtered* call to the same endpoint for "Today"; no
 * new endpoint exists and no number is invented.
 */
export function FacesView() {
  const [cameras, setCameras] = useState<Record<number, string>>({});
  const [camera, setCamera] = useState("all");
  const [date, setDate] = useState("");
  const [assigned, setAssigned] = useState("all");
  const [confidence, setConfidence] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FaceListResponse | null>(null);
  const [today, setToday] = useState<TodaySummary | null>(null);
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

  /*
   * "Today" KPI. The list endpoint already accepts `date`, so a one-row query
   * yields the day's total (and the newest detection for the tile's sub-line)
   * without a new API route and without scanning the whole table in the browser.
   */
  useEffect(() => {
    let cancelled = false;
    void api<FaceListResponse>(`/api/faces?date=${todayInKolkata()}&page=1&pageSize=1`)
      .then((body) => {
        if (cancelled || !body.enabled) return;
        setToday({ total: body.total, last: body.faces[0] ?? null });
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const load = useCallback(
    async (nextPage = 1) => {
      setLoading(true);
      setError(null);
      const params = new URLSearchParams({
        camera,
        assigned,
        page: String(nextPage),
        pageSize: String(DEFAULT_FACE_PAGE_SIZE),
      });
      if (date) params.set("date", date);
      if (confidence !== "all") params.set("minConfidence", confidence);
      try {
        const body = await api<FaceListResponse>(`/api/faces?${params.toString()}`);
        setData(body);
        setPage(nextPage);
      } catch (caught) {
        if (caught instanceof ApiError && caught.status === 401) return;
        setError(caught instanceof Error ? caught.message : Messages.backendDown);
      } finally {
        setLoading(false);
      }
    },
    [camera, date, assigned, confidence],
  );

  useEffect(() => {
    const timer = setTimeout(() => void load(1), 0);
    return () => clearTimeout(timer);
  }, [load]);

  const name = (id: number) => cameras[id] ?? `Camera ${id}`;
  const disabled = data !== null && !data.enabled;
  const filtersActive = camera !== "all" || date !== "" || assigned !== "all" || confidence !== "all";

  const clearFilters = () => {
    setCamera("all");
    setDate("");
    setAssigned("all");
    setConfidence("all");
  };

  const busy = data ? data.processing.processing > 0 : false;
  const queued = data ? data.processing.pending > 0 : false;
  const workerLabel = busy ? "Face worker busy" : queued ? "Face worker queueing" : "Face worker idle";

  const pageSize = data?.pageSize ?? DEFAULT_FACE_PAGE_SIZE;
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const firstRow = total === 0 ? 0 : (page - 1) * pageSize + 1;
  const lastRow = total === 0 ? 0 : Math.min((page - 1) * pageSize + (data?.faces.length ?? 0), total);

  /* In this phase no face can carry an identity: every detection is Unassigned. */
  const unassigned = assigned === "true" ? 0 : total;

  return (
    <div className="min-w-0">
      <PageHeader
        eyebrow="Investigate"
        title="Detected Faces"
        detail="Faces found in event snapshots by the local detector. Every face stays Unassigned until a later phase adds people."
        actions={
          <>
            {data?.enabled ? (
              <span className="pill">
                <span className={`dot ${busy ? "dot--live" : "dot--idle"}`} />
                {workerLabel}
              </span>
            ) : null}
            <Link href="/events" className="btn">
              <Icon name="events" className="icon icon-sm" />
              Events
            </Link>
            <Link href="/settings/system" className="btn">
              <Icon name="activity" className="icon icon-sm" />
              System health
            </Link>
          </>
        }
      />

      {disabled ? (
        <div className="card card--pad">
          <div className="notice notice--warn">
            <Icon name="alert" />
            <div className="min-w-0">
              <div style={{ fontWeight: 600 }}>{Messages.faceDetectionDisabled}</div>
              <div className="section__hint" style={{ marginTop: 4 }}>
                {Messages.faceDetectionDisabledDetail}
              </div>
            </div>
          </div>
        </div>
      ) : (
        <>
          <div className="stat-row">
            <div className="stat stat--accent">
              <div className="stat__icon">
                <Icon name="faces" />
              </div>
              <div>
                <div className="stat__label">Detected faces</div>
                <div className="stat__value">{data ? total : "—"}</div>
                <div className="stat__delta">
                  <strong>{filtersActive ? "Filtered view" : "All time"}</strong> · event snapshots
                </div>
              </div>
            </div>
            <div className="stat">
              <div className="stat__icon">
                <Icon name="calendar" />
              </div>
              <div>
                <div className="stat__label">Today</div>
                <div className="stat__value">{today ? today.total : "—"}</div>
                <div className="stat__delta">
                  {today?.last
                    ? `Last at ${formatKolkataClock(new Date(today.last.eventTimestamp))} · ${name(today.last.cameraId)}`
                    : "No detections today"}
                </div>
              </div>
            </div>
            <div className="stat stat--info">
              <div className="stat__icon">
                <Icon name="user" />
              </div>
              <div>
                <div className="stat__label">Unassigned</div>
                <div className="stat__value">{data ? unassigned : "—"}</div>
                <div className="stat__delta">No identity matching in this phase</div>
              </div>
            </div>
            <div className="stat">
              <div className="stat__icon">
                <Icon name="image" />
              </div>
              <div>
                <div className="stat__label">Snapshots queued</div>
                <div className="stat__value">{data ? data.processing.pending : "—"}</div>
                <div className="stat__delta">
                  {(data?.processing.failed ?? 0) > 0
                    ? `${data?.processing.failed} could not be processed`
                    : queued
                      ? "Worker is catching up"
                      : "Queue clear"}
                </div>
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
                <span className="field__label">Date (optional)</span>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="input input--mono"
                  aria-label="Date"
                />
              </label>
              <label className="field">
                <span className="field__label">Assignment</span>
                <select
                  value={assigned}
                  onChange={(event) => setAssigned(event.target.value)}
                  className="select"
                  aria-label="Assignment"
                >
                  <option value="all">All</option>
                  <option value="false">Unassigned</option>
                  <option value="true">Assigned</option>
                </select>
              </label>
              <label className="field">
                <span className="field__label">Minimum confidence</span>
                <select
                  value={confidence}
                  onChange={(event) => setConfidence(event.target.value)}
                  className="select"
                  aria-label="Minimum confidence"
                >
                  {CONFIDENCE_OPTIONS.map((value) => (
                    <option key={value} value={value}>
                      {value === "all" ? "Any" : `${Math.round(Number(value) * 100)}%+`}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="filter-panel__foot">
              <button type="submit" className="btn btn--primary">
                <Icon name="scan" className="icon icon-sm" />
                {loading ? "Loading..." : "Apply filters"}
              </button>
              <button type="button" className="btn btn--ghost" onClick={clearFilters}>
                Clear filters
              </button>
              <span className="section__hint" style={{ marginLeft: "auto" }}>
                Filters apply to the gallery below
              </span>
            </div>
          </form>

          {/*
            Temporary test mode status. Read-only: it only says whether a face
            detection will raise a browser notification, and until when.
          */}
          {data?.testNotifications?.active ? (
            <div className="notice notice--accent" role="status" style={{ marginTop: 12 }}>
              <Icon name="zap" />
              <div className="min-w-0">
                <div style={{ fontWeight: 600, fontSize: "var(--fs-12)" }}>
                  Face test notifications active until{" "}
                  {data.testNotifications.until
                    ? formatKolkataDateTimeFromIso(data.testNotifications.until)
                    : "(unset)"}
                </div>
                <div className="section__hint">
                  One browser notification per detection · cooldown{" "}
                  {formatCooldown(data.testNotifications.cooldownSeconds)} / camera
                </div>
              </div>
              <span className="badge badge--accent" style={{ marginLeft: "auto" }}>
                Test mode
              </span>
            </div>
          ) : null}

          {error ? (
            <div style={{ marginTop: 12 }}>
              <ErrorBanner message={`Unable to load detected faces. ${error}`} onRetry={() => void load(page)} />
            </div>
          ) : null}

          <section className="section" aria-busy={loading}>
            <div className="section__head">
              <h2 className="section__title">All detections</h2>
              <span className="section__hint" role="status" aria-live="polite">
                {data && total > 0
                  ? `Showing ${firstRow}–${lastRow} of ${total} detected faces · ${
                      filtersActive ? "matching filters" : "newest first"
                    }`
                  : "Newest first"}
              </span>
            </div>

            {data && (data.processing.pending > 0 || data.processing.failed > 0) ? (
              <div className="notice" style={{ marginBottom: 12 }}>
                <Icon name="image" />
                <div className="min-w-0">
                  {data.processing.pending > 0 ? (
                    <div>{data.processing.pending} snapshot(s) queued</div>
                  ) : null}
                  {data.processing.failed > 0 ? (
                    <div className="section__hint">{data.processing.failed} snapshot(s) could not be processed</div>
                  ) : null}
                </div>
              </div>
            ) : null}

            {!data && loading ? (
              <div className="face-grid" aria-hidden="true">
                {Array.from({ length: 12 }, (_, index) => (
                  <div key={index} className="skeleton" style={{ height: 232 }} />
                ))}
              </div>
            ) : null}

            {!error && data && data.faces.length === 0 ? (
              <EmptyState
                icon="faces"
                title={Messages.noFaces}
                detail="Try another camera, date or confidence level. A detection appears once the face worker has processed the event snapshot."
                action={
                  filtersActive ? (
                    <button type="button" className="btn" onClick={clearFilters}>
                      Clear filters
                    </button>
                  ) : undefined
                }
              />
            ) : null}

            {data && data.faces.length > 0 ? (
              <div className="face-grid xl:grid-cols-5 2xl:grid-cols-6">
                {data.faces.map((face) => (
                  <FaceCard key={face.id} face={face} cameraName={name(face.cameraId)} />
                ))}
              </div>
            ) : null}

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
        </>
      )}
    </div>
  );
}
