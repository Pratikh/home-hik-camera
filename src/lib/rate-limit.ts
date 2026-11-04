type Bucket = { count: number; resetAt: number };

const buckets = new Map<string, Bucket>();

/**
 * Cheap in-memory limiter for a *single* process-wide budget (for example
 * "at most N login attempts per minute overall"). Per-account and per-address
 * budgets live in SQLite (`@/server/auth/login-throttle`) because they must
 * survive a restart.
 *
 * The map is bounded: once it grows past `MAX_BUCKETS`, expired entries are
 * swept, and in the worst case the map is cleared rather than allowed to grow
 * without limit. A limiter must never become the memory-exhaustion bug it is
 * supposed to prevent.
 */
export const MAX_RATE_LIMIT_BUCKETS = 10_000;

function sweep(now: number): void {
  if (buckets.size < MAX_RATE_LIMIT_BUCKETS) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
  if (buckets.size >= MAX_RATE_LIMIT_BUCKETS) buckets.clear();
}

export function consumeRateLimit(key: string, limit: number, windowMs: number, now = Date.now()): { allowed: boolean; retryAfterMs: number } {
  sweep(now);
  const current = buckets.get(key);
  if (!current || current.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { allowed: true, retryAfterMs: 0 };
  }
  if (current.count >= limit) return { allowed: false, retryAfterMs: current.resetAt - now };
  current.count += 1;
  return { allowed: true, retryAfterMs: 0 };
}

export function resetRateLimits(): void {
  buckets.clear();
}

export function rateLimitBucketCount(): number {
  return buckets.size;
}
