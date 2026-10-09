import { describe, expect, it } from "vitest";
import path from "node:path";
import { faceCropFile, faceCropsDir } from "@/lib/face-path";

/**
 * FACE-012 — a stored crop path can never point outside DATA_DIR/face-crops.
 *
 * A crop path is only ever resolved after a face id has been looked up in the
 * database, but the stored value is still treated as hostile.
 */
describe("face crop path resolution", () => {
  const dataDir = "/tmp/face-qa";

  it("resolves a normal generated path inside the crop directory", () => {
    const resolved = faceCropFile(dataDir, "2026/10/evt_0123456789abcdef01234567-face-1.jpg");
    expect(resolved).toBe(
      path.join(faceCropsDir(dataDir), "2026", "10", "evt_0123456789abcdef01234567-face-1.jpg"),
    );
    expect(resolved!.startsWith(faceCropsDir(dataDir))).toBe(true);
  });

  it("FACE-012 rejects traversal in any position", () => {
    const evil = [
      "../outside.jpg",
      "../../etc/passwd",
      "2026/10/../../../outside.jpg",
      "2026/../../outside.jpg",
      "..",
      "2026/10/..",
    ];
    for (const value of evil) {
      expect(faceCropFile(dataDir, value), `must reject ${value}`).toBeNull();
    }
  });

  it("normalises a harmless dot segment but still stays inside the root", () => {
    const resolved = faceCropFile(dataDir, "2026/10/./x.jpg");
    expect(resolved).toBe(path.join(faceCropsDir(dataDir), "2026", "10", "x.jpg"));
    expect(resolved!.startsWith(`${faceCropsDir(dataDir)}${path.sep}`)).toBe(true);
  });

  it("FACE-012 rejects absolute paths and drive letters", () => {
    for (const value of ["/etc/passwd", "//server/share/x.jpg", "C:/windows/win.ini", "C:\\windows\\win.ini"]) {
      expect(faceCropFile(dataDir, value), `must reject ${value}`).toBeNull();
    }
  });

  it("FACE-012 rejects a NUL byte and empty values", () => {
    expect(faceCropFile(dataDir, "2026/10/x\u0000.jpg")).toBeNull();
    expect(faceCropFile(dataDir, "")).toBeNull();
    expect(faceCropFile(dataDir, "   ")).toBeNull();
    expect(faceCropFile(dataDir, null)).toBeNull();
    expect(faceCropFile(dataDir, undefined)).toBeNull();
  });

  it("rejects the crop directory itself", () => {
    expect(faceCropFile(dataDir, ".")).toBeNull();
  });

  it("accepts a Windows-style separator only as a separator, never as an escape", () => {
    // Backslashes are normalised, so this is a legitimate nested path...
    expect(faceCropFile(dataDir, "2026\\10\\face.jpg")).toBe(
      path.join(faceCropsDir(dataDir), "2026", "10", "face.jpg"),
    );
    // ...but traversal is still traversal.
    expect(faceCropFile(dataDir, "2026\\..\\..\\face.jpg")).toBeNull();
  });

  it("keeps the crop directory under the configured data directory", () => {
    expect(faceCropsDir(dataDir)).toBe(path.resolve(dataDir, "face-crops"));
  });
});
