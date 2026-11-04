import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";
import { SettingsNav } from "@/components/settings/SettingsNav";

/**
 * Settings shell.
 *
 * Two panes: a sticky sub-navigation (200 px on desktop, wrapping chips at
 * ≤1024 px) and the page content. The ADMIN guard is part of the route and is
 * unchanged: no session redirects to /login, a non-ADMIN redirects to the
 * dashboard.
 */
export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");

  return (
    <div className="settings-shell">
      <SettingsNav />
      <div className="settings-body">{children}</div>
    </div>
  );
}
