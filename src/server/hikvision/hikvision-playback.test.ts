import { describe, expect, it } from "vitest";
import { HikvisionError } from "@/server/hikvision/hikvision-types";
import { parseSearchPage } from "@/server/hikvision/hikvision-playback-parse";
import {
  HikvisionPlaybackClient,
  buildPlaybackRtsp,
  dedupeRecordings,
  searchDescription,
  searchRecordings,
} from "@/server/hikvision/hikvision-playback";

const page = (status: string, items: string) => `<?xml version="1.0" encoding="UTF-8"?>
<CMSearchResult>
  <responseStatus>true</responseStatus>
  <responseStatusStrg>${status}</responseStatusStrg>
  <numOfMatches>1</numOfMatches>
  <matchList>${items}</matchList>
</CMSearchResult>`;

const item = (start: string, end: string, descriptor = "recordType.meta.hikvision.com/timing") => `
<searchMatchItem>
  <trackID>101</trackID>
  <timeSpan><startTime>${start}</startTime><endTime>${end}</endTime></timeSpan>
  <mediaSegmentDescriptor>
    <playbackURI>rtsp://192.0.2.10/Streaming/tracks/101/?starttime=20261007T081500Z&amp;endtime=20261007T094500Z</playbackURI>
  </mediaSegmentDescriptor>
  <metadataMatches><metadataDescriptor>${descriptor}</metadataDescriptor></metadataMatches>
</searchMatchItem>`;

describe("Hikvision recording search", () => {
  it("normalizes local Z timestamps and hides the playback URI", () => {
    const parsed = parseSearchPage(
      page("OK", item("2026-10-07T08:15:00Z", "2026-10-07T09:45:00Z")),
      1,
    );
    expect(parsed.recordings).toEqual([
      expect.objectContaining({
        camera: 1,
        startTime: "2026-10-07T08:15:00+05:30",
        endTime: "2026-10-07T09:45:00+05:30",
        type: "continuous",
        label: "Continuous",
      }),
    ]);
    expect(JSON.stringify(parsed)).not.toContain("rtsp://");
  });

  it("returns an empty list when the DVR has no matches", async () => {
    const recordings = await searchRecordings(
      { postXml: async () => page("NO MATCHES", "") },
      { camera: 1, date: "2026-10-07", startTime: "00:00", endTime: "23:59" },
    );
    expect(recordings).toEqual([]);
  });

  it("pages, drops invalid rows, and removes duplicates", async () => {
    const calls: string[] = [];
    const recordings = await searchRecordings(
      {
        postXml: async (_path, body) => {
          calls.push(body);
          if (calls.length === 1) {
            return page(
              "MORE",
              item("2026-10-07T08:15:00Z", "2026-10-07T09:45:00Z") +
                item("not-a-time", "2026-10-07T10:00:00Z"),
            );
          }
          return page("OK", item("2026-10-07T08:15:00Z", "2026-10-07T09:45:00Z", "recordType.meta.hikvision.com/motion"));
        },
      },
      { camera: 1, date: "2026-10-07", startTime: "00:00", endTime: "23:59" },
    );
    expect(calls).toHaveLength(2);
    expect(calls[0]).toContain("<trackID>101</trackID>");
    expect(calls[0]).toContain("searchResultPostion");
    expect(calls[1]).toContain("<searchResultPostion>1</searchResultPostion>");
    expect(dedupeRecordings(recordings)).toHaveLength(1);
    expect(recordings[0]?.type).toBe("continuous");
  });

  it("reports the DVR offline and an authentication failure", async () => {
    const client = new HikvisionPlaybackClient(
      {
        postXml: async () => {
          throw new HikvisionError("offline", "DVR offline");
        },
      },
      { host: "192.0.2.10", port: 554, username: "admin", password: "p@ss word" },
    );
    await expect(
      client.searchRecordings({ camera: 1, date: "2026-10-07", startTime: "00:00", endTime: "23:59" }),
    ).rejects.toMatchObject({ code: "offline" });

    const denied = new HikvisionPlaybackClient(
      {
        postXml: async () => {
          throw new HikvisionError("auth_failed", "DVR authentication failed", 401);
        },
      },
      { host: "192.0.2.10", port: 554, username: "admin", password: "p@ss word" },
    );
    await expect(
      denied.searchRecordings({ camera: 1, date: "2026-10-07", startTime: "00:00", endTime: "23:59" }),
    ).rejects.toMatchObject({ code: "auth_failed", message: "DVR authentication failed" });
  });

  it("builds a server-side playback URL without putting the password in the query", () => {
    const target = { host: "192.0.2.10", port: 554, username: "admin", password: "p@ss word" };
    const client = new HikvisionPlaybackClient({ postXml: async () => "" }, target);
    const recording = parseSearchPage(page("OK", item("2026-10-07T08:15:00Z", "2026-10-07T09:45:00Z")), 1).recordings[0];
    if (!recording) throw new Error("missing recording");
    const url = client.getPlaybackUrl(recording);
    const query = url.slice(url.indexOf("?"));
    /*
     * The H.264 sub track, not the H.265 main track: MediaMTX's MPEG-TS HLS
     * variant cannot carry H.265, which is what broke /playback remotely.
     */
    expect(url).toContain("/Streaming/tracks/102/?starttime=20261007T081500Z&endtime=20261007T094500Z");
    expect(query).not.toContain("p@ss");
    expect(query).not.toContain("p%40ss");
    expect(url).toContain(encodeURIComponent("p@ss word"));
    expect(client.getRecording([recording], recording.id)?.id).toBe(recording.id);
    expect(client.downloadRecording()).toEqual({
      available: false,
      message: "Download is not available for this recording.",
    });
    expect(searchDescription({
      searchId: "abc",
      track: 101,
      start: new Date("2026-10-07T00:00:00+05:30"),
      end: new Date("2026-10-07T23:59:59+05:30"),
      position: 0,
    })).toContain("<startTime>2026-10-07T00:00:00+05:30</startTime>");
    expect(buildPlaybackRtsp({ ...target, track: 201, start: new Date("2026-10-07T08:15:00+05:30"), end: new Date("2026-10-07T09:45:00+05:30") })).toContain("/Streaming/tracks/201/");
    // Camera 4's sub track is the highest valid playback track; 402 must build.
    expect(buildPlaybackRtsp({ ...target, track: 402, start: new Date("2026-10-07T08:15:00+05:30"), end: new Date("2026-10-07T09:45:00+05:30") })).toContain("/Streaming/tracks/402/");
    expect(() => buildPlaybackRtsp({ ...target, track: 403, start: new Date("2026-10-07T08:15:00+05:30"), end: new Date("2026-10-07T09:45:00+05:30") })).toThrow(HikvisionError);
    expect(() => buildPlaybackRtsp({ ...target, track: 100, start: new Date("2026-10-07T08:15:00+05:30"), end: new Date("2026-10-07T09:45:00+05:30") })).toThrow(HikvisionError);
  });
});
