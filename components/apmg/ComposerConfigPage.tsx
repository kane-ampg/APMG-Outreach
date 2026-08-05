"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  Braces,
  BookOpen,
  Check,
  ChevronDown,
  Cpu,
  Link2,
  Loader2,
  MessageSquare,
  RotateCcw,
  Save,
  Sparkles,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { renderLeadPrompt } from "@/lib/ai/composePrompt";
import { Button } from "@/components/ui/button";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";

/**
 * Email Composer (config) — edit the exact prompt Claude is given when
 * "Compose email" drafts a per-lead outreach email (Pipeline → Send campaigns),
 * and save it to Supabase so it sticks. Reads/writes /api/compose-prompt, which
 * persists the overwriteable public.compose_prompt singleton
 * (supabase/compose-prompt.sql). A saved config overrides the in-code defaults;
 * the compose flow reads the same config to draft each email.
 *
 * The per-sector KNOWLEDGE BASE that grounds each draft is NOT edited here — it
 * lives on the Sector Playbooks tab.
 */

// A representative lead so the per-lead message preview shows real shape.
const SAMPLE_LEAD = {
  business: "Sunhaven Aged Care",
  category: "Aged Care",
  website: "https://sunhavenagedcare.com.au",
};

interface ConfigShape {
  model: string;
  instructions: string;
  leadPromptTemplate: string;
  outputSchema: Record<string, unknown>;
  updatedAt: string | null;
  source: "db" | "default";
}
interface ApiState {
  mode: "live" | "demo";
  canPersist: boolean;
  config: ConfigShape;
  defaults: ConfigShape;
  allowedModels: string[];
}
type Load =
  | { status: "loading" }
  | { status: "error"; error: string; needsMigration?: boolean }
  | ({ status: "ready" } & ApiState);

// The editable form fields (output schema is edited as text, validated on save).
interface Form {
  model: string;
  instructions: string;
  leadPromptTemplate: string;
  schemaText: string;
}

function toForm(c: ConfigShape): Form {
  return {
    model: c.model,
    instructions: c.instructions,
    leadPromptTemplate: c.leadPromptTemplate,
    schemaText: JSON.stringify(c.outputSchema, null, 2),
  };
}

export function ComposerConfigPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [form, setForm] = useState<Form | null>(null);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<string | null>(null);
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchState = useCallback(async () => {
    setLoad({ status: "loading" });
    try {
      const res = await fetch("/api/compose-prompt", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | (Partial<ApiState> & { ok?: boolean; error?: string; needsMigration?: boolean })
        | null;
      if (!mountedRef.current) return;
      if (!res.ok || !data?.ok || !data.config) {
        setLoad({ status: "error", error: data?.error ?? `Couldn't load the composer config (${res.status}).` });
        return;
      }
      const next: ApiState = {
        mode: data.mode ?? "demo",
        canPersist: !!data.canPersist,
        config: data.config,
        defaults: data.defaults!,
        allowedModels: data.allowedModels ?? [data.config.model],
      };
      setLoad({ status: "ready", ...next });
      setForm(toForm(next.config));
      setSavedAt(next.config.updatedAt);
    } catch {
      if (mountedRef.current) setLoad({ status: "error", error: "Network error loading the composer config." });
    }
  }, []);

  useEffect(() => {
    fetchState();
  }, [fetchState]);

  // client-side schema validity (surfaced inline; the route re-validates)
  const schemaError = useMemo(() => {
    if (!form) return null;
    try {
      const parsed = JSON.parse(form.schemaText) as unknown;
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return "Must be a JSON object.";
      return null;
    } catch {
      return "Invalid JSON.";
    }
  }, [form]);

  const dirty = useMemo(() => {
    if (load.status !== "ready" || !form) return false;
    const base = toForm(load.config);
    return (
      base.model !== form.model ||
      base.instructions !== form.instructions ||
      base.leadPromptTemplate !== form.leadPromptTemplate ||
      base.schemaText.trim() !== form.schemaText.trim()
    );
  }, [load, form]);

  const invalid =
    !form ||
    !form.instructions.trim() ||
    !form.leadPromptTemplate.trim() ||
    !form.leadPromptTemplate.includes("{{business}}") ||
    !!schemaError;

  const patch = (p: Partial<Form>) => setForm((f) => (f ? { ...f, ...p } : f));

  const save = useCallback(async () => {
    if (!form || invalid || saving || load.status !== "ready") return;
    setSaving(true);
    setSaveError(null);
    try {
      const res = await fetch("/api/compose-prompt", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: form.model,
          instructions: form.instructions,
          leadPromptTemplate: form.leadPromptTemplate,
          outputSchema: form.schemaText, // route parses the JSON string
        }),
      });
      const data = (await res.json().catch(() => null)) as
        | (Partial<ApiState> & { ok?: boolean; error?: string; needsMigration?: boolean })
        | null;
      if (!mountedRef.current) return;
      if (!res.ok || !data?.ok || !data.config) {
        setSaveError(
          data?.needsMigration
            ? `${data.error} (see supabase/compose-prompt.sql)`
            : data?.error ?? `Save failed (${res.status}).`,
        );
        return;
      }
      // reseat the baseline to what was persisted so `dirty` clears (the PUT
      // success body is the full state(), so defaults/allowedModels are present)
      const next: ApiState = {
        mode: data.mode ?? "live",
        canPersist: !!data.canPersist,
        config: data.config,
        defaults: data.defaults ?? load.defaults,
        allowedModels: data.allowedModels ?? load.allowedModels,
      };
      setLoad({ status: "ready", ...next });
      setForm(toForm(next.config));
      setSavedAt(next.config.updatedAt);
    } catch {
      if (mountedRef.current) setSaveError("Network error saving the prompt.");
    } finally {
      if (mountedRef.current) setSaving(false);
    }
  }, [form, invalid, saving, load]);

  if (load.status === "loading") {
    return (
      <Shell>
        <div className="flex items-center gap-2 rounded-xl bg-card p-5 font-mono text-[11px] text-muted-foreground ring-1 ring-foreground/10">
          <Loader2 className="h-4 w-4 animate-spin text-primary" aria-hidden />
          Loading composer config…
        </div>
      </Shell>
    );
  }
  if (load.status === "error") {
    return (
      <Shell>
        <div className="flex flex-col items-start gap-3 rounded-xl bg-card p-5 ring-1 ring-foreground/10">
          <p role="alert" className="font-mono text-[11px] leading-relaxed text-destructive">
            {load.error}
          </p>
          <Button size="sm" onClick={fetchState} className="gap-1.5">
            <RotateCcw className="h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      </Shell>
    );
  }

  const { mode, canPersist, defaults, allowedModels } = load;
  const models = [...new Set([form!.model, ...allowedModels])];
  const samplePreview = renderLeadPrompt(form!.leadPromptTemplate, SAMPLE_LEAD);
  const savedLabel =
    savedAt && load.config.source === "db"
      ? `saved ${new Date(savedAt).toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" })}`
      : "in-code defaults · not yet saved";

  return (
    <Shell>
      {/* header + save bar */}
      <Reveal className="mb-4" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-3">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Automation
            </div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">
              Email Composer
            </h1>
            <p className="mt-1.5 max-w-2xl text-[13px] leading-relaxed text-muted-foreground">
              Edit the exact prompt Claude is given when{" "}
              <span className="text-foreground">Pipeline → Send campaigns → Compose email</span>{" "}
              drafts a per-lead outreach email. Saved changes stick in Supabase and take effect on the next draft.
            </p>
          </div>
          <div className="flex flex-col items-end gap-1.5">
            <div className="flex items-center gap-2">
              {dirty && (
                <Button
                  variant="outline"
                  size="sm"
                  data-track="composer_reset"
                  onClick={() => setForm(toForm(load.config))}
                  disabled={saving}
                  className="gap-1.5"
                >
                  <RotateCcw className="h-3.5 w-3.5" aria-hidden />
                  Discard
                </Button>
              )}
              <Button
                size="sm"
                data-track="composer_save"
                onClick={save}
                disabled={!dirty || invalid || saving || !canPersist}
                className="gap-1.5"
              >
                {saving ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" aria-hidden />
                ) : (
                  <Save className="h-3.5 w-3.5" aria-hidden />
                )}
                {saving ? "Saving…" : dirty ? "Save changes" : "Saved"}
              </Button>
            </div>
            <span
              className={cn(
                "font-mono text-[10px]",
                mode === "demo" ? "text-amber-500" : "text-muted-foreground",
              )}
            >
              {mode === "demo" ? "demo mode · connect Supabase to save" : savedLabel}
            </span>
          </div>
        </div>
      </Reveal>

      {saveError && (
        <Reveal className="mb-3">
          <div className="flex items-start gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-destructive" aria-hidden />
            <p role="alert" className="font-mono text-[10.5px] leading-relaxed text-destructive">
              {saveError}
            </p>
          </div>
        </Reveal>
      )}
      {mode === "demo" && (
        <Reveal className="mb-3">
          <div className="flex items-start gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 px-3 py-2">
            <AlertTriangle className="mt-px h-3.5 w-3.5 shrink-0 text-amber-500" aria-hidden />
            <p className="font-mono text-[10.5px] leading-relaxed text-amber-600 dark:text-amber-400">
              Supabase isn&rsquo;t configured, so edits can&rsquo;t be saved. Set SUPABASE_URL +
              SUPABASE_SERVICE_ROLE_KEY and run supabase/compose-prompt.sql, then reload.
            </p>
          </div>
        </Reveal>
      )}

      <div className="flex flex-col gap-4">
        {/* model */}
        <Reveal delay={0.04}>
          <SectionCard icon={Cpu} title="Claude engine model" hint="structured-output models only">
            {/* the app's own caret behind the control (matches the leads +
                telemetry filters); native arrows differ per platform */}
            <div className="relative w-full max-w-sm">
              <select
                value={form!.model}
                onChange={(e) => patch({ model: e.target.value })}
                data-track="composer_model"
                aria-label="Claude model"
                className="h-9 w-full min-w-0 cursor-pointer appearance-none truncate rounded-lg border border-border bg-background pl-2.5 pr-8 font-mono text-[12px] text-foreground transition-colors duration-200 hover:border-primary/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {models.map((m) => (
                  <option key={m} value={m}>
                    {m}
                    {m === defaults.model ? "  (default)" : ""}
                  </option>
                ))}
              </select>
              <ChevronDown
                className="pointer-events-none absolute right-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
            </div>
            <p className="mt-2.5 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
              Only structured-output models are offered (a bad value would 404 every draft). The
              COMPOSE_MODEL env var is the fallback when nothing is saved. max_tokens 1500 · 60s
              timeout · falls back to a deterministic template on any miss.
            </p>
          </SectionCard>
        </Reveal>

        {/* instructions */}
        <Reveal delay={0.08}>
          <SectionCard
            icon={MessageSquare}
            title="System prompt — instructions"
            hint="the job, hard rules, output shape"
            action={<CharCount n={form!.instructions.length} max={20_000} />}
          >
            <textarea
              value={form!.instructions}
              onChange={(e) => patch({ instructions: e.target.value })}
              data-track="composer_instructions"
              rows={18}
              spellCheck={false}
              aria-label="Instructions"
              className="w-full resize-y rounded-lg border border-border bg-background/50 p-3.5 font-mono text-[11.5px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {!form!.instructions.trim() && <FieldError>Instructions can&rsquo;t be empty.</FieldError>}
          </SectionCard>
        </Reveal>

        {/* KB grounding note (read-only) */}
        <Reveal delay={0.1}>
          <SectionCard
            icon={BookOpen}
            title="System prompt — knowledge base"
            hint="appended per sector · edit on Sector Playbooks"
          >
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              A second system block is appended below your instructions at draft time —{" "}
              <span className="font-mono text-[12px] text-foreground/80">
                APMG KNOWLEDGE BASE — the only facts you may use:
              </span>{" "}
              plus the general company file and the lead&rsquo;s sector markdown (cached per sector).
              That content is edited on the <span className="text-foreground">Sector Playbooks</span>{" "}
              tab, not here.
            </p>
          </SectionCard>
        </Reveal>

        {/* per-lead message */}
        <Reveal delay={0.12}>
          <SectionCard
            icon={Sparkles}
            title="Per-lead message"
            hint="tokens: {{business}} · {{category}} · {{website}}"
            action={<CharCount n={form!.leadPromptTemplate.length} max={4_000} />}
          >
            <textarea
              value={form!.leadPromptTemplate}
              onChange={(e) => patch({ leadPromptTemplate: e.target.value })}
              data-track="composer_lead_template"
              rows={5}
              spellCheck={false}
              aria-label="Per-lead message template"
              className="w-full resize-y rounded-lg border border-border bg-background/50 p-3.5 font-mono text-[11.5px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            {!form!.leadPromptTemplate.includes("{{business}}") && (
              <FieldError>Must include the {"{{business}}"} token.</FieldError>
            )}
            <div className="mt-3">
              <div className="mb-1.5 font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                Preview · {SAMPLE_LEAD.business}
              </div>
              <pre className="overflow-auto whitespace-pre-wrap break-words rounded-lg border border-border bg-background/40 p-3 font-mono text-[11px] leading-relaxed text-foreground/90">
                {samplePreview || "(empty)"}
              </pre>
              <p className="mt-1.5 font-mono text-[10px] leading-relaxed text-muted-foreground">
                A line whose only token is empty (e.g. a lead with no website) is dropped
                automatically.
              </p>
            </div>
          </SectionCard>
        </Reveal>

        {/* output schema */}
        <Reveal delay={0.14}>
          <SectionCard icon={Braces} title="Output schema" hint="output_config.format · json_schema">
            <textarea
              value={form!.schemaText}
              onChange={(e) => patch({ schemaText: e.target.value })}
              data-track="composer_schema"
              rows={12}
              spellCheck={false}
              aria-label="Output JSON schema"
              className={cn(
                "w-full resize-y rounded-lg border bg-background/50 p-3.5 font-mono text-[11.5px] leading-relaxed text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                schemaError ? "border-destructive/50" : "border-border",
              )}
            />
            {schemaError ? (
              <FieldError>{schemaError}</FieldError>
            ) : (
              <p className="mt-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                Structured output forces the response to match this object — the composer expects{" "}
                <span className="text-foreground/80">subject</span> and{" "}
                <span className="text-foreground/80">html</span> string fields.
              </p>
            )}
          </SectionCard>
        </Reveal>

        {/* CTA rule (read-only) */}
        <Reveal delay={0.16}>
          <SectionCard icon={Link2} title="The tracked call-to-action">
            <p className="text-[13px] leading-relaxed text-muted-foreground">
              The body must contain one anchor whose href is the literal token{" "}
              <span className="font-mono text-[12px] text-primary">{"{{link}}"}</span>. Any real URL
              the model writes is rewritten back to that token, and the send route substitutes a
              per-recipient tracked link{" "}
              <span className="font-mono text-[12px] text-foreground/80">/t/&lt;lead&gt;?c=&lt;campaign&gt;</span>{" "}
              — a click marks the lead engaged and surfaces it in Sales.
            </p>
          </SectionCard>
        </Reveal>
      </div>

      <Footer />
    </Shell>
  );
}

/* ─────────────────────────────  building blocks  ───────────────────────────── */

function Shell({ children }: { children: ReactNode }) {
  return <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">{children}</div>;
}

function SectionCard({
  icon: Icon,
  title,
  hint,
  action,
  children,
}: {
  icon: typeof Cpu;
  title: string;
  hint?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <span className="flex h-7 w-7 items-center justify-center rounded-lg border border-border bg-background text-primary">
            <Icon className="h-4 w-4" aria-hidden />
          </span>
          <div>
            <div className="text-[13.5px] font-semibold text-foreground">{title}</div>
            {hint && (
              <div className="font-mono text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                {hint}
              </div>
            )}
          </div>
        </div>
        {action}
      </div>
      {children}
    </div>
  );
}

function CharCount({ n, max }: { n: number; max: number }) {
  return (
    <span className={cn("tnum font-mono text-[10px]", n > max ? "text-destructive" : "text-muted-foreground")}>
      {n.toLocaleString("en-US")} / {max.toLocaleString("en-US")}
    </span>
  );
}

function FieldError({ children }: { children: ReactNode }) {
  return (
    <p role="alert" className="mt-2 font-mono text-[10.5px] text-destructive">
      {children}
    </p>
  );
}
