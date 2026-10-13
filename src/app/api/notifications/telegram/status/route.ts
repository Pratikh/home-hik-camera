import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/http/require-user";
import { telegramMediaStatus } from "@/server/notifications/telegram-media";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Read-only Telegram status for the settings page. ADMIN only.
 *
 * It reports booleans and durations — never the bot token, the chat id, the Bot
 * API URL or any DVR detail. It also tells the operator whether FFmpeg is
 * present, which is the usual reason a clip is not attached.
 */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json(await telegramMediaStatus());
}
