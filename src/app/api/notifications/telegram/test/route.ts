import { NextResponse } from "next/server";
import { requireAdmin } from "@/server/http/require-user";
import {
  buildTelegramTestMessage,
  sendTelegramMessage,
  telegramFailureMessage,
} from "@/server/notifications/telegram";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

/**
 * Send one Telegram test message. ADMIN only.
 *
 * The request body is ignored on purpose: the bot token and chat id come from
 * the server environment only, so a caller can never supply (or read back) a
 * credential. The response carries a status and a safe sentence — never the
 * token, the chat id or the Bot API URL.
 */
export async function POST() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const result = await sendTelegramMessage({ text: buildTelegramTestMessage() });
  const message = telegramFailureMessage(result);

  if (result.ok) {
    return NextResponse.json({ ok: true, message });
  }

  const status =
    result.status === "not_configured" || result.status === "invalid_chat_id"
      ? 503
      : result.status === "disabled"
        ? 409
        : 502;
  return NextResponse.json({ ok: false, reason: result.status, error: message }, { status });
}
