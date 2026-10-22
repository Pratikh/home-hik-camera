import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { openEventStore } from "@/server/events/event-store";
import { parseRuleBody } from "@/server/events/rule-input";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const RULE_ID = /^rule-[A-Za-z0-9-]+$/;
const RETENTION = /^(0|7|14|30|60|90)$/;

/** Retention is stored as a setting; it is not a rule. */
function readRetention(value: unknown): string | null {
  if (!value || typeof value !== "object") return null;
  const body = value as Record<string, unknown>;
  return typeof body.retentionDays === "string" && RETENTION.test(body.retentionDays) ? body.retentionDays : null;
}

async function update(request: Request, context: { params: Promise<{ id: string }> }, id: string) {
  const store = openEventStore(getConfig().dataDir);
  if (id === "retention") {
    const days = readRetention(await request.json().catch(() => null));
    if (!days) return NextResponse.json({ error: "Invalid retention" }, { status: 400 });
    store.setSetting("retention_days", days);
    return NextResponse.json({ retentionDays: days });
  }
  if (!RULE_ID.test(id)) return NextResponse.json({ error: "Invalid notification rule" }, { status: 400 });

  const raw = (await request.json().catch(() => null)) as Record<string, unknown> | null;
  if (!raw || typeof raw !== "object") {
    return NextResponse.json({ error: "Invalid notification rule" }, { status: 400 });
  }
  const existing = store.rules().find((rule) => rule.id === id);
  if (!existing) return NextResponse.json({ error: "Notification rule not found" }, { status: 404 });

  // A partial update keeps every field the caller did not send.
  const merged: Record<string, unknown> = { ...existing, ...raw };
  /*
   * An older client that sends only cameraId/eventType/classification must not
   * have its change ignored because the row already carries V5.2 arrays. If no
   * array was supplied, drop the inherited arrays so the parser falls back to
   * the legacy fields it just received.
   */
  if (raw.cameraIds === undefined && raw.cameraId !== undefined) merged.cameraIds = undefined;
  if (
    raw.eventTypes === undefined &&
    (raw.eventType !== undefined || raw.classification !== undefined)
  ) {
    merged.eventTypes = undefined;
  }
  const parsed = parseRuleBody(merged, id);
  if (!parsed) return NextResponse.json({ error: "Invalid notification rule" }, { status: 400 });
  store.saveRule(parsed);
  return NextResponse.json({ rule: parsed });
}

export async function PUT(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  return update(request, context, id);
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  return update(request, context, id);
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!RULE_ID.test(id)) return NextResponse.json({ error: "Invalid notification rule" }, { status: 400 });
  const removed = openEventStore(getConfig().dataDir).deleteRule(id);
  if (!removed) return NextResponse.json({ error: "Notification rule not found" }, { status: 404 });
  return new NextResponse(null, { status: 204 });
}