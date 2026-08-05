"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  Clock,
  ExternalLink,
  Eye,
  EyeOff,
  Mail,
  RefreshCw,
  Trash2,
  Webhook,
  Workflow,
  X,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/cn";
import {
  MAX_NOTIFY_EMAILS,
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

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; mode: string; canPersist: boolean; states: IntegrationState[]; notifyEmail: string };

function StatusPill({ status }: { status: AutomationStatus }) {
  const s = STATUS[status];
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em]",
        s.className,
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} aria-hidden />
      {s.label}
    </span>
  );
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

  // realtime: load on mount, poll, and refetch when the tab regains focus
  useEffect(() => {
    fetchState();
    const id = setInterval(() => fetchState({ quiet: true }), POLL_MS);
    const onFocus = () => fetchState({ quiet: true });
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchState]);

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

      {load.status === "ready" && (
        <>
          <Reveal delay={0.08} className="mt-3">
            <NotifyEmailPanel
              initial={load.notifyEmail}
              canPersist={canPersist}
              onSaved={() => fetchState({ quiet: true })}
            />
          </Reveal>
          <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
            {integrations.map((integration, i) => (
              <Reveal key={integration.id} delay={0.12 + 0.04 * i} className="h-full">
                <AutomationCard
                  integration={integration}
                  canPersist={canPersist}
                  onSaved={() => fetchState({ quiet: true })}
                />
              </Reveal>
            ))}
          </div>
        </>
      )}

      <Footer />
    </div>
  );
}

/** Where portal enquiries are emailed to. One global setting (app_settings key
 *  `enquiry_notify_email`) holding one address or a comma-separated list —
 *  EVERY listed address is notified, via a single Gmail send addressed to all of
 *  them. Consumed by the enquiry route + the Enquiry Notification n8n workflow.
 *  Blank clears it (no notifications sent). Parsing lives in
 *  lib/pipeline/notifyEmails.ts, shared with the API route so the validation
 *  shown here is exactly the validation enforced on save. */
function NotifyEmailPanel({
  initial,
  canPersist,
  onSaved,
}: {
  initial: string;
  canPersist: boolean;
  onSaved: () => void;
}) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initialRef = useRef(initial);

  // Re-seed from a poll ONLY while the field still shows the last known saved
  // value. The page polls every 15s, and clobbering a part-typed list of
  // addresses is real data loss (one short address was survivable).
  useEffect(() => {
    const prev = initialRef.current;
    initialRef.current = initial;
    if (prev === initial) return;
    setValue((cur) => (cur.trim() === prev.trim() ? initial : cur));
  }, [initial]);
  useEffect(() => () => {
    if (flashRef.current) clearTimeout(flashRef.current);
  }, []);

  const parsed = useMemo(() => parseNotifyEmails(value), [value]);
  // Compare canonical-to-canonical: saving normalises ("A@b.com ,c@d.com" →
  // "a@b.com, c@d.com"), so a raw comparison would leave the field permanently
  // dirty after every save.
  const initialCanonical = useMemo(() => {
    const p = parseNotifyEmails(initial);
    return p.ok ? p.value : initial.trim();
  }, [initial]);
  const canonical = parsed.ok ? parsed.value : null;
  const emails = parsed.ok ? parsed.emails : [];
  const dirty = canonical !== null && canonical !== initialCanonical;
  const validish = parsed.ok;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Canonical form — Save is gated on `validish`, so this is non-null
        // whenever save() can fire; the fallback is defensive only.
        body: JSON.stringify({ notifyEmail: canonical ?? value }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Save failed (${res.status}).`);
        return;
      }
      // Settle the field on what was actually stored, so the text matches the
      // recipient chips instead of keeping the pre-normalised typing.
      if (canonical !== null) setValue(canonical);
      setSavedFlash(true);
      if (flashRef.current) clearTimeout(flashRef.current);
      flashRef.current = setTimeout(() => setSavedFlash(false), 1800);
      onSaved();
    } catch {
      setError("Network error — couldn't save.");
    } finally {
      setBusy(false);
    }
  }

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
            Every portal enquiry is emailed to all of these addresses (via the Enquiry Notification
            automation below). Separate them with commas — up to {MAX_NOTIFY_EMAILS}. They arrive as
            one email, so each recipient can see the others. Leave blank to send no notifications.
          </p>
          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center">
            <input
              type="email"
              multiple
              inputMode="email"
              autoComplete="email"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              placeholder="you@company.com.au, ops@company.com.au"
              disabled={busy || !canPersist}
              data-track="notify_email_input"
              className="h-9 w-full flex-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground/70 focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-60"
            />
            <Button
              size="sm"
              onClick={save}
              disabled={busy || !canPersist || !dirty || !validish}
              data-track="notify_email_save"
              className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
            >
              {savedFlash ? <Check className="h-3.5 w-3.5" aria-hidden /> : null}
              {savedFlash ? "Saved" : busy ? "Saving…" : "Save"}
            </Button>
          </div>
          {/* Parsed recipients — shows exactly who gets notified, since a long
              comma list scrolls out of sight inside the input. */}
          {emails.length > 0 && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
              {emails.map((addr) => (
                <span
                  key={addr}
                  className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground"
                >
                  {addr}
                  <button
                    type="button"
                    onClick={() => setValue(serializeNotifyEmails(emails.filter((a) => a !== addr)))}
                    aria-label={`Remove ${addr}`}
                    disabled={busy || !canPersist}
                    className="text-muted-foreground transition-colors hover:text-destructive disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <X className="h-3 w-3" aria-hidden />
                  </button>
                </span>
              ))}
              <span className="tnum ml-0.5 font-mono text-[10px] text-muted-foreground">
                {emails.length} of {MAX_NOTIFY_EMAILS}
              </span>
            </div>
          )}
          {!canPersist && (
            <p className="mt-2 text-[11px] text-amber-500">
              Connect Supabase to save this here.
            </p>
          )}
          {!parsed.ok && <p className="mt-2 text-[11px] text-primary">{parsed.error}</p>}
          {error && (
            <p className="mt-2 flex items-center gap-1 text-[11px] text-destructive">
              <AlertTriangle className="h-3 w-3" aria-hidden /> {error}
            </p>
          )}
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
  const trigger = TRIGGER[integration.trigger];
  const TriggerIcon = trigger.icon;

  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [reveal, setReveal] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [savedFlash, setSavedFlash] = useState(false);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (flashRef.current) clearTimeout(flashRef.current);
  }, []);

  const webhookUrl = `${N8N_BASE_URL}${integration.webhookPath}`;

  async function save() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: integration.id, url: value.trim() }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Save failed (${res.status}).`);
        return;
      }
      setEditing(false);
      setValue("");
      setSavedFlash(true);
      if (flashRef.current) clearTimeout(flashRef.current);
      flashRef.current = setTimeout(() => setSavedFlash(false), 1800);
      onSaved();
    } catch {
      setError("Network error saving the webhook.");
    } finally {
      setBusy(false);
    }
  }

  async function clear() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: integration.id, url: "" }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Clear failed (${res.status}).`);
        return;
      }
      setEditing(false);
      setValue("");
      onSaved();
    } catch {
      setError("Network error clearing the webhook.");
    } finally {
      setBusy(false);
    }
  }

  // On/off — only writes the toggle, so the saved webhook URL is retained.
  async function toggleEnabled() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/integrations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: integration.id, enabled: !integration.enabled }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Toggle failed (${res.status}).`);
        return;
      }
      onSaved();
    } catch {
      setError("Network error updating the toggle.");
    } finally {
      setBusy(false);
    }
  }

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
            busy={busy}
            disabled={!integration.configured}
            onToggle={toggleEnabled}
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
        <div className="mt-3 flex flex-col gap-2">
          <label className="flex flex-col gap-1.5">
            <span className="text-[12px] font-medium text-foreground">Paste the n8n Production webhook URL</span>
            <div className="relative">
              <input
                type={reveal ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder={webhookUrl}
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
          {error && (
            <p role="alert" className="font-mono text-[10px] leading-relaxed text-destructive">
              {error}
            </p>
          )}
          <div className="flex items-center gap-2">
            <Button
              size="sm"
              onClick={save}
              disabled={busy || value.trim().length === 0}
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
                setEditing(false);
                setValue("");
                setError(null);
              }}
              disabled={busy}
            >
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={integration.configured ? "outline" : "default"}
            onClick={() => {
              setEditing(true);
              setError(null);
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
              onClick={clear}
              disabled={busy}
              data-track="integration_webhook_clear"
              className="gap-1.5 text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Clear
            </Button>
          )}
          {savedFlash && (
            <span className="inline-flex items-center gap-1 font-mono text-[10.5px] text-primary">
              <Check className="h-3.5 w-3.5" aria-hidden />
              Saved
            </span>
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
