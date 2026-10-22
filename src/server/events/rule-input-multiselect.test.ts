import { describe, expect, it } from "vitest";
import { parseRuleBody } from "@/server/events/rule-input";

const base = {
  name: "Multi rule",
  enabled: true,
  minimumPriority: null,
  scheduleStart: null,
  scheduleEnd: null,
  daysOfWeek: [],
  quietHoursStart: null,
  quietHoursEnd: null,
  quietHoursBehavior: "suppress",
  cooldownSeconds: 300,
};

describe("rule input - multi-select validation", () => {
  it("accepts known camera ids and event filters", () => {
    const parsed = parseRuleBody(
      { ...base, cameraIds: [1, 3], eventTypes: ["person", "vehicle"] },
      "rule-1",
    );
    expect(parsed).not.toBeNull();
    expect(parsed?.cameraIds).toEqual([1, 3]);
    expect(parsed?.eventTypes).toEqual(["person", "vehicle"]);
    expect(parsed?.cameraId).toBeNull();
    expect(parsed?.eventType).toBe("motion");
    expect(parsed?.classification).toBeNull();
  });

  it("rejects an empty camera or event selection, never treating it as all", () => {
    expect(parseRuleBody({ ...base, cameraIds: [], eventTypes: ["person"] }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...base, cameraIds: [1], eventTypes: [] }, "rule-1")).toBeNull();
  });

  it("rejects unknown, malformed, and non-array camera/event values", () => {
    expect(parseRuleBody({ ...base, cameraIds: [1, 9], eventTypes: ["person"] }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...base, cameraIds: ["1"], eventTypes: ["person"] }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...base, cameraIds: "1", eventTypes: ["person"] }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...base, cameraIds: [1], eventTypes: ["person", "intrusion"] }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...base, cameraIds: [1], eventTypes: ["explosion"] }, "rule-1")).toBeNull();
    expect(parseRuleBody({ ...base, cameraIds: [1], eventTypes: "person" }, "rule-1")).toBeNull();
  });

  it("deduplicates repeated known values instead of storing duplicates", () => {
    const parsed = parseRuleBody(
      { ...base, cameraIds: [1, 1, 3], eventTypes: ["person", "person", "motion"] },
      "rule-1",
    );
    expect(parsed?.cameraIds).toEqual([1, 3]);
    expect(parsed?.eventTypes).toEqual(["person", "motion"]);
  });

  it("lets arrays win when a caller sends both array and legacy fields", () => {
    const parsed = parseRuleBody(
      {
        ...base,
        cameraId: 2,
        eventType: "motion",
        classification: "person",
        cameraIds: [1, 4],
        eventTypes: ["vehicle"],
      },
      "rule-1",
    );
    expect(parsed?.cameraIds).toEqual([1, 4]);
    expect(parsed?.eventTypes).toEqual(["vehicle"]);
    expect(parsed?.cameraId).toBeNull();
    expect(parsed?.classification).toBe("vehicle");
  });

  it("still accepts the legacy single camera and event form", () => {
    const parsed = parseRuleBody(
      { ...base, cameraId: 2, eventType: "motion", classification: "person" },
      "rule-1",
    );
    expect(parsed?.cameraIds).toEqual([2]);
    expect(parsed?.eventTypes).toEqual(["person"]);
    expect(parsed?.cameraId).toBe(2);
    expect(parsed?.classification).toBe("person");
  });

  it("derives a readable name for a multi-select rule", () => {
    const parsed = parseRuleBody(
      { ...base, name: "", cameraIds: [1, 2], eventTypes: ["person", "vehicle"] },
      "rule-1",
    );
    expect(parsed?.name).toBe("Person, Vehicle - Cameras 1, 2");
  });
});
