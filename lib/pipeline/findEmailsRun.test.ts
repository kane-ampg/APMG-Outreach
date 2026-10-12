import { describe, expect, it } from "vitest";
import {
  chunkLeads,
  DEFAULT_MS_PER_LEAD,
  estimateProgress,
  estimateRemainingMs,
  classifyReply,
  runFindEmails,
  usableWebsite,
  type ChunkReply,
  type FindLead,
  type FindRunEvent,
} from "./findEmailsRun";

const ID = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const lead = (n: number): FindLead => ({ id: ID(n), website: `https://site${n}.com.au/` });
const leads = (count: number) => Array.from({ length: count }, (_, i) => lead(i + 1));

/** postChunk stub that answers each chunk from a queue of replies. */
function scripted(replies: Array<ChunkReply | ((chunk: FindLead[]) => ChunkReply)>) {
  const calls: FindLead[][] = [];
  const postChunk = async (chunk: FindLead[]) => {
    calls.push(chunk);
    const next = replies.shift();
    if (!next) throw new Error("unexpected chunk");
    return typeof next === "function" ? next(chunk) : next;
  };
  return { calls, postChunk };
}

/** Every lead in the chunk gets one address, except the ids listed in `miss`. */
const answerAll =
  (miss: string[] = []) =>
  (chunk: FindLead[]): ChunkReply => ({
    kind: "ok",
    results: chunk.map((l) =>
      miss.includes(l.id)
        ? { id: l.id, emails: [], best_email: null }
        : { id: l.id, emails: [`info@${new URL(l.website).hostname}`], best_email: null },
    ),
  });

describe("chunkLeads", () => {
  it("splits into fixed-size chunks with a short tail", () => {
    expect(chunkLeads([1, 2, 3, 4, 5, 6, 7], 3)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
  });
  it("returns no chunks for an empty list", () => {
    expect(chunkLeads([], 5)).toEqual([]);
  });
});

describe("classifyReply", () => {
  it("reads an unconfigured or paused finder as not-connected, whatever the status", () => {
    expect(classifyReply(503, { ok: false, mode: "paused", error: "paused!" })).toEqual({
      kind: "not-connected",
      message: "paused!",
    });
    expect(classifyReply(503, { ok: false, mode: "unconfigured" }).kind).toBe("not-connected");
  });

  it("keeps only well-formed results from a successful reply", () => {
    const reply = classifyReply(200, {
      ok: true,
      mode: "live",
      results: [
        { id: ID(1), emails: ["a@x.com", 7], best_email: "a@x.com" },
        { id: 42, emails: ["b@x.com"] },
        "junk",
      ],
    });
    expect(reply).toEqual({
      kind: "ok",
      results: [{ id: ID(1), emails: ["a@x.com"], best_email: "a@x.com" }],
    });
  });

  it("treats 5xx as retryable and 4xx as not", () => {
    expect(classifyReply(502, { ok: false, error: "n8n down" })).toEqual({
      kind: "error",
      message: "n8n down",
      retryable: true,
    });
    expect(classifyReply(403, { ok: false, error: "Forbidden." })).toMatchObject({ retryable: false });
  });

  it("falls back to a status message when the body is unreadable", () => {
    expect(classifyReply(500, null)).toEqual({
      kind: "error",
      message: "The email finder responded 500.",
      retryable: true,
    });
  });
});

describe("runFindEmails", () => {
  it("walks every chunk in order and tallies found / scanned", async () => {
    const all = leads(7);
    const { calls, postChunk } = scripted([answerAll([ID(2)]), answerAll(), answerAll([ID(7)])]);
    const events: FindRunEvent[] = [];
    const end = await runFindEmails({
      leads: all,
      chunkSize: 3,
      postChunk,
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
    });

    expect(calls.map((c) => c.length)).toEqual([3, 3, 1]);
    expect(end).toEqual({ kind: "done", found: 5, scanned: 7, failed: 0, total: 7 });
    expect(events.map((e) => e.type)).toEqual([
      "chunk-start",
      "chunk-done",
      "chunk-start",
      "chunk-done",
      "chunk-start",
      "chunk-done",
    ]);
  });

  it("counts a lead the finder never answered for as scanned with nothing found", async () => {
    const { postChunk } = scripted([{ kind: "ok", results: [] }]);
    const end = await runFindEmails({
      leads: leads(2),
      chunkSize: 5,
      postChunk,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(end).toEqual({ kind: "done", found: 0, scanned: 2, failed: 0, total: 2 });
  });

  it("ignores results for leads that weren't in the chunk", async () => {
    const stray = { id: ID(99), emails: ["x@y.com"], best_email: "x@y.com" };
    const { postChunk } = scripted([{ kind: "ok", results: [stray] }]);
    const events: FindRunEvent[] = [];
    const end = await runFindEmails({
      leads: leads(1),
      postChunk,
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
    });
    expect(end.found).toBe(0);
    const done = events.find((e) => e.type === "chunk-done");
    expect(done && done.type === "chunk-done" ? done.results : null).toEqual([]);
  });

  it("ends as not-connected without scanning further", async () => {
    const { calls, postChunk } = scripted([{ kind: "not-connected", message: "Switch it on." }]);
    const end = await runFindEmails({
      leads: leads(12),
      chunkSize: 5,
      postChunk,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(calls).toHaveLength(1);
    expect(end).toMatchObject({ kind: "not-connected", message: "Switch it on.", scanned: 0 });
  });

  it("fails fast when the very first chunk errors — that's wiring, not a bad site", async () => {
    const { calls, postChunk } = scripted([
      { kind: "error", message: "Could not reach n8n.", retryable: true },
    ]);
    const end = await runFindEmails({
      leads: leads(12),
      chunkSize: 5,
      postChunk,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(calls).toHaveLength(1);
    expect(end).toMatchObject({ kind: "error", message: "Could not reach n8n.", scanned: 0, failed: 5 });
  });

  it("skips past one failed chunk after a success and keeps going", async () => {
    const { postChunk } = scripted([
      answerAll(),
      { kind: "error", message: "timeout", retryable: true },
      answerAll(),
    ]);
    const events: FindRunEvent[] = [];
    const end = await runFindEmails({
      leads: leads(6),
      chunkSize: 2,
      postChunk,
      onEvent: (e) => events.push(e),
      signal: new AbortController().signal,
    });
    expect(end).toEqual({ kind: "done", found: 4, scanned: 4, failed: 2, total: 6, message: "timeout" });
    expect(events.filter((e) => e.type === "chunk-failed")).toHaveLength(1);
  });

  it("gives up after two failed chunks in a row", async () => {
    const { calls, postChunk } = scripted([
      answerAll(),
      { kind: "error", message: "down", retryable: true },
      { kind: "error", message: "still down", retryable: true },
    ]);
    const end = await runFindEmails({
      leads: leads(10),
      chunkSize: 2,
      postChunk,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(calls).toHaveLength(3);
    expect(end).toMatchObject({ kind: "error", message: "still down", scanned: 2, failed: 4 });
  });

  it("stops on a non-retryable error even after a success", async () => {
    const { calls, postChunk } = scripted([
      answerAll(),
      { kind: "error", message: "Forbidden.", retryable: false },
    ]);
    const end = await runFindEmails({
      leads: leads(6),
      chunkSize: 2,
      postChunk,
      onEvent: () => {},
      signal: new AbortController().signal,
    });
    expect(calls).toHaveLength(2);
    expect(end).toMatchObject({ kind: "error", message: "Forbidden.", scanned: 2, failed: 2 });
  });

  it("stops between chunks once aborted, without reporting the cut-off chunk", async () => {
    const ctrl = new AbortController();
    const { calls, postChunk } = scripted([
      (chunk) => {
        ctrl.abort();
        return answerAll()(chunk);
      },
    ]);
    const events: FindRunEvent[] = [];
    const end = await runFindEmails({
      leads: leads(6),
      chunkSize: 2,
      postChunk,
      onEvent: (e) => events.push(e),
      signal: ctrl.signal,
    });
    expect(calls).toHaveLength(1);
    expect(end).toEqual({ kind: "stopped", found: 0, scanned: 0, failed: 0, total: 6 });
    expect(events.map((e) => e.type)).toEqual(["chunk-start"]);
  });
});

describe("estimateProgress", () => {
  const base = { total: 10, processed: 0, inflight: 0, chunkStartedAt: null, busyMs: 0 };

  it("is exactly the processed share when nothing is in flight", () => {
    expect(estimateProgress({ ...base, processed: 4, busyMs: 8000 }, 99_999)).toBe(0.4);
  });

  it("creeps into the in-flight chunk but never reaches its end", () => {
    const s = { ...base, processed: 5, busyMs: 10_000, inflight: 5, chunkStartedAt: 0 };
    const early = estimateProgress(s, 2_000);
    const due = estimateProgress(s, 10_000); // 2s/lead measured × 5 leads
    const late = estimateProgress(s, 600_000);
    expect(early).toBeGreaterThan(0.5);
    expect(due).toBeGreaterThan(early);
    expect(late).toBeGreaterThan(due);
    expect(late).toBeLessThan(1);
  });

  it("seeds the pace from the default before any chunk has answered", () => {
    const s = { ...base, inflight: 5, chunkStartedAt: 0 };
    const atDefault = estimateProgress(s, DEFAULT_MS_PER_LEAD * 5);
    expect(atDefault).toBeGreaterThan(0.25);
    expect(atDefault).toBeLessThan(0.5);
  });

  it("is 0 for an empty run", () => {
    expect(estimateProgress({ ...base, total: 0 }, 0)).toBe(0);
  });
});

describe("estimateRemainingMs", () => {
  const base = { total: 10, processed: 0, inflight: 0, chunkStartedAt: null, busyMs: 0 };

  it("has no estimate until a chunk has answered", () => {
    expect(estimateRemainingMs({ ...base, inflight: 5, chunkStartedAt: 0 }, 1_000)).toBeNull();
  });

  it("extrapolates the measured pace over what's left", () => {
    expect(estimateRemainingMs({ ...base, processed: 5, busyMs: 10_000 }, 0)).toBe(10_000);
  });

  it("counts down through the chunk in flight, without going negative", () => {
    const s = { ...base, processed: 5, busyMs: 10_000, inflight: 5, chunkStartedAt: 0 };
    expect(estimateRemainingMs(s, 4_000)).toBe(6_000);
    expect(estimateRemainingMs(s, 60_000)).toBeGreaterThanOrEqual(0);
  });
});

describe("usableWebsite", () => {
  it("defaults the scheme to https and normalises the URL", () => {
    expect(usableWebsite(" acme.com.au ")).toBe("https://acme.com.au/");
    expect(usableWebsite("http://acme.com.au/contact")).toBe("http://acme.com.au/contact");
  });
  it("rejects blanks, non-http schemes and dotless hosts", () => {
    expect(usableWebsite("")).toBeNull();
    expect(usableWebsite(null)).toBeNull();
    expect(usableWebsite("ftp://acme.com.au")).toBeNull();
    expect(usableWebsite("localhost")).toBeNull();
    expect(usableWebsite("https://")).toBeNull();
  });
});
