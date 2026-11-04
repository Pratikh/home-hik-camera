import type { ReactNode } from "react";
import { Icon, type IconName } from "@/components/ui/Icon";

export function MessagePanel({ message }: { message: string }) {
  return (
    <div className="message-panel" role="status">
      <p>{message}</p>
    </div>
  );
}

export function FrameSkeleton() {
  return <div className="skeleton h-full w-full" aria-hidden="true" />;
}

export function ErrorBanner({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="card card--pad" role="alert">
      <div className="notice notice--danger">
        <Icon name="alert" />
        <span>{message}</span>
      </div>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="btn btn--sm" style={{ marginTop: 12 }}>
          Try again
        </button>
      ) : null}
    </div>
  );
}

/**
 * Empty state for a list/card with no rows.
 *
 * `title` names the state ("No events match your filters."), `detail` explains
 * what to do next, and `action` is an optional control. An empty state is never
 * just a bare sentence.
 */
export function EmptyState({
  icon = "info",
  title,
  detail,
  action,
}: {
  icon?: IconName;
  title: string;
  detail?: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty">
      <span className="empty__icon">
        <Icon name={icon} />
      </span>
      <p className="empty__title">{title}</p>
      {detail ? <p className="empty__text">{detail}</p> : null}
      {action}
    </div>
  );
}

/** Shimmering placeholder lines for a list that is still loading. */
export function SkeletonRows({ rows = 3 }: { rows?: number }) {
  return (
    <div aria-hidden="true" style={{ display: "grid", gap: 8 }}>
      {Array.from({ length: rows }, (_, index) => (
        <div key={index} className="skeleton" style={{ height: 48, opacity: 1 - index * 0.12 }} />
      ))}
    </div>
  );
}

/**
 * Page heading.
 *
 * `compact` drops the bottom margin (for a parent that already applies `gap`)
 * and tightens the type, so a page that must fit the viewport does not spend
 * ~30px on a double gap plus oversized text.
 *
 * NOTE: the exact class tokens in both variants are asserted by
 * `playback-layout.test.ts`; change them only together with that test.
 */
export function PageIntro({ title, detail, compact = false }: { title: string; detail: string; compact?: boolean }) {
  if (compact) {
    return (
      <div className="min-w-0">
        <h1 className="text-base font-semibold tracking-tight">{title}</h1>
        <p className="text-xs text-muted">{detail}</p>
      </div>
    );
  }
  return (
    <div className="mb-4 min-w-0">
      <h1 className="text-lg font-semibold tracking-tight md:text-xl">{title}</h1>
      <p className="mt-1 text-sm text-muted">{detail}</p>
    </div>
  );
}
