/** Short forms used when space is tight (mobile header). */
const COMPACT_LABEL: Record<string, string> = {
  Connected: "DVR ok",
  "DVR offline": "Offline",
  "DVR not configured": "Not set",
  "DVR authentication failed": "Auth failed",
  "Video gateway unavailable": "Gateway down",
  Checking: "Checking",
  "Backend unavailable": "Backend down",
};

function compactLabel(label: string): string {
  return COMPACT_LABEL[label] ?? label;
}

const DOT_CLASS = {
  online: "dot--online",
  offline: "dot--offline",
  warn: "dot--warn",
  idle: "dot--idle",
} as const;

/**
 * Status indicator: a coloured dot, a visible word, and the full label exposed
 * to assistive technology. Status is never communicated by colour alone.
 *
 * The API is unchanged from the previous implementation so existing call sites
 * keep working; only the presentation moved to the Sentinel design system.
 */
export function StatusLamp({
  tone,
  label,
  compact = false,
}: {
  tone: "online" | "offline" | "warn" | "idle";
  label: string;
  /** Render a shorter label on small screens (with the full text kept for screen readers). */
  compact?: boolean;
}) {
  return (
    <span className="status" title={label}>
      <span className={`dot ${DOT_CLASS[tone]}`} aria-hidden="true" />
      {/* The accessible name is always the full label, so the abbreviation never
          hides the real DVR state from assistive technology. */}
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="status__text">
        {compact ? (
          <>
            <span className="md:hidden">{compactLabel(label)}</span>
            <span className="hidden md:inline">{label}</span>
          </>
        ) : (
          label
        )}
      </span>
    </span>
  );
}
