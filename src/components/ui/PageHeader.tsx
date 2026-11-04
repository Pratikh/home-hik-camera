import type { ReactNode } from "react";

/**
 * Standard page heading for the Sentinel design system.
 *
 * One `<h1>` per page, an optional uppercase eyebrow, an explanatory line and
 * an optional action slot that stacks under the title on narrow viewports.
 * Server-safe (no hooks) so server pages and client views can both use it.
 */
export function PageHeader({
  eyebrow,
  title,
  detail,
  actions,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="page-head">
      <div className="min-w-0">
        {eyebrow ? <div className="page-head__eyebrow">{eyebrow}</div> : null}
        <h1>{title}</h1>
        {detail ? <p className="page-head__sub">{detail}</p> : null}
      </div>
      {actions ? <div className="page-head__actions">{actions}</div> : null}
    </div>
  );
}
