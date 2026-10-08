import { getCache } from "@vercel/functions";
import { localDay, type PerformanceTally } from "./performance";

/**
 * The Performance tab's server cache. A tally pages through months of
 * portal_events (about 3.5 s and a few hundred KB of Supabase egress at
 * 2026-10 volumes), and the answer barely moves minute to minute, so the
 * finished tally is kept in Vercel's Runtime Cache and shared by every
 * function in the region. Off Vercel (local dev, tests) @vercel/functions
 * falls back to an in-memory cache on its own.
 *
 * Only the finished tally is stored, never a response: the route checks
 * telemetry.view before it reads here, so a cached answer is never handed to
 * someone who couldn't have computed it.
 */

/** How long a tally is served before the next request computes it again. */
export const PERFORMANCE_CACHE_TTL_SECONDS = 5 * 60;

export const PERFORMANCE_CACHE_TAG = "performance";

/** Bump when the tally's shape changes, so a deploy never serves an old shape
 *  out of a cache that survives deployments. */
const CACHE_VERSION = "v1";

export interface CachedPerformance {
  tally: PerformanceTally;
  /** when the tally was computed (ISO) */
  computedAt: string;
}

const cache = () => getCache({ namespace: PERFORMANCE_CACHE_TAG });

/**
 * One entry per period, zone and day. The day is in the key so the entry
 * dies at local midnight: a tally made at 23:58 must not be served at 00:01
 * with yesterday as its last bar.
 */
export function performanceCacheKey(days: number, tz: string, now: Date): string {
  const today = localDay(now.toISOString(), tz) ?? now.toISOString().slice(0, 10);
  return `${CACHE_VERSION}:${days}:${tz}:${today}`;
}

/** The cached tally, or null on a miss. A cache that can't be reached is a
 *  miss, never an error: the tab still works, just slower. */
export async function readCachedPerformance(key: string): Promise<CachedPerformance | null> {
  try {
    const hit = (await cache().get(key)) as Partial<CachedPerformance> | null | undefined;
    if (!hit || typeof hit !== "object" || !hit.tally || typeof hit.computedAt !== "string") return null;
    return hit as CachedPerformance;
  } catch (e) {
    console.error("[performance] cache read failed:", e);
    return null;
  }
}

export async function writeCachedPerformance(key: string, value: CachedPerformance): Promise<void> {
  try {
    await cache().set(key, value, {
      ttl: PERFORMANCE_CACHE_TTL_SECONDS,
      tags: [PERFORMANCE_CACHE_TAG],
      name: "performance-tally",
    });
  } catch (e) {
    console.error("[performance] cache write failed:", e);
  }
}

/** Drop every cached tally, e.g. after portal events are deleted. */
export async function expirePerformanceCache(): Promise<void> {
  try {
    await cache().expireTag(PERFORMANCE_CACHE_TAG);
  } catch (e) {
    console.error("[performance] cache expire failed:", e);
  }
}
