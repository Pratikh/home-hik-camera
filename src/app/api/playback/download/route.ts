import { NextResponse } from "next/server";
import { DOWNLOAD_UNAVAILABLE } from "@/lib/recording";
import { requireUser } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  const auth = await requireUser();
  if (!auth.ok) return auth.response;
  return NextResponse.json({ error: DOWNLOAD_UNAVAILABLE.message }, { status: 501 });
}
