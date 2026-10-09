import { readFile } from "node:fs/promises";
import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { Messages } from "@/lib/messages";
import { snapshotFile } from "@/lib/snapshot-path";
import { openEventStore } from "@/server/events/event-store";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Kept as a named re-export for existing callers and tests.
export { snapshotFile };

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const { id } = await context.params;
  if (!/^evt_[a-f0-9]{24}$/.test(id)) {
    return NextResponse.json({ error: Messages.snapshotUnavailable }, { status: 404 });
  }
  const config = getConfig();
  const file = snapshotFile(config.dataDir, openEventStore(config.dataDir).snapshotPath(id));
  if (!file) return NextResponse.json({ error: Messages.snapshotUnavailable }, { status: 404 });
  try {
    const bytes = await readFile(file);
    return new NextResponse(bytes, { headers: { "Content-Type": "image/jpeg", "Cache-Control": "private, no-store" } });
  } catch {
    return NextResponse.json({ error: Messages.snapshotUnavailable }, { status: 404 });
  }
}
