/** Best-effort per-isolate token bucket. In production, pair with Cloudflare rate limiting rules
 * (state is not shared across isolates). */
const buckets = new Map<string, { n: number; reset: number }>();

export function rateLimited(key: string, limit: number, windowMs: number, nowMs = Date.now()): boolean {
  const b = buckets.get(key);
  if (!b || b.reset <= nowMs) {
    buckets.set(key, { n: 1, reset: nowMs + windowMs });
    if (buckets.size > 5000) for (const [k, v] of buckets) if (v.reset <= nowMs) buckets.delete(k);
    return false;
  }
  b.n++;
  return b.n > limit;
}
export const resetRateLimits = () => buckets.clear();
