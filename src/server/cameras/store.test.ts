import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCameraNames, writeCameraName } from "@/server/cameras/store";

describe("camera names", () => {
  it("persists display names and falls back to Camera N", async () => {
    const dir = await mkdtemp(path.join(tmpdir(), "cctv-names-"));
    const initial = await readCameraNames(dir);
    expect(initial[1]).toBe("Camera 1");
    await writeCameraName(dir, 2, "Garage");
    const saved = JSON.parse(await readFile(path.join(dir, "cameras.json"), "utf8")) as {
      names: Record<string, string>;
    };
    expect(saved.names["2"]).toBe("Garage");
    const next = await readCameraNames(dir);
    expect(next[2]).toBe("Garage");
    expect(next[3]).toBe("Camera 3");
    await expect(writeCameraName(dir, 2, " ")).rejects.toThrow();
  });
});
