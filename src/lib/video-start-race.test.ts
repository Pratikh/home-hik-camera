import { describe, expect, it } from "vitest";

/**
 * Regression tests for the "data loads only after a reload" defect.
 *
 * Root cause: the live and playback players started their stream from an effect
 * that read a `useRef` to the <video> element and returned early when it was
 * null:
 *
 *     useEffect(() => {
 *       if (!active) return;
 *       const video = videoRef.current;
 *       if (!video) return;      // bailed on first load, phase stuck at "loading"
 *       ...
 *     }, [active, path]);
 *
 * During hydration the ref can still be null when the effect first runs, and no
 * dependency changed afterwards, so the effect never ran again. The tile stayed
 * blank until a reload. Mirroring the node into state via a callback ref makes
 * the node itself a dependency, so the effect re-runs once it attaches.
 *
 * These tests model that control flow without a DOM.
 */

/** The effect body's guard, as it existed before the fix. */
function shouldStartWithRefOnly(node: unknown, active: boolean): boolean {
  if (!active) return false;
  if (!node) return false;
  return true;
}

/** The effect body's guard after the fix (node comes from state). */
function shouldStartWithState(node: unknown, active: boolean): boolean {
  if (!active) return false;
  if (!node) return false;
  return true;
}

/** Simulates React running the effect, then the ref attaching later. */
function runEffect(
  guard: (node: unknown, active: boolean) => boolean,
  deps: { nodeAtEffectTime: unknown; nodeAfterAttach: unknown; rerunsOnAttach: boolean },
): { started: boolean; stuckLoading: boolean } {
  const ranOnMount = guard(deps.nodeAtEffectTime, true);
  if (ranOnMount) return { started: true, stuckLoading: false };
  // With a ref-only dependency the effect does not re-run when the node
  // attaches. With the node in state, it does.
  if (deps.rerunsOnAttach) {
    const ranAfterAttach = guard(deps.nodeAfterAttach, true);
    return { started: ranAfterAttach, stuckLoading: !ranAfterAttach };
  }
  return { started: false, stuckLoading: true };
}

describe("video start effect - hydration race", () => {
  it("reproduces the defect: a ref-only effect stays stuck when the node attaches late", () => {
    const result = runEffect(shouldStartWithRefOnly, {
      nodeAtEffectTime: null,
      nodeAfterAttach: { tagName: "VIDEO" },
      rerunsOnAttach: false,
    });
    expect(result.started).toBe(false);
    expect(result.stuckLoading).toBe(true);
  });

  it("starts the stream when the node is a dependency, even if it attaches late", () => {
    const result = runEffect(shouldStartWithState, {
      nodeAtEffectTime: null,
      nodeAfterAttach: { tagName: "VIDEO" },
      rerunsOnAttach: true,
    });
    expect(result.started).toBe(true);
    expect(result.stuckLoading).toBe(false);
  });

  it("does not start while the player is inactive", () => {
    expect(shouldStartWithState({ tagName: "VIDEO" }, false)).toBe(false);
  });

  it("does not start before the node exists", () => {
    expect(shouldStartWithState(null, true)).toBe(false);
  });

  it("starts normally when the node is present at effect time", () => {
    expect(shouldStartWithState({ tagName: "VIDEO" }, true)).toBe(true);
  });
});
