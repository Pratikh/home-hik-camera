import { beforeEach, describe, expect, it } from "vitest";
import { MAX_RATE_LIMIT_BUCKETS, consumeRateLimit, rateLimitBucketCount, resetRateLimits } from "@/lib/rate-limit";

describe("in-memory rate limit", () => {
  beforeEach(() => resetRateLimits());

  it("allows up to the limit inside the window and then blocks", () => {
    const now = 1_000_000;
    for (let index = 0; index < 3; index += 1) {
      expect(consumeRateLimit("login:global", 3, 60_000, now).allowed).toBe(true);
    }
    const blocked = consumeRateLimit("login:global", 3, 60_000, now);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it("resets the bucket after its window", () => {
    expect(consumeRateLimit("k", 1, 1_000, 0).allowed).toBe(true);
    expect(consumeRateLimit("k", 1, 1_000, 500).allowed).toBe(false);
    expect(consumeRateLimit("k", 1, 1_000, 1_500).allowed).toBe(true);
  });

  it("keeps buckets independent", () => {
    expect(consumeRateLimit("a", 1, 60_000, 0).allowed).toBe(true);
    expect(consumeRateLimit("a", 1, 60_000, 0).allowed).toBe(false);
    expect(consumeRateLimit("b", 1, 60_000, 0).allowed).toBe(true);
  });

  it("never grows without bound", () => {
    const now = 5_000;
    for (let index = 0; index < MAX_RATE_LIMIT_BUCKETS + 500; index += 1) {
      consumeRateLimit(`spray:${index}`, 5, 60_000, now);
    }
    expect(rateLimitBucketCount()).toBeLessThanOrEqual(MAX_RATE_LIMIT_BUCKETS);
  });
});
