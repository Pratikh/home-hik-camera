import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { accountStore } from "@/server/auth/accounts";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const url = new URL(request.url);
  const logs = accountStore(getConfig().dataDir).listAudit({
    user: url.searchParams.get("user"),
    action: url.searchParams.get("action"),
    date: url.searchParams.get("date"),
  });
  return NextResponse.json({ logs });
}
