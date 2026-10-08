"use client";

import { useState } from "react";
import type { CameraView, CamerasResponse } from "@/lib/api-types";
import { usePoll } from "@/components/hooks/usePoll";
import { CameraTile } from "@/components/camera/CameraTile";
import { FullscreenViewer } from "@/components/camera/FullscreenViewer";
import { ErrorBanner, FrameSkeleton, PageIntro } from "@/components/ui/States";
import { RecentEvents } from "@/components/events/RecentEvents";

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

  return (
    <section>
      <PageIntro title="Dashboard" detail="Four-camera live view. The grid and full screen use the H.264 sub streams." />
      {loading && !data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="overflow-hidden rounded-xl border border-line">
              <div className="aspect-video">
                <FrameSkeleton />
              </div>
            </div>
          ))}
        </div>
      ) : null}
      {error && !data ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}
      {data ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 md:gap-4">
          {data.cameras.map((camera) => (
            <CameraTile
              key={camera.id}
              camera={camera}
              suspended={tileMessage(data, camera)}
              active={focusId === null}
              onExpand={() => setFocusId(camera.id)}
            />
          ))}
        </div>
      ) : null}
      <RecentEvents />
      {focused && data ? (
        <FullscreenViewer
          camera={focused}
          suspended={tileMessage(data, focused)}
          onClose={() => setFocusId(null)}
        />
      ) : null}
    </section>
  );
}
