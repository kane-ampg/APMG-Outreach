"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  Check,
  Copy,
  Eye,
  FileDown,
  Inbox,
  LayoutGrid,
  Mail,
  MessageCircle,
  Phone,
  RefreshCw,
  Send,
  Sparkles,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { adminHeaders } from "@/lib/portal/adminKey";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { serviceLabel, sourceLabel, type PortalInquiry } from "@/lib/data/enquiries";
import { isHiddenEvent, serviceName, type LeadActivity } from "@/lib/data/leadActivity";
import { leadScore, scoreTier } from "@/lib/data/leadScore";
import {
  buildEngagementFacts,
  fallbackSummary,
  humanDuration,
  talkingPoints,
} from "@/lib/data/enquiryActivity";
import { Button } from "@/components/ui/button";
import { TimelineLine, fmtStamp } from "./LeadTrail";

/**
 * Enquiries → "View": everything one enquirer did before they enquired.
 *
 * The rep about to ring an inbound enquiry has two questions — how warm is
 * this, and what do I open with — and the answers are already in the portal
 * telemetry. This modal puts them in one place, hottest signal first:
 *
 *   1 · Engagement    — the countable tallies (email clicks, info-pack
 *                       downloads, portal visits, service cards, chat
 *                       questions), plus the intent score the Telemetry and Hot
 *                       Leads tabs show, so the same lead reads the same
 *                       everywhere.
 *   2 · AI summary    — on demand (the button top-right of that panel): a short
 *                       brief written from those same facts by Claude, via
 *                       /api/portal/lead-summary. Never auto-runs — it's a
 *                       spend surface, and the panels around it already answer
 *                       the question without it.
 *   3 · Talking points— the fact-only bullets (lib/data/enquiryActivity) the
 *                       summary is built from, so nothing on screen is a claim
 *                       the rep can't check against the trail below.
 *   4 · Their enquiry — service, contact details, and the message verbatim.
 *   5 · Full trail    — the chronological timeline, same grammar as Telemetry.
 *
 * A direct or social enquirer has no tracked trail (no attribution cookie), and
 * that's a normal state, not an error: the panels say so plainly and the enquiry
 * itself carries the modal.
 *
 * Follows ui-standards §10 (icon + description + explicit close), traps focus
 * and restores it on close, same as CloseDealModal / ReturnLeadModal.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/* ───────────────────────────  summary state  ─────────────────────────── */

type SummarySource = "claude" | "fallback";

type SummaryState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; text: string; source: SummarySource; note: string | null };

/** Why we're showing the counted-facts summary instead of a written one. Each
 *  reason names the fix, so an unset key doesn't read as a bug. */
const REASON_NOTE: Record<string, string> = {
  unconfigured:
    "AI summary isn’t configured on the server (ENQUIRY_SUMMARY_ANTHROPIC_KEY) — this is the counted-facts summary.",
  "daily-cap":
    "Today’s AI summary cap is spent (ENQUIRY_SUMMARY_DAILY_CAP) — this is the counted-facts summary.",
  refusal: "Claude declined to write this one — this is the counted-facts summary.",
  error: "Couldn’t reach Claude just now — this is the counted-facts summary.",
  demo: "Demo data — this is the counted-facts summary, written without a model call.",
  unauthorized: "The access key was rejected — this is the counted-facts summary.",
};

interface SummaryResponse {
  ok?: boolean;
  mode?: string;
  summary?: string;
  source?: string;
  reason?: string;
  cached?: boolean;
  error?: string;
}

/* ───────────────────────────  pieces  ─────────────────────────── */

/** Hairline panel head, same grammar as the tab's other panels. */
function PanelHead({
  title,
  icon: Icon,
  action,
}: {
  title: string;
  icon: LucideIcon;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <h3 className="flex items-center gap-2 font-heading text-[12.5px] font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden />
        {title}
      </h3>
      {action}
    </div>
  );
}

/** One engagement tally. Zero reads quiet; anything above zero reads solid, so
 *  the shape of the engagement is legible without reading the numbers. */
function Tally({
  icon: Icon,
  label,
  value,
  loud,
}: {
  icon: LucideIcon;
  label: string;
  value: number;
  loud?: boolean;
}) {
  const on = value > 0;
  return (
    <div className="flex flex-col gap-1 bg-card px-3 py-2.5">
      <span className="flex items-center gap-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        <span className="truncate">{label}</span>
      </span>
      <span
        className={cn(
          "tnum font-mono text-[19px] font-semibold leading-none",
          !on ? "text-muted-foreground/40" : loud ? "text-primary" : "text-foreground",
        )}
      >
        {formatInt(value)}
      </span>
    </div>
  );
}

/* ───────────────────────────  the modal  ─────────────────────────── */

export function EnquiryActivityModal({
  inquiry,
  activity,
  activityState,
  demo,
  onClose,
}: {
  /** null = closed. */
  inquiry: PortalInquiry | null;
  /** the enquirer's click trail, or null when they have none */
  activity: LeadActivity | null;
  /** whether the trail read is still in flight / failed */
  activityState: "loading" | "ready" | "unavailable";
  /** demo mode — no server read is possible, so the summary stays local */
  demo: boolean;
  onClose: () => void;
}) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const open = inquiry !== null;
  const [summary, setSummary] = useState<SummaryState>({ status: "idle" });
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mounted = useRef(true);

  useFocusTrap(open, ref);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, []);

  // A different enquiry means a different brief — never show the last one's.
  useEffect(() => {
    setSummary({ status: "idle" });
    setCopied(false);
  }, [inquiry?.id]);

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const facts = useMemo(
    () => (inquiry ? buildEngagementFacts(inquiry, activity) : null),
    [inquiry, activity],
  );
  const points = useMemo(() => (facts ? talkingPoints(facts) : []), [facts]);
  const visibleEvents = useMemo(
    () => (activity ? activity.events.filter((e) => !isHiddenEvent(e.event)) : []),
    [activity],
  );

  /** Ask the server for the written brief. Any miss lands on the deterministic
   *  summary with a note rather than an error state — the panel always says
   *  something useful about the lead. */
  const generate = useCallback(async () => {
    if (!inquiry || !facts) return;
    const local = (note: string | null): SummaryState => ({
      status: "ready",
      text: fallbackSummary(facts),
      source: "fallback",
      note,
    });
    setSummary({ status: "loading" });
    setCopied(false);

    // Demo rows aren't in the database (their ids aren't uuids), so there is
    // nothing for the server to ground a summary in.
    if (demo) {
      setSummary(local(REASON_NOTE.demo));
      return;
    }

    try {
      const res = await fetch("/api/portal/lead-summary", {
        method: "POST",
        headers: { "Content-Type": "application/json", ...adminHeaders() },
        body: JSON.stringify({ inquiryId: inquiry.id }),
      });
      const data = (await res.json().catch(() => null)) as SummaryResponse | null;
      if (!mounted.current) return;

      if (res.status === 401) {
        setSummary(local(REASON_NOTE.unauthorized));
        return;
      }
      if (!res.ok || !data?.ok || !data.summary) {
        setSummary(local(data?.error ?? REASON_NOTE.error));
        return;
      }
      const note = data.reason ? REASON_NOTE[data.reason] ?? REASON_NOTE.error : null;
      setSummary({
        status: "ready",
        text: data.summary,
        source: data.source === "claude" ? "claude" : "fallback",
        note,
      });
    } catch {
      if (mounted.current) setSummary(local(REASON_NOTE.error));
    }
  }, [inquiry, facts, demo]);

  async function copySummary() {
    if (summary.status !== "ready") return;
    try {
      await navigator.clipboard.writeText(summary.text);
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the text is on screen and selectable */
    }
  }

  const title = inquiry
    ? inquiry.business ?? inquiry.name ?? inquiry.email
    : "";
  const score = activity ? leadScore(activity) : null;
  const tier = score !== null ? scoreTier(score) : null;
  const t = facts?.trail ?? null;

  return (
    <AnimatePresence>
      {open && inquiry && facts && (
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
          <div className="fixed inset-0 z-[81] flex items-center justify-center p-3 sm:p-4">
            <motion.div
              ref={ref}
              role="dialog"
              aria-modal="true"
              aria-label={`Portal activity for ${title}`}
              tabIndex={-1}
              className="flex max-h-[90vh] w-[min(96vw,44rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
              initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
              transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
            >
              {/* ── header ─────────────────────────────────────────────── */}
              <div className="flex items-start gap-3 border-b border-border px-5 py-4">
                <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
                  <Activity className="h-4 w-4" aria-hidden />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 flex-wrap items-center gap-2">
                    <h2 className="truncate font-heading text-base font-semibold text-foreground">
                      {title}
                    </h2>
                    {tier && score !== null && (
                      <span
                        title={`Intent score ${score}/100 · ${tier.label}`}
                        className={cn(
                          "inline-flex shrink-0 items-center gap-1 rounded-full border px-1.5 py-px text-[9px] font-semibold uppercase tracking-[0.08em]",
                          tier.chip,
                        )}
                      >
                        <span className="tnum">{score}</span>
                        <span className={cn("font-medium normal-case tracking-normal", tier.ring)}>
                          {tier.label}
                        </span>
                      </span>
                    )}
                  </div>
                  <p className="mt-0.5 text-[12.5px] text-muted-foreground">
                    Enquired about{" "}
                    <span className="font-medium text-foreground">
                      {serviceName(inquiry.serviceSlug)}
                    </span>{" "}
                    · <span className="tnum">{fmtStamp(inquiry.createdAt)}</span>
                    {t?.firstSeen && (
                      <>
                        {" "}
                        · first seen <span className="tnum">{fmtStamp(t.firstSeen)}</span>
                      </>
                    )}
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

              {/* ── body ───────────────────────────────────────────────── */}
              <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-5 py-4">
                {/* 1 · engagement tallies */}
                <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                  <PanelHead
                    title="Engagement"
                    icon={Activity}
                    action={
                      <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                        {activityState === "loading"
                          ? "reading trail…"
                          : t
                            ? `${formatInt(t.steps)} tracked step${t.steps === 1 ? "" : "s"}`
                            : "no tracked trail"}
                      </span>
                    }
                  />
                  {t ? (
                    <>
                      <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-3 lg:grid-cols-6">
                        <Tally icon={Mail} label="Email clicks" value={t.emailClicks} />
                        <Tally icon={FileDown} label="Info pack" value={t.packDownloads} loud />
                        <Tally icon={Eye} label="Portal visits" value={t.portalViews} />
                        <Tally icon={LayoutGrid} label="Services" value={t.serviceOpens} />
                        <Tally icon={MessageCircle} label="Chat Qs" value={t.chatPrompts} />
                        <Tally icon={Send} label="Enquiries" value={t.enquiries} loud />
                      </div>
                      <p className="border-t border-border px-4 py-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                        Active on <span className="tnum text-foreground/80">{t.daysActive}</span>{" "}
                        {t.daysActive === 1 ? "day" : "separate days"}
                        {t.minutesToEnquiry != null && (
                          <>
                            {" "}
                            · <span className="text-foreground/80">
                              {humanDuration(t.minutesToEnquiry)}
                            </span>{" "}
                            from first click to enquiry
                          </>
                        )}
                        {t.consented && " · accepted the Terms & Privacy Policy"}
                      </p>
                    </>
                  ) : (
                    <p className="px-4 py-3 text-[12.5px] leading-relaxed text-muted-foreground">
                      {activityState === "loading"
                        ? "Reading this lead’s click trail…"
                        : activityState === "unavailable"
                          ? "The click trail couldn’t be read just now — everything below comes from the enquiry itself."
                          : inquiry.source
                            ? `No tracked trail — they reached the portal via ${sourceLabel(
                                inquiry.source,
                              )} rather than a tracked outreach link, so this enquiry is their first recorded touch.`
                            : "No tracked trail — they reached the portal directly rather than through a tracked outreach link, so this enquiry is their first recorded touch."}
                    </p>
                  )}
                </section>

                {/* 2 · AI summary (on demand — the button is the whole point) */}
                <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                  <PanelHead
                    title="AI summary"
                    icon={Sparkles}
                    action={
                      <div className="flex items-center gap-1.5">
                        {summary.status === "ready" && (
                          <button
                            type="button"
                            onClick={copySummary}
                            aria-label="Copy the summary"
                            className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                          >
                            {copied ? (
                              <Check className="h-3.5 w-3.5 text-primary" aria-hidden />
                            ) : (
                              <Copy className="h-3.5 w-3.5" aria-hidden />
                            )}
                          </button>
                        )}
                        <Button
                          size="sm"
                          disabled={summary.status === "loading" || activityState === "loading"}
                          onClick={() => void generate()}
                          data-track="enquiry_ai_summary"
                          data-track-service={inquiry.serviceSlug}
                          className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                        >
                          {summary.status === "loading" ? (
                            <>
                              <RefreshCw className="h-3.5 w-3.5 animate-spin" aria-hidden />
                              Writing…
                            </>
                          ) : summary.status === "ready" ? (
                            <>
                              <RefreshCw className="h-3.5 w-3.5" aria-hidden />
                              Rewrite
                            </>
                          ) : (
                            <>
                              <Sparkles className="h-3.5 w-3.5" aria-hidden />
                              AI Summary
                            </>
                          )}
                        </Button>
                      </div>
                    }
                  />
                  <div className="px-4 py-3">
                    {summary.status === "idle" && (
                      <p className="text-[12.5px] leading-relaxed text-muted-foreground">
                        Have Claude read this lead’s telemetry and write the brief you’d want before
                        picking up the phone — what they clicked, what it says about their intent,
                        and how to open the call.
                      </p>
                    )}
                    {summary.status === "loading" && (
                      <div className="space-y-2" aria-busy>
                        <div className="h-3 w-full animate-pulse rounded bg-muted" />
                        <div className="h-3 w-11/12 animate-pulse rounded bg-muted" />
                        <div className="h-3 w-9/12 animate-pulse rounded bg-muted" />
                      </div>
                    )}
                    {summary.status === "ready" && (
                      <>
                        <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-foreground/90">
                          {summary.text}
                        </p>
                        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
                          {summary.note ??
                            (summary.source === "claude"
                              ? "Written by Claude from this lead’s recorded activity only."
                              : "Written from this lead’s recorded activity.")}
                        </p>
                      </>
                    )}
                  </div>
                </section>

                {/* 3 · talking points */}
                <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                  <PanelHead title="Talking points" icon={Inbox} />
                  <ul className="divide-y divide-border/70">
                    {points.map((p) => (
                      <li key={p.id} className="flex gap-2.5 px-4 py-2.5">
                        <span
                          className={cn(
                            "mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full",
                            p.strong ? "bg-primary" : "bg-border",
                          )}
                          aria-hidden
                        />
                        <span
                          className={cn(
                            "text-[12.5px] leading-relaxed",
                            p.strong ? "text-foreground" : "text-foreground/80",
                          )}
                        >
                          {p.text}
                        </span>
                      </li>
                    ))}
                  </ul>
                </section>

                {/* 4 · the enquiry itself */}
                <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                  <PanelHead
                    title="Their enquiry"
                    icon={Send}
                    action={
                      <span className="inline-flex items-center rounded-full border border-border bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
                        {serviceLabel(inquiry.serviceSlug)}
                      </span>
                    }
                  />
                  <div className="space-y-2.5 px-4 py-3">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
                      <a
                        href={`mailto:${encodeURIComponent(inquiry.email)}`}
                        className="inline-flex items-center gap-1.5 font-mono text-[11.5px] font-medium text-primary hover:underline"
                      >
                        <Mail className="h-3 w-3" aria-hidden />
                        {inquiry.email}
                      </a>
                      {inquiry.phone && (
                        <a
                          href={`tel:${inquiry.phone.replace(/[^\d+]/g, "")}`}
                          className="inline-flex items-center gap-1.5 font-mono text-[11.5px] font-medium text-primary hover:underline"
                        >
                          <Phone className="h-3 w-3" aria-hidden />
                          {inquiry.phone}
                        </a>
                      )}
                      {inquiry.name && (
                        <span className="text-[12px] text-muted-foreground">
                          Contact: <span className="text-foreground">{inquiry.name}</span>
                        </span>
                      )}
                    </div>
                    {inquiry.message?.trim() ? (
                      <blockquote className="border-l-2 border-primary/40 bg-background/50 px-3 py-2 text-[12.5px] leading-relaxed text-foreground/90">
                        {inquiry.message.trim()}
                      </blockquote>
                    ) : (
                      <p className="font-mono text-[10.5px] text-muted-foreground">
                        They submitted the form without a message.
                      </p>
                    )}
                    {(inquiry.category || inquiry.campaign || inquiry.source) && (
                      <p className="font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                        {inquiry.category && <>Sector: {inquiry.category}</>}
                        {inquiry.campaign && <> · Campaign: {inquiry.campaign}</>}
                        {inquiry.source && <> · Source: {sourceLabel(inquiry.source)}</>}
                      </p>
                    )}
                  </div>
                </section>

                {/* 5 · the full trail */}
                <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
                  <PanelHead
                    title="Full activity trail"
                    icon={Eye}
                    action={
                      visibleEvents.length > 0 ? (
                        <span className="tnum font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                          {formatInt(visibleEvents.length)} step
                          {visibleEvents.length === 1 ? "" : "s"}
                        </span>
                      ) : undefined
                    }
                  />
                  {visibleEvents.length > 0 ? (
                    <ul className="px-4 py-3">
                      {visibleEvents.map((ev, i) => (
                        <TimelineLine
                          key={`${ev.ts}-${i}`}
                          ev={ev}
                          last={i === visibleEvents.length - 1}
                        />
                      ))}
                    </ul>
                  ) : (
                    <p className="px-4 py-3 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                      {activityState === "loading"
                        ? "Reading the trail…"
                        : "Nothing tracked for this enquirer — the enquiry above is the only recorded event."}
                    </p>
                  )}
                </section>
              </div>

              {/* ── footer ─────────────────────────────────────────────── */}
              <div className="flex items-center justify-end gap-2 border-t border-border bg-muted/40 px-5 py-3">
                <Button variant="outline" size="sm" onClick={onClose}>
                  Close
                </Button>
                {/* An anchor, not a Button — mailto: is a navigation, and Button
                    renders a <button> (no asChild in components/ui/button). */}
                <a
                  href={`mailto:${encodeURIComponent(inquiry.email)}`}
                  data-track="enquiry_modal_email"
                  className="inline-flex h-7 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-primary-solid px-2.5 text-xs font-medium text-primary-foreground shadow-sm shadow-signal-900/30 transition-colors hover:bg-primary-solid/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background active:translate-y-px"
                >
                  <Mail className="h-3.5 w-3.5" aria-hidden />
                  Email them
                </a>
              </div>
            </motion.div>
          </div>
        </>
      )}
    </AnimatePresence>
  );
}
