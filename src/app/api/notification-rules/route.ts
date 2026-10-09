import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { newRuleId, openEventStore } from "@/server/events/event-store";
import { parseRuleBody } from "@/server/events/rule-input";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const store = openEventStore(getConfig().dataDir);
  return NextResponse.json({
    rules: store.rules(),
    retentionDays: store.setting("retention_days") ?? String(getConfig().eventRetentionDays),
  });
}

export async function POST(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const rule = parseRuleBody(await request.json().catch(() => null), newRuleId());
  if (!rule) return NextResponse.json({ error: "Invalid notification rule" }, { status: 400 });
  openEventStore(getConfig().dataDir).saveRule(rule);
  return NextResponse.json({ rule }, { status: 201 });
}