"use client";

import { useEffect } from "react";
import type { CameraView } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { LivePlayer } from "@/components/camera/LivePlayer";
import { MessagePanel } from "@/components/ui/States";
import { StatusLamp } from "@/components/ui/StatusLamp";

export function FullscreenViewer({
  camera,
  suspended,
  onClose,
}: {
  camera: CameraView;
  suspended: string | null;
  onClose: () => void;
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKey);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", onKey);
    };
  }, [onClose]);

  const tone = camera.online === true ? "online" : camera.online === false ? "offline" : "warn";
  const signal = camera.online === true ? Messages.online : camera.online === false ? Messages.offline : Messages.notReported;

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-black" role="dialog" aria-modal="true" aria-label={camera.name}>
      <div className="flex items-center justify-between gap-3 px-3 py-3 sm:px-5">
        <div className="min-w-0">
          <h2 className="truncate text-base font-semibold text-white">{camera.name}</h2>
          <p className="font-mono text-xs text-white/70">Sub {camera.subChannel}</p>
        </div>
        <div className="flex items-center gap-3">
          <StatusLamp tone={tone} label={signal} />
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 items-center rounded-lg border border-white/20 px-3 text-sm text-white"
            autoFocus
          >
            Close
          </button>
        </div>
      </div>
      <div className="relative min-h-0 flex-1">
        {suspended ? <MessagePanel message={suspended} /> : <LivePlayer path={camera.subPath} active label={camera.name} />}
      </div>
    </div>
  );
}
