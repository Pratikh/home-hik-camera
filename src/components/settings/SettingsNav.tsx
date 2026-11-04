"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Icon, type IconName } from "@/components/ui/Icon";

/**
 * Settings sub-navigation.
 *
 * The `/settings/*` family is a two-pane shell: this sticky list is the left
 * pane and the page content is the right pane. Labels are unchanged from the
 * approved information architecture; only grouping and styling are new.
 *
 * `aria-current="page"` marks the active destination, and the client hook is
 * used so the highlight follows `next/link` navigation without a reload.
 */

const ITEMS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: "/settings", label: "Overview", icon: "sliders" },
  { href: "/settings/users", label: "Users", icon: "users" },
  { href: "/settings/notifications", label: "Notification rules", icon: "bell" },
  { href: "/settings/detection", label: "Object detection", icon: "scan" },
  { href: "/settings/audit-log", label: "Audit log", icon: "file" },
  { href: "/settings/system", label: "System", icon: "activity" },
];

function activeFor(pathname: string, href: string): boolean {
  // The hub is the only exact match; every other entry also matches its children.
  if (href === "/settings") return pathname === "/settings";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SettingsNav() {
  const pathname = usePathname();

  return (
    <nav className="settings-nav" aria-label="Settings">
      <div className="settings-nav__label">Settings</div>
      {ITEMS.map((item) => (
        <Link
          key={item.href}
          href={item.href}
          aria-current={activeFor(pathname, item.href) ? "page" : undefined}
          className="settings-nav__item"
        >
          <Icon name={item.icon} className="icon icon-sm" />
          {item.label}
        </Link>
      ))}
      <div style={{ height: 1, background: "var(--line)", margin: "6px 4px" }} />
      <Link href="/" className="settings-nav__item">
        <Icon name="chevronLeft" className="icon icon-sm" />
        Back to dashboard
      </Link>
    </nav>
  );
}
