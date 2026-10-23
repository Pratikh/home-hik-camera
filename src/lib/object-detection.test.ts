import { describe, expect, it } from "vitest";
import {
  CAMERA_DETECTION_DEFAULTS,
  OBJECT_DETECTION_DEFAULTS,
  classificationForRawClass,
  effectiveCameraDetection,
  effectiveDetectionSource,
  validateCameraDetectionSettings,
  validateObjectDetectionSettings,
  workerHeartbeatFresh,
  type CameraDetectionSettings,
} from "@/lib/object-detection";

/**
 * Settings are validated on the server, so these tests pin the exact bounds the
 * Admin form promises: confidence 50–99 %, sampling 0.5–5 FPS, one to four
 * concurrent inferences, and a bounded queue.
 */

describe("object detection defaults", () => {
  it("ships switched off with safe sampling and thresholds", () => {
    expect(OBJECT_DETECTION_DEFAULTS.enabled).toBe(false);
    expect(OBJECT_DETECTION_DEFAULTS.personConfidence).toBe(0.7);
    expect(OBJECT_DETECTION_DEFAULTS.vehicleConfidence).toBe(0.7);
    expect(OBJECT_DETECTION_DEFAULTS.baseFps).toBe(1);
    expect(OBJECT_DETECTION_DEFAULTS.activeFps).toBe(3);
    expect(OBJECT_DETECTION_DEFAULTS.maxFps).toBe(5);
    expect(OBJECT_DETECTION_DEFAULTS.detectionSource).toBe("ai_only");
    expect(CAMERA_DETECTION_DEFAULTS.enabled).toBe(false);
    expect(CAMERA_DETECTION_DEFAULTS.personConfidence).toBeNull();
  });

  it("maps the raw detector classes onto person and vehicle", () => {
    expect(classificationForRawClass("person")).toBe("person");
    for (const raw of ["car", "motorcycle", "bus", "truck"] as const) {
      expect(classificationForRawClass(raw)).toBe("vehicle");
    }
  });
});

describe("validateObjectDetectionSettings", () => {
  it("accepts the documented defaults", () => {
    const result = validateObjectDetectionSettings(OBJECT_DETECTION_DEFAULTS);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toEqual(OBJECT_DETECTION_DEFAULTS);
  });

  it("accepts a precise threshold such as 73%", () => {
    const result = validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, personConfidence: 0.73 });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.personConfidence).toBe(0.73);
  });

  it("rejects thresholds outside 50–99 %", () => {
    for (const value of [0.49, 0.5 - 0.01, 1, 1.2]) {
      const result = validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, personConfidence: value });
      expect(result.ok).toBe(false);
    }
    const low = validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, vehicleConfidence: 0.2 });
    expect(low.ok).toBe(false);
    if (!low.ok) expect(low.errors.join(" ")).toContain("vehicleConfidence");
  });

  it("rejects sampling outside 0.5–5 FPS", () => {
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, baseFps: 0.4 }).ok).toBe(false);
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, baseFps: 6 }).ok).toBe(false);
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, baseFps: 2 }).ok).toBe(true);
  });

  it("requires max FPS >= active FPS >= base FPS", () => {
    const bad = validateObjectDetectionSettings({
      ...OBJECT_DETECTION_DEFAULTS,
      baseFps: 5,
      activeFps: 3,
      maxFps: 5,
    });
    expect(bad.ok).toBe(false);

    const noHeadroom = validateObjectDetectionSettings({
      ...OBJECT_DETECTION_DEFAULTS,
      baseFps: 1,
      activeFps: 5,
      maxFps: 3,
    });
    expect(noHeadroom.ok).toBe(false);
  });

  it("bounds concurrency, queue and timeouts", () => {
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, maxConcurrentInference: 0 }).ok).toBe(false);
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, maxConcurrentInference: 5 }).ok).toBe(false);
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, queueSize: 0 }).ok).toBe(false);
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, queueSize: 11 }).ok).toBe(false);
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, disappearanceThresholdSeconds: 0 }).ok).toBe(
      false,
    );
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, disappearanceThresholdSeconds: 11 }).ok).toBe(
      false,
    );
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, activityTimeoutSeconds: 0 }).ok).toBe(false);
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, activityTimeoutSeconds: 61 }).ok).toBe(false);
  });

  it("rejects non-integer concurrency and unknown detection sources", () => {
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, maxConcurrentInference: 1.5 }).ok).toBe(false);
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, detectionSource: "both" }).ok).toBe(false);
  });

  it("rejects wrong value types", () => {
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, enabled: "yes" }).ok).toBe(false);
    expect(validateObjectDetectionSettings({ ...OBJECT_DETECTION_DEFAULTS, personConfidence: "0.7" }).ok).toBe(false);
    expect(validateObjectDetectionSettings(null).ok).toBe(false);
    expect(validateObjectDetectionSettings([]).ok).toBe(false);
  });

  it("fills missing fields from the defaults", () => {
    const result = validateObjectDetectionSettings({ enabled: true });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.enabled).toBe(true);
      expect(result.value.personConfidence).toBe(OBJECT_DETECTION_DEFAULTS.personConfidence);
    }
  });
});

describe("validateCameraDetectionSettings", () => {
  const CAMERAS = [1, 2, 3, 4];

  it("accepts a global override and a custom threshold per camera", () => {
    const result = validateCameraDetectionSettings(
      [
        { cameraId: 1, enabled: true, personEnabled: true, personConfidence: null, vehicleEnabled: true, vehicleConfidence: 0.7 },
        { cameraId: 2, enabled: true, personEnabled: true, personConfidence: 0.85, vehicleEnabled: false, vehicleConfidence: null },
      ],
      CAMERAS,
    );
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value).toHaveLength(2);
      expect(result.value[0]!.personConfidence).toBeNull();
      expect(result.value[1]!.personConfidence).toBe(0.85);
      expect(result.value[1]!.vehicleEnabled).toBe(false);
    }
  });

  it("rejects unknown, duplicate or non-integer camera ids", () => {
    expect(validateCameraDetectionSettings([{ cameraId: 5, enabled: true }], CAMERAS).ok).toBe(false);
    expect(validateCameraDetectionSettings([{ cameraId: 1 }, { cameraId: 1 }], CAMERAS).ok).toBe(false);
    expect(validateCameraDetectionSettings([{ cameraId: 1.5 }], CAMERAS).ok).toBe(false);
    expect(validateCameraDetectionSettings([{ cameraId: "1" }], CAMERAS).ok).toBe(false);
    expect(validateCameraDetectionSettings("nope", CAMERAS).ok).toBe(false);
  });

  it("rejects an out-of-range camera threshold", () => {
    expect(validateCameraDetectionSettings([{ cameraId: 1, personConfidence: 0.2 }], CAMERAS).ok).toBe(false);
    expect(validateCameraDetectionSettings([{ cameraId: 1, vehicleConfidence: 1.2 }], CAMERAS).ok).toBe(false);
  });
});

describe("effectiveCameraDetection", () => {
  const camera = (patch: Partial<CameraDetectionSettings> = {}): CameraDetectionSettings => ({
    ...CAMERA_DETECTION_DEFAULTS,
    cameraId: 1,
    enabled: true,
    ...patch,
  });

  it("is off when the master switch is off, whatever the camera says", () => {
    const global = { ...OBJECT_DETECTION_DEFAULTS, enabled: false };
    expect(effectiveCameraDetection(global, camera()).enabled).toBe(false);
  });

  it("is off when the camera is off", () => {
    const global = { ...OBJECT_DETECTION_DEFAULTS, enabled: true };
    expect(effectiveCameraDetection(global, camera({ enabled: false })).enabled).toBe(false);
  });

  it("uses global thresholds unless the camera overrides them", () => {
    const global = { ...OBJECT_DETECTION_DEFAULTS, enabled: true, personConfidence: 0.7, vehicleConfidence: 0.65 };
    const effective = effectiveCameraDetection(global, camera({ personConfidence: 0.9 }));
    expect(effective.enabled).toBe(true);
    expect(effective.person.confidence).toBe(0.9);
    expect(effective.vehicle.confidence).toBe(0.65);
  });

  it("requires both the global and the camera class switch", () => {
    const global = { ...OBJECT_DETECTION_DEFAULTS, enabled: true, personEnabled: false };
    const effective = effectiveCameraDetection(global, camera({ vehicleEnabled: false }));
    expect(effective.person.enabled).toBe(false);
    expect(effective.vehicle.enabled).toBe(false);
  });
});

describe("workerHeartbeatFresh", () => {
  it("treats a missing or old heartbeat as stale", () => {
    const now = Date.parse("2026-10-23T16:00:00+05:30");
    expect(workerHeartbeatFresh(null, now)).toBe(false);
    expect(workerHeartbeatFresh("2026-10-23T15:59:45+05:30", now)).toBe(true);
    expect(workerHeartbeatFresh("2026-10-23T15:58:00+05:30", now)).toBe(false);
    expect(workerHeartbeatFresh("not-a-date", now)).toBe(false);
  });
});

describe("effective detection source", () => {
  it("uses the configured source while object detection is enabled", () => {
    for (const source of ["ai_only", "dvr_only", "ai_both"] as const) {
      expect(effectiveDetectionSource({ enabled: true, detectionSource: source })).toBe(source);
    }
  });

  it("restores the historical DVR behaviour while object detection is disabled", () => {
    // There are no AI events to prefer when the detector is off; a stored
    // "AI only" default must not suppress DVR Human/Vehicle notifications.
    expect(effectiveDetectionSource({ enabled: false, detectionSource: "ai_only" })).toBe("ai_both");
    expect(effectiveDetectionSource({ enabled: false, detectionSource: "dvr_only" })).toBe("ai_both");
    expect(effectiveDetectionSource({ enabled: false, detectionSource: "ai_both" })).toBe("ai_both");
    expect(effectiveDetectionSource(OBJECT_DETECTION_DEFAULTS)).toBe("ai_both");
  });
});
