"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import {
  AlertTriangle,
  Check,
  ChevronDown,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  LayoutGrid,
  Mail,
  RefreshCw,
  Rows3,
  Trash2,
  Webhook,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  MAX_NOTIFY_EMAILS,
  NOTIFY_SEPARATOR_RE,
  commitNotifyDraft,
  parseNotifyEmails,
  serializeNotifyEmails,
} from "@/lib/pipeline/notifyEmails";
import {
  INTEGRATIONS,
  N8N_BASE_URL,
  type AutomationStatus,
  type Integration,
  type IntegrationState,
  type TriggerKind,
} from "@/lib/data/integrations";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { SignalLed } from "./SignalLed";

const TRIGGER: Record<TriggerKind, { label: string; icon: typeof Webhook }> = {
  webhook: { label: "Webhook", icon: Webhook },
  schedule: { label: "Schedule", icon: Clock },
  event: { label: "Event", icon: Zap },
};

const STATUS: Record<AutomationStatus, { label: string; className: string; dot: string }> = {
  connected: { label: "Live", className: "border-primary/40 bg-transparent text-primary", dot: "bg-primary" },
  paused: { label: "Paused", className: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground/50" },
  demo: { label: "Not configured", className: "border-border bg-muted text-muted-foreground", dot: "bg-muted-foreground/50" },
  error: { label: "Error", className: "border-destructive/40 bg-transparent text-destructive", dot: "bg-destructive" },
};

const POLL_MS = 15000;

/** How the page is laid out. Table is the default — it puts every configurable
 *  thing (the notification recipients and each webhook URL) in one scannable
 *  list; cards are richer per automation (they carry the full description). */
type ViewMode = "table" | "cards";

const VIEW_STORAGE = "apmg:integrations-view";

const VIEWS: { id: ViewMode; label: string; icon: typeof Rows3 }[] = [
  { id: "table", label: "Table", icon: Rows3 },
  { id: "cards", label: "Cards", icon: LayoutGrid },
];

/** Row id for the global recipients setting in the table. It isn't an n8n
 *  integration, so it can't collide with an INTEGRATIONS id. */
const NOTIFY_ROW_ID = "enquiry-notify-emails";

/** House ease (ui-standards §14.1) for the expanding editor rows. */
const SWAP_EASE = [0.16, 1, 0.3, 1] as const;

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; mode: string; canPersist: boolean; states: IntegrationState[]; notifyEmail: string };

function Pill({
  label,
  className,
  dot,
}: {
  label: string;
  className: string;
  dot: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dot)} aria-hidden />
      {label}
    </span>
  );
}

function StatusPill({ status }: { status: AutomationStatus }) {
  const s = STATUS[status];
  return <Pill label={s.label} className={s.className} dot={s.dot} />;
}

/** On/off switch (on = primary track). Turning it on sends live; off pauses the
 *  automation (demo/simulated) while keeping the saved webhook URL. */
function Toggle({
  on,
  disabled,
  busy,
  onToggle,
  label,
}: {
  on: boolean;
  disabled?: boolean;
  busy?: boolean;
  onToggle: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled || busy}
      onClick={onToggle}
      data-track="integration_toggle"
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-card disabled:cursor-not-allowed disabled:opacity-50",
        on ? "bg-primary" : "bg-muted",
      )}
    >
      <span
        aria-hidden
        className={cn(
          "inline-block h-4 w-4 rounded-full bg-background shadow-sm transition-transform",
          on ? "translate-x-[18px]" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

/** A short-lived "Saved" confirmation, cleaned up on unmount. */
function useSavedFlash(): [boolean, () => void] {
  const [on, setOn] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);
  const flash = useCallback(() => {
    setOn(true);
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setOn(false), 1800);
  }, []);
  return [on, flash];
}

/* ── shared editing state ────────────────────────────────────────────────────
   Both layouts edit exactly the same settings, so the state and the save calls
   live in hooks that the card and the table row share. Only the presentation
   differs — a card view and a table view can't drift on validation, on what
   Save persists, or on which error the operator sees. */

/**
 * Where internal notifications are emailed to. One global setting (app_settings
 * key `enquiry_notify_email`) holding one address or a comma-separated list —
 * EVERY listed address is notified, via a single Gmail send addressed to all of
 * them. TWO surfaces consume it, because both are the same internal audience:
 * the enquiry route (+ the Enquiry Notification n8n workflow) and the Sales
 * hand-off notifier (+ the Sales Handoff Notification workflow).
 * Blank clears it (no notifications sent). Parsing lives in
 * lib/pipeline/notifyEmails.ts, shared with the API route so the validation
 * shown here is exactly the validation enforced on save.
 *
 * `committed` holds the confirmed recipients as a canonical string (rendered as
 * removable chips), `draft` holds whatever's currently being typed in the add
 * field. Pressing Enter, typing/pasting a separator, or clicking Add folds
 * `draft` onto `committed` via commitNotifyDraft — the same validation Save and
 * the API route already enforce, so a bad add attempt can never corrupt the
 * confirmed list.
 *
 * Held by IntegrationsPage rather than by either layout, so switching between
 * table and cards mid-edit doesn't throw away a part-typed recipient list.
 */
function useNotifyEmails({ initial, onSaved }: { initial: string; onSaved: () => void }) {
  const [committed, setCommitted] = useState(initial);
  const [draft, setDraft] = useState("");
  const [addError, setAddError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, flashSaved] = useSavedFlash();
  const initialRef = useRef(initial);

  // Re-seed from a poll ONLY while the field still shows the last known saved
  // value. The page polls every 15s, and clobbering a part-typed list of
  // addresses is real data loss (one short address was survivable).
  useEffect(() => {
    const prev = initialRef.current;
    initialRef.current = initial;
    if (prev === initial) return;
    setCommitted((cur) => (cur.trim() === prev.trim() ? initial : cur));
  }, [initial]);

  const parsed = useMemo(() => parseNotifyEmails(committed), [committed]);
  // Compare canonical-to-canonical: saving normalises ("A@b.com ,c@d.com" →
  // "a@b.com, c@d.com"), so a raw comparison would leave the field permanently
  // dirty after every save.
  const initialCanonical = useMemo(() => {
    const p = parseNotifyEmails(initial);
    return p.ok ? p.value : initial.trim();
  }, [initial]);
  const canonical = parsed.ok ? parsed.value : null;
  const emails = parsed.ok ? parsed.emails : [];
  const atCap = emails.length >= MAX_NOTIFY_EMAILS;

  // What Save would actually persist, accounting for a non-empty draft that
  // hasn't been explicitly committed yet — otherwise typing an address and
  // clicking Save straight away (without pressing Enter first) would look
  // like a no-op because `committed` hasn't changed.
  const draftPreview = useMemo(
    () => (draft.trim() ? commitNotifyDraft(committed, draft) : null),
    [committed, draft],
  );
  const effectiveCanonical = draftPreview ? (draftPreview.ok ? draftPreview.value : null) : canonical;
  const dirty = effectiveCanonical !== null && effectiveCanonical !== initialCanonical;
  const validish = draftPreview ? draftPreview.ok : parsed.ok;

  /** Fold `rawDraft` onto `committed`. On success, clears the draft field and
   *  the committed list grows by one chip (or more, for a pasted list). On
   *  failure, the draft text is preserved so the operator can fix the exact
   *  problem — the committed chips are never touched by a bad attempt. */
  function tryCommit(rawDraft: string) {
    const result = commitNotifyDraft(committed, rawDraft);
    if (!result.ok) {
      setAddError(result.error);
      setDraft(rawDraft);
      return;
    }
    setAddError(null);
    setCommitted(result.value);
    setDraft("");
  }

  function remove(addr: string) {
    setCommitted(serializeNotifyEmails(emails.filter((a) => a !== addr)));
  }

  function edit(next: string) {
    if (NOTIFY_SEPARATOR_RE.test(next)) {
      tryCommit(next);
    } else {
      setDraft(next);
      setAddError(null);
    }
  }

  async function save() {
    setError(null);
    let toSave = canonical;
    if (draft.trim()) {
      const result = commitNotifyDraft(committed, draft);
      if (!result.ok) {
        setAddError(result.error);
        return;
      }
      setAddError(null);
      setCommitted(result.value);
      setDraft("");
      toSave = result.value;
    }
    // Save is gated on `validish`, so `toSave` is non-null whenever save()
    // can fire; the guard is defensive only.
    if (toSave === null) return;
    setBusy(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notifyEmail: toSave }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Save failed (${res.status}).`);
        return;
      }
      flashSaved();
      onSaved();
    } catch {
      setError("Network error — couldn't save.");
    } finally {
      setBusy(false);
    }
  }

  return {
    draft,
    emails,
    atCap,
    addError,
    error,
    busy,
    savedFlash,
    dirty,
    validish,
    edit,
    tryCommit,
    remove,
    save,
  };
}

type NotifyEmails = ReturnType<typeof useNotifyEmails>;

/** Save / clear / pause for one integration's webhook. All three go to the same
 *  endpoint and differ only in body and error wording. */
function useIntegrationConfig({ integration, onSaved }: { integration: Integration; onSaved: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, flashSaved] = useSavedFlash();

  async function post(
    body: Record<string, unknown>,
    labels: { failed: string; network: string },
  ): Promise<boolean> {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: integration.id, ...body }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `${labels.failed} (${res.status}).`);
        return false;
      }
      onSaved();
      return true;
    } catch {
      setError(labels.network);
      return false;
    } finally {
      setBusy(false);
    }
  }

  return {
    busy,
    error,
    savedFlash,
    clearError: () => setError(null),
    async save(url: string) {
      const ok = await post({ url: url.trim() }, { failed: "Save failed", network: "Network error saving the webhook." });
      if (ok) flashSaved();
      return ok;
    },
    clear: () => post({ url: "" }, { failed: "Clear failed", network: "Network error clearing the webhook." }),
    // On/off — only writes the toggle, so the saved webhook URL is retained.
    toggleEnabled: () =>
      post({ enabled: !integration.enabled }, { failed: "Toggle failed", network: "Network error updating the toggle." }),
  };
}

type IntegrationConfig = ReturnType<typeof useIntegrationConfig>;

export function IntegrationsPage() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchState = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoad((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    try {
      const res = await fetch("/api/integrations", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; mode?: string; canPersist?: boolean; integrations?: IntegrationState[]; notifyEmail?: string; error?: string }
        | null;
      if (!mountedRef.current) return;
      if (!res.ok || !data?.ok) {
        setLoad({ status: "error", error: data?.error ?? `Couldn't load integrations (${res.status}).` });
        return;
      }
      setLoad({
        status: "ready",
        mode: data.mode ?? "live",
        canPersist: data.canPersist ?? false,
        states: data.integrations ?? [],
        notifyEmail: data.notifyEmail ?? "",
      });
    } catch {
      if (mountedRef.current) setLoad({ status: "error", error: "Network error loading integrations." });
    }
  }, []);

  // realtime: load on mount, poll, and refetch when the tab regains focus.
  // The tick skips while the tab is hidden and tops up the moment it comes back
  // (matching TelemetryPage/SalesProvider): a console left open in a background
  // tab was otherwise polling all night for nobody, which is billed transfer.
  useEffect(() => {
    fetchState();
    const tick = () => {
      if (document.visibilityState === "hidden") return;
      fetchState({ quiet: true });
    };
    const id = setInterval(tick, POLL_MS);
    const onActive = () => fetchState({ quiet: true });
    const onVisible = () => {
      if (document.visibilityState === "visible") onActive();
    };
    window.addEventListener("focus", onActive);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onActive);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchState]);

  // Table is the default working layout; cards are the opt-in. Hydrated after
  // mount (never during render) so the server and first client pass agree.
  const [view, setView] = useState<ViewMode>("table");
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE);
    if (saved === "cards" || saved === "table") setView(saved);
  }, []);
  function chooseView(next: ViewMode) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE, next);
    } catch {
      /* storage unavailable — the choice just won't survive a reload */
    }
  }

  const refetch = useCallback(() => fetchState({ quiet: true }), [fetchState]);
  const notify = useNotifyEmails({
    initial: load.status === "ready" ? load.notifyEmail : "",
    onSaved: refetch,
  });

  // merge static metadata with live state, in registry order
  const integrations = useMemo<Integration[]>(() => {
    if (load.status !== "ready") return [];
    const byId = new Map(load.states.map((s) => [s.id, s]));
    return INTEGRATIONS.map((meta) => {
      const state: IntegrationState = byId.get(meta.id) ?? {
        id: meta.id,
        configured: false,
        enabled: true,
        maskedUrl: null,
        source: null,
        status: "demo",
      };
      return { ...meta, ...state };
    });
  }, [load]);

  const stats = useMemo(() => {
    const live = integrations.filter((i) => i.status === "connected").length;
    return { live, total: integrations.length };
  }, [integrations]);

  const canPersist = load.status === "ready" ? load.canPersist : true;

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <Reveal className="mb-5" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Automation layer
            </div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">
              Integrations
            </h1>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="flex items-center gap-1.5" role="group" aria-label="Integrations layout">
              {VIEWS.map((v) => {
                const Icon = v.icon;
                return (
                  <button
                    key={v.id}
                    type="button"
                    data-track="integrations_view"
                    data-track-view={v.id}
                    onClick={() => chooseView(v.id)}
                    aria-pressed={view === v.id}
                    title={`${v.label} view`}
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 font-mono text-[11px] uppercase tracking-[0.1em] transition-colors",
                      view === v.id
                        ? "border-primary/40 bg-primary/10 text-foreground"
                        : "border-border bg-background text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" aria-hidden />
                    {v.label}
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => fetchState()}
              data-track="integrations_refresh"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", load.status === "loading" && "animate-spin")} aria-hidden />
              Refresh
            </button>
          </div>
        </div>
      </Reveal>

      {/* n8n connection status */}
      <Reveal delay={0.04}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl bg-card px-4 py-3.5 ring-1 ring-foreground/10">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <Workflow className="h-[18px] w-[18px]" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-[13.5px] font-semibold text-foreground">n8n</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-transparent px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary">
                <SignalLed className="h-1.5 w-1.5" />
                {load.status === "ready" && load.mode === "demo" ? "Demo" : "Connected"}
              </span>
            </div>
            <div className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{N8N_BASE_URL}</div>
          </div>

          <div className="ml-auto flex items-center gap-5">
            <Stat label="Live" value={`${stats.live}/${stats.total}`} />
            <a
              href={N8N_BASE_URL}
              target="_blank"
              rel="noreferrer"
              data-track="n8n_manage"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              <span className="hidden sm:inline">Manage</span>
            </a>
          </div>
        </div>
      </Reveal>

      {load.status === "loading" && (
        <div className="mt-3 h-40 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
      )}

      {load.status === "error" && (
        <div className="mt-3 flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-card px-6 py-10 text-center ring-1 ring-foreground/10">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <p role="alert" className="max-w-sm font-mono text-[11px] leading-relaxed text-muted-foreground">
            {load.error}
          </p>
          <Button variant="outline" size="sm" onClick={() => fetchState()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {load.status === "ready" &&
        (view === "table" ? (
          <Reveal delay={0.08} className="mt-3">
            <IntegrationsTable
              integrations={integrations}
              notify={notify}
              canPersist={canPersist}
              onSaved={refetch}
            />
          </Reveal>
        ) : (
          <>
            <Reveal delay={0.08} className="mt-3">
              <NotifyEmailPanel notify={notify} canPersist={canPersist} />
            </Reveal>
            <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
              {integrations.map((integration, i) => (
                <Reveal key={integration.id} delay={0.12 + 0.04 * i} className="h-full">
                  <AutomationCard integration={integration} canPersist={canPersist} onSaved={refetch} />
                </Reveal>
              ))}
            </div>
          </>
        ))}

      <Footer />
    </div>
  );
}

/* ── table view (default) ────────────────────────────────────────────────────
   One row per configurable thing: the recipients the enquiry notification is
   emailed to, then each n8n webhook. Every row expands in place into its own
   editor, so the whole page is editable without leaving the list. */

function IntegrationsTable({
  integrations,
  notify,
  canPersist,
  onSaved,
}: {
  integrations: Integration[];
  notify: NotifyEmails;
  canPersist: boolean;
  onSaved: () => void;
}) {
  // One editor open at a time — a table full of open inputs stops reading as a
  // list, and nothing here needs to be edited in parallel.
  const [expanded, setExpanded] = useState<string | null>(null);
  const toggleRow = (id: string) => setExpanded((cur) => (cur === id ? null : id));

  return (
    <div className="min-w-0 overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="pl-3 text-[13.5px]">Setting</TableHead>
            <TableHead className="text-[13.5px]">Status</TableHead>
            <TableHead className="text-[13.5px]">Value</TableHead>
            <TableHead className="text-[13.5px]">Live</TableHead>
            <TableHead className="pr-3 text-right text-[13.5px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          <NotifyEmailRow
            notify={notify}
            canPersist={canPersist}
            open={expanded === NOTIFY_ROW_ID}
            onToggleOpen={() => toggleRow(NOTIFY_ROW_ID)}
          />
          {integrations.map((integration) => (
            <AutomationRow
              key={integration.id}
              integration={integration}
              canPersist={canPersist}
              open={expanded === integration.id}
              onToggleOpen={() => toggleRow(integration.id)}
              onSaved={onSaved}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** The row a `<tr>` expands into. Rendered as a full-width cell under the row
 *  it belongs to, tinted so the pair reads as one unit. */
function EditorRow({ id, children }: { id: string; children: React.ReactNode }) {
  const reduce = !!useReducedMotion();
  return (
    <TableRow className="bg-muted/30 hover:bg-muted/30">
      <TableCell colSpan={5} className="whitespace-normal px-3 py-3">
        <motion.div
          id={id}
          initial={reduce ? false : { opacity: 0, y: -4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduce ? 0 : 0.2, ease: SWAP_EASE }}
        >
          {children}
        </motion.div>
      </TableCell>
    </TableRow>
  );
}

/** Chevron that opens/closes a row's editor. */
function ExpandButton({
  open,
  onClick,
  label,
  controls,
  track,
  variant = "outline",
}: {
  open: boolean;
  onClick: () => void;
  label: string;
  controls: string;
  track: string;
  variant?: "outline" | "default";
}) {
  return (
    <Button
      size="sm"
      variant={variant}
      onClick={onClick}
      aria-expanded={open}
      aria-controls={controls}
      data-track={track}
      className="gap-1.5"
    >
      {label}
      <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", open && "rotate-180")} aria-hidden />
    </Button>
  );
}

/** The empty-cell convention (ui-standards §5.2). */
function Dash({ title }: { title?: string }) {
  return (
    <span className="text-muted-foreground/60" title={title}>
      —
    </span>
  );
}

function NotifyEmailRow({
  notify,
  canPersist,
  open,
  onToggleOpen,
}: {
  notify: NotifyEmails;
  canPersist: boolean;
  open: boolean;
  onToggleOpen: () => void;
}) {
  const editorId = `${NOTIFY_ROW_ID}-editor`;
  const shown = notify.emails.slice(0, 3);
  const extra = notify.emails.length - shown.length;

  return (
    <>
      <TableRow>
        <TableCell className="pl-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-accent text-primary ring-1 ring-primary/15">
              <Mail className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-foreground">Enquiry notification emails</div>
              <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                <span className="uppercase tracking-[0.1em]">Recipients</span>
                <span aria-hidden className="mx-1.5 text-border">·</span>
                <span>every portal enquiry</span>
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell>
          {notify.emails.length > 0 ? (
            <Pill
              label={`${notify.emails.length} of ${MAX_NOTIFY_EMAILS}`}
              className="border-primary/40 bg-transparent text-primary"
              dot="bg-primary"
            />
          ) : (
            <Pill label="Not set" className="border-border bg-muted text-muted-foreground" dot="bg-muted-foreground/50" />
          )}
        </TableCell>
        <TableCell className="whitespace-normal">
          {notify.emails.length > 0 ? (
            <div className="flex max-w-md flex-wrap items-center gap-1.5">
              {shown.map((addr) => (
                <span
                  key={addr}
                  className="inline-flex items-center rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground"
                >
                  {addr}
                </span>
              ))}
              {extra > 0 && (
                <span className="font-mono text-[10.5px] text-muted-foreground">+{extra} more</span>
              )}
            </div>
          ) : (
            <span className="text-[12px] text-muted-foreground">No notifications sent.</span>
          )}
        </TableCell>
        <TableCell>
          <Dash title="Delivery is controlled by the notification automations below." />
        </TableCell>
        <TableCell className="pr-3 text-right">
          <div className="inline-flex items-center gap-2">
            {notify.savedFlash && (
              <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-primary">
                <Check className="h-3.5 w-3.5" aria-hidden />
                Saved
              </span>
            )}
            <ExpandButton
              open={open}
              onClick={onToggleOpen}
              controls={editorId}
              track="notify_email_edit"
              variant={notify.emails.length > 0 ? "outline" : "default"}
              label={notify.emails.length > 0 ? "Edit recipients" : "Add recipients"}
            />
          </div>
        </TableCell>
      </TableRow>

      {open && (
        <EditorRow id={editorId}>
          <p className="mb-3 max-w-2xl text-xs leading-relaxed text-muted-foreground">
            Every portal enquiry — and every lead an admin sends to the Sales dashboard — is
            emailed to all of these addresses (via the notification automations below). Add up to{" "}
            {MAX_NOTIFY_EMAILS} — type one and press Enter, or paste a list. They arrive as one
            email, so each recipient can see the others. Leave blank to send no notifications.
          </p>
          <NotifyEmailEditor notify={notify} canPersist={canPersist} />
        </EditorRow>
      )}
    </>
  );
}

function AutomationRow({
  integration,
  canPersist,
  open,
  onToggleOpen,
  onSaved,
}: {
  integration: Integration;
  canPersist: boolean;
  open: boolean;
  onToggleOpen: () => void;
  onSaved: () => void;
}) {
  const config = useIntegrationConfig({ integration, onSaved });
  const trigger = TRIGGER[integration.trigger];
  const TriggerIcon = trigger.icon;
  const editorId = `${integration.id}-editor`;

  return (
    <>
      <TableRow>
        <TableCell className="pl-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
              <TriggerIcon className="h-4 w-4" aria-hidden />
            </span>
            <div className="min-w-0">
              <div className="text-[13.5px] font-semibold text-foreground">{integration.name}</div>
              <div className="mt-0.5 font-mono text-[10.5px] text-muted-foreground">
                <span className="uppercase tracking-[0.1em]">{trigger.label}</span>
                <span aria-hidden className="mx-1.5 text-border">·</span>
                <span>{integration.webhookPath}</span>
              </div>
            </div>
          </div>
        </TableCell>
        <TableCell>
          <StatusPill status={integration.status} />
        </TableCell>
        <TableCell>
          {integration.configured ? (
            <div className="min-w-0">
              <div className="truncate font-mono text-[11px] text-foreground">{integration.maskedUrl}</div>
              <div className="mt-0.5 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/70">
                {integration.source === "setting" ? "saved here" : "from environment"}
              </div>
            </div>
          ) : (
            <span className="text-[12px] text-muted-foreground">Not set — runs are simulated.</span>
          )}
        </TableCell>
        <TableCell>
          <Toggle
            on={integration.enabled}
            busy={config.busy}
            disabled={!integration.configured}
            onToggle={config.toggleEnabled}
            label={`${integration.enabled ? "Pause" : "Turn on"} ${integration.name}`}
          />
        </TableCell>
        <TableCell className="pr-3 text-right">
          <div className="inline-flex items-center gap-2">
            {config.savedFlash && (
              <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-primary">
                <Check className="h-3.5 w-3.5" aria-hidden />
                Saved
              </span>
            )}
            {integration.source === "setting" && (
              <Button
                size="sm"
                variant="outline"
                onClick={config.clear}
                disabled={config.busy}
                data-track="integration_webhook_clear"
                className="gap-1.5 text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Clear
              </Button>
            )}
            <ExpandButton
              open={open}
              onClick={() => {
                config.clearError();
                onToggleOpen();
              }}
              controls={editorId}
              track="integration_webhook_edit"
              variant={integration.configured ? "outline" : "default"}
              label={integration.configured ? "Update webhook" : "Add webhook"}
            />
          </div>
        </TableCell>
      </TableRow>

      {/* An error from Clear or the toggle has no editor to live in, so it gets
          its own row — otherwise a failed pause would be silent in table view. */}
      {!open && config.error && (
        <TableRow className="bg-muted/30 hover:bg-muted/30">
          <TableCell colSpan={5} className="whitespace-normal px-3 py-2">
            <p role="alert" className="flex items-center gap-1.5 font-mono text-[10.5px] text-destructive">
              <AlertTriangle className="h-3.5 w-3.5 shrink-0" aria-hidden />
              {config.error}
            </p>
          </TableCell>
        </TableRow>
      )}

      {open && (
        <EditorRow id={editorId}>
          <p className="mb-3 max-w-3xl text-xs leading-relaxed text-muted-foreground">
            {integration.description}
          </p>
          <WebhookEditor
            integration={integration}
            config={config}
            canPersist={canPersist}
            onDone={onToggleOpen}
          />
          {integration.configured && !integration.enabled && (
            <p className="mt-2.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
              Paused — the webhook is saved but turned off, so runs are simulated. Toggle on to send live.
            </p>
          )}
          <div className="mt-3 flex flex-wrap items-center gap-3 border-t border-border pt-3 font-mono text-[10.5px] text-muted-foreground">
            <a
              href={N8N_BASE_URL}
              target="_blank"
              rel="noreferrer"
              data-track="automation_open"
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <ExternalLink className="h-3.5 w-3.5" aria-hidden />
              Open in n8n
            </a>
            <span className="min-w-0 flex-1 truncate">
              Import <span className="text-foreground/80">references/{integration.workflowFile}</span>
            </span>
          </div>
        </EditorRow>
      )}
    </>
  );
}

/* ── shared editors ──────────────────────────────────────────────────────────
   Rendered inside a card (cards view) or inside an expanded row (table view).
   Identical markup either way, so the two layouts can't diverge. */

function NotifyEmailEditor({ notify, canPersist }: { notify: NotifyEmails; canPersist: boolean }) {
  return (
    <>
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="email"
          inputMode="email"
          autoComplete="email"
          value={notify.draft}
          onChange={(e) => notify.edit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              notify.tryCommit(notify.draft);
            }
          }}
          placeholder={
            notify.atCap
              ? `${MAX_NOTIFY_EMAILS} of ${MAX_NOTIFY_EMAILS} — remove one to add another.`
              : "you@company.com.au"
          }
          disabled={notify.busy || !canPersist || notify.atCap}
          data-track="notify_email_input"
          className="h-9 w-full flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
        />
        <Button
          size="sm"
          variant="outline"
          onClick={() => notify.tryCommit(notify.draft)}
          disabled={notify.busy || !canPersist || notify.atCap || !notify.draft.trim()}
          data-track="notify_email_add"
        >
          Add
        </Button>
        <Button
          size="sm"
          onClick={notify.save}
          disabled={notify.busy || !canPersist || !notify.dirty || !notify.validish}
          data-track="notify_email_save"
          className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
        >
          {notify.savedFlash ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
          {notify.savedFlash ? "Saved" : notify.busy ? "Saving…" : "Save"}
        </Button>
      </div>
      {/* Parsed recipients — the chips ARE the committed list, so this is
          exactly who Save will persist (plus whatever's in the add field,
          covered by the dirty/validish check above). */}
      {notify.emails.length > 0 && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {notify.emails.map((addr) => (
            <span
              key={addr}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground"
            >
              {addr}
              <button
                type="button"
                onClick={() => notify.remove(addr)}
                aria-label={`Remove ${addr}`}
                disabled={notify.busy || !canPersist}
                className="text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-3 w-3" aria-hidden />
              </button>
            </span>
          ))}
          <span className="tnum ml-0.5 font-mono text-[10px] text-muted-foreground">
            {notify.emails.length} of {MAX_NOTIFY_EMAILS}
          </span>
        </div>
      )}
      {!canPersist && (
        <p className="mt-2 text-[11px] text-amber-500">Connect Supabase to save this here.</p>
      )}
      {notify.addError && <p className="mt-2 text-[11px] text-primary">{notify.addError}</p>}
      {notify.error && (
        <p role="alert" className="mt-2 flex items-center gap-1 text-[11px] text-destructive">
          <AlertTriangle className="h-3 w-3" aria-hidden /> {notify.error}
        </p>
      )}
    </>
  );
}

function WebhookEditor({
  integration,
  config,
  canPersist,
  onDone,
}: {
  integration: Integration;
  config: IntegrationConfig;
  canPersist: boolean;
  onDone: () => void;
}) {
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const placeholder = `${N8N_BASE_URL}${integration.webhookPath}`;

  return (
    <div className="flex flex-col gap-2">
      <label className="flex flex-col gap-1.5">
        <span className="text-[12px] font-medium text-foreground">Paste the n8n Production webhook URL</span>
        <div className="relative max-w-xl">
          <input
            type={reveal ? "text" : "password"}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            placeholder={placeholder}
            spellCheck={false}
            autoComplete="off"
            data-track="integration_webhook_input"
            className="h-8 w-full rounded-lg border border-border bg-background pl-2.5 pr-8 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
          <button
            type="button"
            onClick={() => setReveal((r) => !r)}
            aria-label={reveal ? "Hide URL" : "Show URL"}
            className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
          >
            {reveal ? <EyeOff className="h-3.5 w-3.5" aria-hidden /> : <Eye className="h-3.5 w-3.5" aria-hidden />}
          </button>
        </div>
      </label>
      {!canPersist && (
        <p className="font-mono text-[10px] leading-relaxed text-muted-foreground">
          Supabase isn&apos;t connected, so this can&apos;t be saved here yet — set{" "}
          <span className="text-foreground/80">{integration.envVar}</span> in the environment instead.
        </p>
      )}
      {config.error && (
        <p role="alert" className="font-mono text-[10px] leading-relaxed text-destructive">
          {config.error}
        </p>
      )}
      <div className="flex items-center gap-2">
        <Button
          size="sm"
          onClick={async () => {
            if (await config.save(value)) {
              setValue("");
              onDone();
            }
          }}
          disabled={config.busy || value.trim().length === 0}
          data-track="integration_webhook_save"
          className="gap-1.5"
        >
          <Check className="h-3.5 w-3.5" aria-hidden />
          Save webhook
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            setValue("");
            config.clearError();
            onDone();
          }}
          disabled={config.busy}
        >
          Cancel
        </Button>
      </div>
    </div>
  );
}

/* ── cards view ──────────────────────────────────────────────────────────── */

/** The recipients setting as a standalone panel above the automation cards.
 *  Same state and same editor as the table's recipients row — see
 *  useNotifyEmails for what the setting is and how it's stored. */
function NotifyEmailPanel({ notify, canPersist }: { notify: NotifyEmails; canPersist: boolean }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="flex items-start gap-3">
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent text-primary ring-1 ring-primary/15">
          <Mail className="h-4 w-4" aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h3 className="font-heading text-sm font-semibold text-foreground">
            Enquiry notification emails
          </h3>
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
            Every portal enquiry — and every lead an admin sends to the Sales dashboard — is
            emailed to all of these addresses (via the notification automations below). Add up to{" "}
            {MAX_NOTIFY_EMAILS} — type one and press Enter, or paste a list. They arrive as one
            email, so each recipient can see the others. Leave blank to send no notifications.
          </p>
          <div className="mt-3">
            <NotifyEmailEditor notify={notify} canPersist={canPersist} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AutomationCard({
  integration,
  canPersist,
  onSaved,
}: {
  integration: Integration;
  canPersist: boolean;
  onSaved: () => void;
}) {
  const config = useIntegrationConfig({ integration, onSaved });
  const trigger = TRIGGER[integration.trigger];
  const TriggerIcon = trigger.icon;
  const [editing, setEditing] = useState(false);

  return (
    <div className="flex h-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/20">
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-start gap-2.5">
          <div className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
            <TriggerIcon className="h-4 w-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <h3 className="truncate text-[13.5px] font-semibold text-foreground">{integration.name}</h3>
            <div className="mt-0.5 flex items-center gap-1.5 font-mono text-[10.5px] text-muted-foreground">
              <span className="uppercase tracking-[0.1em]">{trigger.label}</span>
              <span aria-hidden className="text-border">·</span>
              <span className="truncate">{integration.webhookPath}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2.5">
          <StatusPill status={integration.status} />
          <Toggle
            on={integration.enabled}
            busy={config.busy}
            disabled={!integration.configured}
            onToggle={config.toggleEnabled}
            label={`${integration.enabled ? "Pause" : "Turn on"} ${integration.name}`}
          />
        </div>
      </div>

      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{integration.description}</p>

      {/* live wiring state */}
      <div className="mt-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Webhook URL
          </span>
          {integration.configured && (
            <span className="font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/70">
              {integration.source === "setting" ? "saved here" : "from environment"}
            </span>
          )}
        </div>
        <div className="mt-1 font-mono text-[11px] text-foreground">
          {integration.configured ? (
            integration.maskedUrl
          ) : (
            <span className="text-muted-foreground">
              Not set — runs are simulated (demo mode) until a webhook is configured.
            </span>
          )}
        </div>
        {integration.configured && !integration.enabled && (
          <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
            Paused — the webhook is saved but turned off, so runs are simulated. Toggle on to send live.
          </p>
        )}
      </div>

      {/* edit / add webhook */}
      {editing ? (
        <div className="mt-3">
          <WebhookEditor
            integration={integration}
            config={config}
            canPersist={canPersist}
            onDone={() => setEditing(false)}
          />
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={integration.configured ? "outline" : "default"}
            onClick={() => {
              setEditing(true);
              config.clearError();
            }}
            data-track="integration_webhook_edit"
            className="gap-1.5"
          >
            <Webhook className="h-3.5 w-3.5" aria-hidden />
            {integration.configured ? "Update webhook" : "Add webhook"}
          </Button>
          {integration.source === "setting" && (
            <Button
              size="sm"
              variant="outline"
              onClick={config.clear}
              disabled={config.busy}
              data-track="integration_webhook_clear"
              className="gap-1.5 text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Clear
            </Button>
          )}
          {config.savedFlash && (
            <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-primary">
              <Check className="h-3.5 w-3.5" aria-hidden />
              Saved
            </span>
          )}
          {/* Clear and the toggle post without an open editor, so their errors
              need somewhere to land. */}
          {config.error && (
            <p role="alert" className="w-full font-mono text-[10px] leading-relaxed text-destructive">
              {config.error}
            </p>
          )}
        </div>
      )}

      <div className="mt-3 flex items-center gap-3 border-t border-border pt-3 font-mono text-[10.5px] text-muted-foreground">
        <a
          href={N8N_BASE_URL}
          target="_blank"
          rel="noreferrer"
          data-track="automation_open"
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <ExternalLink className="h-3.5 w-3.5" aria-hidden />
          Open in n8n
        </a>
        <span className="min-w-0 flex-1 truncate">
          Import <span className="text-foreground/80">references/{integration.workflowFile}</span>
        </span>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-right">
      <div className="tnum font-mono text-sm font-semibold text-foreground">{value}</div>
      <div className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div>
    </div>
  );
}
