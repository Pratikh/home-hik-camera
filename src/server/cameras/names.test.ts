import { describe, expect, it } from "vitest";
import { namesFromChannels, resolveCameraNames } from "@/server/cameras/names";

/**
 * Camera display-name resolution.
 *
 * Precedence: an explicit local override wins, otherwise the name configured on
 * the DVR, otherwise the generic "Camera N" fallback. The DVR is the source of
 * truth by default so renaming a channel on the DVR needs no code change, while
 * the UI never breaks when the DVR cannot be read.
 */

const DVR = {
  1: "Parking",
  2: "Right Side Outside Camera",
  3: "First Floor Passage",
  4: "Left Side Outside",
};

describe("names from DVR channels", () => {
  it("maps channel ids to their names", () => {
    const names = namesFromChannels([
      { id: 1, name: "Parking" },
      { id: 2, name: "Right Side Outside Camera" },
    ]);
    expect(names).toEqual({ 1: "Parking", 2: "Right Side Outside Camera" });
  });

  it("ignores channels with no name", () => {
    expect(namesFromChannels([{ id: 1, name: null }, { id: 2, name: "   " }])).toEqual({});
  });

  it("ignores channel ids outside the camera range", () => {
    const names = namesFromChannels([
      { id: 0, name: "Zero" },
      { id: 9, name: "Nine" },
      { id: 2, name: "Two" },
    ]);
    expect(names).toEqual({ 2: "Two" });
  });

  it("returns nothing when the DVR did not report channels", () => {
    expect(namesFromChannels(null)).toEqual({});
  });

  it("rejects names the UI cannot display", () => {
    // normalizeCameraName strips anything outside its allowed character set.
    const names = namesFromChannels([{ id: 1, name: "!!!@@@" }]);
    expect(names[1]).toBeUndefined();
  });
});

describe("camera name precedence", () => {
  it("prefers the DVR name over the generic fallback", () => {
    const { names, fromDvr } = resolveCameraNames({}, DVR);
    expect(names[1]).toBe("Parking");
    expect(names[2]).toBe("Right Side Outside Camera");
    expect(names[3]).toBe("First Floor Passage");
    expect(names[4]).toBe("Left Side Outside");
    expect(fromDvr).toBe(true);
  });

  it("falls back to the generic name when the DVR reports nothing", () => {
    const { names, fromDvr } = resolveCameraNames({}, {});
    expect(names).toEqual({ 1: "Camera 1", 2: "Camera 2", 3: "Camera 3", 4: "Camera 4" });
    expect(fromDvr).toBe(false);
  });

  it("lets an explicit local override win over the DVR name", () => {
    const { names } = resolveCameraNames({ 2: "Driveway" }, DVR);
    expect(names[2]).toBe("Driveway");
    expect(names[1]).toBe("Parking");
  });

  it("treats a saved generic name as no override, so the DVR name shows", () => {
    // Regression: an install that had stored "Camera 1" used to be stuck on it
    // forever and never picked up the DVR name for that channel.
    const { names } = resolveCameraNames({ 1: "Camera 1" }, DVR);
    expect(names[1]).toBe("Parking");
  });

  it("still honours a saved name that merely resembles a generic one", () => {
    const { names } = resolveCameraNames({ 1: "Camera One" }, DVR);
    expect(names[1]).toBe("Camera One");
  });

  it("always returns a name for every camera, whatever the DVR reports", () => {
    const { names } = resolveCameraNames({ 3: "Stairs" }, { 1: "Parking" });
    expect(Object.keys(names).sort()).toEqual(["1", "2", "3", "4"]);
    expect(names[3]).toBe("Stairs");
    expect(names[4]).toBe("Camera 4");
  });

  it("keeps the camera id stable while only the label changes", () => {
    const { names } = resolveCameraNames({}, DVR);
    // The ids are the keys; the DVR name is only the display label.
    expect(Object.keys(names).map(Number).sort()).toEqual([1, 2, 3, 4]);
    expect(names[1]).toBe("Parking");
  });
});
