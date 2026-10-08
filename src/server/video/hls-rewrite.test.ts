import { describe, expect, it } from "vitest";
import { rewriteHlsPlaylist } from "@/server/video/hls-rewrite";

describe("HLS rewrite", () => {
  it("points playlist URIs at the same-origin proxy", () => {
    const playlist = [
      "#EXTM3U",
      "#EXT-X-STREAM-INF:BANDWIDTH=800000",
      "video.m3u8?session=abc",
      '#EXT-X-MEDIA:URI="http://mediamtx:8888/cam1_sub/audio.m3u8"',
      "http://mediamtx:8888/cam1_sub/segment.ts",
    ].join("\n");
    const rewritten = rewriteHlsPlaylist(playlist, "cam1_sub");
    expect(rewritten).toContain("/api/hls/cam1_sub/video.m3u8?session=abc");
    expect(rewritten).toContain('URI="/api/hls/cam1_sub/audio.m3u8"');
    expect(rewritten).toContain("/api/hls/cam1_sub/segment.ts");
    expect(rewritten).not.toContain("mediamtx:8888");
  });
});
