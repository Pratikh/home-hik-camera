import { NextResponse } from "next/server";
import { getConfig } from "@/lib/config";
import { describeStreamPath } from "@/server/cameras/channels";
import { accountStore } from "@/server/auth/accounts";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request: Request) {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  const body = (await request.json().catch(() => null)) as { path?: unknown } | null;
  const streamPath = typeof body?.path === "string" ? body.path : "";
  if (!describeStreamPath(streamPath)) return NextResponse.json({ error: "Stream unavailable" }, { status: 404 });
  accountStore(getConfig().dataDir).touchPresence(auth.userId, streamPath);
  return NextResponse.json({ ok: true });
}
