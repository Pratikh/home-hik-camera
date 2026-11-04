"use client";

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  void error;
  return (
    <main className="flex min-h-dvh items-center justify-center bg-bg px-6 text-ink">
      <div className="card card--pad" style={{ maxWidth: 440, textAlign: "center" }}>
        <div className="empty__icon" style={{ margin: "0 auto 12px" }}>
          <svg viewBox="0 0 24 24" className="icon" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
            <path d="M12 4.5l8.5 15H3.5z" strokeLinejoin="round" />
            <path d="M12 10v4M12 17.2h.01" strokeLinecap="round" />
          </svg>
        </div>
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">The hub hit an unexpected error. Technical details stay in the server log.</p>
        <button type="button" onClick={reset} className="btn btn--primary mt-6">
          Try again
        </button>
      </div>
    </main>
  );
}
