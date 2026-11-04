export function Mark({ className = "h-8 w-8" }: { className?: string }) {
  return (
    <svg viewBox="0 0 32 32" className={className} aria-hidden="true">
      <rect x="0.5" y="0.5" width="31" height="31" rx="8" fill="#0f1a20" stroke="#2fe3c6" strokeOpacity="0.8" />
      <rect x="5" y="5" width="9" height="9" rx="2" fill="#2fe3c6" />
      <rect x="18" y="5" width="9" height="9" rx="2" fill="#7cf2e0" />
      <rect x="5" y="18" width="9" height="9" rx="2" fill="#7cf2e0" />
      <rect x="18" y="18" width="9" height="9" rx="2" fill="#2fe3c6" />
    </svg>
  );
}
