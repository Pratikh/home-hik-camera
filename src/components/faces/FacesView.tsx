"use client";

import { useCallback, useEffect, useState } from "react";
import type { CamerasResponse } from "@/lib/api-types";
import { CAMERA_IDS } from "@/lib/cameras";
import type { FaceListResponse } from "@/lib/faces";
import { DEFAULT_FACE_PAGE_SIZE } from "@/lib/faces";
import { ApiError, api } from "@/lib/client-api";
import { Messages } from "@/lib/messages";
import { PageIntro } from "@/components/ui/States";
import { FaceCard } from "@/components/faces/FaceCard";

const CONFIDENCE_OPTIONS = ["all", "0.5", "0.6", "0.7", "0.8", "0.9"] as const;

/**
 * Detected Faces.
 *
 * This is a gallery of detections, not a recognition screen: every face is
 * Unassigned because no identity is computed. The page works whether or not
 * detection is enabled — with the flag off it explains that plainly instead of
 * showing an empty gallery.
 */
export function FacesView() {
  const [cameras, setCameras] = useState<Record<number, string>>({});
  const [camera, setCamera] = useState("all");
  const [date, setDate] = useState("");
  const [assigned, setAssigned] = useState("all");
  const [confidence, setConfidence] = useState("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<FaceListResponse | null>(null);
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

  return (
    <div className="min-w-0">
      <PageIntro
        title="Detected Faces"
        detail="Faces found in event snapshots by the local detector. Every face stays Unassigned until a later phase adds people."
      />

      {disabled ? (
        <div className="rounded-xl border border-line bg-card p-5" role="status">
          <h2 className="text-sm font-semibold">{Messages.faceDetectionDisabled}</h2>
          <p className="mt-1 text-sm text-muted">{Messages.faceDetectionDisabledDetail}</p>
        </div>
      ) : (
        <>
          <form
            className="mb-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5"
            onSubmit={(event) => {
              event.preventDefault();
              void load(1);
            }}
          >
            <label className="text-sm">
              <span className="mb-1 block text-muted">Camera</span>
              <select
                value={camera}
                onChange={(event) => setCamera(event.target.value)}
                className="h-11 w-full rounded-lg border border-line bg-card px-3"
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
            <label className="text-sm">
              <span className="mb-1 block text-muted">Date (optional)</span>
              <input
                type="date"
                value={date}
                onChange={(event) => setDate(event.target.value)}
                className="h-11 w-full rounded-lg border border-line bg-card px-3"
                aria-label="Date"
              />
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">Assignment</span>
              <select
                value={assigned}
                onChange={(event) => setAssigned(event.target.value)}
                className="h-11 w-full rounded-lg border border-line bg-card px-3"
                aria-label="Assignment"
              >
                <option value="all">All</option>
                <option value="false">Unassigned</option>
                <option value="true">Assigned</option>
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-muted">Minimum confidence</span>
              <select
                value={confidence}
                onChange={(event) => setConfidence(event.target.value)}
                className="h-11 w-full rounded-lg border border-line bg-card px-3"
                aria-label="Minimum confidence"
              >
                {CONFIDENCE_OPTIONS.map((value) => (
                  <option key={value} value={value}>
                    {value === "all" ? "Any" : `${Math.round(Number(value) * 100)}%+`}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="submit"
                className="h-11 w-full rounded-lg bg-teal px-4 text-sm font-semibold text-[#08110f] xl:w-auto"
              >
                {loading ? "Loading..." : "Apply filters"}
              </button>
            </div>
          </form>

          {error ? (
            <div className="mb-3 flex items-center gap-3 text-sm text-warn" role="alert">
              <span>Unable to load detected faces.</span>
              <button type="button" onClick={() => void load(page)} className="rounded-lg border border-line px-3 py-1">
                Retry
              </button>
            </div>
          ) : null}

          {!error && loading && !data ? <p className="text-sm text-muted">Loading detected faces...</p> : null}

          {data ? (
            <div className="mb-3 flex flex-wrap gap-4 text-sm text-muted">
              <span>
                <strong className="text-ink">{data.total}</strong> detected face{data.total === 1 ? "" : "s"}
              </span>
              {data.processing.pending > 0 ? <span>{data.processing.pending} snapshot(s) queued</span> : null}
              {data.processing.failed > 0 ? (
                <span className="text-warn">{data.processing.failed} snapshot(s) could not be processed</span>
              ) : null}
            </div>
          ) : null}

          {!loading && data && data.faces.length === 0 ? (
            <p className="text-sm text-muted">{Messages.noFaces}</p>
          ) : null}

          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-4">
            {data?.faces.map((face) => (
              <FaceCard key={face.id} face={face} cameraName={name(face.cameraId)} />
            ))}
          </div>

          {data && data.total > data.pageSize ? (
            <div className="mt-3 flex items-center gap-2">
              <button
                type="button"
                className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40"
                disabled={page <= 1}
                onClick={() => void load(page - 1)}
              >
                Previous
              </button>
              <span className="text-xs text-muted">
                Page {page} of {Math.max(1, Math.ceil(data.total / data.pageSize))}
              </span>
              <button
                type="button"
                className="h-10 rounded-lg border border-line px-3 text-sm disabled:opacity-40"
                disabled={page * data.pageSize >= data.total}
                onClick={() => void load(page + 1)}
              >
                Next
              </button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
