"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Check,
  Database,
  FileSpreadsheet,
  FileUp,
  RotateCcw,
  ScanLine,
  UploadCloud,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { parseLeadsCsv, type ParsedCsv } from "@/lib/pipeline/csv";
import { useLeadStats, type LeadStatsState } from "@/lib/data/useLeadStats";
import { formatInt } from "@/lib/format";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { Button } from "@/components/ui/button";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { SignalLed } from "./SignalLed";
import { LeadsTableView } from "./pipeline/LeadsTable";
import { SendCampaigns } from "./pipeline/SendCampaigns";
import { MigrationCard, StoredLeadsPanel } from "./pipeline/StoredLeads";
import { StepRail, type FlowStep, type StepStatus } from "./pipeline/StepRail";

const EASE = [0.16, 1, 0.3, 1] as const;
const BATCH_SIZE = 200;

type Phase = "idle" | "reading" | "confirm" | "uploading" | "done" | "error";
type UploadMode = "live" | "demo" | "noop";

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

/** Next 4-digit sequence for a new import folder (max existing + 1). */
function nextBatchSeq(batches: Array<{ batch: string }> | undefined): number {
  let max = 0;
  for (const b of batches ?? []) {
    const m = /^leads-(\d+)-/.exec(b.batch);
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max + 1;
}

/** Folder name for an import, e.g. leads-0001-20260629-073700. */
function makeBatchName(seq: number): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const ts = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  return `leads-${String(seq).padStart(4, "0")}-${ts}`;
}

type PipelineSub = "leads" | "campaigns";

const SUB_VARIANTS = {
  enter: (dir: number) => ({ opacity: 0, x: dir >= 0 ? 24 : -24 }),
  center: { opacity: 1, x: 0 },
  exit: (dir: number) => ({ opacity: 0, x: dir >= 0 ? -24 : 24 }),
};

/**
 * Pipeline shell — hosts two sub-tabs: "Leads" (the CSV importer) and
 * "Send Campaigns (Automation)" (tracked outreach to stored leads). The campaign
 * tab is gated on the `campaigns.send` permission, so a role without it sees
 * only Leads. Sub-views unmount on switch (AnimatePresence), exactly like the
 * top-level tabs in DashboardShell.
 */
export function PipelinePage() {
  const reduce = !!useReducedMotion();
  const { can } = useRbac();
  const canSend = can("campaigns.send");
  const [sub, setSub] = useState<PipelineSub>("leads");

  // a role that loses send rights can't sit on the campaign tab
  useEffect(() => {
    if (sub === "campaigns" && !canSend) setSub("leads");
  }, [sub, canSend]);

  const dir = sub === "campaigns" ? 1 : -1;

  return (
    <div className="flex min-h-full flex-col">
      <PipelineSubNav sub={sub} canSend={canSend} reduce={reduce} onSelect={setSub} />
      <div className="min-h-0 flex-1 overflow-x-clip">
        <AnimatePresence mode="wait" initial={false} custom={dir}>
          <motion.div
            key={sub}
            custom={dir}
            variants={SUB_VARIANTS}
            initial={reduce ? false : "enter"}
            animate="center"
            exit={reduce ? { opacity: 0 } : "exit"}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="min-h-full"
          >
            {sub === "leads" ? (
              <PipelineLeads />
            ) : (
              <SendCampaigns onSwitchToLeads={() => setSub("leads")} />
            )}
          </motion.div>
        </AnimatePresence>
      </div>
    </div>
  );
}

/* ─────────────────────────────  sub-tabs  ───────────────────────────── */

function PipelineSubNav({
  sub,
  canSend,
  reduce,
  onSelect,
}: {
  sub: PipelineSub;
  canSend: boolean;
  reduce: boolean;
  onSelect: (sub: PipelineSub) => void;
}) {
  return (
    <Reveal className="border-b border-border px-4 pt-5 sm:px-6" y={6}>
      <div className="flex flex-wrap items-center gap-1 pb-3">
        <SubTabPill
          id="leads"
          label="Leads"
          active={sub === "leads"}
          reduce={reduce}
          onClick={() => onSelect("leads")}
        />
        {canSend && (
          <SubTabPill
            id="campaigns"
            label="Send Campaigns (Automation)"
            active={sub === "campaigns"}
            reduce={reduce}
            onClick={() => onSelect("campaigns")}
          />
        )}
      </div>
    </Reveal>
  );
}

/** Sliding-indicator pill (ui-standards §11.1), recoloured to the signal accent:
 *  a single solid-red indicator glides between pills via a shared `layoutId`. */
function SubTabPill({
  id,
  label,
  active,
  reduce,
  onClick,
}: {
  id: string;
  label: string;
  active: boolean;
  reduce: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      data-track="pipeline_subtab"
      data-track-subtab={id}
      className={cn(
        "relative rounded-md px-3 py-1.5 text-[12.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
        active ? "text-primary-foreground" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="pipeline-subtab"
          className="absolute inset-0 rounded-md bg-primary-solid shadow-sm shadow-signal-900/30"
          transition={{ duration: reduce ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
        />
      )}
      <span className="relative z-10">{label}</span>
    </button>
  );
}

/* ─────────────────────────────  leads importer  ───────────────────────────── */

function PipelineLeads() {
  const reduce = !!useReducedMotion();
  const inputRef = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [parsed, setParsed] = useState<ParsedCsv | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [readShown, setReadShown] = useState(0);
  const [uploaded, setUploaded] = useState(0);
  const [result, setResult] = useState<{ inserted: number; mode: UploadMode; batch: string | null } | null>(
    null,
  );
  const [error, setError] = useState<{ step: number; message: string } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  // which phase node the user is viewing (0 upload · 1 read & parse · 2 push)
  const [selected, setSelected] = useState(0);
  // bumped after a successful import so the stored-leads view refetches
  const [refreshSignal, setRefreshSignal] = useState(0);
  // true when the `batch` column is missing (folders migration not yet run)
  const [needsMigration, setNeedsMigration] = useState(false);

  // Live database counts shown above the flow — polls every 15s (and on focus)
  // so the numbers stay realtime; also refreshed the instant an import finishes.
  const { state: statsState, reload: reloadStats } = useLeadStats({ pollMs: 15000 });

  // Unmount / re-run guards. DashboardShell unmounts this page on tab switch
  // (AnimatePresence mode="wait"), so any in-flight rAF / awaited fetch must not
  // setState afterwards. A run token also prevents an old run() from clobbering
  // state after the user hits "Try again".
  const mountedRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  const runIdRef = useRef(0);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  // Refresh the live counts the instant an import (or delete) bumps the signal.
  useEffect(() => {
    if (refreshSignal > 0) reloadStats();
  }, [refreshSignal, reloadStats]);

  const total = parsed?.rows.length ?? 0;

  const steps = useMemo<FlowStep[]>(
    () => buildSteps(phase, !!file, error?.step ?? null),
    [phase, file, error],
  );

  const fail = useCallback((step: number, message: string) => {
    setError({ step, message });
    setPhase("error");
    setSelected(step);
  }, []);

  // Smoothly tween a numeric setter from → to over `dur` ms on an easeOutCubic
  // curve. The rAF id is tracked in rafRef so it's cancelled on unmount / re-run,
  // and `live` lets a stale run bail. Snaps to the target under reduced motion.
  // Shared by the reading count-up and the upload progress fill.
  const tweenTo = useCallback(
    (
      apply: (n: number) => void,
      from: number,
      to: number,
      dur: number,
      live: () => boolean = () => mountedRef.current,
    ) =>
      new Promise<void>((resolve) => {
        if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
        if (reduce || dur <= 0 || to === from) {
          apply(to);
          resolve();
          return;
        }
        const start = performance.now();
        const tick = (now: number) => {
          if (!live()) {
            resolve();
            return;
          }
          const t = Math.min(1, (now - start) / dur);
          const eased = 1 - Math.pow(1 - t, 3);
          apply(Math.round(from + (to - from) * eased));
          if (t < 1) {
            rafRef.current = requestAnimationFrame(tick);
          } else {
            rafRef.current = null;
            apply(to);
            resolve();
          }
        };
        rafRef.current = requestAnimationFrame(tick);
      }),
    [reduce],
  );

  // count-up reveal for the "reading" phase (snaps under reduced motion).
  const animateRead = useCallback(
    (count: number) => tweenTo(setReadShown, 0, count, Math.min(1500, 400 + count * 7)),
    [tweenTo],
  );

  const run = useCallback(
    async (f: File) => {
      const runId = ++runIdRef.current;
      // true only while this exact run still owns the component
      const live = () => mountedRef.current && runId === runIdRef.current;

      setError(null);
      setResult(null);
      setReadShown(0);
      setUploaded(0);
      setParsed(null);
      setNeedsMigration(false);
      setPhase("reading");
      setSelected(1); // follow the flow to the Read & parse node

      // ── Phase: read & parse (client-side) ──
      let parsedCsv: ParsedCsv;
      try {
        const text = await f.text();
        parsedCsv = parseLeadsCsv(text);
      } catch {
        if (live()) fail(1, "Couldn't read that file. Make sure it's a .csv export.");
        return;
      }
      if (!live()) return;
      if (parsedCsv.rows.length === 0) {
        fail(
          1,
          parsedCsv.headers.length
            ? "No rows with a Name column were found in this file."
            : "That file doesn't look like a CSV export.",
        );
        return;
      }
      setParsed(parsedCsv);
      await animateRead(parsedCsv.rows.length);
      if (!live()) return;

      // ── Gate: STOP before writing anything ──
      // Parsing is done, but nothing is pushed to Supabase yet. We park on the
      // "confirm" phase so the user reviews the parsed rows and answers the
      // "Save leads?" prompt; confirmSave() does the actual write on click.
      setPhase("confirm");
      // stay on the Read & parse node (selected === 1) so the parsed table and
      // the Save prompt sit together.
    },
    [animateRead, fail],
  );

  // The write half of the flow, gated behind the user's explicit "Save leads"
  // click: batched POST → /api/pipeline/upload, auto-naming this import folder.
  const confirmSave = useCallback(async () => {
    const rows = parsed?.rows;
    if (!rows || rows.length === 0) return;

    const runId = ++runIdRef.current;
    const live = () => mountedRef.current && runId === runIdRef.current;

    setError(null);
    setResult(null);
    setUploaded(0);
    setNeedsMigration(false);
    setPhase("uploading");
    setSelected(2); // follow the flow to the Push to Supabase node

    // auto-name this import's folder: leads-0001-<timestamp>
    let seq = 1;
    try {
      const br = await fetch("/api/pipeline/batches", { cache: "no-store" });
      const bd = (await br.json().catch(() => null)) as
        | { ok?: boolean; batches?: Array<{ batch: string }>; needsMigration?: boolean }
        | null;
      if (bd?.needsMigration) setNeedsMigration(true);
      if (bd?.ok) seq = nextBatchSeq(bd.batches);
    } catch {
      /* best-effort; default to seq 1 */
    }
    if (!live()) return;
    const batchName = makeBatchName(seq);

    const chunks = chunk(rows, BATCH_SIZE);
    let inserted = 0;
    let anyDemo = false;
    let anyLive = false;
    for (const chunkRows of chunks) {
      let res: Response;
      try {
        res = await fetch("/api/pipeline/upload", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ batch: batchName, rows: chunkRows }),
        });
      } catch {
        if (live()) fail(2, "Network error reaching the importer.");
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; inserted?: number; mode?: UploadMode; error?: string; needsMigration?: boolean }
        | null;
      if (!live()) return;
      if (data?.needsMigration) {
        setNeedsMigration(true);
        fail(2, "Folders need a one-time migration — see the SQL under Push to Supabase.");
        return;
      }
      if (!res.ok || !data?.ok) {
        fail(2, data?.error ?? `Importer responded ${res.status}.`);
        return;
      }
      if (data.mode === "demo") anyDemo = true;
      if (data.mode === "live") anyLive = true;
      const prev = inserted;
      inserted += data.inserted ?? chunkRows.length;
      // Smooth, eased fill for this chunk. The write itself can return instantly
      // (demo mode / tiny files), so we animate the counter + bar over a comfy
      // minimum instead of snapping to 100% — this is the "loading" the user sees.
      const span = inserted - prev;
      await tweenTo(setUploaded, prev, inserted, Math.max(750, Math.min(1800, span * 7 + 400)), live);
      if (!live()) return;
    }

    // let the filled bar rest at 100% for a beat so completion registers
    if (!reduce) await sleep(550);
    if (!live()) return;

    // worst-case wins: if any batch fell back to demo, the badge says demo
    const mode: UploadMode = anyDemo ? "demo" : anyLive ? "live" : "demo";
    setResult({ inserted, mode, batch: batchName });
    setRefreshSignal((n) => n + 1); // pull the freshly-written rows back
    setPhase("done");
  }, [parsed, fail, reduce, tweenTo]);

  function pick(f: File | null | undefined) {
    if (!f) return;
    setFile(f);
    setParsed(null);
    setResult(null);
    setError(null);
    setPhase("idle");
    setSelected(0);
  }

  function reset() {
    setFile(null);
    setParsed(null);
    setResult(null);
    setError(null);
    setReadShown(0);
    setUploaded(0);
    setNeedsMigration(false);
    setPhase("idle");
    setSelected(0);
    if (inputRef.current) inputRef.current.value = "";
  }

  const busy = phase === "reading" || phase === "uploading";

  // Coarse, phase-level status surfaced to screen readers (not the per-frame
  // counter, which would be noisy). Errors are announced via role="alert".
  const liveMessage =
    phase === "reading"
      ? `Reading CSV${total ? `, ${total} rows` : ""}`
      : phase === "confirm"
        ? `Parsed ${total} row${total === 1 ? "" : "s"}. Confirm to save them to Supabase.`
        : phase === "uploading"
          ? `Uploading ${total} rows to Supabase`
          : phase === "done" && result
            ? `Done. Imported ${result.inserted} lead${result.inserted === 1 ? "" : "s"}${
                result.mode === "demo" ? " (demo mode)" : ""
              }.`
            : "";

  // distinct key per visible content so AnimatePresence cross-fades cleanly
  const panelKey =
    selected === 0
      ? "upload"
      : selected === 1
        ? phase === "reading"
          ? "reading"
          : phase === "error" && error?.step === 1
            ? "error1"
            : parsed && parsed.rows.length
              ? "parsed"
              : "empty1"
        : needsMigration
          ? "migrate"
          : phase === "uploading"
            ? "uploading"
            : phase === "error" && error?.step === 2
              ? "error2"
              : "supabase";

  function renderPanel() {
    if (selected === 0) {
      return (
        <IdlePanel
          file={file}
          dragOver={dragOver}
          running={busy}
          onBrowse={() => inputRef.current?.click()}
          onClear={reset}
          onRun={() => file && run(file)}
          onDragState={setDragOver}
          onDropFile={pick}
        />
      );
    }
    if (selected === 1) {
      if (phase === "reading") {
        return (
          <ReadingPanel file={file} parsed={parsed} readShown={readShown} total={total} reduce={reduce} />
        );
      }
      if (phase === "error" && error?.step === 1) {
        return (
          <ErrorPanel
            message={error.message}
            canRetry={!!file}
            onRetry={() => file && run(file)}
            onReset={reset}
          />
        );
      }
      if (parsed && parsed.rows.length)
        return (
          <ParsedView
            parsed={parsed}
            confirming={phase === "confirm"}
            onSave={confirmSave}
            onDiscard={reset}
          />
        );
      return (
        <EmptyPhase
          icon={ScanLine}
          title="Nothing parsed yet"
          hint="Select Upload CSV, choose a file, and Run import — the rows read from the file appear here."
        />
      );
    }
    // selected === 2 (Push to Supabase)
    if (needsMigration) return <MigrationCard />;
    if (phase === "uploading") {
      return <UploadingPanel uploaded={uploaded} total={total} reduce={reduce} />;
    }
    if (phase === "error" && error?.step === 2) {
      return (
        <ErrorPanel
          message={error.message}
          canRetry={!!file}
          onRetry={() => file && run(file)}
          onReset={reset}
        />
      );
    }
    return (
      <StoredLeadsPanel
        refreshSignal={refreshSignal}
        openBatch={result?.batch ?? undefined}
        banner={result ? <SuccessBanner result={result} onReset={reset} /> : undefined}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <input
        ref={inputRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => pick(e.target.files?.[0])}
      />
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {/* header */}
      <Reveal className="mb-5" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Data pipeline
            </div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">
              Leads
            </h1>
          </div>
          <div className="text-right font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
            <div>Target table</div>
            <div className="tnum text-foreground/80">public.leads</div>
          </div>
        </div>
      </Reveal>

      {/* live database counts — realtime (polls + refreshes after each import) */}
      <Reveal delay={0.03} className="mb-3">
        <PipelineStats state={statsState} />
      </Reveal>

      {/* the n8n-style step rail — nodes are clickable to switch the view */}
      <Reveal delay={0.06} className="mb-3">
        <StepRail steps={steps} selected={selected} onSelect={setSelected} />
      </Reveal>

      {/* selected phase panel */}
      <Reveal delay={0.08}>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panelKey}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: reduce ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
            >
              {renderPanel()}
            </motion.div>
          </AnimatePresence>
        </div>
      </Reveal>

      <Footer />
    </div>
  );
}

/* ─────────────────────────────  live stats  ───────────────────────────── */

/** Relative "time ago" for the last-import recency cue. */
function formatAgo(iso: string | null): string {
  if (!iso) return "—";
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return "—";
  const s = Math.max(0, Math.floor((Date.now() - t) / 1000));
  if (s < 45) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(t).toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function StatCell({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="bg-card px-4 py-3">
      <div
        className={cn(
          "tnum font-mono text-xl font-semibold leading-none sm:text-2xl",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/** Realtime readout of the leads table sitting above the import flow. */
function PipelineStats({ state }: { state: LeadStatsState }) {
  const data = state.status === "ready" ? state.data : null;
  const fmt = (n: number | undefined) => (data && n != null ? formatInt(n) : "—");

  const note =
    state.status === "loading"
      ? "connecting…"
      : state.status === "error"
        ? "unavailable"
        : data?.mode === "demo"
          ? "demo mode"
          : `last import ${formatAgo(data?.latestImport ?? null)}`;

  return (
    <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" aria-label="Live database counts">
      <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-2.5">
        <div className="flex items-center gap-2">
          <SignalLed className="h-2 w-2" />
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Live · public.leads
          </span>
        </div>
        <span className="tnum font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground/70">
          {note}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-4">
        <StatCell label="In database" value={fmt(data?.total)} accent />
        <StatCell label="Folders" value={fmt(data?.folders)} />
        <StatCell label="With email" value={fmt(data?.withEmail)} />
        <StatCell label="New · 24h" value={fmt(data?.addedToday)} />
      </div>
    </section>
  );
}

/* ─────────────────────────────  step status  ───────────────────────────── */

function buildSteps(phase: Phase, hasFile: boolean, errStep: number | null): FlowStep[] {
  let s0: StepStatus;
  let s1: StepStatus;
  let s2: StepStatus;

  if (phase === "error" && errStep != null) {
    s0 = errStep === 0 ? "error" : "done";
    s1 = errStep === 1 ? "error" : errStep > 1 ? "done" : "idle";
    s2 = errStep === 2 ? "error" : "idle";
  } else {
    s0 =
      phase === "reading" || phase === "confirm" || phase === "uploading" || phase === "done"
        ? "done"
        : hasFile
          ? "active"
          : "idle";
    s1 =
      phase === "done" || phase === "uploading" || phase === "confirm"
        ? "done"
        : phase === "reading"
          ? "active"
          : "idle";
    s2 = phase === "done" ? "done" : phase === "uploading" ? "active" : "idle";
  }

  return [
    {
      id: "upload",
      label: "Upload CSV",
      icon: FileUp,
      status: s0,
      detail: detailFor(s0, "Awaiting file", "Selected", "Ingested"),
    },
    {
      id: "read",
      label: "Read & parse",
      icon: ScanLine,
      status: s1,
      detail: detailFor(s1, "Queued", "Reading…", "Parsed"),
    },
    {
      id: "push",
      label: "Push to Database",
      icon: Database,
      status: s2,
      detail: phase === "confirm" ? "Awaiting save" : detailFor(s2, "Queued", "Writing…", "Stored"),
    },
  ];
}

function detailFor(status: StepStatus, idle: string, active: string, done: string): string {
  if (status === "active") return active;
  if (status === "done") return done;
  if (status === "error") return "Failed";
  return idle;
}

/* ─────────────────────────────  panels  ───────────────────────────── */

function IdlePanel({
  file,
  dragOver,
  running,
  onBrowse,
  onClear,
  onRun,
  onDragState,
  onDropFile,
}: {
  file: File | null;
  dragOver: boolean;
  running: boolean;
  onBrowse: () => void;
  onClear: () => void;
  onRun: () => void;
  onDragState: (v: boolean) => void;
  onDropFile: (f: File | undefined) => void;
}) {
  return (
    <div className="flex flex-col gap-4">
      <button
        type="button"
        onClick={onBrowse}
        data-track="pipeline_dropzone"
        onDragOver={(e) => {
          e.preventDefault();
          onDragState(true);
        }}
        onDragLeave={() => onDragState(false)}
        onDrop={(e) => {
          e.preventDefault();
          onDragState(false);
          onDropFile(e.dataTransfer.files?.[0]);
        }}
        className={cn(
          "group flex w-full flex-col items-center justify-center gap-3 rounded-xl border border-dashed px-6 py-10 text-center transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card",
          dragOver
            ? "border-primary/60 bg-primary/5"
            : "border-border hover:border-primary/40 hover:bg-muted/40",
        )}
      >
        <span
          className={cn(
            "flex h-12 w-12 items-center justify-center rounded-2xl border transition-colors",
            dragOver
              ? "border-primary/40 bg-primary/10 text-primary"
              : "border-border bg-background text-muted-foreground group-hover:text-primary",
          )}
        >
          <UploadCloud className="h-6 w-6" aria-hidden />
        </span>
        <span className="text-sm font-semibold text-foreground">
          Drop your Bing Maps Scraper CSV
        </span>
        <span className="font-mono text-[11px] text-muted-foreground">
          or <span className="text-primary underline-offset-2 group-hover:underline">browse</span>{" "}
          to select a file
        </span>
      </button>

      {file && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-card text-primary">
            <FileSpreadsheet className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium text-foreground">{file.name}</div>
            <div className="tnum font-mono text-[10.5px] text-muted-foreground">
              {formatBytes(file.size)}
            </div>
          </div>
          <button
            type="button"
            aria-label="Remove file"
            data-track="pipeline_clear_file"
            onClick={onClear}
            className="rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          Keeps: Name · Address · Website · Phone · Emails · Socials · Rating · Image · Map URL
        </p>
        <Button data-track="pipeline_run" disabled={!file || running} onClick={onRun} className="gap-1.5">
          <FileUp className="h-4 w-4" aria-hidden />
          Run import
        </Button>
      </div>
    </div>
  );
}

function ReadingPanel({
  file,
  parsed,
  readShown,
  total,
  reduce,
}: {
  file: File | null;
  parsed: ParsedCsv | null;
  readShown: number;
  total: number;
  reduce: boolean;
}) {
  const end = Math.min(readShown, total);
  const start = Math.max(0, end - 5);
  const windowRows = (parsed?.rows ?? []).slice(start, end).map((r, k) => ({ r, idx: start + k }));

  return (
    <div className="flex flex-col gap-4">
      <PhaseHeader icon={ScanLine} title="Reading CSV" meta={file?.name ?? "file"} />

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="tnum font-mono text-[34px] font-semibold leading-none text-foreground sm:text-[40px]">
            {end.toLocaleString("en-US")}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            of {total.toLocaleString("en-US")} rows parsed
          </div>
        </div>
        <SignalLed className="mb-2 h-2.5 w-2.5" />
      </div>

      <Bar value={total ? end / total : 0} reduce={reduce} label="Parse progress" />

      {/* live row reveal — a moving window so it reads like a scan */}
      <div className="relative overflow-hidden rounded-lg border border-border bg-background/40">
        {!reduce && (
          <motion.div
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 z-10 h-10 bg-gradient-to-b from-primary/15 to-transparent"
            animate={{ y: ["-100%", "360%"] }}
            transition={{ repeat: Infinity, duration: 1.6, ease: "linear" }}
          />
        )}
        <ul className="divide-y divide-border">
          {windowRows.length === 0 && (
            <li className="px-3 py-2 font-mono text-[10.5px] text-muted-foreground">scanning…</li>
          )}
          {windowRows.map(({ r, idx }) => (
            <li key={idx} className="flex items-center gap-2 px-3 py-1.5">
              <span className="tnum font-mono text-[9.5px] text-muted-foreground">
                {String(idx + 1).padStart(3, "0")}
              </span>
              <span className="truncate text-[12px] text-foreground">{r.name}</span>
              <span className="ml-auto max-w-[45%] truncate font-mono text-[10.5px] text-muted-foreground">
                {r.website ?? "—"}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function UploadingPanel({
  uploaded,
  total,
  reduce,
}: {
  uploaded: number;
  total: number;
  reduce: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PhaseHeader icon={Database} title="Pushing to Supabase" meta="public.leads" />

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="tnum font-mono text-[34px] font-semibold leading-none text-foreground sm:text-[40px]">
            {uploaded.toLocaleString("en-US")}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            of {total.toLocaleString("en-US")} rows written
          </div>
        </div>
        <SignalLed className="mb-2 h-2.5 w-2.5" />
      </div>

      <Bar value={total ? uploaded / total : 0} reduce={reduce} label="Upload progress" />

      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
        <UploadCloud className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className="truncate">POST · /rest/v1/leads</span>
        <span className="tnum ml-auto text-foreground/70">
          {total ? Math.round((uploaded / total) * 100) : 0}%
        </span>
      </div>
    </div>
  );
}

function ParsedView({
  parsed,
  confirming = false,
  onSave,
  onDiscard,
}: {
  parsed: ParsedCsv;
  confirming?: boolean;
  onSave?: () => void;
  onDiscard?: () => void;
}) {
  const count = parsed.rows.length;
  return (
    <div className="flex flex-col gap-4">
      {/* the "Save leads?" gate — nothing is written to Supabase until confirmed */}
      {confirming && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
            <Database className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground">
              Save {count.toLocaleString("en-US")} lead{count === 1 ? "" : "s"} to Supabase?
            </div>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground">
              Writes to public.leads · nothing is stored until you confirm
            </div>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={onDiscard} data-track="pipeline_save_discard">
              Discard
            </Button>
            <Button
              size="sm"
              onClick={onSave}
              data-track="pipeline_save_confirm"
              className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
            >
              <UploadCloud className="h-3.5 w-3.5" aria-hidden />
              Save {count.toLocaleString("en-US")} lead{count === 1 ? "" : "s"}
            </Button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <PhaseHeader
          icon={ScanLine}
          title="Parsed from file"
          meta={`${count.toLocaleString("en-US")} rows`}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          in memory · client-side
        </span>
      </div>
      <LeadsTableView rows={parsed.rows} emptyHint="No rows parsed from this file." />
      {parsed.skipped > 0 && (
        <p className="font-mono text-[10.5px] text-muted-foreground">
          {parsed.skipped.toLocaleString("en-US")} row
          {parsed.skipped === 1 ? "" : "s"} skipped (no business name).
        </p>
      )}
    </div>
  );
}

function SuccessBanner({
  result,
  onReset,
}: {
  result: { inserted: number; mode: UploadMode; batch: string | null };
  onReset: () => void;
}) {
  const demo = result.mode === "demo";
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
        <Check className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">
          Imported {result.inserted.toLocaleString("en-US")} lead{result.inserted === 1 ? "" : "s"}
        </div>
        <div className="truncate font-mono text-[10.5px] text-muted-foreground">
          {demo
            ? "Demo mode — not written to Supabase"
            : result.batch
              ? `Folder ${result.batch}`
              : "Written to Supabase · public.leads"}
        </div>
      </div>
      <Button
        variant="outline"
        size="sm"
        data-track="pipeline_import_another"
        onClick={onReset}
        className="ml-auto gap-1.5"
      >
        <RotateCcw className="h-3.5 w-3.5" aria-hidden />
        Import another
      </Button>
    </div>
  );
}

function EmptyPhase({
  icon: Icon,
  title,
  hint,
}: {
  icon: typeof Database;
  title: string;
  hint: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
        <Icon className="h-5 w-5" aria-hidden />
      </span>
      <p className="text-[13px] font-medium text-foreground">{title}</p>
      <p className="max-w-xs font-mono text-[10.5px] leading-relaxed text-muted-foreground">{hint}</p>
    </div>
  );
}

function ErrorPanel({
  message,
  canRetry,
  onRetry,
  onReset,
}: {
  message: string;
  canRetry: boolean;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="text-base font-semibold text-foreground">Import failed</h2>
      <p
        role="alert"
        className="max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground"
      >
        {message}
      </p>
      <div className="mt-1 flex items-center gap-2">
        {canRetry && (
          <Button data-track="pipeline_retry" onClick={onRetry} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Try again
          </Button>
        )}
        <Button variant="outline" data-track="pipeline_startover" onClick={onReset}>
          Start over
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────  bits  ───────────────────────────── */

function PhaseHeader({
  icon: Icon,
  title,
  meta,
}: {
  icon: typeof Database;
  title: string;
  meta: string;
}) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
        <Icon className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <div className="truncate font-mono text-[10.5px] text-muted-foreground">{meta}</div>
      </div>
    </div>
  );
}

function Bar({ value, reduce, label }: { value: number; reduce: boolean; label: string }) {
  const pct = Math.round(Math.max(0, Math.min(1, value)) * 100);
  return (
    <div
      className="h-1.5 w-full overflow-hidden rounded-full bg-border"
      role="progressbar"
      aria-label={label}
      aria-valuenow={pct}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <motion.div
        className="h-full rounded-full bg-primary"
        initial={false}
        animate={{ width: `${pct}%` }}
        transition={{ duration: reduce ? 0 : 0.25, ease: EASE }}
      />
    </div>
  );
}
