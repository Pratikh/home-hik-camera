import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/http/require-user";
import { collectSystemHealth } from "@/server/system-health";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * ADMIN-only operational health. The public `/api/health` endpoint stays small
 * and stable; this one is for the System page and for scripts that need to see
 * the face worker, backups, retention and disk usage.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const report = await collectSystemHealth();
  // Degraded is a valid, renderable answer: return 200 so the page can explain
  // it. An unreadable database still reports `status: unhealthy` in the body.
  return NextResponse.json(report);
}
