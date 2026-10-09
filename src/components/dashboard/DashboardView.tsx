"use client";

import { useCallback, useEffect, useState } from "react";
import type { CameraView, CamerasResponse } from "@/lib/api-types";
import { usePoll } from "@/components/hooks/usePoll";
import { useCameraFocus } from "@/components/hooks/useCameraFocus";
import { CameraTile } from "@/components/camera/CameraTile";
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
  const isFocused = focusId !== null;

  const { setFocused } = useCameraFocus();

  const exitFocus = useCallback(() => setFocusId(null), []);

  /*
   * Tell the shell whether a camera is focused, so it can hide the header,
   * sidebar and navigation. Entering/leaving focus never unmounts a player, so
   * the WebRTC sessions stay alive.
   */
  useEffect(() => {
    setFocused(isFocused);
    return () => setFocused(false);
  }, [isFocused, setFocused]);

  /*
   * Escape leaves focus mode. This is an application-level state change only:
   * the browser Fullscreen API is deliberately not used, so nothing about the
   * window or the stream changes.
   */
  useEffect(() => {
    if (!isFocused) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") exitFocus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isFocused, exitFocus]);

  /* Freeze the page behind the focus overlay without unmounting anything. */
  useEffect(() => {
    if (!isFocused) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [isFocused]);

  return (
    <>
      {/*
        The grid stays mounted at all times so every LivePlayer keeps its WebRTC
        session. In focus mode only the non-focused tiles are hidden (via
        `hidden` on the tile itself), and the focused tile becomes `fixed`, so
        nothing is unmounted or reconnected.
      */}
      <section className="flex min-h-0 flex-col">
        <div className={isFocused ? "hidden" : ""}>
          <PageIntro title="Dashboard" detail="Four-camera live view. The grid and full screen use the H.264 sub streams." />
        </div>

        {loading && !data && !isFocused ? (
          <div className="grid min-h-0 grid-cols-1 gap-3 camera-grid-h lg:grid-cols-2 lg:grid-rows-2 lg:gap-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="min-h-0 overflow-hidden rounded-xl border border-line">
                <div className="h-full min-h-[160px]">
                  <FrameSkeleton />
                </div>
              </div>
            ))}
          </div>
        ) : null}
        {error && !data ? <ErrorBanner message={error} onRetry={() => void reload()} /> : null}

        {data ? (
          /*
            Viewport-fitting grid.
            - below lg: one column, natural 16:9 tiles, the page scrolls.
            - lg and up: 2x2 filling the height left after the chrome, so all
              four cameras are visible with no page scroll. The height comes from
              `camera-grid-h`, which derives it from the viewport.
          */
          <div className="grid min-h-0 grid-cols-1 gap-3 camera-grid-h lg:grid-cols-2 lg:grid-rows-2 lg:gap-4">
            {data.cameras.map((camera) => (
              <CameraTile
                key={camera.id}
                camera={camera}
                suspended={tileMessage(data, camera)}
                /* Every stream stays active; focus only changes presentation. */
                active
                focused={focusId === camera.id}
                hidden={isFocused && focusId !== camera.id}
                onExpand={() => setFocusId(camera.id)}
                onExitFocus={exitFocus}
              />
            ))}
          </div>
        ) : null}

        <div className={isFocused ? "hidden" : "mt-4 shrink-0"}>
          <RecentEvents />
        </div>
      </section>

      {/* Announce the mode change to assistive technology. */}
      {focused ? (
        <p className="sr-only" role="status">
          Focused on {focused.name}. Press Escape or the Exit button to return to the four-camera grid.
        </p>
      ) : null}
    </>
  );
}