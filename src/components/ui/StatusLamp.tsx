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

export function StatusLamp({
  tone,
  label,
  compact = false,
}: {
  tone: "online" | "offline" | "warn" | "idle";
  label: string;
  /** Render a shorter label (with the full text kept for screen readers). */
  compact?: boolean;
}) {
  const color =
    tone === "online" ? "bg-online" : tone === "offline" ? "bg-offline" : tone === "warn" ? "bg-warn" : "bg-muted";
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm" title={label}>
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />
      {/*
        The accessible name is always the full label, so the abbreviation never
        hides the real DVR state from assistive technology.
      */}
      <span className="sr-only">{label}</span>
      <span aria-hidden="true" className="truncate whitespace-nowrap">
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