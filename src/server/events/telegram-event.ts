import "server-only";
import type { AppConfig } from "@/lib/config";
import type { EventClassification, EventType } from "@/lib/events";
import type { EventPriority } from "@/lib/priority";
import {
  notifyTelegramEvent,
  type TelegramEventInput,
  type TelegramResult,
} from "@/server/notifications/telegram";

/**
 * Deliver one accepted general notification-rule decision to Telegram.
 *
 * The decision itself (rule match, priority, schedule, quiet hours, cooldown and
 * duplicate protection) has already been made and recorded. This function only
 * delivers, so a Telegram failure can never suppress the browser notification
 * or change the stored decision.
 *
 * Gated by BOTH the Telegram master switch and TELEGRAM_EVENT_NOTIFICATIONS;
 * the face-test path has its own flag and is untouched.
 */
export type TelegramEventDelivery = "sent" | "disabled" | "failed";

export async function deliverTelegramEvent(input: {
  event: {
    id: string;
    cameraId: number;
    type: EventType;
    classification: EventClassification | null;
    priority: EventPriority;
    timestamp: string;
  };
  cameraName: string;
  ruleName?: string | null;
  config: Pick<
    AppConfig,
    | "telegramNotificationsEnabled"
    | "telegramEventNotifications"
    | "telegramBotToken"
    | "telegramChatId"
    | "telegramFaceNotifications"
  >;
  /** Injected in tests. Defaults to the real Bot API sender. */
  telegram?: (payload: TelegramEventInput) => Promise<TelegramResult>;
  log?: (line: string) => void;
}): Promise<TelegramEventDelivery> {
  const { event, config } = input;
  if (!config.telegramNotificationsEnabled || !config.telegramEventNotifications) return "disabled";

  const payload: TelegramEventInput = {
    cameraName: input.cameraName,
    type: event.type,
    classification: event.classification,
    priority: event.priority,
    eventTimestamp: event.timestamp,
    ruleName: input.ruleName ?? null,
  };

  const log = input.log ?? ((line: string) => console.info(`[telegram] ${line}`));
  try {
    const result = input.telegram
      ? await input.telegram(payload)
      : await notifyTelegramEvent({ ...payload, config });
    if (result.ok) {
      log(`event=${event.id} camera=${event.cameraId} result=sent`);
      return "sent";
    }
    log(`event=${event.id} camera=${event.cameraId} result=${result.status}`);
    return result.status === "disabled" || result.status === "not_configured" ? "disabled" : "failed";
  } catch (error) {
    // The sender is fail-safe; a throw must never escape into event processing.
    log(`event=${event.id} camera=${event.cameraId} result=error name=${error instanceof Error ? error.name : "error"}`);
    return "failed";
  }
}
