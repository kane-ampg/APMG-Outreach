// Client-driven "Find emails" run. Rather than POSTing the whole selection in
// one request and waiting minutes on a spinner, the client walks the batch in
// small chunks — one find-emails request per chunk — so the progress modal can
// show real, per-site progress as each chunk lands. It also keeps every request
// far inside the function's maxDuration, and makes Stop possible between chunks.
//
// Pure (no React, no fetch): the caller supplies postChunk, so the policy below
// is unit-tested in findEmailsRun.test.ts.

/** Leads per find-emails request. Small enough that progress moves every few
 *  seconds; large enough not to multiply n8n executions. The route still caps
 *  each n8n call at its own CHUNK_SIZE (10), so this never splits further. */
export const FIND_CHUNK_SIZE = 5;

/** Starting guess for one lead's scan (homepage + contact page in n8n, each
 *  with a 10s timeout). Only seeds the progress estimate before the first chunk
 *  answers; after that the measured pace takes over. */
export const DEFAULT_MS_PER_LEAD = 4000;

export interface FindLead {
  id: string;
  website: string;
}

export interface FoundResult {
  id: string;
  emails: string[];
  best_email: string | null;
}

/** What one find-emails request came back as. */
export type ChunkReply =
  /** removed: ids of scanned leads that had no address and were deleted */
  | { kind: "ok"; results: FoundResult[]; removed?: string[] }
  | { kind: "not-connected"; message: string }
  /** retryable: a 5xx / network blip that the next chunk may not hit. A 4xx
   *  (session expired, forbidden, bad input) won't fix itself mid-run. */
  | { kind: "error"; message: string; retryable: boolean };

export type FindRunEvent =
  | { type: "chunk-start"; ids: string[] }
  /** results holds only leads that came back with something to say; any
   *  requested id missing from it was scanned with nothing found. */
  | { type: "chunk-done"; ids: string[]; results: FoundResult[]; removed: string[] }
  | { type: "chunk-failed"; ids: string[]; message: string };

export interface FindRunEnd {
  /** done = every chunk attempted; stopped = the user cancelled; not-connected
   *  and error = the run was cut short (see message). */
  kind: "done" | "stopped" | "not-connected" | "error";
  /** leads that came back with at least one address */
  found: number;
  /** leads in chunks the finder answered */
  scanned: number;
  /** leads in chunks that errored */
  failed: number;
  /** scanned leads that had no address and were deleted from the leads table */
  removed: number;
  total: number;
  /** why the run ended early, or the last skipped chunk's error on a done run */
  message?: string;
}

/** Consecutive failed chunks that end the run — past this the finder is down,
 *  not just tripping over one slow cluster of sites. */
const MAX_CONSECUTIVE_FAILURES = 2;

/** Snapshot of a run's pace, as the progress bar and ETA read it. */
export interface FindPace {
  total: number;
  /** leads whose chunk has answered or failed */
  processed: number;
  /** leads in the chunk currently in flight (0 between chunks) */
  inflight: number;
  /** when the in-flight chunk was sent (same clock as `now`) */
  chunkStartedAt: number | null;
  /** summed wall time of every finished chunk */
  busyMs: number;
}

/** Share of the in-flight chunk the estimate may claim before it answers —
 *  the bar never shows a chunk as done until it actually is. */
const CREEP_CEILING = 0.9;

function msPerLead(p: FindPace): number {
  return p.processed > 0 ? p.busyMs / p.processed : DEFAULT_MS_PER_LEAD;
}

/**
 * Bar position, 0–1. Finished chunks count in full; the chunk in flight eases
 * toward (never past) CREEP_CEILING of its share on an exponential curve timed
 * against the measured pace — so the bar keeps moving smoothly between chunk
 * replies, and simply slows if a chunk runs long.
 */
export function estimateProgress(p: FindPace, now: number): number {
  if (p.total <= 0) return 0;
  let done = p.processed;
  if (p.inflight > 0 && p.chunkStartedAt !== null) {
    const expected = Math.max(1, msPerLead(p) * p.inflight);
    const t = Math.max(0, now - p.chunkStartedAt) / expected;
    done += p.inflight * CREEP_CEILING * (1 - Math.exp(-1.6 * t));
  }
  return Math.min(1, done / p.total);
}

/** Time left at the measured pace, or null before any chunk has answered. */
export function estimateRemainingMs(p: FindPace, now: number): number | null {
  if (p.processed === 0 || p.busyMs <= 0) return null;
  const per = msPerLead(p);
  let ms = (p.total - p.processed) * per;
  if (p.inflight > 0 && p.chunkStartedAt !== null) {
    // count down through the chunk in flight, but no further than the creep
    // ceiling — an overrunning chunk reads "a few seconds", never zero
    ms -= Math.min(Math.max(0, now - p.chunkStartedAt), p.inflight * per * CREEP_CEILING);
  }
  return Math.max(0, ms);
}

/** A lead's website as the finder can fetch it — public http(s) with a dotted
 *  host, scheme defaulted to https — or null. The route enforces this per lead
 *  (and 400s a request where no lead passes), so the client applies the same
 *  check up front: a chunk of junk sites would otherwise read as a failure. */
export function usableWebsite(input: unknown): string | null {
  let site = typeof input === "string" ? input.trim() : "";
  if (!site) return null;
  if (!/^https?:\/\//i.test(site)) site = `https://${site}`;
  try {
    const u = new URL(site);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

export function chunkLeads<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let at = 0; at < items.length; at += size) out.push(items.slice(at, at + size));
  return out;
}

/** Coerce a find-emails response (status + parsed body) into a ChunkReply. The
 *  route already sanitizes what n8n sent; this only guards the shape. */
export function classifyReply(status: number, data: unknown): ChunkReply {
  const d = (data && typeof data === "object" ? data : {}) as Record<string, unknown>;
  const error = typeof d.error === "string" && d.error ? d.error : null;

  // Checked before the generic failure branch: the route answers an
  // unconfigured/paused finder with a 503, which would otherwise read as a
  // retryable outage instead of "go switch it on".
  if (d.mode === "unconfigured" || d.mode === "paused") {
    return {
      kind: "not-connected",
      message:
        error ??
        "The Email Finder automation isn't connected — add its webhook on the Integrations tab, then try again.",
    };
  }

  if (status >= 200 && status < 300 && d.ok === true && Array.isArray(d.results)) {
    const results: FoundResult[] = [];
    for (const raw of d.results) {
      if (!raw || typeof raw !== "object") continue;
      const r = raw as Record<string, unknown>;
      if (typeof r.id !== "string") continue;
      const emails = Array.isArray(r.emails)
        ? r.emails.filter((e): e is string => typeof e === "string")
        : [];
      const best = typeof r.best_email === "string" ? r.best_email : null;
      results.push({ id: r.id, emails, best_email: best });
    }
    const removed = Array.isArray(d.removed)
      ? d.removed.filter((id): id is string => typeof id === "string")
      : [];
    return { kind: "ok", results, removed };
  }

  return {
    kind: "error",
    message: error ?? `The email finder responded ${status}.`,
    retryable: status === 0 || status >= 500 || status === 429,
  };
}

/**
 * Walk `leads` in chunks through `postChunk`, sequentially, reporting each
 * chunk's start and outcome through `onEvent`.
 *
 * Failure policy: the first chunk failing ends the run (nothing has worked
 * yet, so it's wiring — n8n down, workflow off — not a bad site); after a
 * success, a retryable failure marks that chunk failed and moves on, until two
 * in a row. A non-retryable failure or a not-connected reply always ends it.
 *
 * Aborting `signal` stops before the next chunk; the chunk in flight at the
 * time is dropped from the tallies (the server may still finish and save it).
 */
export async function runFindEmails({
  leads,
  postChunk,
  onEvent,
  signal,
  chunkSize = FIND_CHUNK_SIZE,
}: {
  leads: readonly FindLead[];
  postChunk: (chunk: FindLead[], signal: AbortSignal) => Promise<ChunkReply>;
  onEvent: (event: FindRunEvent) => void;
  signal: AbortSignal;
  chunkSize?: number;
}): Promise<FindRunEnd> {
  const total = leads.length;
  let found = 0;
  let scanned = 0;
  let failed = 0;
  let removed = 0;
  let streak = 0;
  let lastError: string | undefined;
  const tally = () => ({ found, scanned, failed, removed, total });

  for (const chunk of chunkLeads(leads, chunkSize)) {
    if (signal.aborted) return { kind: "stopped", ...tally() };
    const ids = chunk.map((l) => l.id);
    onEvent({ type: "chunk-start", ids });

    let reply: ChunkReply;
    try {
      reply = await postChunk(chunk, signal);
    } catch {
      reply = { kind: "error", message: "Network error reaching the email finder.", retryable: true };
    }
    if (signal.aborted) return { kind: "stopped", ...tally() };

    if (reply.kind === "not-connected") {
      return { kind: "not-connected", message: reply.message, ...tally() };
    }

    if (reply.kind === "error") {
      failed += ids.length;
      streak++;
      lastError = reply.message;
      onEvent({ type: "chunk-failed", ids, message: reply.message });
      if (scanned === 0 || !reply.retryable || streak >= MAX_CONSECUTIVE_FAILURES) {
        return { kind: "error", message: reply.message, ...tally() };
      }
      continue;
    }

    streak = 0;
    const asked = new Set(ids);
    const results = reply.results.filter((r) => asked.has(r.id));
    scanned += ids.length;
    found += results.filter((r) => r.emails.length > 0).length;
    const gone = (reply.removed ?? []).filter((id) => asked.has(id));
    removed += gone.length;
    onEvent({ type: "chunk-done", ids, results, removed: gone });
  }

  return lastError ? { kind: "done", ...tally(), message: lastError } : { kind: "done", ...tally() };
}
