export function StatusLamp({
  tone,
  label,
}: {
  tone: "online" | "offline" | "warn" | "idle";
  label: string;
}) {
  const color =
    tone === "online" ? "bg-online" : tone === "offline" ? "bg-offline" : tone === "warn" ? "bg-warn" : "bg-muted";
  return (
    <span className="inline-flex min-w-0 items-center gap-2 text-sm">
      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${color}`} aria-hidden="true" />
      <span className="truncate">{label}</span>
    </span>
  );
}
