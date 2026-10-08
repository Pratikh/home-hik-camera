import { redirect } from "next/navigation";
import { AppShell } from "@/components/layout/AppShell";
import { currentSession } from "@/lib/auth";
import { getConfig } from "@/lib/config";

export const dynamic = "force-dynamic";

export default async function HubLayout({ children }: { children: React.ReactNode }) {
  const config = getConfig();
  if (!config.appConfigured) redirect("/login");
  const session = await currentSession();
  if (!session) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
