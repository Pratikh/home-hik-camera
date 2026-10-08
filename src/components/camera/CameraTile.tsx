"use client";

import type { CameraView } from "@/lib/api-types";
import { Messages } from "@/lib/messages";
import { LivePlayer } from "@/components/camera/LivePlayer";
import { MessagePanel } from "@/components/ui/States";
import { StatusLamp } from "@/components/ui/StatusLamp";

export function CameraTile({
  camera,
  suspended,
  active,
  onExpand,
}: {
  camera: CameraView;
  suspended: string | null;
  active: boolean;
  onExpand: () => void;
}) {
  const tone = camera.online === true ? "online" : camera.online === false ? "offline" : "warn";
  const signal = camera.online === true ? Messages.online : camera.online === false ? Messages.offline : Messages.notReported;

  return (
    <article className="min-w-0 overflow-hidden rounded-xl border border-line bg-card">
      <div className="relative aspect-video bg-black">
        {suspended ? (
          <MessagePanel message={suspended} />
        ) : (
          <LivePlayer path={camera.subPath} active={active} label={camera.name} />
        )}
        <button
          type="button"
          onClick={onExpand}
          className="absolute right-2 top-2 inline-flex h-11 items-center rounded-lg border border-white/20 bg-black/60 px-3 text-xs font-medium text-white"
          aria-label={`Full screen ${camera.name}`}
        >
          Full screen
        </button>
      </div>
      <div className="flex items-center justify-between gap-3 px-3 py-3">
        <div className="min-w-0">
          <h2 className="truncate text-sm font-semibold">{camera.name}</h2>
          <p className="mt-0.5 font-mono text-xs text-muted">Sub {camera.subChannel}</p>
        </div>
        <StatusLamp tone={tone} label={signal} />
      </div>
    </article>
  );
}
