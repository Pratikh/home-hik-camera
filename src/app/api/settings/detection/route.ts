import { NextResponse } from "next/server";
import type { DetectionSettingsResponse } from "@/lib/api-types";
import { getConfig } from "@/lib/config";
import {
  DETECTION_SOURCES,
  DETECTION_SOURCE_DESCRIPTIONS,
  DETECTION_SOURCE_LABELS,
  OBJECT_DETECTION_MODEL,
  validateCameraDetectionSettings,
  validateObjectDetectionSettings,
  workerHeartbeatFresh,
} from "@/lib/object-detection";
import { CAMERA_IDS } from "@/lib/cameras";
import { accountStore } from "@/server/auth/accounts";
import {
  objectDetectionConfig,
  readObjectWorkerHeartbeat,
  saveObjectDetectionConfig,
} from "@/server/detection/settings-store";
import { openEventStore } from "@/server/events/event-store";
import { requireAdmin } from "@/server/http/require-user";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 32 * 1024;

function response(now = Date.now()): DetectionSettingsResponse {
  const dataDir = getConfig().dataDir;
  const store = openEventStore(dataDir);
  const config = objectDetectionConfig(dataDir);
  const worker = readObjectWorkerHeartbeat(store.db);
  return {
    settings: config.settings,
    cameras: config.cameras,
    worker,
    workerFresh: workerHeartbeatFresh(worker?.updatedAt ?? null, now),
    model: { ...OBJECT_DETECTION_MODEL, rawClasses: OBJECT_DETECTION_MODEL.rawClasses },
    detectionSources: DETECTION_SOURCES.map((value) => ({
      value,
      label: DETECTION_SOURCE_LABELS[value],
      description: DETECTION_SOURCE_DESCRIPTIONS[value],
    })),
  };
}

/** The full object-detection configuration, including the worker heartbeat. */
export async function GET() {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;
  return NextResponse.json(response());
}

/**
 * Replace the configuration. ADMIN only, validated server-side.
 *
 * The Python worker polls the same rows every few seconds, so a successful save
 * applies without restarting a container. Invalid input changes nothing.
 */
export async function PUT(request: Request) {
  const auth = await requireAdmin();
  if (!auth.ok) return auth.response;

  const raw = await request.text();
  if (raw.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Configuration body is too large." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(raw) as unknown;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body !== "object" || body === null) {
    return NextResponse.json({ error: "Invalid configuration body." }, { status: 400 });
  }
  const record = body as { settings?: unknown; cameras?: unknown };

  const settings = validateObjectDetectionSettings(record.settings);
  if (!settings.ok) {
    return NextResponse.json({ error: settings.errors.join("; "), errors: settings.errors }, { status: 400 });
  }
  const cameras = validateCameraDetectionSettings(record.cameras, CAMERA_IDS);
  if (!cameras.ok) {
    return NextResponse.json({ error: cameras.errors.join("; "), errors: cameras.errors }, { status: 400 });
  }

  const config = getConfig();
  const store = openEventStore(config.dataDir);
  saveObjectDetectionConfig(store.db, { settings: settings.value, cameras: cameras.value });

  accountStore(config.dataDir).writeAudit({
    userId: auth.userId,
    action: "DETECTION_SETTINGS_UPDATED",
    resource: "object-detection",
    metadata: {
      enabled: settings.value.enabled,
      personConfidence: settings.value.personConfidence,
      vehicleConfidence: settings.value.vehicleConfidence,
      detectionSource: settings.value.detectionSource,
      cameras: cameras.value.filter((camera) => camera.enabled).length,
    },
    ip: request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || null,
    userAgent: request.headers.get("user-agent"),
  });

  return NextResponse.json(response());
}
