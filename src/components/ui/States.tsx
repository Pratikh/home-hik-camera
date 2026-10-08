export function MessagePanel({ message }: { message: string }) {
  return (
    <div className="flex h-full w-full items-center justify-center bg-black px-4 text-center" role="status">
      <p className="max-w-xs text-sm leading-5 text-white/90">{message}</p>
    </div>
  );
}

export function FrameSkeleton() {
  return <div className="h-full w-full animate-pulse bg-[#151b24]" aria-hidden="true" />;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="rounded-xl border border-line bg-card px-4 py-8 text-center" role="alert">
      <p className="text-sm">{message}</p>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="mt-4 rounded-lg border border-line bg-white/5 px-3 py-2 text-sm hover:bg-white/10"
        >
          Try again
        </button>
      ) : null}
    </div>
  );
}

export function PageIntro({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="mb-4 min-w-0">
      <h1 className="text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}
