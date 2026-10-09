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
  const page = Number(url.searchParams.get("page") ?? "1");
  const pageSize = Number(url.searchParams.get("pageSize") ?? "25");
  if (!Number.isInteger(page) || page < 1 || page > 1000) {
    return NextResponse.json({ error: "Invalid page" }, { status: 400 });
  }
  if (!Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return NextResponse.json({ error: "Invalid page size" }, { status: 400 });
  }
  const result = accountStore(getConfig().dataDir).listAudit({
    user: url.searchParams.get("user"),
    action: url.searchParams.get("action"),
    date: url.searchParams.get("date"),
    limit: pageSize,
    offset: (page - 1) * pageSize,
  });
  return NextResponse.json({ logs: result.logs, total: result.total, page, pageSize });
}