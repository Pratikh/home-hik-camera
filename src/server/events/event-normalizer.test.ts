import { describe, expect, it } from "vitest";
import { attachStops, classificationFromAddition, parseAlarmLogs } from "@/server/events/event-normalizer";
import { createAIProvider } from "@/server/ai/ai-provider";

const xml = `<?xml version="1.0" encoding="UTF-8"?>
<CMSearchResult>
  <responseStatusStrg>OK</responseStatusStrg>
  <matchList>
    <searchMatchItem><logDescriptor>
      <metaId>log.hikvision.com/Alarm/motionStart/1</metaId>
      <StartDateTime>2026-10-07T18:42:13Z</StartDateTime>
      <additionInformation>Human</additionInformation>
    </logDescriptor></searchMatchItem>
    <searchMatchItem><logDescriptor>
      <metaId>log.hikvision.com/Alarm/motionStop/1</metaId>
      <StartDateTime>2026-10-07T18:42:25Z</StartDateTime>
      <additionInformation>Human</additionInformation>
    </logDescriptor></searchMatchItem>
    <searchMatchItem><logDescriptor>
      <metaId>log.hikvision.com/Alarm/motionStart/2</metaId>
      <StartDateTime>2026-10-07T17:31:04Z</StartDateTime>
      <additionInformation>Vehicle</additionInformation>
    </logDescriptor></searchMatchItem>
    <searchMatchItem><logDescriptor>
      <metaId>log.hikvision.com/Exception/ezvizOffline</metaId>
      <StartDateTime>2026-10-07T03:02:39Z</StartDateTime>
    </logDescriptor></searchMatchItem>
  </matchList>
</CMSearchResult>`;

describe("event normalization", () => {
  it("pairs motion start and stop and keeps person separate from the motion type", () => {
    const parsed = parseAlarmLogs(xml);
    const paired = attachStops(parsed.starts, parsed.stops);
    expect(parsed.starts).toHaveLength(2);
    expect(paired.events.find((event) => event.cameraId === 1)).toMatchObject({
      type: "motion",
      classification: "person",
      timestamp: "2026-10-07T18:42:13+05:30",
      endTimestamp: "2026-10-07T18:42:25+05:30",
    });
    expect(paired.events.find((event) => event.cameraId === 2)).toMatchObject({ classification: "vehicle", endTimestamp: null });
    expect(JSON.stringify(paired)).not.toContain("ezviz");
    expect(classificationFromAddition("")).toBeNull();
    expect(classificationFromAddition("Human")).toBe("person");
  });

  it("ignores a repeated event key", () => {
    const parsed = parseAlarmLogs(xml);
    expect(parsed.starts[0]?.dedupeKey).toBe(parsed.starts[0]?.dedupeKey);
    const again = parseAlarmLogs(xml);
    expect(again.starts[0]?.id).toBe(parsed.starts[0]?.id);
  });

  it("keeps AI disabled unless explicitly enabled, and never invents confidence", async () => {
    expect(await createAIProvider(false).analyzeImage({ eventId: "evt_1", classification: "person" })).toBeNull();
    const enabled = createAIProvider(true);
    expect(enabled.name).toBe("dvr");
    expect(await enabled.analyzeImage({ eventId: "evt_1", classification: "person" })).toEqual({
      label: "person",
      confidence: null,
    });
  });
});
