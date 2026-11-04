import { priorityLabel, type EventPriority } from "@/lib/priority";

/**
 * Priority is carried by a labelled badge, never by colour alone.
 *
 * HIGH/CRITICAL are the two escalation tones; NORMAL/LOW stay neutral so a busy
 * day does not turn into a wall of alarm colour.
 */
const TONE: Record<EventPriority, string> = {
  CRITICAL: "badge--critical",
  // Amber, not red: red is reserved for failure/offline/destructive actions so
  // "important" and "broken" cannot be confused in an alarm console.
  HIGH: "badge--warn",
  NORMAL: "",
  LOW: "",
};

export function PriorityBadge({ priority, className = "" }: { priority: EventPriority; className?: string }) {
  return <span className={`badge ${TONE[priority]} ${className}`.trim()}>{priorityLabel(priority)}</span>;
}
