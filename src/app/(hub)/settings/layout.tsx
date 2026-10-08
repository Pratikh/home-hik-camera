import { redirect } from "next/navigation";
import { currentSession } from "@/lib/auth";

export default async function SettingsLayout({ children }: { children: React.ReactNode }) {
  const session = await currentSession();
  if (!session) redirect("/login");
  if (session.role !== "ADMIN") redirect("/");
  return children;
}
