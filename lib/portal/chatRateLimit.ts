import "server-only";
import { RATE_LIMIT, RATE_WINDOW_MS } from "./chatLimits";

/**
 * Server-only abuse guardrail for the PUBLIC portal chat endpoint
 * (app/api/portal/chat): the per-IP rate limiter + client-IP helper.
 *
 * The chat bubble spends a paid Anthropic key on behalf of anonymous visitors,
 * so the route is a spend surface a stranger can point at. This limiter is the
 * floor that stops one visitor (or a script) from turning the bubble into a
 * free, unmetered LLM. The plain length/turn caps live in ./chatLimits (safe for
 * the client bundle too); this module holds only the server-side state.
 *
 * The limiter is IN-MEMORY and therefore PER-INSTANCE: on serverless it resets
 * on cold start and is not shared across concurrent instances, so the effective
 * ceiling is (limit × live instances). That is deliberately a launch-grade floor
 * — it defeats casual spam and accidental loops, not a distributed attacker. If
 * abuse becomes real, back the counter with Supabase (see the note in the route).
 */

/** Per-IP hit timestamps (ms). Module-level so it survives across requests on a
 *  warm instance; a Map keyed by IP with the raw timestamps for the window. */
const hits = new Map<string, number[]>();

/** Bound the Map so a stream of unique IPs can't grow it without limit. When we
 *  exceed this, we sweep entries whose newest hit is outside the window. */
const MAX_TRACKED_IPS = 5000;

/**
 * Record one request for `ip` and report whether it is allowed. Sliding window:
 * counts hits inside the last RATE_WINDOW_MS; if already at RATE_LIMIT, the
 * request is rejected and `retryAfterMs` says when the oldest hit ages out.
 */
export function rateLimit(ip: string): {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
} {
  const now = Date.now();
  const cutoff = now - RATE_WINDOW_MS;

  if (hits.size > MAX_TRACKED_IPS) sweep(cutoff);

  const prior = (hits.get(ip) ?? []).filter((t) => t > cutoff);

  if (prior.length >= RATE_LIMIT) {
    // Oldest surviving hit determines when a slot frees up.
    const retryAfterMs = Math.max(0, prior[0] + RATE_WINDOW_MS - now);
    hits.set(ip, prior); // keep the pruned list so it doesn't regrow with stale entries
    return { allowed: false, remaining: 0, retryAfterMs };
  }

  prior.push(now);
  hits.set(ip, prior);
  return { allowed: true, remaining: RATE_LIMIT - prior.length, retryAfterMs: 0 };
}

/** Drop IPs whose most recent hit has aged out of the window. */
function sweep(cutoff: number): void {
  for (const [ip, times] of hits) {
    if (!times.length || times[times.length - 1] <= cutoff) hits.delete(ip);
  }
}

/**
 * Best-effort client IP for rate-limiting. Behind Vercel/most proxies the real
 * client is the FIRST entry of x-forwarded-for; x-real-ip is the fallback. This
 * is spoofable by a direct (non-proxied) caller, which is acceptable for a
 * launch-grade floor — the proxy overwrites it in production. Never trust it for
 * anything security-sensitive.
 */
export function clientIp(req: Request): string {
  const xff = req.headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return req.headers.get("x-real-ip")?.trim() || "unknown";
}
