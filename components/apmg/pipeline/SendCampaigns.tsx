"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MutableRefObject,
  type ReactNode,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Globe,
  Mail,
  MailX,
  PenLine,
  RefreshCw,
  RotateCcw,
  Search,
  Send,
  Sparkles,
  Target,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/useFocusTrap";
import {
  alternateEmails,
  bestEmail,
  COMPOSE_CHUNK_LEADS,
  DEFAULT_BODY_HTML,
  DEFAULT_CAMPAIGN,
  DEFAULT_SUBJECT,
  isEmail,
  MAX_COMPOSE_LEADS,
  MAX_FIND_LEADS,
  MAX_RECIPIENTS,
  MERGE_TOKENS,
  MIN_SEND_EMAILS,
  renderBody,
  renderSubject,
  slugifyCampaign,
  trackedLink,
  type ComposeDraft,
} from "@/lib/pipeline/campaign";
import { SERVICE_TEMPLATES, serviceBySlug } from "@/lib/pipeline/services";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/rbac/Can";
import { Footer } from "../Footer";
import { Reveal } from "../Reveal";
import { SignalLed } from "../SignalLed";
import {
  ErrorInline,
  LeadsTableView,
  TableSkeleton,
  type LeadView,
} from "./LeadsTable";
import { StepRail, type FlowStep, type StepStatus } from "./StepRail";

const EASE = [0.16, 1, 0.3, 1] as const;
const PANEL_EASE = [0.22, 1, 0.36, 1] as const;
// keep in sync with UNGROUPED in lib/pipeline/server.ts
const UNGROUPED = "__ungrouped__";

type SendPhase = "idle" | "sending" | "done" | "error";
type SendMode = "live" | "demo" | "noop";
// AI drafting via the in-app composer (app/api/pipeline/campaigns/compose)
type ComposePhase = "idle" | "running" | "ready" | "error";
type DraftMode = "template" | "ai";
// Email finding via the n8n Email Finder (app/api/pipeline/campaigns/find-emails)
type FindPhase = "idle" | "running" | "done" | "error";
type FindInfo = { mode: "live" | "demo"; found: number; tried: number };
type Recipient = {
  id: string;
  email: string;
  business: string;
  subject?: string;
  html?: string;
  category?: string | null;
  /** a top-up recipient: the lead's 2nd/3rd stored address, added because the
   *  send resolved fewer than MIN_SEND_EMAILS addresses (same email content) */
  alt?: boolean;
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

function folderLabel(batch: string): string {
  return batch === UNGROUPED ? "Ungrouped" : batch;
}

/** A draft can be sent only with a resolved address AND non-empty subject/body.
 *  Blanking any of these in review takes the lead out of the send (rather than
 *  silently falling back to the shared template server-side). */
function draftSendable(d: ComposeDraft): boolean {
  return isEmail(d.best_email ?? "") && d.subject.trim().length > 0 && d.html.trim().length > 0;
}

/** Resolve the host the tracked CTA links point at (build-pinned or this origin). */
function trackBase(): string {
  return process.env.NEXT_PUBLIC_TRACK_BASE || (typeof window !== "undefined" ? window.location.origin : "");
}

/** Shared srcDoc wrapper for the sandboxed email previews (compose editor,
 *  drafts review, and the per-recipient review list before sending). */
function emailPreviewDoc(inner: string): string {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"><base target="_blank"><style>body{margin:0;padding:18px;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;font-size:14px;line-height:1.55;color:#1a1a1a;background:#fff}p{margin:0 0 14px}a{color:#c8102e;font-weight:600;text-decoration:underline}</style></head><body>${inner}</body></html>`;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; rows: LeadView[]; mode: string };

/**
 * Send Campaigns (Automation) — the Pipeline sub-tab that turns stored leads
 * into a tracked outreach send. Three n8n-style nodes:
 *   1. Audience      — pick leads with a stored email (leads without one are
 *                      excluded here; they live in their folder's "No email"
 *                      section on the Leads tab)
 *   2. Compose       — "Compose email" drafts a per-lead email in-app with
 *                      Claude (app/api/pipeline/campaigns/compose), grounded in
 *                      the sector knowledge base for the lead's CSV Category.
 *                      Drafts are reviewed one by one (or select-all) and are
 *                      editable; selections above the AI cap fall back to the
 *                      shared {{business}}/{{link}} template editor.
 *   3. Review & send — fire the campaign (n8n webhook, or simulated in demo mode)
 *
 * Each recipient's CTA is rewritten to /t/<leadId>?c=<campaign>, so a click
 * flips the lead's "Engaged" badge and feeds the email-gated Sales queue.
 */
export function SendCampaigns({ onSwitchToLeads }: { onSwitchToLeads?: () => void }) {
  const reduce = !!useReducedMotion();

  // which node is in view (0 audience · 1 compose · 2 send)
  const [selected, setSelected] = useState(0);

  // ── audience ──
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const [picked, setPicked] = useState<Set<string>>(new Set());
  // folders chosen first, before the leads — leads are scoped to this set
  const [folderSel, setFolderSel] = useState<Set<string>>(new Set());
  const [q, setQ] = useState("");
  // audience filter: only leads we've never sent an outreach email (per the
  // email_sent ledger count the leads API attaches to each row)
  const [unsentOnly, setUnsentOnly] = useState(false);

  // ── compose ──
  const [campaign, setCampaign] = useState(DEFAULT_CAMPAIGN);
  const [subject, setSubject] = useState(DEFAULT_SUBJECT);
  const [body, setBody] = useState(DEFAULT_BODY_HTML);
  // service template picked on Step 2 ("" = the general multi-trade pitch).
  // Fills the shared template, steers the AI drafts (service focus), and picks
  // the branded email's hero photo server-side (send route → n8n).
  const [service, setService] = useState("");

  // ── AI drafts (compose automation) ──
  const [draftMode, setDraftMode] = useState<DraftMode>("template");
  const [composePhase, setComposePhase] = useState<ComposePhase>("idle");
  const [composeError, setComposeError] = useState<string | null>(null);
  const [composeInfo, setComposeInfo] = useState<{ mode: "live" | "demo"; saved: number; drafted: number } | null>(null);
  const [drafts, setDrafts] = useState<ComposeDraft[]>([]);
  // draft ids approved for the send (review one by one, or select all at once)
  const [approved, setApproved] = useState<Set<string>>(new Set());
  const [draftIdx, setDraftIdx] = useState(0);
  // snapshot of the batch actually submitted (so the drafting UI shows the
  // submitted count even if the audience is edited mid-run)
  const [composeBatch, setComposeBatch] = useState({ count: 0, scrape: 0 });
  // drafts completed so far in the running compose — the batch goes to the
  // route in COMPOSE_CHUNK_LEADS-sized requests, so this advances per chunk
  const [composeDone, setComposeDone] = useState(0);

  // ── email finder (scrape addresses for website-only leads via n8n) ──
  const [findPhase, setFindPhase] = useState<FindPhase>("idle");
  const [findInfo, setFindInfo] = useState<FindInfo | null>(null);
  const [findError, setFindError] = useState<string | null>(null);
  // success modal: shown once after a live run completes, dismissed independently
  // of findInfo so the inline outcome line survives closing it
  const [findSuccessOpen, setFindSuccessOpen] = useState(false);

  // ── batching (selections over the AI cap) ──
  // "Compose email" splits an over-cap selection into MAX_COMPOSE_LEADS-sized
  // batches worked one at a time: `picked` collapses to the current batch and
  // the rest wait here as id lists (audience order). After each send the
  // success banner offers the next batch. Editing the audience voids the plan
  // (see the draft-invalidation effect); per-lead exclusion inside a batch is
  // the drafts-review checkbox, not the audience.
  const [batchQueue, setBatchQueue] = useState<string[][]>([]);
  const [batchNo, setBatchNo] = useState(0); // 1-based; 0 = not batching
  const [batchTotal, setBatchTotal] = useState(0);

  // ── send ──
  const [sendPhase, setSendPhase] = useState<SendPhase>("idle");
  const [sentShown, setSentShown] = useState(0);
  // the denominator the progress bar fills toward. Starts as the optimistic
  // client count, then snaps to the server's actual sent count (which may be
  // lower — it de-dupes by address) so the bar can reach 100%.
  const [sendTotal, setSendTotal] = useState(0);
  const [result, setResult] = useState<{ sent: number; mode: SendMode; campaign: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  // unmount / re-run guards (the sub-tab unmounts on switch, like the importer)
  const mountedRef = useRef(true);
  const rafRef = useRef<number | null>(null);
  // runIdRef guards the send tween; composeRunIdRef guards the compose fetch —
  // kept separate so a send (or send reset) can't strand an in-flight compose.
  const runIdRef = useRef(0);
  const composeRunIdRef = useRef(0);
  // lead ids the current drafts were composed for — used to invalidate stale
  // drafts when the audience changes.
  const composedIdsRef = useRef<Set<string>>(new Set());
  // the service template the current drafts were composed with — switching
  // templates invalidates the drafts (they pitch the wrong service).
  const composedServiceRef = useRef("");
  // a failed chunked-compose run's finished drafts, keyed by lead id — kept
  // (with its batch key) so Try again resumes from the failed chunk instead of
  // re-drafting (and re-paying for) the leads that already came back.
  const composePartialRef = useRef<{
    key: string;
    done: Map<string, ComposeDraft>;
    drafted: number;
    saved: number;
    anyLive: boolean;
  } | null>(null);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, []);

  const fetchLeads = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const res = await fetch("/api/pipeline/leads", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; rows?: LeadView[]; mode?: string; error?: string }
        | null;
      if (!mountedRef.current) return;
      if (!res.ok || !data?.ok) {
        setLoad({ status: "error", error: data?.error ?? `Couldn't load leads (${res.status}).` });
        return;
      }
      setLoad({ status: "ready", rows: data.rows ?? [], mode: data.mode ?? "live" });
    } catch {
      if (mountedRef.current) setLoad({ status: "error", error: "Network error loading leads." });
    }
  }, []);

  useEffect(() => {
    fetchLeads();
  }, [fetchLeads]);

  // leads we can campaign: a stable id + a stored email address. Leads without
  // an email are kept out of the audience entirely — they sit in the "No email"
  // section of their folder on the Leads tab (where Find emails lives now)
  // until an address is found for them.
  const targets = useMemo<LeadView[]>(() => {
    if (load.status !== "ready") return [];
    // dedupe by id — a repeated lead here would echo through everything keyed
    // on it (audience rows, picked set, drafts) as duplicate React keys
    const seen = new Set<string>();
    return load.rows.filter((r) => {
      if (!r.id || (r.emails?.length ?? 0) === 0 || seen.has(r.id)) return false;
      seen.add(r.id);
      return true;
    });
  }, [load]);

  // drop picked ids that no longer exist after a refresh
  useEffect(() => {
    setPicked((prev) => {
      const ids = new Set(targets.map((r) => r.id!).filter(Boolean));
      const next = new Set<string>();
      for (const id of prev) if (ids.has(id)) next.add(id);
      return next.size === prev.size ? prev : next;
    });
  }, [targets]);

  // keep the audience scoped to the chosen folders and the unsent-only filter —
  // deselecting a folder (or turning the filter on) drops the picked leads it
  // hides, so nothing hidden is sent
  useEffect(() => {
    setPicked((prev) => {
      if (prev.size === 0) return prev;
      const next = new Set<string>();
      for (const r of targets) {
        if (
          r.id &&
          prev.has(r.id) &&
          folderSel.has(r.batch ?? UNGROUPED) &&
          (!unsentOnly || (r.emails_sent ?? 0) === 0)
        )
          next.add(r.id);
      }
      return next.size === prev.size ? prev : next;
    });
  }, [folderSel, targets, unsentOnly]);

  // folder options (newest folders first; Ungrouped sinks to the bottom) + a
  // per-folder count of campaignable leads, shown on each chip
  const folders = useMemo(() => {
    const set = new Set<string>();
    for (const r of targets) set.add(r.batch ?? UNGROUPED);
    return [...set].sort((a, b) => {
      if (a === UNGROUPED) return 1;
      if (b === UNGROUPED) return -1;
      return b.localeCompare(a);
    });
  }, [targets]);
  const folderCounts = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of targets) {
      const b = r.batch ?? UNGROUPED;
      m.set(b, (m.get(b) ?? 0) + 1);
    }
    return m;
  }, [targets]);

  // keep the folder selection valid across refreshes; auto-pick when there's
  // only one folder so a single-folder account isn't gated behind a chip
  useEffect(() => {
    setFolderSel((prev) => {
      const valid = new Set(folders);
      let next = new Set([...prev].filter((f) => valid.has(f)));
      if (next.size === 0 && folders.length === 1) next = new Set(folders);
      const same = next.size === prev.size && [...next].every((f) => prev.has(f));
      return same ? prev : next;
    });
  }, [folders]);

  const term = q.trim().toLowerCase();
  // leads are scoped to the chosen folders — nothing shows until one is picked.
  const inScope = useMemo(() => {
    if (folderSel.size === 0) return [];
    return targets
      .filter((r) => folderSel.has(r.batch ?? UNGROUPED))
      .filter((r) =>
        term
          ? r.name.toLowerCase().includes(term) ||
            (r.website ?? "").toLowerCase().includes(term) ||
            (r.emails ?? []).some((e) => e.toLowerCase().includes(term))
          : true,
      );
  }, [targets, folderSel, term]);
  // "Not yet emailed" chip count — unsent leads within the current folder +
  // search scope, so the number always matches what toggling would show
  const unsentCount = useMemo(
    () => inScope.filter((r) => (r.emails_sent ?? 0) === 0).length,
    [inScope],
  );
  const visible = useMemo(
    () => (unsentOnly ? inScope.filter((r) => (r.emails_sent ?? 0) === 0) : inScope),
    [inScope, unsentOnly],
  );

  // the current selection (drives Compose) + how many need a website scrape
  const pickedTargets = useMemo(
    () => targets.filter((r) => r.id && picked.has(r.id)),
    [targets, picked],
  );
  const scrapeCount = useMemo(
    () => pickedTargets.filter((r) => (r.emails?.length ?? 0) === 0).length,
    [pickedTargets],
  );
  // selected leads the Email Finder can actually work on: no stored address,
  // but a website whose contact page the automation can scrape
  const findable = useMemo(
    () => pickedTargets.filter((r) => (r.emails?.length ?? 0) === 0 && !!r.website),
    [pickedTargets],
  );

  // "Find emails" — POST the website-only selection to the n8n Email Finder
  // (via /api/pipeline/campaigns/find-emails). Found addresses are persisted
  // onto the lead rows server-side; here they're mirrored into the local rows
  // so the leads become sendable (and show their best address) immediately.
  const findEmails = useCallback(async () => {
    const batch = findable
      .slice(0, MAX_FIND_LEADS)
      .map((r) => ({ id: r.id!, website: r.website! }));
    if (batch.length === 0) return;
    setFindPhase("running");
    setFindError(null);
    setFindInfo(null);
    setFindSuccessOpen(false); // clear any prior run's success modal

    let res: Response;
    try {
      res = await fetch("/api/pipeline/campaigns/find-emails", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ leads: batch }),
      });
    } catch {
      if (mountedRef.current) {
        setFindError("Network error reaching the email finder.");
        setFindPhase("error");
      }
      return;
    }
    const data = (await res.json().catch(() => null)) as
      | {
          ok?: boolean;
          mode?: "live" | "demo" | "noop";
          results?: Array<{ id: string; emails: string[]; best_email?: string | null }>;
          found?: number;
          error?: string;
        }
      | null;
    if (!mountedRef.current) return;
    if (!res.ok || !data?.ok) {
      setFindError(data?.error ?? `The email finder responded ${res.status}.`);
      setFindPhase("error");
      return;
    }

    const results = Array.isArray(data.results) ? data.results : [];
    // Prefill the scraped addresses onto the folder's lead rows so they become
    // sendable (and show an address) without a refresh. Order the chosen
    // best_email first — the audience table and bestEmail() both read that as
    // the lead's address — while keeping the alternates for review.
    const byId = new Map(
      results
        .filter((r) => Array.isArray(r.emails) && r.emails.length > 0)
        .map((r) => {
          const best = r.best_email && r.emails.includes(r.best_email) ? r.best_email : null;
          const ordered = best ? [best, ...r.emails.filter((e) => e !== best)] : r.emails;
          return [r.id, ordered] as const;
        }),
    );
    setLoad((prev) => {
      if (prev.status !== "ready") return prev;
      return {
        ...prev,
        rows: prev.rows.map((row) => {
          const emails = row.id ? byId.get(row.id) : undefined;
          // only prefill leads that had no stored address — never clobber an
          // email a lead already came in with (from the CSV import)
          return emails && (row.emails?.length ?? 0) === 0 ? { ...row, emails } : row;
        }),
      };
    });
    const mode = data.mode === "demo" ? "demo" : "live";
    setFindInfo({ mode, found: data.found ?? 0, tried: batch.length });
    setFindPhase("done");
    // Pop the success summary for a real run — demo means "not connected", which
    // the inline hint already explains, so no modal there.
    if (mode === "live") setFindSuccessOpen(true);
  }, [findable]);

  // Dismiss the Find emails error modal — back to idle so the outcome line and
  // the modal both clear (the button stays, ready for another run).
  const dismissFindError = useCallback(() => {
    setFindPhase("idle");
    setFindError(null);
  }, []);

  // the actual send list. AI mode: approved, still-selected, sendable drafts,
  // each carrying its own subject/body; template mode: selected leads with a
  // stored best address. Intersecting with `picked` means a lead deselected
  // after composing is never mailed, and nothing is armed mid-compose.
  //
  // TOP-UP: one best address per lead first — then, when that resolves to
  // fewer than MIN_SEND_EMAILS addresses, the list is padded with the
  // alternate stored addresses of leads that have more than one email (same
  // per-lead content, flagged `alt`), until the target or the alternates run
  // out. Deduped case-insensitively across the whole send; the send route
  // de-dupes by address too, so the counts agree.
  const recipients = useMemo<Recipient[]>(() => {
    // one best address per lead, paired with the lead's FULL stored list so
    // the top-up below can draw its alternates
    let base: Array<{ recipient: Recipient; emails: readonly string[] }>;
    if (draftMode === "ai") {
      if (composePhase !== "ready") return [];
      base = drafts
        .filter((d) => approved.has(d.id) && picked.has(d.id) && draftSendable(d))
        .map((d) => ({
          recipient: {
            id: d.id,
            email: d.best_email!,
            business: d.business,
            subject: d.subject,
            html: d.html,
            category: d.category,
          },
          emails: d.emails,
        }));
    } else {
      base = pickedTargets
        .map((r) => ({
          recipient: { id: r.id!, email: bestEmail(r.emails) ?? "", business: r.name, category: r.category ?? null },
          emails: r.emails ?? [],
        }))
        .filter((b) => !!b.recipient.email);
    }

    const out = base.map((b) => b.recipient);
    if (out.length === 0 || out.length >= MIN_SEND_EMAILS) return out;

    const used = new Set(out.map((r) => r.email.toLowerCase()));
    for (const b of base) {
      if (out.length >= MIN_SEND_EMAILS) break;
      for (const email of alternateEmails(b.emails, used)) {
        if (out.length >= MIN_SEND_EMAILS) break;
        used.add(email.toLowerCase());
        out.push({ ...b.recipient, email, alt: true });
      }
    }
    return out;
  }, [draftMode, composePhase, drafts, approved, picked, pickedTargets]);
  const recipientCount = recipients.length;
  // distinct LEADS being mailed — with the top-up, one lead can hold several
  // recipient rows, so lead-facing copy must not count rows
  const recipientLeadCount = useMemo(
    () => new Set(recipients.map((r) => r.id)).size,
    [recipients],
  );
  // template-mode leads dropped for want of a stored email (website-only leads
  // above the AI cap, or when the shared template is used deliberately)
  const templateDropped =
    !(draftMode === "ai" && composePhase === "ready")
      ? pickedTargets.length - recipientLeadCount
      : 0;

  // Invalidate stale drafts when the composed audience changes — a re-compose
  // is required so the drafts, approvals, and send list stay consistent.
  useEffect(() => {
    if (composePhase !== "ready") return;
    const composed = composedIdsRef.current;
    const diverged = picked.size !== composed.size || [...picked].some((id) => !composed.has(id));
    if (diverged) {
      setComposePhase("idle");
      setDrafts([]);
      setApproved(new Set());
      setDraftIdx(0);
      setComposeInfo(null);
      // a parked partial run belongs to the old audience too (its batch key
      // wouldn't match anyway — this just frees it)
      composePartialRef.current = null;
      // the batch plan was cut from the audience these drafts were composed
      // for — an audience edit voids the queued batches along with the drafts
      setBatchQueue([]);
      setBatchNo(0);
      setBatchTotal(0);
    }
  }, [picked, composePhase]);

  // Invalidate ready drafts when the service template changes — they were
  // written to pitch the old service. Unlike an audience edit this keeps the
  // batch plan (the batches are audience slices, still valid); "Draft with AI
  // instead" then recomposes the current batch with the new service.
  useEffect(() => {
    if (composePhase !== "ready" || service === composedServiceRef.current) return;
    setComposePhase("idle");
    setDrafts([]);
    setApproved(new Set());
    setDraftIdx(0);
    setComposeInfo(null);
    composePartialRef.current = null;
  }, [service, composePhase]);

  function toggleFolder(f: string) {
    setFolderSel((prev) => {
      const next = new Set(prev);
      if (next.has(f)) next.delete(f);
      else next.add(f);
      return next;
    });
  }
  function selectAllFolders() {
    setFolderSel(new Set(folders));
  }
  function clearFolders() {
    setFolderSel(new Set());
  }

  function toggle(id: string) {
    setPicked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAll() {
    setPicked((prev) => {
      const ids = visible.map((r) => r.id!).filter(Boolean);
      const allOn = ids.length > 0 && ids.every((id) => prev.has(id));
      const next = new Set(prev);
      ids.forEach((id) => (allOn ? next.delete(id) : next.add(id)));
      return next;
    });
  }

  /** Draft one batch of leads with the in-app composer, which writes a per-lead
   *  email with Claude grounded in the sector knowledge base for the lead's
   *  Category. Addresses come from the stored CSV emails (or are added by hand
   *  in review). Callers guarantee `batch` is within MAX_COMPOSE_LEADS.
   *
   *  The batch goes to the route as COMPOSE_CHUNK_LEADS-sized requests, one
   *  after another — one big request used to outlive the serverless gateway
   *  (34 leads → 504) and lose every draft. Chunking keeps each request well
   *  inside the timeout, advances composeDone as chunks land, and on failure
   *  parks the finished drafts so Try again resumes from the failed chunk. */
  const composeLeads = useCallback(async (batch: LeadView[]) => {
    const tag = slugifyCampaign(campaign) || DEFAULT_CAMPAIGN;
    const runId = ++composeRunIdRef.current;
    const live = () => mountedRef.current && runId === composeRunIdRef.current;

    setDraftMode("ai");
    setComposePhase("running");
    setComposeError(null);
    setComposeInfo(null);
    setComposeBatch({
      count: batch.length,
      scrape: batch.filter((r) => (r.emails?.length ?? 0) === 0).length,
    });

    // Resume: a prior failed run over this exact batch (and the same service
    // template) left its finished drafts behind — keep them and only draft the
    // leads still missing. The service prefixes the key so drafts written for
    // another service are never resumed into this run.
    const key =
      `${service}|` +
      batch
        .map((r) => r.id!)
        .sort()
        .join(",");
    const prior = composePartialRef.current?.key === key ? composePartialRef.current : null;
    const done = prior?.done ?? new Map<string, ComposeDraft>();
    let drafted = prior?.drafted ?? 0;
    let saved = prior?.saved ?? 0;
    let anyLive = prior?.anyLive ?? false;
    setComposeDone(done.size);

    const todo = batch.filter((r) => !done.has(r.id!));
    const chunks: LeadView[][] = [];
    for (let i = 0; i < todo.length; i += COMPOSE_CHUNK_LEADS) {
      chunks.push(todo.slice(i, i + COMPOSE_CHUNK_LEADS));
    }

    type ComposeResponse = {
      ok?: boolean;
      mode?: "live" | "demo";
      results?: ComposeDraft[];
      drafted?: number;
      saved?: number;
      error?: string;
    };
    // null = network error; the caller retries once, then surfaces it
    const post = async (part: LeadView[]): Promise<{ status: number; data: ComposeResponse | null } | null> => {
      try {
        const res = await fetch("/api/pipeline/campaigns/compose", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            campaign: tag,
            service: service || undefined,
            leads: part.map((r) => ({
              id: r.id!,
              name: r.name,
              website: r.website ?? null,
              category: r.category ?? null,
              emails: r.emails ?? [],
            })),
          }),
        });
        return { status: res.status, data: (await res.json().catch(() => null)) as ComposeResponse | null };
      } catch {
        return null;
      }
    };

    for (const part of chunks) {
      if (!live()) return;
      let out = await post(part);
      if (!out?.data?.ok || !Array.isArray(out.data.results)) {
        // one automatic retry — a transient blip shouldn't cost the run
        await sleep(1500);
        if (!live()) return;
        out = await post(part);
      }
      if (!live()) return;
      const data = out?.data;
      if (!out || !data?.ok || !Array.isArray(data.results)) {
        // park the finished drafts so Try again resumes instead of restarting
        composePartialRef.current = { key, done, drafted, saved, anyLive };
        const detail = !out
          ? "Network error reaching the composer."
          : data?.error ?? `The composer responded ${out.status}.`;
        setComposeError(
          done.size > 0
            ? `${detail} ${done.size.toLocaleString("en-US")} of ${batch.length.toLocaleString("en-US")} drafts are finished and kept — Try again picks up where it stopped.`
            : detail,
        );
        setComposePhase("error");
        return;
      }
      for (const d of data.results) done.set(d.id, d);
      drafted += data.drafted ?? 0;
      saved += data.saved ?? 0;
      if ((data.mode ?? "demo") === "live") anyLive = true;
      setComposeDone(done.size);
    }

    composePartialRef.current = null;
    // record the service these drafts were composed with (see the
    // service-change invalidation effect)
    composedServiceRef.current = service;
    // reassemble in batch (audience) order; leads the server dropped as
    // invalid just vanish, exactly as they did from a single response
    const results = batch
      .map((r) => done.get(r.id!))
      .filter((d): d is ComposeDraft => d !== undefined);
    setDrafts(results);
    // everything sendable starts approved — deselect while reviewing
    setApproved(new Set(results.filter(draftSendable).map((d) => d.id)));
    setDraftIdx(0);
    setComposeInfo({ mode: anyLive ? "live" : "demo", saved, drafted });
    // record the composed audience so an audience change invalidates these drafts
    composedIdsRef.current = new Set(batch.map((r) => r.id!));
    setComposePhase("ready");

    // freshly scraped addresses were persisted server-side — mirror them locally
    setLoad((prev) => {
      if (prev.status !== "ready") return prev;
      const byId = new Map(results.map((d) => [d.id, d]));
      return {
        ...prev,
        rows: prev.rows.map((r) => {
          const d = r.id ? byId.get(r.id) : undefined;
          return d && d.emails.length > 0 && (r.emails?.length ?? 0) === 0 ? { ...r, emails: d.emails } : r;
        }),
      };
    });
  }, [campaign, service]);

  /** "Compose email" — draft the current selection with Claude. Selections over
   *  the AI cap are split into MAX_COMPOSE_LEADS-sized batches (audience order):
   *  `picked` collapses to the first batch and the rest queue up behind the
   *  send, offered one at a time from the success banner. */
  const startCompose = useCallback(() => {
    setSelected(1);
    if (pickedTargets.length === 0) {
      setDraftMode("template");
      return;
    }
    if (pickedTargets.length > MAX_COMPOSE_LEADS) {
      const chunks: LeadView[][] = [];
      for (let i = 0; i < pickedTargets.length; i += MAX_COMPOSE_LEADS) {
        chunks.push(pickedTargets.slice(i, i + MAX_COMPOSE_LEADS));
      }
      setBatchQueue(chunks.slice(1).map((c) => c.map((r) => r.id!)));
      setBatchNo(1);
      setBatchTotal(chunks.length);
      setPicked(new Set(chunks[0].map((r) => r.id!)));
      void composeLeads(chunks[0]);
      return;
    }
    // within the cap: a plain single-batch run — but don't touch the batch
    // state, so re-drafting the current batch keeps its place in the plan
    void composeLeads(pickedTargets);
  }, [pickedTargets, composeLeads]);

  /** Advance to the next queued batch after a send: clear the finished send +
   *  drafts, collapse `picked` onto the batch, and compose it. */
  const startNextBatch = useCallback(() => {
    const nextIds = batchQueue[0];
    if (!nextIds) return;
    // map ids back to lead rows, keeping the audience order; leads that
    // disappeared since the plan was made (deleted, re-imported) just drop out
    const byId = new Map(targets.map((r) => [r.id!, r]));
    const next = nextIds.map((id) => byId.get(id)).filter((r): r is LeadView => !!r);
    if (next.length === 0) {
      // the whole queued batch no longer exists — drop the stale plan
      setBatchQueue([]);
      setBatchNo(0);
      setBatchTotal(0);
      return;
    }
    setBatchQueue((q) => q.slice(1));
    setBatchNo((n) => n + 1);
    // reset the completed send and the previous batch's drafts
    runIdRef.current++;
    setSendPhase("idle");
    setSentShown(0);
    setSendTotal(0);
    setResult(null);
    setError(null);
    setDrafts([]);
    setApproved(new Set());
    setDraftIdx(0);
    setComposeInfo(null);
    setComposePhase("idle");
    composedIdsRef.current = new Set();
    setPicked(new Set(next.map((r) => r.id!)));
    setSelected(1);
    void composeLeads(next);
  }, [batchQueue, targets, composeLeads]);

  /** Pick a service template on Step 2: fills the shared subject/body with that
   *  service's copy (or the general default), and is threaded through the AI
   *  compose (service focus) and the send (matching hero photo). */
  function selectService(slug: string) {
    setService(slug);
    const t = serviceBySlug(slug);
    setSubject(t ? t.subject : DEFAULT_SUBJECT);
    setBody(t ? t.html : DEFAULT_BODY_HTML);
  }

  function editDraft(id: string, patch: Partial<Pick<ComposeDraft, "subject" | "html" | "best_email">>) {
    setDrafts((prev) => prev.map((d) => (d.id === id ? { ...d, ...patch } : d)));
    // If this edit makes a previously-unsendable draft sendable — e.g. the user
    // hand-typed an address for a website-only lead — auto-include it, mirroring
    // the compose-time seeding where every sendable draft starts approved.
    setApproved((ap) => {
      const before = drafts.find((d) => d.id === id);
      if (!before || ap.has(id)) return ap;
      const after = { ...before, ...patch };
      return !draftSendable(before) && draftSendable(after) ? new Set(ap).add(id) : ap;
    });
  }
  function toggleDraft(id: string) {
    setApproved((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleAllDrafts() {
    setApproved((prev) => {
      const sendable = drafts.filter(draftSendable).map((d) => d.id);
      const allOn = sendable.length > 0 && sendable.every((id) => prev.has(id));
      return allOn ? new Set<string>() : new Set(sendable);
    });
  }

  const send = useCallback(async () => {
    if (recipients.length === 0 || recipients.length > MAX_RECIPIENTS) return;
    const tag = slugifyCampaign(campaign) || DEFAULT_CAMPAIGN;

    const runId = ++runIdRef.current;
    const live = () => mountedRef.current && runId === runIdRef.current;

    setError(null);
    setResult(null);
    setSentShown(0);
    setSendTotal(recipients.length); // optimistic; corrected from the response below
    setSendPhase("sending");
    setSelected(2);

    let res: Response;
    try {
      res = await fetch("/api/pipeline/campaigns/send", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ campaign: tag, subject, bodyHtml: body, recipients, service: service || undefined }),
      });
    } catch {
      if (live()) {
        setError("Network error reaching the campaign sender.");
        setSendPhase("error");
      }
      return;
    }
    const data = (await res.json().catch(() => null)) as
      | { ok?: boolean; sent?: number; mode?: SendMode; campaign?: string; error?: string }
      | null;
    if (!live()) return;
    if (!res.ok || !data?.ok) {
      setError(data?.error ?? `The sender responded ${res.status}.`);
      setSendPhase("error");
      return;
    }

    const sent = data.sent ?? recipients.length;
    setSendTotal(sent); // the bar now fills toward what was actually sent → reaches 100%
    // eased count-up over a comfortable minimum so the send "registers"
    await tweenTo(rafRef, reduce, setSentShown, 0, sent, Math.max(750, Math.min(1800, sent * 9 + 400)), live);
    if (!live()) return;
    if (!reduce) await sleep(450);
    if (!live()) return;
    setResult({ sent, mode: data.mode ?? "demo", campaign: data.campaign ?? tag });
    setSendPhase("done");
  }, [recipients, campaign, subject, body, service, reduce]);

  function resetSend() {
    runIdRef.current++; // abort any in-flight tween/await
    setSendPhase("idle");
    setSentShown(0);
    setSendTotal(0);
    setResult(null);
    setError(null);
    setSelected(2);
  }

  // Full reset for "New send" after a completed campaign — clears the drafts and
  // selection too, so it can't re-fire the identical send with one more click.
  function resetFlow() {
    runIdRef.current++;
    composeRunIdRef.current++;
    composedIdsRef.current = new Set();
    composePartialRef.current = null;
    setComposeDone(0);
    setSendPhase("idle");
    setSentShown(0);
    setSendTotal(0);
    setResult(null);
    setError(null);
    setDraftMode("template");
    setComposePhase("idle");
    setComposeError(null);
    setComposeInfo(null);
    setFindPhase("idle");
    setFindInfo(null);
    setFindError(null);
    setFindSuccessOpen(false);
    setDrafts([]);
    setApproved(new Set());
    setDraftIdx(0);
    setBatchQueue([]);
    setBatchNo(0);
    setBatchTotal(0);
    setPicked(new Set());
    // back to the general pitch — but only reset the shared subject/body when a
    // service template was driving them, so a hand-written template survives
    if (service) {
      setSubject(DEFAULT_SUBJECT);
      setBody(DEFAULT_BODY_HTML);
    }
    setService("");
    composedServiceRef.current = "";
    setSelected(0);
  }

  const sending = sendPhase === "sending";
  // batching progress, threaded through the rail + panel headers so the user
  // always knows which slice of the plan they're working
  const batchLabel = batchNo > 0 ? `batch ${batchNo} of ${batchTotal}` : null;
  const steps = useMemo<FlowStep[]>(
    () =>
      buildSteps(
        pickedTargets.length,
        sendPhase,
        draftMode === "ai",
        batchNo > 0 ? { no: batchNo, total: batchTotal } : null,
      ),
    [pickedTargets.length, sendPhase, draftMode, batchNo, batchTotal],
  );

  const liveMessage =
    composePhase === "running"
      ? `Drafting ${composeBatch.count} personalized email${composeBatch.count === 1 ? "" : "s"} with Claude${
          composeDone > 0 ? ` — ${composeDone} of ${composeBatch.count} done` : ""
        }`
      : sendPhase === "sending"
        ? `Sending the campaign to ${recipientCount} recipients`
        : sendPhase === "done" && result
          ? `Done. Sent ${result.sent} email${result.sent === 1 ? "" : "s"}${result.mode === "demo" ? " (demo mode)" : ""}.`
          : "";

  const panelKey =
    selected === 0
      ? "audience"
      : selected === 1
        ? draftMode === "ai"
          ? composePhase === "running"
            ? "drafting"
            : composePhase === "error"
              ? "draft-error"
              : composePhase === "ready"
                ? "drafts"
                : "compose"
          : "compose"
        : sendPhase === "sending"
          ? "sending"
          : sendPhase === "error"
            ? "send-error"
            : sendPhase === "done"
              ? "sent"
              : "review";

  function renderPanel() {
    if (selected === 0) {
      return (
        <AudiencePanel
          load={load}
          targetCount={targets.length}
          visible={visible}
          picked={picked}
          selectedCount={pickedTargets.length}
          scrapeCount={scrapeCount}
          findableCount={findable.length}
          findPhase={findPhase}
          findInfo={findInfo}
          onFindEmails={findEmails}
          folders={folders}
          folderSel={folderSel}
          folderCounts={folderCounts}
          q={q}
          unsentOnly={unsentOnly}
          unsentCount={unsentCount}
          onToggleUnsent={() => setUnsentOnly((v) => !v)}
          onToggleFolder={toggleFolder}
          onSelectAllFolders={selectAllFolders}
          onClearFolders={clearFolders}
          onSearch={setQ}
          onToggle={toggle}
          onToggleAll={toggleAll}
          onSelectMany={setPicked}
          onRefresh={fetchLeads}
          onContinue={startCompose}
          onSwitchToLeads={onSwitchToLeads}
        />
      );
    }
    if (selected === 1) {
      if (draftMode === "ai" && composePhase === "running") {
        return (
          <DraftingPanel
            count={composeBatch.count}
            done={composeDone}
            scrapeCount={composeBatch.scrape}
            batchLabel={batchLabel}
            reduce={reduce}
          />
        );
      }
      if (draftMode === "ai" && composePhase === "error") {
        return (
          <ComposeErrorPanel
            message={composeError ?? "The composer failed."}
            onRetry={startCompose}
            onUseTemplate={() => setDraftMode("template")}
          />
        );
      }
      if (draftMode === "ai" && composePhase === "ready") {
        return (
          <DraftsReviewPanel
            drafts={drafts}
            approved={approved}
            index={draftIdx}
            info={composeInfo}
            serviceName={serviceBySlug(service)?.name ?? null}
            batchLabel={batchLabel}
            campaignTag={slugifyCampaign(campaign) || DEFAULT_CAMPAIGN}
            onIndex={setDraftIdx}
            onToggle={toggleDraft}
            onToggleAll={toggleAllDrafts}
            onEdit={editDraft}
            onRecompose={startCompose}
            onUseTemplate={() => setDraftMode("template")}
            onBack={() => setSelected(0)}
            onContinue={() => setSelected(2)}
          />
        );
      }
      return (
        <ComposePanel
          campaign={campaign}
          subject={subject}
          body={body}
          service={service}
          onService={selectService}
          recipients={recipients}
          canAi={pickedTargets.length > 0 && pickedTargets.length <= MAX_COMPOSE_LEADS}
          hasDrafts={drafts.length > 0}
          pickedCount={pickedTargets.length}
          droppedCount={templateDropped}
          onAiCompose={drafts.length > 0 ? () => setDraftMode("ai") : startCompose}
          onCampaign={setCampaign}
          onSubject={setSubject}
          onBody={setBody}
          onBack={() => setSelected(0)}
          onContinue={() => setSelected(2)}
        />
      );
    }
    // selected === 2 — review & send
    if (sendPhase === "sending") {
      return <SendingPanel sent={sentShown} total={sendTotal || recipientCount} reduce={reduce} />;
    }
    if (sendPhase === "error") {
      return (
        <ErrorPanel
          message={error ?? "The campaign failed to send."}
          onRetry={send}
          onReset={resetSend}
        />
      );
    }
    if (sendPhase === "done" && result) {
      return (
        <SuccessBanner
          result={result}
          batch={
            batchNo > 0
              ? {
                  no: batchNo,
                  total: batchTotal,
                  nextCount: batchQueue[0]?.length ?? 0,
                  queuedLeads: batchQueue.reduce((n, c) => n + c.length, 0),
                }
              : null
          }
          onNextBatch={startNextBatch}
          onReset={resetFlow}
        />
      );
    }
    const aiSend = draftMode === "ai" && composePhase === "ready";
    return (
      <ReviewPanel
        recipients={recipients}
        campaign={slugifyCampaign(campaign) || DEFAULT_CAMPAIGN}
        subject={subject}
        bodyHtml={body}
        serviceName={serviceBySlug(service)?.name ?? null}
        ai={aiSend}
        templateReady={aiSend || (subject.trim().length > 0 && body.trim().length > 0)}
        droppedCount={templateDropped}
        batchLabel={batchLabel}
        onBack={() => setSelected(1)}
        onSend={send}
        sending={sending}
      />
    );
  }

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <p className="sr-only" role="status" aria-live="polite">
        {liveMessage}
      </p>

      {/* header */}
      <Reveal className="mb-4" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Data pipeline
            </div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">
              Send campaigns
            </h1>
          </div>
        </div>
      </Reveal>

      {/* the n8n-style step rail — nodes are clickable to switch the view */}
      <Reveal delay={0.04} className="mb-3">
        <StepRail
          steps={steps}
          selected={selected}
          onSelect={(i) => {
            // lock navigation onto the send node while a send is in flight so the
            // user can't edit the selection (and the live counts) mid-send
            if (sending && i !== 2) return;
            // keep the user on the drafting node while a compose is in flight,
            // so they can't arm a template send (or strand the compose) mid-run
            if (composePhase === "running" && i !== 1) return;
            setSelected(i);
          }}
        />
      </Reveal>

      {/* selected node panel */}
      <Reveal delay={0.08}>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
          <AnimatePresence mode="wait" initial={false}>
            <motion.div
              key={panelKey}
              initial={reduce ? false : { opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
              transition={{ duration: reduce ? 0 : 0.26, ease: PANEL_EASE }}
            >
              {renderPanel()}
            </motion.div>
          </AnimatePresence>
        </div>
      </Reveal>

      <Footer />

      {/* Find emails failure — surfaced as a modal with the server error and a
          troubleshooting checklist (the automation lives in n8n, so most
          failures are a wiring problem the user resolves there). */}
      <FindErrorModal
        open={findPhase === "error"}
        message={findError}
        onClose={dismissFindError}
        onRetry={() => {
          dismissFindError();
          findEmails();
        }}
      />

      {/* Find emails success — how many of the scanned leads got an address.
          Prefilled onto the folder's rows already; this just confirms the run. */}
      <FindSuccessModal
        open={findSuccessOpen && findInfo?.mode === "live"}
        found={findInfo?.found ?? 0}
        tried={findInfo?.tried ?? 0}
        onClose={() => setFindSuccessOpen(false)}
      />
    </div>
  );
}

/* ─────────────────────────────  step status  ───────────────────────────── */

function buildSteps(
  selectedCount: number,
  sendPhase: SendPhase,
  ai: boolean,
  batch: { no: number; total: number } | null,
): FlowStep[] {
  const sent = sendPhase === "done";
  const s0: StepStatus = selectedCount > 0 ? "done" : "active";
  const s1: StepStatus = sent || sendPhase === "error" ? "done" : selectedCount > 0 ? "active" : "idle";
  const s2: StepStatus =
    sent ? "done" : sendPhase === "sending" ? "active" : sendPhase === "error" ? "error" : "idle";

  return [
    {
      id: "audience",
      label: "Audience",
      icon: Target,
      status: s0,
      detail:
        selectedCount > 0
          ? `${batch ? `Batch ${batch.no}/${batch.total} · ` : ""}${selectedCount.toLocaleString("en-US")} selected`
          : "Pick recipients",
    },
    {
      id: "compose",
      label: "Compose",
      icon: ai ? Sparkles : PenLine,
      status: s1,
      detail: ai ? "AI drafts per lead" : "Subject + tracked link",
    },
    {
      id: "send",
      label: "Review & send",
      icon: Send,
      status: s2,
      detail:
        sendPhase === "sending"
          ? "Sending…"
          : sendPhase === "done"
            ? "Sent"
            : sendPhase === "error"
              ? "Failed"
              : "Confirm send",
    },
  ];
}

/* ─────────────────────────────  audience  ───────────────────────────── */

function AudiencePanel({
  load,
  targetCount,
  visible,
  picked,
  selectedCount,
  scrapeCount,
  findableCount,
  findPhase,
  findInfo,
  onFindEmails,
  folders,
  folderSel,
  folderCounts,
  q,
  unsentOnly,
  unsentCount,
  onToggleUnsent,
  onToggleFolder,
  onSelectAllFolders,
  onClearFolders,
  onSearch,
  onToggle,
  onToggleAll,
  onSelectMany,
  onRefresh,
  onContinue,
  onSwitchToLeads,
}: {
  load: LoadState;
  targetCount: number;
  visible: LeadView[];
  picked: Set<string>;
  selectedCount: number;
  scrapeCount: number;
  findableCount: number;
  findPhase: FindPhase;
  findInfo: FindInfo | null;
  onFindEmails: () => void;
  folders: string[];
  folderSel: Set<string>;
  folderCounts: Map<string, number>;
  q: string;
  unsentOnly: boolean;
  unsentCount: number;
  onToggleUnsent: () => void;
  onToggleFolder: (f: string) => void;
  onSelectAllFolders: () => void;
  onClearFolders: () => void;
  onSearch: (v: string) => void;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onSelectMany: (next: Set<string>) => void;
  onRefresh: () => void;
  onContinue: () => void;
  onSwitchToLeads?: () => void;
}) {
  const noFolders = folderSel.size === 0;
  const finding = findPhase === "running";
  // outcome line for the last Find emails run (shown under the lead table).
  // Errors are surfaced in a modal (see FindErrorModal) rather than inline, so
  // this line only carries the success / demo outcome.
  const findNote =
    findPhase === "done" && findInfo
      ? findInfo.mode === "demo"
        ? "The Email Finder automation isn't connected — add its webhook on the Integrations tab, then try again."
        : `Found addresses for ${findInfo.found.toLocaleString("en-US")} of ${findInfo.tried.toLocaleString("en-US")} website-only lead${findInfo.tried === 1 ? "" : "s"}.${
            findInfo.found < findInfo.tried ? " The rest had nothing scrapable — add those by hand in review." : ""
          }`
      : null;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PhaseHeader
          icon={Target}
          title="Choose your audience"
          meta={
            load.status === "ready"
              ? `${targetCount.toLocaleString("en-US")} lead${targetCount === 1 ? "" : "s"} with a stored email`
              : "stored leads with an email address"
          }
        />
        <div className="flex flex-wrap items-center gap-2">
          {findableCount > 0 && (
            <Button
              variant="outline"
              size="sm"
              data-track="campaign_find_emails"
              disabled={finding}
              onClick={onFindEmails}
              className="gap-1.5"
            >
              {finding ? (
                <RefreshCw className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Globe className="h-4 w-4" aria-hidden />
              )}
              {finding
                ? "Finding emails…"
                : `Find emails (${Math.min(findableCount, MAX_FIND_LEADS).toLocaleString("en-US")})`}
            </Button>
          )}
          <Button
            size="sm"
            data-track="campaign_next_compose_top"
            disabled={selectedCount === 0 || selectedCount > MAX_RECIPIENTS}
            onClick={onContinue}
            className="gap-1.5"
          >
            {selectedCount > MAX_COMPOSE_LEADS
              ? `Compose in ${Math.ceil(selectedCount / MAX_COMPOSE_LEADS).toLocaleString("en-US")} batches`
              : "Compose email"}
            <PenLine className="h-4 w-4" aria-hidden />
          </Button>
          <button
            type="button"
            onClick={onRefresh}
            data-track="campaign_refresh_leads"
            aria-label="Refresh leads"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", load.status === "loading" && "animate-spin")} aria-hidden />
            Refresh
          </button>
        </div>
      </div>

      {load.status === "loading" && <TableSkeleton />}
      {load.status === "error" && <ErrorInline message={load.error} onRetry={onRefresh} />}

      {load.status === "ready" && targetCount === 0 && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-border bg-background/40 px-6 py-12 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
            <Upload className="h-5 w-5" aria-hidden />
          </span>
          <p className="text-[13px] font-medium text-foreground">No campaignable leads yet</p>
          <p className="max-w-xs font-mono text-[10.5px] leading-relaxed text-muted-foreground">
            {load.mode === "demo"
              ? "Connect Supabase, then import a CSV from the Leads tab — leads with an email address show up here."
              : "Import a CSV from the Leads tab. Leads with a stored email address become campaign recipients — leads without one sit in their folder's No email section until an address is found."}
          </p>
          {onSwitchToLeads && (
            <Button variant="outline" size="sm" onClick={onSwitchToLeads} data-track="campaign_goto_leads" className="mt-1 gap-1.5">
              <Upload className="h-3.5 w-3.5" aria-hidden />
              Go to Leads
            </Button>
          )}
        </div>
      )}

      {load.status === "ready" && targetCount > 0 && (
        <>
          {/* Step 1 — pick the folders to campaign, before the leads */}
          <FolderChooser
            folders={folders}
            folderSel={folderSel}
            folderCounts={folderCounts}
            onToggleFolder={onToggleFolder}
            onSelectAll={onSelectAllFolders}
            onClear={onClearFolders}
          />

          {/* Step 2 — pick leads within the chosen folders */}
          {noFolders ? (
            <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-background/40 px-6 py-10 text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-card text-muted-foreground">
                <Target className="h-5 w-5" aria-hidden />
              </span>
              <p className="text-[13px] font-medium text-foreground">Choose a folder to begin</p>
              <p className="max-w-xs font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                Pick one or more folders above — their leads appear here for you to select.
              </p>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
                  Step 2 · Pick leads
                </span>

                {/* search */}
                <div className="relative w-full max-w-xs">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
                  <input
                    type="text"
                    value={q}
                    onChange={(e) => onSearch(e.target.value)}
                    placeholder="Search leads…"
                    aria-label="Search leads"
                    data-track="campaign_search"
                    className="h-8 w-full rounded-lg border border-border bg-background pl-8 pr-8 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  />
                  {q && (
                    <button
                      type="button"
                      onClick={() => onSearch("")}
                      aria-label="Clear search"
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                    >
                      <X className="h-3.5 w-3.5" aria-hidden />
                    </button>
                  )}
                </div>

                {/* only leads never sent an outreach email (email_sent ledger).
                    Turning it on also drops already-emailed leads from the
                    selection, so nothing hidden is sent. */}
                <button
                  type="button"
                  onClick={onToggleUnsent}
                  aria-pressed={unsentOnly}
                  data-track="campaign_filter_unsent"
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-[11px] font-medium transition-colors",
                    unsentOnly
                      ? "border-primary/50 bg-primary/10 text-foreground"
                      : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
                  )}
                >
                  <MailX className="h-3.5 w-3.5" aria-hidden />
                  Not yet emailed
                  <span className="tnum">{unsentCount.toLocaleString("en-US")}</span>
                </button>

                <span className="ml-auto font-mono text-[10.5px] text-muted-foreground">
                  <span className="tnum text-foreground">{selectedCount.toLocaleString("en-US")}</span> selected
                </span>
              </div>

              <LeadsTableView
                rows={visible}
                selection={{ selected: picked, onToggle, onToggleAll, onSelectMany }}
                emptyHint={
                  q
                    ? `No leads match “${q.trim()}”.`
                    : unsentOnly
                      ? "Every lead in the selected folders has already been emailed — turn off “Not yet emailed” to see them."
                      : "No leads in the selected folders."
                }
              />
            </>
          )}

          {findNote && (
            <p role="status" className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              {findNote}
            </p>
          )}

          <p
            className={cn(
              "font-mono text-[10.5px] leading-relaxed",
              selectedCount > MAX_RECIPIENTS ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {selectedCount > MAX_RECIPIENTS
              ? `Max ${MAX_RECIPIENTS.toLocaleString("en-US")} recipients per send — deselect ${(selectedCount - MAX_RECIPIENTS).toLocaleString("en-US")}.`
              : selectedCount > MAX_COMPOSE_LEADS
                ? `AI drafting handles ${MAX_COMPOSE_LEADS} leads per run — Compose splits this selection into ${Math.ceil(selectedCount / MAX_COMPOSE_LEADS).toLocaleString("en-US")} batches of up to ${MAX_COMPOSE_LEADS}, drafted, reviewed and sent one after another.`
                : scrapeCount > 0
                  ? `${scrapeCount.toLocaleString("en-US")} selected lead${scrapeCount === 1 ? " has" : "s have"} no stored email — Find emails scans their websites, or add an address while reviewing.`
                  : "Compose drafts each lead with Claude, grounded in its sector knowledge base."}
          </p>
        </>
      )}
    </div>
  );
}

/** Step 1 of the audience — multi-select folder chips. Leads are scoped to the
 *  chosen folders, so the user picks folders before the leads. */
function FolderChooser({
  folders,
  folderSel,
  folderCounts,
  onToggleFolder,
  onSelectAll,
  onClear,
}: {
  folders: string[];
  folderSel: Set<string>;
  folderCounts: Map<string, number>;
  onToggleFolder: (f: string) => void;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  const allOn = folders.length > 0 && folders.every((f) => folderSel.has(f));
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // close on outside click / Escape while the menu is open
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  // trigger summary: name a single pick, otherwise a count + the total leads
  const selected = folders.filter((f) => folderSel.has(f));
  const pickedLeadCount = selected.reduce((n, f) => n + (folderCounts.get(f) ?? 0), 0);
  const triggerLabel =
    selected.length === 0
      ? "Select folders…"
      : selected.length === 1
        ? folderLabel(selected[0])
        : allOn
          ? `All folders (${folders.length})`
          : `${selected.length} folders`;

  return (
    <div className="flex flex-col gap-2">
      <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
        Step 1 · Choose folders
      </span>

      <div ref={rootRef} className="relative w-full max-w-sm">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-haspopup="listbox"
          aria-expanded={open}
          data-track="campaign_folders_toggle"
          className={cn(
            "inline-flex h-9 w-full items-center justify-between gap-2 rounded-lg border bg-background px-3 text-xs transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
            selected.length > 0 ? "border-primary/50 text-foreground" : "border-border text-muted-foreground hover:border-primary/40 hover:text-foreground",
          )}
        >
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate font-medium">{triggerLabel}</span>
            {selected.length > 0 && (
              <span className="tnum shrink-0 font-mono text-[10px] text-muted-foreground">
                {pickedLeadCount.toLocaleString("en-US")} lead{pickedLeadCount === 1 ? "" : "s"}
              </span>
            )}
          </span>
          <ChevronDown
            className={cn(
              "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200 ease-out",
              open && "rotate-180",
            )}
            aria-hidden
          />
        </button>

        {/* Kept mounted so the list animates shut as well as open — see
            `.apmg-menu` in globals.css. */}
        <div
          role="listbox"
          aria-multiselectable="true"
          aria-hidden={!open}
          data-open={open}
          className="apmg-menu absolute z-20 mt-1.5 w-full overflow-hidden rounded-lg border border-border bg-card shadow-lg ring-1 ring-foreground/5"
        >
          {folders.length > 1 && (
            <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2 font-mono text-[10px]">
              <button
                type="button"
                onClick={onSelectAll}
                disabled={allOn}
                data-track="campaign_folders_all"
                className="text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Select all
              </button>
              <button
                type="button"
                onClick={onClear}
                disabled={folderSel.size === 0}
                data-track="campaign_folders_clear"
                className="text-muted-foreground transition-colors hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
              >
                Clear
              </button>
            </div>
          )}
          <div className="max-h-64 overflow-y-auto py-1">
            {folders.map((f) => {
              const active = folderSel.has(f);
              return (
                <button
                  key={f}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => onToggleFolder(f)}
                  data-track="campaign_select_folder"
                  className={cn(
                    "flex w-full items-start gap-2 px-3 py-2 text-left text-xs transition-colors",
                    active ? "bg-primary/10 text-foreground" : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground",
                  )}
                >
                  <span
                    className={cn(
                      "mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                      active ? "border-primary bg-primary-solid text-primary-foreground" : "border-border",
                    )}
                  >
                    {active && <Check className="h-3 w-3" aria-hidden />}
                  </span>
                  {/* folder names are user-supplied and can be long — wrap onto
                      a second line rather than truncating the one thing the
                      operator needs to read to pick correctly */}
                  <span className="min-w-0 flex-1 break-words font-medium leading-snug">{folderLabel(f)}</span>
                  <span className="tnum mt-px shrink-0 font-mono text-[10px] text-muted-foreground">
                    {(folderCounts.get(f) ?? 0).toLocaleString("en-US")}
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────  compose  ───────────────────────────── */

function ComposePanel({
  campaign,
  subject,
  body,
  service,
  onService,
  recipients,
  canAi,
  hasDrafts,
  pickedCount,
  droppedCount,
  onAiCompose,
  onCampaign,
  onSubject,
  onBody,
  onBack,
  onContinue,
}: {
  campaign: string;
  subject: string;
  body: string;
  service: string;
  onService: (slug: string) => void;
  recipients: Array<{ id: string; email: string; business: string }>;
  canAi: boolean;
  hasDrafts: boolean;
  pickedCount: number;
  droppedCount: number;
  onAiCompose: () => void;
  onCampaign: (v: string) => void;
  onSubject: (v: string) => void;
  onBody: (v: string) => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const tag = slugifyCampaign(campaign) || DEFAULT_CAMPAIGN;
  const sample = recipients[0] ?? { id: "preview-lead", email: "info@acme-hvac.com", business: "Acme HVAC & Plumbing" };
  const link = trackedLink(trackBase(), sample.id, tag);
  // distinct leads (the top-up can give one lead several recipient rows)
  const leadCount = useMemo(() => new Set(recipients.map((r) => r.id)).size, [recipients]);

  const previewDoc = useMemo(
    () => emailPreviewDoc(renderBody(body, { business: sample.business, link })),
    [body, sample.business, link],
  );

  const canContinue = subject.trim().length > 0 && body.trim().length > 0 && recipients.length > 0;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PhaseHeader
          icon={PenLine}
          title="Compose the email"
          meta={`${serviceBySlug(service)?.name ?? "Shared template"} · ${tag}`}
        />
        {canAi && (
          <button
            type="button"
            onClick={onAiCompose}
            data-track="campaign_ai_compose"
            className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-primary/10 px-2.5 py-1.5 text-[11px] font-medium text-primary transition-colors hover:bg-primary/15"
          >
            <Sparkles className="h-3.5 w-3.5" aria-hidden />
            {hasDrafts ? "Back to AI drafts" : "Draft with AI instead"}
          </button>
        )}
      </div>

      {pickedCount > MAX_COMPOSE_LEADS && (
        <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5">
          <p className="text-[12px] leading-relaxed text-foreground">
            <span className="font-semibold">
              {pickedCount.toLocaleString("en-US")} leads selected — over the {MAX_COMPOSE_LEADS}-lead AI drafting cap.
            </span>{" "}
            Every recipient will get this one shared template, not a Claude-written email. Use{" "}
            <span className="font-semibold">Compose in batches</span> on the Audience step to split the selection
            into batches of {MAX_COMPOSE_LEADS} Claude-drafted emails, sent one batch at a time.
          </p>
        </div>
      )}
      {canAi && !hasDrafts && (
        <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          This is the shared fallback template — every recipient gets the same email. Use{" "}
          <span className="text-foreground/80">Draft with AI instead</span> to have Claude write each lead a
          sector-specific email from the composer prompt.
        </p>
      )}

      {/* service templates — one per APMG service line. Picking one fills the
          shared subject/body, steers the AI drafts (Claude leads with that
          service, still tailored per lead's sector), and swaps the branded
          email's hero photo to match. */}
      <div className="flex flex-col gap-1.5">
        <span className="flex items-baseline justify-between gap-2">
          <span className="text-[12px] font-medium text-foreground">Service template</span>
          <span className="font-mono text-[9.5px] text-muted-foreground">
            fills the template · steers AI drafts · sets the email&apos;s hero photo
          </span>
        </span>
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Service template">
          <button
            type="button"
            onClick={() => onService("")}
            aria-pressed={service === ""}
            data-track="campaign_service_general"
            className={cn(
              "rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
              service === ""
                ? "border-primary/50 bg-primary/10 text-primary"
                : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
            )}
          >
            All trades (general)
          </button>
          {SERVICE_TEMPLATES.map((t) => (
            <button
              key={t.slug}
              type="button"
              onClick={() => onService(t.slug)}
              aria-pressed={service === t.slug}
              title={t.name}
              data-track={`campaign_service_${t.slug}`}
              className={cn(
                "rounded-md border px-2.5 py-1.5 text-[11px] font-medium transition-colors",
                service === t.slug
                  ? "border-primary/50 bg-primary/10 text-primary"
                  : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {t.short}
            </button>
          ))}
        </div>
        {hasDrafts && (
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            Switching the service template clears the current AI drafts — they were written for the old service.
          </p>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* editor */}
        <div className="flex flex-col gap-3">
          <Field label="Campaign tag" hint="Used as the ?c= tracking value">
            <input
              type="text"
              value={campaign}
              onChange={(e) => onCampaign(e.target.value)}
              data-track="campaign_tag"
              placeholder={DEFAULT_CAMPAIGN}
              className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <Field label="Subject">
            <input
              type="text"
              value={subject}
              onChange={(e) => onSubject(e.target.value)}
              data-track="campaign_subject"
              maxLength={300}
              className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
          <Field label="Body (HTML)" hint={`Merge tokens: ${MERGE_TOKENS.join(" · ")}`}>
            <textarea
              value={body}
              onChange={(e) => onBody(e.target.value)}
              data-track="campaign_body"
              rows={9}
              spellCheck={false}
              className="w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </Field>
        </div>

        {/* preview */}
        <div className="flex min-w-0 flex-col gap-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
              Live preview
            </span>
            <span className="truncate font-mono text-[10px] text-muted-foreground">
              to {sample.email}
            </span>
          </div>
          <div className="overflow-hidden rounded-lg border border-border bg-background/40">
            <div className="border-b border-border bg-card px-3 py-2">
              <div className="truncate text-[12.5px] font-semibold text-foreground">
                {renderSubject(subject, { business: sample.business }) || "(no subject)"}
              </div>
              <div className="mt-px truncate font-mono text-[10px] text-muted-foreground">
                APMG Services · preview for {sample.business}
              </div>
            </div>
            <iframe
              title="Email preview"
              srcDoc={previewDoc}
              sandbox=""
              className="h-[300px] w-full bg-white"
            />
          </div>
          <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
            The CTA link is rewritten per lead to <span className="text-foreground/80">/t/&lt;lead&gt;?c={tag}</span> — a click marks the lead engaged and surfaces it in Sales.
          </p>
        </div>
      </div>

      {droppedCount > 0 && (
        <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          This shared template only reaches the{" "}
          <span className="text-foreground/80">{leadCount.toLocaleString("en-US")}</span> selected lead
          {leadCount === 1 ? "" : "s"} with a stored email —{" "}
          <span className="text-foreground/80">{droppedCount.toLocaleString("en-US")}</span> website-only lead
          {droppedCount === 1 ? "" : "s"} {droppedCount === 1 ? "is" : "are"} skipped. Draft with AI to write them
          and add an address in review.
        </p>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack} data-track="campaign_back_audience" className="gap-1.5">
          Back
        </Button>
        <Button onClick={onContinue} disabled={!canContinue} data-track="campaign_next_send" className="gap-1.5">
          Review &amp; send
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="flex items-baseline justify-between gap-2">
        <span className="text-[12px] font-medium text-foreground">{label}</span>
        {hint && <span className="font-mono text-[9.5px] text-muted-foreground">{hint}</span>}
      </span>
      {children}
    </label>
  );
}

/* ─────────────────────────────  AI drafts  ───────────────────────────── */

/** Shown while Claude drafts each lead's email in-app, grounded in the KB. */
function DraftingPanel({
  count,
  done,
  scrapeCount,
  batchLabel,
  reduce,
}: {
  count: number;
  done: number;
  scrapeCount: number;
  batchLabel: string | null;
  reduce: boolean;
}) {
  return (
    <div className="flex flex-col gap-4">
      <PhaseHeader
        icon={Sparkles}
        title="Drafting with Claude"
        meta={batchLabel ? `${batchLabel} · grounded in the sector KB` : "grounded in the sector KB"}
      />

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="tnum font-mono text-[34px] font-semibold leading-none text-foreground sm:text-[40px]">
            {count.toLocaleString("en-US")}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            {done > 0
              ? `${done.toLocaleString("en-US")} of ${count.toLocaleString("en-US")} drafted`
              : `lead${count === 1 ? "" : "s"} being drafted`}
          </div>
        </div>
        <SignalLed className="mb-2 h-2.5 w-2.5" />
      </div>

      {/* drafts come back a chunk of leads at a time (several short requests
          per run) — indeterminate sweep until the first chunk lands, then a
          real fill */}
      <div
        className="h-1.5 w-full overflow-hidden rounded-full bg-border"
        role="progressbar"
        aria-label="Drafting progress"
        aria-valuemin={0}
        aria-valuemax={count}
        aria-valuenow={done}
      >
        {done > 0 ? (
          <div
            className={cn("h-full rounded-full bg-primary", !reduce && "transition-[width] duration-500 ease-out")}
            style={{ width: `${Math.min(100, Math.round((done / Math.max(count, 1)) * 100))}%` }}
          />
        ) : (
          !reduce && (
            <motion.div
              className="h-full w-1/3 rounded-full bg-primary"
              animate={{ x: ["-110%", "320%"] }}
              transition={{ repeat: Infinity, duration: 1.5, ease: "linear" }}
            />
          )
        )}
      </div>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
        <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className="truncate">
          {scrapeCount > 0
            ? `Claude writes one grounded email per lead · ${scrapeCount.toLocaleString("en-US")} need an address you'll add in review`
            : "Claude writes one grounded email per lead, tailored to its sector"}
        </span>
      </div>
    </div>
  );
}

/** Compose automation failed — retry, or fall back to the shared template. */
function ComposeErrorPanel({
  message,
  onRetry,
  onUseTemplate,
}: {
  message: string;
  onRetry: () => void;
  onUseTemplate: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="text-base font-semibold text-foreground">Drafting failed</h2>
      <p role="alert" className="max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground">
        {message}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Button data-track="campaign_compose_retry" onClick={onRetry} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Try again
        </Button>
        <Button variant="outline" data-track="campaign_compose_fallback" onClick={onUseTemplate}>
          Use the template instead
        </Button>
      </div>
    </div>
  );
}

/** Per-lead drafts, back from the automation: review one by one (list + prev/
 *  next), edit subject/body/address in place, or select all and send at once.
 *  Only checked drafts with an address become recipients. */
function DraftsReviewPanel({
  drafts,
  approved,
  index,
  info,
  serviceName,
  batchLabel,
  campaignTag,
  onIndex,
  onToggle,
  onToggleAll,
  onEdit,
  onRecompose,
  onUseTemplate,
  onBack,
  onContinue,
}: {
  drafts: ComposeDraft[];
  approved: Set<string>;
  index: number;
  info: { mode: "live" | "demo"; saved: number; drafted: number } | null;
  serviceName: string | null;
  batchLabel: string | null;
  campaignTag: string;
  onIndex: (i: number) => void;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onEdit: (id: string, patch: Partial<Pick<ComposeDraft, "subject" | "html" | "best_email">>) => void;
  onRecompose: () => void;
  onUseTemplate: () => void;
  onBack: () => void;
  onContinue: () => void;
}) {
  const current = drafts.length > 0 ? drafts[Math.min(index, drafts.length - 1)] : null;
  const sendable = drafts.filter(draftSendable);
  const approvedCount = sendable.filter((d) => approved.has(d.id)).length;
  const allOn = sendable.length > 0 && sendable.every((d) => approved.has(d.id));

  const link = current ? trackedLink(trackBase(), current.id, campaignTag) : "";
  const previewDoc = useMemo(
    () => (current ? emailPreviewDoc(renderBody(current.html, { business: current.business, link })) : ""),
    [current, link],
  );

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PhaseHeader
          icon={Sparkles}
          title="Review AI drafts"
          meta={`${batchLabel ? `${batchLabel} · ` : ""}${serviceName ? `${serviceName} · ` : ""}${approvedCount.toLocaleString("en-US")} of ${drafts.length.toLocaleString("en-US")} selected to send${info?.mode === "demo" ? " · demo drafts" : info && info.drafted < drafts.length ? ` · ${info.drafted.toLocaleString("en-US")} AI-written` : ""}`}
        />
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onRecompose}
            data-track="campaign_recompose"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Re-draft
          </button>
          <button
            type="button"
            onClick={onUseTemplate}
            data-track="campaign_use_template"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <PenLine className="h-3.5 w-3.5" aria-hidden />
            Use template
          </button>
        </div>
      </div>

      {info != null && info.saved > 0 && (
        <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          {info.saved.toLocaleString("en-US")} lead{info.saved === 1 ? "'s" : "s'"} scraped emails were saved back to
          public.leads.
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[280px_minmax(0,1fr)]">
        {/* draft list — check to include; click to review one by one */}
        <div className="flex min-w-0 flex-col overflow-hidden rounded-lg border border-border">
          <div className="flex items-center gap-2 border-b border-border bg-card px-3 py-2">
            <input
              type="checkbox"
              checked={allOn}
              ref={(el) => {
                if (el) el.indeterminate = !allOn && approvedCount > 0;
              }}
              onChange={onToggleAll}
              aria-label="Select all sendable drafts"
              className="h-3.5 w-3.5 cursor-pointer accent-primary"
            />
            <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Select all
            </span>
            <span className="tnum ml-auto font-mono text-[10px] text-muted-foreground">
              {approvedCount}/{sendable.length}
              {drafts.length > sendable.length ? ` · ${drafts.length - sendable.length} unsendable` : ""}
            </span>
          </div>
          <ul className="max-h-[380px] divide-y divide-border overflow-y-auto">
            {drafts.map((d, i) => {
              const canSend = draftSendable(d);
              const reason = !d.best_email
                ? "no address found"
                : d.subject.trim().length === 0 || d.html.trim().length === 0
                  ? "empty subject/body — won't send"
                  : d.best_email;
              return (
                <li key={d.id} className={cn("flex items-center gap-2 px-3 py-2", i === index && "bg-primary/[0.06]")}>
                  <input
                    type="checkbox"
                    checked={approved.has(d.id) && canSend}
                    disabled={!canSend}
                    onChange={() => onToggle(d.id)}
                    aria-label={`Include ${d.business} in the send`}
                    className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-primary disabled:cursor-not-allowed"
                  />
                  <button type="button" onClick={() => onIndex(i)} data-track="campaign_draft_open" className="min-w-0 flex-1 text-left">
                    <div className="truncate text-[12.5px] text-foreground">{d.business}</div>
                    <div className={cn("truncate font-mono text-[10px]", canSend ? "text-muted-foreground" : "text-destructive")}>
                      {reason}
                      {canSend && d.category ? ` · ${d.category}` : ""}
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        {/* current draft — editable, with a live preview */}
        {current && (
          <div className="flex min-w-0 flex-col gap-3">
            <div className="flex items-center justify-between gap-2">
              <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
                Draft {Math.min(index, drafts.length - 1) + 1} of {drafts.length} ·{" "}
                {current.email_source === "scraped"
                  ? "emails scraped from website"
                  : current.email_source === "csv"
                    ? "emails from CSV"
                    : "no emails found"}
              </span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={() => onIndex(Math.max(0, index - 1))}
                  disabled={index <= 0}
                  aria-label="Previous draft"
                  data-track="campaign_draft_prev"
                  className="rounded-md border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronLeft className="h-3.5 w-3.5" aria-hidden />
                </button>
                <button
                  type="button"
                  onClick={() => onIndex(Math.min(drafts.length - 1, index + 1))}
                  disabled={index >= drafts.length - 1}
                  aria-label="Next draft"
                  data-track="campaign_draft_next"
                  className="rounded-md border border-border bg-background p-1.5 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <ChevronRight className="h-3.5 w-3.5" aria-hidden />
                </button>
              </div>
            </div>

            <Field
              label="To"
              hint={
                current.emails.length > 0
                  ? `${current.emails.length.toLocaleString("en-US")} address${current.emails.length === 1 ? "" : "es"} on file · max 10`
                  : "no stored address — type one to reach this lead"
              }
            >
              {current.emails.length > 0 ? (
                <select
                  value={current.best_email ?? current.emails[0]}
                  onChange={(e) => onEdit(current.id, { best_email: e.target.value })}
                  data-track="campaign_draft_to"
                  className="h-8 w-full rounded-lg border border-border bg-background px-2.5 font-mono text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {current.emails.map((e) => (
                    <option key={e} value={e}>
                      {e}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type="email"
                  value={current.best_email ?? ""}
                  onChange={(e) => onEdit(current.id, { best_email: e.target.value.trim() })}
                  placeholder="name@business.com"
                  data-track="campaign_draft_to_manual"
                  className={cn(
                    "h-8 w-full rounded-lg border bg-background px-2.5 font-mono text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                    draftSendable(current) ? "border-border" : "border-destructive/40",
                  )}
                />
              )}
            </Field>
            <Field label="Subject">
              <input
                type="text"
                value={current.subject}
                onChange={(e) => onEdit(current.id, { subject: e.target.value })}
                data-track="campaign_draft_subject"
                maxLength={300}
                className="h-8 w-full rounded-lg border border-border bg-background px-2.5 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
            <Field label="Body (HTML)" hint="keep {{link}} — it becomes the tracked CTA">
              <textarea
                value={current.html}
                onChange={(e) => onEdit(current.id, { html: e.target.value })}
                data-track="campaign_draft_body"
                rows={7}
                spellCheck={false}
                className="w-full resize-y rounded-lg border border-border bg-background p-2.5 font-mono text-[11px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </Field>
            <div className="overflow-hidden rounded-lg border border-border bg-background/40">
              <div className="border-b border-border bg-card px-3 py-2">
                <div className="truncate text-[12.5px] font-semibold text-foreground">
                  {renderSubject(current.subject, { business: current.business }) || "(no subject)"}
                </div>
                <div className="mt-px truncate font-mono text-[10px] text-muted-foreground">
                  to {current.best_email ?? "—"} · preview for {current.business}
                </div>
              </div>
              <iframe title={`Email preview for ${current.business}`} srcDoc={previewDoc} sandbox="" className="h-[220px] w-full bg-white" />
            </div>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack} data-track="campaign_drafts_back" className="gap-1.5">
          Back
        </Button>
        <Button onClick={onContinue} disabled={approvedCount === 0} data-track="campaign_drafts_continue" className="gap-1.5">
          Review &amp; send {approvedCount > 0 ? approvedCount.toLocaleString("en-US") : ""}
          <Send className="h-4 w-4" aria-hidden />
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────  review & send  ───────────────────────────── */

function ReviewPanel({
  recipients,
  campaign,
  subject,
  bodyHtml,
  serviceName,
  ai,
  templateReady,
  droppedCount,
  batchLabel,
  onBack,
  onSend,
  sending,
}: {
  recipients: Recipient[];
  campaign: string;
  subject: string;
  bodyHtml: string;
  serviceName: string | null;
  ai: boolean;
  templateReady: boolean;
  droppedCount: number;
  batchLabel: string | null;
  onBack: () => void;
  onSend: () => void;
  sending: boolean;
}) {
  const recipientCount = recipients.length;
  // top-up rows: alternate addresses added because the send resolved fewer
  // than MIN_SEND_EMAILS addresses (see the recipients memo)
  const altCount = recipients.filter((r) => r.alt).length;
  const leadCount = new Set(recipients.map((r) => r.id)).size;
  const none = recipientCount === 0;
  const overCap = recipientCount > MAX_RECIPIENTS;
  const blocked = none || overCap || !templateReady;
  return (
    <div className="flex flex-col gap-4">
      <PhaseHeader
        icon={Send}
        title="Review & send"
        meta={batchLabel ? `${batchLabel} · nothing is sent until you confirm` : "nothing is sent until you confirm"}
      />

      <dl className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
        <Stat label="Recipients" value={recipientCount.toLocaleString("en-US")} />
        <Stat label="Campaign tag" value={campaign} mono />
        <Stat label="Message" value={ai ? "AI · per lead" : "Shared template"} />
      </dl>

      {serviceName && (
        <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          Service template: <span className="text-foreground/80">{serviceName}</span> — the branded email&apos;s hero
          photo is swapped to match this service.
        </p>
      )}

      {!ai && (
        <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
          <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">Subject</div>
          <div className="mt-0.5 truncate text-[13px] text-foreground">{subject || "(no subject)"}</div>
        </div>
      )}

      {/* every email exactly as it will be sent — AI drafts each carry their own
          subject/body; template sends render the shared template per lead.
          Expand a row to see the full rendered email. */}
      {recipientCount > 0 && (
        <div className="flex flex-col gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
            {ai ? "The emails Claude drafted" : "Emails to send"} · {recipientCount.toLocaleString("en-US")} · click one to preview
          </span>
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto rounded-lg border border-border">
            {recipients.map((r) => (
              <ReviewEmailRow
                // the top-up can list one lead at several addresses — the
                // address, not the lead, is what's unique per row
                key={`${r.id}:${r.email.toLowerCase()}`}
                recipient={r}
                campaign={campaign}
                fallbackSubject={subject}
                fallbackHtml={bodyHtml}
              />
            ))}
          </ul>
        </div>
      )}

      {altCount > 0 && (
        <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          Fewer than {MIN_SEND_EMAILS} addresses resolved — {altCount.toLocaleString("en-US")} alternate address
          {altCount === 1 ? "" : "es"} from leads with more than one stored email {altCount === 1 ? "was" : "were"} added
          (marked <span className="text-foreground/80">2nd address</span> above), so every inbox we know about is reached.
        </p>
      )}

      {!ai && droppedCount > 0 && (
        <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
          {droppedCount.toLocaleString("en-US")} selected lead{droppedCount === 1 ? "" : "s"} without a stored email{" "}
          {droppedCount === 1 ? "is" : "are"} skipped — draft with AI to add an address in review.
        </p>
      )}

      {blocked ? (
        <p role="alert" className="font-mono text-[11px] text-destructive">
          {none
            ? "No recipients selected — go back to Audience and pick at least one lead."
            : overCap
              ? `Too many recipients (${recipientCount.toLocaleString("en-US")}) — max ${MAX_RECIPIENTS.toLocaleString("en-US")} per send. Go back and deselect some.`
              : "Subject and body are required — go back to Compose and fill them in."}
        </p>
      ) : (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
            <Send className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground">
              Send {recipientCount.toLocaleString("en-US")} email{recipientCount === 1 ? "" : "s"} to{" "}
              {leadCount.toLocaleString("en-US")} lead{leadCount === 1 ? "" : "s"}?
            </div>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground">
              Triggers the outreach automation · each email carries a tracked link
            </div>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button variant="outline" onClick={onBack} data-track="campaign_back_compose" className="gap-1.5">
          Back
        </Button>
        <Can
          perm="campaigns.send"
          fallback={
            <span className="font-mono text-[10.5px] text-muted-foreground">
              Your role can&apos;t send campaigns.
            </span>
          }
        >
          <Button
            onClick={onSend}
            disabled={blocked || sending}
            data-track="campaign_send_confirm"
            className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
          >
            <Send className="h-4 w-4" aria-hidden />
            Send campaign
          </Button>
        </Can>
      </div>
    </div>
  );
}

/** One send-list row in Review & send — collapsed it shows who/where/subject;
 *  expanded it renders the exact email (merge tokens + tracked link resolved).
 *  Only open rows mount an iframe, so a big send list stays light. */
function ReviewEmailRow({
  recipient,
  campaign,
  fallbackSubject,
  fallbackHtml,
}: {
  recipient: Recipient;
  campaign: string;
  fallbackSubject: string;
  fallbackHtml: string;
}) {
  const [open, setOpen] = useState(false);
  // AI drafts carry their own subject/html; template recipients fall back to the shared one
  const subject = recipient.subject ?? fallbackSubject;
  const html = recipient.html ?? fallbackHtml;
  const link = trackedLink(trackBase(), recipient.id, campaign);
  const renderedSubject = renderSubject(subject, { business: recipient.business });
  const previewDoc = useMemo(
    () => (open ? emailPreviewDoc(renderBody(html, { business: recipient.business, link })) : ""),
    [open, html, recipient.business, link],
  );

  return (
    <li className="bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        data-track="campaign_review_email_toggle"
        className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left transition-colors hover:bg-primary/[0.04]"
      >
        <ChevronRight
          className={cn("h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          <div className="flex min-w-0 items-center gap-1.5">
            <span className="truncate text-[12.5px] font-medium text-foreground">{recipient.business}</span>
            {recipient.alt && (
              <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-muted px-1.5 py-px font-mono text-[9px] uppercase tracking-[0.08em] text-muted-foreground">
                2nd address
              </span>
            )}
          </div>
          <div className="truncate font-mono text-[10px] text-muted-foreground">
            to {recipient.email} · {renderedSubject || "(no subject)"}
          </div>
        </div>
        <Mail className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />
      </button>
      {open && (
        <div className="border-t border-border bg-background/40 px-3 pb-3 pt-2.5">
          <div className="overflow-hidden rounded-lg border border-border">
            <div className="border-b border-border bg-card px-3 py-2">
              <div className="truncate text-[12.5px] font-semibold text-foreground">
                {renderedSubject || "(no subject)"}
              </div>
              <div className="mt-px truncate font-mono text-[10px] text-muted-foreground">
                to {recipient.email} · exactly as it will be sent
              </div>
            </div>
            <iframe
              title={`Email preview for ${recipient.business}`}
              srcDoc={previewDoc}
              sandbox=""
              className="h-[240px] w-full bg-white"
            />
          </div>
        </div>
      )}
    </li>
  );
}

function SendingPanel({ sent, total, reduce }: { sent: number; total: number; reduce: boolean }) {
  return (
    <div className="flex flex-col gap-4">
      <PhaseHeader icon={Send} title="Sending campaign" meta="outreach automation" />

      <div className="flex items-end justify-between gap-4">
        <div>
          <div className="tnum font-mono text-[34px] font-semibold leading-none text-foreground sm:text-[40px]">
            {sent.toLocaleString("en-US")}
          </div>
          <div className="mt-1 font-mono text-[10px] uppercase tracking-[0.18em] text-muted-foreground">
            of {total.toLocaleString("en-US")} emails queued
          </div>
        </div>
        <SignalLed className="mb-2 h-2.5 w-2.5" />
      </div>

      <Bar value={total ? sent / total : 0} reduce={reduce} label="Send progress" />

      <div className="flex items-center gap-2 rounded-lg border border-border bg-background/40 px-3 py-2 font-mono text-[10.5px] text-muted-foreground">
        <Mail className="h-3.5 w-3.5 text-primary" aria-hidden />
        <span className="truncate">POST · campaign automation</span>
        <span className="tnum ml-auto text-foreground/70">{total ? Math.round((sent / total) * 100) : 0}%</span>
      </div>
    </div>
  );
}

function SuccessBanner({
  result,
  batch,
  onNextBatch,
  onReset,
}: {
  result: { sent: number; mode: SendMode; campaign: string };
  /** batching progress — set when this send was one batch of a larger selection */
  batch: { no: number; total: number; nextCount: number; queuedLeads: number } | null;
  onNextBatch: () => void;
  onReset: () => void;
}) {
  const demo = result.mode === "demo";
  const hasNext = !!batch && batch.nextCount > 0;
  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-primary/30 bg-primary/[0.04] px-3 py-2.5">
        <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
          <Check className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-foreground">
            Sent {result.sent.toLocaleString("en-US")} email{result.sent === 1 ? "" : "s"}
            {batch ? ` · batch ${batch.no} of ${batch.total}${hasNext ? "" : " — all batches done"}` : ""}
          </div>
          <div className="truncate font-mono text-[10.5px] text-muted-foreground">
            {demo
              ? "Demo mode — not actually delivered (set N8N_CAMPAIGN_WEBHOOK_URL to go live)"
              : `Campaign ${result.campaign} · handed to the automation`}
          </div>
        </div>
        <Button variant="outline" size="sm" data-track="campaign_send_another" onClick={onReset} className="ml-auto gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          New send
        </Button>
      </div>

      {/* next queued batch — compose it right from the success banner. Nothing
          is sent until that batch is reviewed and confirmed in turn. */}
      {hasNext && batch && (
        <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-primary/40 bg-primary/10 text-primary">
            <Sparkles className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold text-foreground">
              {batch.queuedLeads.toLocaleString("en-US")} lead{batch.queuedLeads === 1 ? "" : "s"} still queued
              {batch.total - batch.no > 1 ? ` across ${(batch.total - batch.no).toLocaleString("en-US")} batches` : ""}
            </div>
            <div className="truncate font-mono text-[10.5px] text-muted-foreground">
              Drafted with Claude, then reviewed and confirmed like this one — nothing sends automatically
            </div>
          </div>
          <Button onClick={onNextBatch} data-track="campaign_next_batch" className="gap-1.5">
            <Sparkles className="h-4 w-4" aria-hidden />
            Compose batch {(batch.no + 1).toLocaleString("en-US")} ({batch.nextCount.toLocaleString("en-US")})
          </Button>
        </div>
      )}

      <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
        Leads that click the tracked link are marked engaged and flow into the Sales queue, which only shows
        leads that have been emailed.
      </p>
    </div>
  );
}

function ErrorPanel({
  message,
  onRetry,
  onReset,
}: {
  message: string;
  onRetry: () => void;
  onReset: () => void;
}) {
  return (
    <div className="flex flex-col items-center gap-3 px-4 py-8 text-center">
      <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
        <AlertTriangle className="h-6 w-6" aria-hidden />
      </span>
      <h2 className="text-base font-semibold text-foreground">Send failed</h2>
      <p role="alert" className="max-w-md font-mono text-[11px] leading-relaxed text-muted-foreground">
        {message}
      </p>
      <div className="mt-1 flex items-center gap-2">
        <Button data-track="campaign_retry" onClick={onRetry} className="gap-1.5">
          <RotateCcw className="h-3.5 w-3.5" aria-hidden />
          Try again
        </Button>
        <Button variant="outline" data-track="campaign_send_startover" onClick={onReset}>
          Back to review
        </Button>
      </div>
    </div>
  );
}

/* ─────────────────────────────  find emails success modal  ───────────────────────────── */

/** Success summary after a live Find emails run — how many of the scanned leads
 *  came back with an address. The addresses are already prefilled onto the
 *  folder's rows; this confirms the outcome. Same modal pattern as the error
 *  dialog (overlay + focus trap + Escape). */
function FindSuccessModal({
  open,
  found,
  tried,
  onClose,
}: {
  open: boolean;
  found: number;
  tried: number;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const none = found === 0;
  const missed = Math.max(0, tried - found);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={onClose}
            aria-hidden
          />
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-4">
            <motion.div
              ref={ref}
              role="dialog"
              aria-modal="true"
              aria-label="Find emails complete"
              tabIndex={-1}
              className="w-[min(94vw,460px)] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
              initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: PANEL_EASE }}
            >
              {/* header */}
              <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div
                  className={cn(
                    "flex h-9 w-9 shrink-0 items-center justify-center rounded-lg",
                    none ? "bg-muted text-muted-foreground" : "bg-primary-solid text-primary-foreground",
                  )}
                >
                  {none ? <Globe className="h-5 w-5" aria-hidden /> : <Check className="h-5 w-5" aria-hidden />}
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-base font-semibold text-foreground">
                    {none ? "No addresses found" : "Emails found"}
                  </h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    Scanned {tried.toLocaleString("en-US")} website-only lead{tried === 1 ? "" : "s"}.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* body */}
              <div className="space-y-3 px-5 py-4">
                <div className="flex items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-3">
                  <span className="tnum font-mono text-[30px] font-semibold leading-none text-foreground">
                    {found.toLocaleString("en-US")}
                    <span className="text-muted-foreground">/{tried.toLocaleString("en-US")}</span>
                  </span>
                  <span className="text-[12px] leading-snug text-muted-foreground">
                    lead{found === 1 ? "" : "s"} got a contact address, prefilled onto the rows in this folder.
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed text-muted-foreground">
                  {none
                    ? "None of the scanned sites exposed a usable address — add one by hand while reviewing, or try a different selection."
                    : missed > 0
                      ? `The other ${missed.toLocaleString("en-US")} had nothing scrapable — add those by hand in review.`
                      : "Every scanned lead now has an address and is ready to compose."}
                </p>
              </div>

              {/* footer */}
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
                <Button
                  size="sm"
                  onClick={onClose}
                  data-track="campaign_find_success_close"
                  className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                >
                  <Check className="h-4 w-4" aria-hidden />
                  Done
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────────  find emails error modal  ───────────────────────────── */

/** Troubleshooting steps shown in the Find emails error modal. The finder runs
 *  in n8n, so most failures aren't app bugs — they're a workflow that's off,
 *  duplicated, or pointed at the wrong URL. Keep this in step with the setup
 *  notes in references/APMG Email Finder.json. */
const FIND_TROUBLESHOOTING = [
  "Open n8n and confirm the APMG Email Finder workflow is Active (toggle green, top-right).",
  "Make sure only ONE workflow owns the /webhook/email-finder path — a duplicate import can answer instead and return nothing. Delete the extras.",
  "Check the Integrations tab holds that workflow's Production URL (ending /webhook/email-finder), not a test URL.",
  "Open the workflow's Executions in n8n — the run should reach the final Respond node. If it stops earlier, that node shows why.",
] as const;

/** Modal shown when a Find emails run fails. Carries the server's error message
 *  plus an actionable checklist. Follows the app modal pattern (overlay +
 *  centered dialog, focus trap, Escape to close) — see CloseDealModal. */
function FindErrorModal({
  open,
  message,
  onClose,
  onRetry,
}: {
  open: boolean;
  message: string | null;
  onClose: () => void;
  onRetry: () => void;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  useFocusTrap(open, ref);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <>
          <motion.div
            className="fixed inset-0 z-[80] bg-black/55 backdrop-blur-[1px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={onClose}
            aria-hidden
          />
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-4">
            <motion.div
              ref={ref}
              role="dialog"
              aria-modal="true"
              aria-label="Find emails failed"
              tabIndex={-1}
              className="w-[min(94vw,520px)] overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
              initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: PANEL_EASE }}
            >
              {/* header */}
              <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-destructive/10 text-destructive">
                  <AlertTriangle className="h-5 w-5" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <h2 className="font-heading text-base font-semibold text-foreground">Find emails failed</h2>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    The email finder ran but didn&rsquo;t return any addresses. This is almost always a workflow
                    setup issue in n8n, not the leads.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={onClose}
                  aria-label="Close"
                  className="-mr-1 rounded-md p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>

              {/* body */}
              <div className="space-y-4 px-5 py-4">
                {message && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/[0.06] px-3 py-2.5">
                    <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-destructive">
                      What the finder returned
                    </div>
                    <p role="alert" className="mt-1 font-mono text-[11px] leading-relaxed text-foreground/90">
                      {message}
                    </p>
                  </div>
                )}

                <div className="space-y-2">
                  <div className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                    Try this, in order
                  </div>
                  <ol className="space-y-2">
                    {FIND_TROUBLESHOOTING.map((step, i) => (
                      <li key={i} className="flex gap-2.5">
                        <span className="tnum mt-px flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-primary/15 font-mono text-[9px] font-semibold text-primary">
                          {i + 1}
                        </span>
                        <span className="text-[12px] leading-relaxed text-foreground/90">{step}</span>
                      </li>
                    ))}
                  </ol>
                </div>
              </div>

              {/* footer */}
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
                <Button variant="outline" size="sm" onClick={onClose} data-track="campaign_find_error_close">
                  Close
                </Button>
                <Button size="sm" onClick={onRetry} data-track="campaign_find_error_retry" className="gap-1.5">
                  <RotateCcw className="h-4 w-4" aria-hidden />
                  Try again
                </Button>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}

/* ─────────────────────────────  bits  ───────────────────────────── */

function Stat({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="rounded-lg border border-border bg-background/40 px-3 py-2.5">
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">{label}</div>
      <div className={cn("mt-0.5 truncate text-[15px] font-semibold text-foreground", mono && "font-mono text-[13px]")}>
        {value}
      </div>
    </div>
  );
}

function PhaseHeader({ icon: Icon, title, meta }: { icon: typeof Send; title: string; meta: string }) {
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

/** Eased count-up shared by the send progress fill. Snaps under reduced motion;
 *  `live` lets a stale run bail, and the rAF id is tracked for cancel-on-unmount. */
function tweenTo(
  rafRef: MutableRefObject<number | null>,
  reduce: boolean,
  apply: (n: number) => void,
  from: number,
  to: number,
  dur: number,
  live: () => boolean,
): Promise<void> {
  return new Promise<void>((resolve) => {
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
  });
}
