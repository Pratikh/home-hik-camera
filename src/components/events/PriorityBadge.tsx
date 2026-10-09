import { priorityLabel, type EventPriority } from "@/lib/priority";

const TONE: Record<EventPriority, string> = {
  CRITICAL: "border-offline/60 bg-offline/15 text-offline",
  HIGH: "border-warn/60 bg-warn/15 text-warn",
  NORMAL: "border-line bg-white/5 text-muted",
  LOW: "border-line bg-white/5 text-muted",
};

export function PriorityBadge({ priority, className = "" }: { priority: EventPriority; className?: string }) {
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-0.5 text-[11px] font-medium ${TONE[priority]} ${className}`}
    >
      {priorityLabel(priority)}
    </span>
  );
}