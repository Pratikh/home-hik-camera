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
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold">Something went wrong</h1>
        <p className="mt-2 text-sm text-muted">The hub hit an unexpected error. Technical details stay in the server log.</p>
        <button
          type="button"
          onClick={reset}
          className="mt-6 rounded-lg bg-teal px-4 py-2 text-sm font-semibold text-black"
        >
          Try again
        </button>
      </div>
    </main>
  );
}
