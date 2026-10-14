"use client";

import { memo, useCallback, useEffect, useId, useRef, useState } from "react";
import {
  AnimatePresence,
  animate,
  motion,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import {
  AlertTriangle,
  Check,
  CircleStop,
  Globe,
  Minus,
  PlugZap,
  ScanSearch,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  classifyReply,
  estimateProgress,
  estimateRemainingMs,
  runFindEmails,
  usableWebsite,
  type ChunkReply,
  type FindLead,
  type FindPace,
  type FindRunEnd,
  type FindRunEvent,
} from "@/lib/pipeline/findEmailsRun";
import { Button } from "@/components/ui/button";

const EASE = [0.16, 1, 0.3, 1] as const;
const DIALOG_EASE = [0.22, 1, 0.36, 1] as const;
/** Tracks the creeping estimate closely, then glides (rather than snaps) when
 *  a chunk lands and the bar jumps to the real count. */
const BAR_SPRING = { stiffness: 70, damping: 20, mass: 0.8 };

/** A no-email lead handed to the finder. `name` is display-only. */
export interface FindTarget {
  id: string;
  website: string;
  name: string;
}

type RowStatus = "queued" | "scanning" | "found" | "none" | "failed";

interface RowState {
  status: RowStatus;
  /** the address shown for a found lead (its best, else its first) */
  email: string | null;
  /** further addresses found beyond `email` */
  extra: number;
  /** nothing found, so the lead was deleted from the leads table */
  removed?: boolean;
}

/** Live state of one Find emails run. Extends FindPace so the progress bar and
 *  ETA can read the pace straight off it. */
export interface FindRun extends FindPace {
  targets: FindTarget[];
  rows: Record<string, RowState>;
  scanned: number;
  found: number;
  failed: number;
  phase: "running" | "finished";
  end: FindRunEnd | null;
}

const QUEUED: RowState = { status: "queued", email: null, extra: 0 };

/** POST one chunk to the find-emails route. Network failures and aborts
 *  propagate — runFindEmails turns them into an error or a stop. */
async function postChunk(chunk: FindLead[], signal: AbortSignal): Promise<ChunkReply> {
  const res = await fetch("/api/pipeline/campaigns/find-emails", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ leads: chunk }),
    signal,
  });
  const data: unknown = await res.json().catch(() => null);
  return classifyReply(res.status, data);
}

function applyEvent(run: FindRun, e: FindRunEvent, now: number): FindRun {
  const rows = { ...run.rows };
  if (e.type === "chunk-start") {
    for (const id of e.ids) rows[id] = { status: "scanning", email: null, extra: 0 };
    return { ...run, rows, inflight: e.ids.length, chunkStartedAt: now };
  }
  const took = run.chunkStartedAt === null ? 0 : now - run.chunkStartedAt;
  const settled: FindRun = {
    ...run,
    rows,
    inflight: 0,
    chunkStartedAt: null,
    busyMs: run.busyMs + took,
    processed: run.processed + e.ids.length,
  };
  if (e.type === "chunk-failed") {
    for (const id of e.ids) rows[id] = { status: "failed", email: null, extra: 0 };
    return { ...settled, failed: run.failed + e.ids.length };
  }
  const byId = new Map(e.results.map((r) => [r.id, r]));
  const removed = new Set(e.removed);
  let found = 0;
  for (const id of e.ids) {
    const r = byId.get(id);
    if (r && r.emails.length > 0) {
      found++;
      const best = r.best_email && r.emails.includes(r.best_email) ? r.best_email : r.emails[0];
      rows[id] = { status: "found", email: best, extra: r.emails.length - 1 };
    } else {
      rows[id] = { status: "none", email: null, extra: 0, removed: removed.has(id) };
    }
  }
  return { ...settled, scanned: run.scanned + e.ids.length, found: run.found + found };
}

function finishRun(run: FindRun, end: FindRunEnd): FindRun {
  // a stop drops the chunk that was mid-scan back to unchecked
  const rows = { ...run.rows };
  for (const [id, row] of Object.entries(rows)) if (row.status === "scanning") rows[id] = QUEUED;
  return { ...run, rows, phase: "finished", end, inflight: 0, chunkStartedAt: null };
}

/**
 * Drives a Find emails run for the progress modal. `start` walks the leads in
 * chunks (runFindEmails) and folds each chunk's outcome into `run`; the modal
 * can be hidden mid-run without stopping it, and reopens itself on the
 * summary when the run ends. Unmounting aborts the run — the state has nowhere
 * left to live. `onFinished` fires once the run has touched the lead rows, so
 * the parent can refetch.
 */
export function useFindEmailsRun(onFinished: () => void) {
  const [run, setRun] = useState<FindRun | null>(null);
  const [open, setOpen] = useState(false);
  const ctrlRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);
  const onFinishedRef = useRef(onFinished);
  useEffect(() => {
    onFinishedRef.current = onFinished;
  }, [onFinished]);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      ctrlRef.current?.abort();
    };
  }, []);

  const start = useCallback(async (input: FindTarget[]) => {
    if (ctrlRef.current) return; // one run at a time
    // dedupe by id, and leave out sites the route would refuse anyway
    const seen = new Set<string>();
    const targets: FindTarget[] = [];
    for (const t of input) {
      const website = usableWebsite(t.website);
      if (!website || seen.has(t.id)) continue;
      seen.add(t.id);
      targets.push({ ...t, website });
    }
    if (targets.length === 0) return;

    const ctrl = new AbortController();
    ctrlRef.current = ctrl;
    setRun({
      targets,
      rows: Object.fromEntries(targets.map((t) => [t.id, QUEUED])),
      total: targets.length,
      processed: 0,
      inflight: 0,
      chunkStartedAt: null,
      busyMs: 0,
      scanned: 0,
      found: 0,
      failed: 0,
      phase: "running",
      end: null,
    });
    setOpen(true);

    const end = await runFindEmails({
      leads: targets.map(({ id, website }) => ({ id, website })),
      postChunk,
      signal: ctrl.signal,
      onEvent: (e) => {
        // stamp outside the updater — StrictMode may run it twice
        const now = performance.now();
        if (mountedRef.current) setRun((prev) => prev && applyEvent(prev, e, now));
      },
    });
    ctrlRef.current = null;
    if (!mountedRef.current) return;
    setRun((prev) => prev && finishRun(prev, end));
    setOpen(true); // finished while hidden → come back with the summary
    // a stopped chunk may still land server-side, so refetch on a stop too
    if (end.scanned > 0 || end.kind === "stopped") onFinishedRef.current();
  }, []);

  const stop = useCallback(() => ctrlRef.current?.abort(), []);
  const show = useCallback(() => setOpen(true), []);
  const hide = useCallback(() => setOpen(false), []);

  return { run, open, start, stop, show, hide };
}

/**
 * Find emails progress modal. While the run is live it shows real progress —
 * leads checked and addresses found, a bar that eases smoothly between chunk
 * replies (estimateProgress), an ETA from the measured pace, and every lead's
 * own state as its chunk is scanned. When the run ends the same card settles
 * into the summary, so there's no second modal.
 *
 * Mid-run, every close affordance (X, Escape, backdrop, Hide) only hides it —
 * Stop is the one way to cancel. Rendered unconditionally with `open` driving
 * AnimatePresence so the exit animation plays.
 */
export function FindEmailsModal({
  open,
  run,
  onHide,
  onStop,
}: {
  open: boolean;
  run: FindRun | null;
  /** close the modal (mid-run, the search carries on) */
  onHide: () => void;
  onStop: () => void;
}) {
  const reduce = !!useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const doneRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();
  const running = run?.phase === "running";
  useFocusTrap(open && !!run, ref);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onHide();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onHide]);

  // Stop unmounts when the run ends and Done takes its place — move focus with it
  const phase = run?.phase;
  useEffect(() => {
    if (open && phase === "finished") doneRef.current?.focus();
  }, [open, phase]);

  const end = run?.end ?? null;
  const notice =
    end && (end.kind === "not-connected" || (end.kind === "error" && end.scanned === 0)) ? end : null;

  return (
    <AnimatePresence>
      {open && run && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <motion.div
            className="absolute inset-0 bg-black/60 backdrop-blur-[2px]"
            onClick={onHide}
            aria-hidden
            initial={reduce ? false : { opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
          />
          <motion.div
            ref={ref}
            role="dialog"
            aria-modal="true"
            aria-labelledby={titleId}
            aria-busy={running}
            tabIndex={-1}
            initial={reduce ? false : { opacity: 0, scale: 0.97, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0, transition: { duration: reduce ? 0 : 0.32, ease: DIALOG_EASE } }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 8, transition: { duration: 0.18, ease: EASE } }}
            className="relative z-10 flex max-h-[min(90vh,760px)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
          >
            <button
              type="button"
              onClick={onHide}
              aria-label={running ? "Hide — the search keeps running" : "Close"}
              data-track="find_emails_result_close"
              className="absolute right-3 top-3 z-10 rounded-lg p-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>

            <AnimatePresence mode="wait" initial={false}>
              {notice ? (
                <motion.div
                  key="notice"
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  transition={{ duration: reduce ? 0 : 0.18 }}
                >
                  {notice.kind === "not-connected" ? (
                    <NoticeBody
                      titleId={titleId}
                      tone="info"
                      icon={PlugZap}
                      title="Email finder not connected"
                      message={notice.message ?? ""}
                    />
                  ) : (
                    <NoticeBody
                      titleId={titleId}
                      tone="error"
                      icon={AlertTriangle}
                      title="Couldn’t finish the search"
                      message={notice.message ?? ""}
                    />
                  )}
                </motion.div>
              ) : (
                <motion.div
                  key="progress"
                  className="flex min-h-0 flex-1 flex-col"
                  exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.15 } }}
                >
                  <ProgressBody run={run} reduce={reduce} titleId={titleId} />
                </motion.div>
              )}
            </AnimatePresence>

            <div className="flex shrink-0 items-center justify-between gap-3 border-t border-border px-5 py-3.5">
              {running ? (
                <>
                  <span className="font-mono text-[10px] leading-snug text-muted-foreground">
                    Hide to keep working — it runs until you leave this list
                  </span>
                  <div className="flex shrink-0 gap-2">
                    <Button variant="ghost" size="sm" onClick={onHide} data-track="find_emails_hide">
                      Hide
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={onStop}
                      data-track="find_emails_stop"
                      className="gap-1.5"
                    >
                      <CircleStop className="h-3.5 w-3.5" aria-hidden />
                      Stop
                    </Button>
                  </div>
                </>
              ) : (
                <Button
                  ref={doneRef}
                  size="sm"
                  onClick={onHide}
                  className="ml-auto"
                  data-track="find_emails_result_done"
                >
                  Done
                </Button>
              )}
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────────  progress body  ───────────────────────────── */

interface Head {
  icon: LucideIcon;
  tone: "primary" | "neutral";
  title: string;
}

function headFor(run: FindRun): Head {
  const end = run.end;
  if (!end) return { icon: ScanSearch, tone: "primary", title: "Finding emails" };
  if (end.kind === "stopped") return { icon: CircleStop, tone: "neutral", title: "Search stopped" };
  if (end.kind === "error") return { icon: AlertTriangle, tone: "primary", title: "Search cut short" };
  return end.found > 0
    ? { icon: Check, tone: "primary", title: "Addresses found" }
    : { icon: Globe, tone: "neutral", title: "No addresses found" };
}

function ProgressBody({ run, reduce, titleId }: { run: FindRun; reduce: boolean; titleId: string }) {
  const head = headFor(run);
  const running = run.phase === "running";
  const pct = run.total > 0 ? Math.round((run.found / run.total) * 100) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-4 px-5 pb-5 pt-6">
      <div className="flex items-start gap-3 pr-8">
        <span
          className={cn(
            "relative flex h-10 w-10 shrink-0 items-center justify-center overflow-hidden rounded-xl border transition-colors duration-300",
            head.tone === "primary"
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-muted text-muted-foreground",
          )}
          aria-hidden
        >
          <AnimatePresence initial={false}>
            <motion.span
              key={head.title}
              className="absolute inset-0 flex items-center justify-center"
              initial={reduce ? false : { opacity: 0, scale: 0.6 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.6 }}
              transition={{ duration: reduce ? 0 : 0.24, ease: EASE }}
            >
              <head.icon className="h-5 w-5" />
            </motion.span>
          </AnimatePresence>
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Email finder
          </div>
          <AnimatePresence mode="wait" initial={false}>
            <motion.h2
              key={head.title}
              id={titleId}
              initial={reduce ? false : { opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: reduce ? 0 : 0.18, ease: EASE }}
              className="mt-1 text-base font-semibold leading-snug tracking-tight text-foreground"
            >
              {head.title}
            </motion.h2>
          </AnimatePresence>
        </div>
      </div>

      {/* the two counts double as the bar's legend: light = checked, solid = found */}
      <div className="flex items-end justify-between gap-4">
        <div className="min-w-0">
          <StatLabel dot="bg-primary/30">Checked</StatLabel>
          <div className="mt-1 flex items-baseline gap-1.5">
            <Count
              value={run.processed}
              reduce={reduce}
              className="tnum font-mono text-3xl font-semibold leading-none tracking-tight text-foreground"
            />
            <span className="tnum font-mono text-sm text-muted-foreground">
              / {run.total.toLocaleString("en-US")}
            </span>
          </div>
        </div>
        <div className="min-w-0 text-right">
          <StatLabel dot="bg-primary" className="justify-end">
            Found
          </StatLabel>
          <div className="mt-1 flex items-baseline justify-end gap-2">
            <AnimatePresence initial={false}>
              {!running && (
                <motion.span
                  initial={reduce ? false : { opacity: 0, x: 6 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ duration: reduce ? 0 : 0.24, ease: EASE, delay: reduce ? 0 : 0.1 }}
                  className="tnum rounded-full border border-border bg-background px-2 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground"
                >
                  {pct}%
                </motion.span>
              )}
            </AnimatePresence>
            <Count
              value={run.found}
              reduce={reduce}
              className="tnum font-mono text-3xl font-semibold leading-none tracking-tight text-foreground"
            />
          </div>
        </div>
      </div>

      <ScanBar run={run} reduce={reduce} />

      <AnimatePresence mode="wait" initial={false}>
        {running ? (
          <motion.div
            key="eta"
            exit={{ opacity: 0, transition: { duration: reduce ? 0 : 0.12 } }}
            className="-mt-2"
          >
            <EtaLine run={run} />
          </motion.div>
        ) : (
          <motion.div
            key="summary"
            initial={reduce ? false : { opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
            className="-mt-1 overflow-hidden"
          >
            <Summary run={run} />
          </motion.div>
        )}
      </AnimatePresence>

      <LeadList run={run} reduce={reduce} />

      {/* one polite announcement per landed chunk, not per animation frame */}
      <p className="sr-only" aria-live="polite">
        {running
          ? `${run.processed} of ${run.total} checked, ${run.found} found`
          : `${head.title}: ${run.found} of ${run.total} leads got an address`}
      </p>
    </div>
  );
}

function StatLabel({
  dot,
  className,
  children,
}: {
  dot: string;
  className?: string;
  children: string;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground",
        className,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full", dot)} aria-hidden />
      {children}
    </div>
  );
}

/** Number that counts up to `value` instead of jumping (§14.5: snaps when
 *  reduced motion is on). */
function Count({ value, reduce, className }: { value: number; reduce: boolean; className?: string }) {
  const mv = useMotionValue(value);
  const text = useTransform(mv, (v) => Math.round(v).toLocaleString("en-US"));
  useEffect(() => {
    if (reduce) {
      mv.jump(value);
      return;
    }
    const controls = animate(mv, value, { duration: 0.6, ease: EASE });
    return () => controls.stop();
  }, [mv, value, reduce]);
  return <motion.span className={className}>{text}</motion.span>;
}

const toPct = (v: number) => `${Math.min(1, Math.max(0, v)) * 100}%`;

/**
 * Two-layer bar: the light layer is leads checked, the solid layer leads with
 * an address. While a chunk is in flight the checked layer eases forward on
 * the pace estimate (rAF → spring), so it never sits frozen between replies,
 * yet never claims a chunk before it answers; when the reply lands the spring
 * glides it to the real count. Reduced motion shows the real counts only.
 */
function ScanBar({ run, reduce }: { run: FindRun; reduce: boolean }) {
  const real = run.total > 0 ? run.processed / run.total : 0;
  const foundShare = run.total > 0 ? run.found / run.total : 0;
  const running = run.phase === "running";

  const checkedTarget = useMotionValue(real);
  const checked = useSpring(checkedTarget, BAR_SPRING);
  const found = useSpring(foundShare, BAR_SPRING);
  const checkedWidth = useTransform(checked, toPct);
  const foundWidth = useTransform(found, toPct);

  // the rAF loop reads the latest pace without restarting on every render
  const paceRef = useRef<FindPace>(run);
  useEffect(() => {
    paceRef.current = run;
  }, [run]);

  useEffect(() => {
    if (reduce) {
      checkedTarget.jump(real);
      checked.jump(real);
      return;
    }
    if (!running) {
      checkedTarget.set(real);
      return;
    }
    let frame = 0;
    const tick = () => {
      const next = estimateProgress(paceRef.current, performance.now());
      if (next > checkedTarget.get()) checkedTarget.set(next);
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [reduce, running, real, checkedTarget, checked]);

  useEffect(() => {
    if (reduce) found.jump(foundShare);
    else found.set(foundShare);
  }, [found, foundShare, reduce]);

  return (
    <div
      role="progressbar"
      aria-label="Leads checked"
      aria-valuemin={0}
      aria-valuemax={run.total}
      aria-valuenow={run.processed}
      aria-valuetext={`${run.processed} of ${run.total} checked, ${run.found} found`}
      className="relative h-2.5 w-full overflow-hidden rounded-full bg-muted"
    >
      <motion.div
        className="absolute inset-y-0 left-0 overflow-hidden rounded-full bg-primary/30"
        style={{ width: checkedWidth }}
      >
        {running && !reduce && (
          <span
            aria-hidden
            className="absolute inset-y-0 left-0 w-1/3 animate-sweep bg-gradient-to-r from-transparent via-white/60 to-transparent dark:via-white/25"
          />
        )}
      </motion.div>
      <motion.div
        className="absolute inset-y-0 left-0 rounded-full bg-primary"
        style={{ width: foundWidth }}
      />
    </div>
  );
}

function fmtEta(ms: number | null): string {
  if (ms === null) return "estimating time…";
  if (ms < 10_000) return "a few seconds left";
  if (ms < 60_000) return "under a minute left";
  return `about ${Math.max(1, Math.round(ms / 60_000))} min left`;
}

/** Under-bar line while running; ticks once a second for the ETA (its own
 *  component so the lead list doesn't re-render with it). */
function EtaLine({ run }: { run: FindRun }) {
  const [now, setNow] = useState(() => performance.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(performance.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  return (
    <div className="flex items-center justify-between gap-3 font-mono text-[10.5px] text-muted-foreground">
      <span className="truncate">
        {run.failed > 0
          ? `${run.failed.toLocaleString("en-US")} couldn’t be reached — skipped`
          : "checking each website and its contact page"}
      </span>
      <span className="tnum shrink-0">{fmtEta(estimateRemainingMs(run, now))}</span>
    </div>
  );
}

function plural(n: number, one: string, many = `${one}s`): string {
  return `${n.toLocaleString("en-US")} ${n === 1 ? one : many}`;
}

/** Outcome sentence once the run has ended (notice-shaped ends render
 *  NoticeBody instead, so `end` here is done / stopped / a partial error). */
function Summary({ run }: { run: FindRun }) {
  const end = run.end;
  if (!end) return null;
  const nothing = end.scanned - end.found;
  const moved =
    end.found > 0
      ? ` ${end.found === 1 ? "It has" : "They have"} moved to the With email tab.`
      : "";
  const dropped =
    end.removed > 0
      ? ` ${plural(end.removed, "lead")} with no email ${end.removed === 1 ? "was" : "were"} removed from your leads.`
      : "";
  const skipped =
    end.failed > 0 ? ` ${plural(end.failed, "lead")} couldn’t be reached and were skipped.` : "";

  let text: string;
  if (end.kind === "stopped") {
    text = `Stopped after checking ${end.scanned.toLocaleString("en-US")} of ${plural(end.total, "lead")} — ${plural(end.found, "address", "addresses")} found.${moved}${dropped} The batch that was mid-scan may still save; refresh in a minute to pick it up.`;
  } else if (end.kind === "error") {
    text = `The finder stopped answering after ${end.scanned.toLocaleString("en-US")} of ${plural(end.total, "lead")} (${end.message ?? "unknown error"}). ${plural(end.found, "address", "addresses")} found before that.${moved}${dropped}`;
  } else if (end.found === 0) {
    text = `None of the ${plural(end.scanned, "lead")} had a scrapable address on its website.${dropped}${skipped}`;
  } else {
    text = `Found an email for ${end.found.toLocaleString("en-US")} of ${plural(end.total, "lead")}${
      nothing > 0 ? ` — the other ${nothing.toLocaleString("en-US")} had nothing scrapable` : ""
    }.${dropped}${skipped}${moved}`;
  }
  return <p className="text-[12.5px] leading-relaxed text-muted-foreground">{text}</p>;
}

/* ─────────────────────────────  lead list  ───────────────────────────── */

function hostOf(website: string): string {
  try {
    return new URL(website).hostname.replace(/^www\./, "");
  } catch {
    return website;
  }
}

/** Every lead in the run with its live state. Follows the chunk being scanned
 *  until the user scrolls the list themselves. */
function LeadList({ run, reduce }: { run: FindRun; reduce: boolean }) {
  const listRef = useRef<HTMLUListElement>(null);
  const followRef = useRef(true);
  const idle = run.phase === "finished";
  const scanningId = idle
    ? null
    : (run.targets.find((t) => run.rows[t.id]?.status === "scanning")?.id ?? null);

  useEffect(() => {
    const list = listRef.current;
    if (!list || !scanningId || !followRef.current) return;
    const row = list.querySelector<HTMLElement>(`[data-id="${CSS.escape(scanningId)}"]`);
    if (!row) return;
    // keep one finished row in view above the chunk being scanned
    list.scrollTo({
      top: Math.max(0, row.offsetTop - row.offsetHeight),
      behavior: reduce ? "auto" : "smooth",
    });
  }, [scanningId, reduce]);

  const stopFollowing = () => {
    followRef.current = false;
  };

  return (
    <ul
      ref={listRef}
      onWheel={stopFollowing}
      onTouchMove={stopFollowing}
      aria-label="Leads in this search"
      className="relative max-h-[min(15rem,34vh)] min-h-0 divide-y divide-border overflow-y-auto rounded-xl border border-border bg-background/60 [scrollbar-width:thin]"
    >
      {run.targets.map((t, i) => (
        <LeadRow
          key={t.id}
          target={t}
          row={run.rows[t.id] ?? QUEUED}
          idle={idle}
          index={i}
          reduce={reduce}
        />
      ))}
    </ul>
  );
}

/** Memoised: applyEvent only replaces the RowState of leads in the chunk that
 *  just moved, so the rest of the list skips the re-render. */
const LeadRow = memo(function LeadRow({
  target,
  row,
  idle,
  index,
  reduce,
}: {
  target: FindTarget;
  row: RowState;
  idle: boolean;
  index: number;
  reduce: boolean;
}) {
  const host = hostOf(target.website);
  const s = row.status;
  const label =
    s === "found"
      ? `${row.email ?? ""}${row.extra > 0 ? ` +${row.extra}` : ""}`
      : s === "none"
        ? row.removed
          ? "nothing found · removed"
          : "nothing found"
        : s === "failed"
          ? "couldn’t reach"
          : s === "scanning"
            ? "scanning…"
            : idle
              ? "not checked"
              : "queued";

  return (
    <motion.li
      data-id={target.id}
      initial={reduce ? false : { opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.18, ease: "easeOut", delay: reduce ? 0 : Math.min(index * 0.02, 0.2) }}
      className={cn(
        "flex items-center gap-3 px-3 py-2 transition-colors duration-300",
        s === "scanning" && "bg-primary/[0.06]",
      )}
    >
      <StatusGlyph status={s} reduce={reduce} />
      <div className="min-w-0 flex-1">
        <div
          className={cn(
            "truncate text-[13px] font-medium leading-tight transition-colors duration-300",
            s === "queued" ? "text-muted-foreground" : "text-foreground",
          )}
        >
          {target.name.trim() || host}
        </div>
        <div className="truncate font-mono text-[10.5px] leading-tight text-muted-foreground">
          {host}
        </div>
      </div>
      <div className="flex min-w-0 max-w-[48%] justify-end">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={s}
            initial={reduce ? false : { opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: reduce ? 0 : 0.16, ease: EASE }}
            title={s === "found" ? (row.email ?? undefined) : undefined}
            className={cn(
              "truncate font-mono text-[11px]",
              s === "found" ? "text-foreground" : "text-muted-foreground",
              s === "scanning" && "text-primary",
            )}
          >
            {label}
          </motion.span>
        </AnimatePresence>
      </div>
    </motion.li>
  );
});

function StatusGlyph({ status, reduce }: { status: RowStatus; reduce: boolean }) {
  return (
    <span className="relative flex h-5 w-5 shrink-0 items-center justify-center" aria-hidden>
      <AnimatePresence initial={false}>
        <motion.span
          key={status}
          className="absolute inset-0 flex items-center justify-center"
          initial={reduce ? false : { opacity: 0, scale: 0.5 }}
          animate={{ opacity: 1, scale: 1 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.5 }}
          transition={{ duration: reduce ? 0 : 0.22, ease: EASE }}
        >
          {status === "scanning" ? (
            <span className="h-4 w-4 animate-spin rounded-full border-2 border-primary/20 border-t-primary motion-reduce:animate-none" />
          ) : status === "found" ? (
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-primary text-primary-foreground">
              <Check className="h-3 w-3" strokeWidth={3} />
            </span>
          ) : status === "none" ? (
            <span className="flex h-[18px] w-[18px] items-center justify-center rounded-full bg-muted text-muted-foreground">
              <Minus className="h-3 w-3" strokeWidth={2.5} />
            </span>
          ) : status === "failed" ? (
            <AlertTriangle className="h-3.5 w-3.5 text-muted-foreground" />
          ) : (
            <span className="h-1.5 w-1.5 rounded-full bg-muted-foreground/40" />
          )}
        </motion.span>
      </AnimatePresence>
    </span>
  );
}

/* ─────────────────────────────  notice body  ───────────────────────────── */

/** Not-connected, or a run that failed before any chunk answered. */
function NoticeBody({
  titleId,
  tone,
  icon: Icon,
  title,
  message,
}: {
  titleId: string;
  tone: "info" | "error";
  icon: LucideIcon;
  title: string;
  message: string;
}) {
  return (
    <div className="flex flex-col gap-4 px-5 pb-5 pt-6">
      <div className="flex items-start gap-3 pr-8">
        <span
          className={cn(
            "flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border",
            tone === "error"
              ? "border-destructive/40 bg-destructive/10 text-destructive"
              : "border-primary/40 bg-primary/10 text-primary",
          )}
          aria-hidden
        >
          <Icon className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            Email finder
          </div>
          <h2
            id={titleId}
            className="mt-1 text-base font-semibold leading-snug tracking-tight text-foreground"
          >
            {title}
          </h2>
        </div>
      </div>
      <p
        role={tone === "error" ? "alert" : undefined}
        className="text-[12.5px] leading-relaxed text-muted-foreground"
      >
        {message}
      </p>
    </div>
  );
}
