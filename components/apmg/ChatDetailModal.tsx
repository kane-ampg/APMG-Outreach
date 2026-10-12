"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  Activity,
  ArrowRight,
  Building2,
  Check,
  CheckCircle2,
  Copy,
  Eye,
  Globe,
  LayoutGrid,
  Mail,
  MessageCircle,
  MessagesSquare,
  Send,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { useFocusTrap } from "@/lib/useFocusTrap";
import { sourceLabel } from "@/lib/data/enquiries";
import { chatDisplayName, LEAD_ORIGIN_NAME, type ChatConversation } from "@/lib/data/chats";
import { isHiddenEvent, type LeadActivity, type LeadActivityEvent } from "@/lib/data/leadActivity";
import { leadScore, scoreTier } from "@/lib/data/leadScore";
import { DIRECT_SOURCE, OUTREACH_SOURCE } from "@/lib/portal/source";
import { Button } from "@/components/ui/button";
import { BRAND_LOGO, isBrand } from "./BrandLogos";
import { TimelineLine, fmtStamp } from "./LeadTrail";

/**
 * Telemetry → Chats → "View": everything known about one person who used the
 * portal's chat assistant, and the button that hands them to Sales.
 *
 *   Who they are   — the lead's school / business and every way to reach
 *                    them (leads row, or the saved copy once the folder is
 *                    gone), where we got the lead, how they reached the
 *                    portal, and what they chatted from.
 *   Portal activity — the same click trail and intent score the Lead activity
 *                    table shows, read from the payload the page already has.
 *   Chats          — EVERY conversation this person has had with the
 *                    assistant, newest first, not just the row that was
 *                    opened — the reason to send them to Sales is usually
 *                    in what they asked.
 *
 * "Send to Sales" is the Hot Leads hand-off (lib/data/hotLeads →
 * /api/sales/handoff): the lead joins the rep queue and the sales desk is
 * emailed. It needs a lead behind the chat — an anonymous visitor has no
 * record Sales could call — so for those the transcript can be copied instead.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

/** The portal trail behind the person, when the page has one loaded. */
export interface ChatTrail {
  events: LeadActivityEvent[];
  counts: LeadActivity["counts"];
  firstSeen: string;
  lastSeen: string;
}

/** Where the person stands with Sales. */
export type ChatSalesState =
  | { state: "ready" }
  | { state: "sent"; at: string }
  | { state: "blocked"; reason: string };

/** The channel's mark: a brand logo for the gauged platforms, an envelope for
 *  the outreach email, a globe for any other site. Direct has none. */
export function ChatSourceMark({ channel }: { channel: string }) {
  if (isBrand(channel)) {
    const Logo = BRAND_LOGO[channel];
    return <Logo className="h-3.5 w-3.5 shrink-0" />;
  }
  if (channel === DIRECT_SOURCE) return null;
  const Icon = channel === OUTREACH_SOURCE ? Mail : Globe;
  return <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" aria-hidden />;
}

/** Plain-text transcript of every chat, for pasting into an email or a note. */
function transcriptText(name: string, chats: ChatConversation[]): string {
  const blocks = chats.map((c) =>
    [
      `Chat — ${fmtStamp(c.startedAt)}`,
      ...c.exchanges.flatMap((e) => [`${name}: ${e.question}`, `APMG Assistant: ${e.reply}`]),
    ].join("\n"),
  );
  return [`${name} — via ${sourceLabel(chats[0]?.channel ?? DIRECT_SOURCE)}`, ...blocks].join("\n\n");
}

function PanelHead({ title, icon: Icon, action }: { title: string; icon: LucideIcon; action?: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border px-4 py-2.5">
      <h3 className="flex items-center gap-2 font-heading text-[13px] font-semibold text-foreground">
        <Icon className="h-3.5 w-3.5 text-primary" aria-hidden />
        {title}
      </h3>
      {action}
    </div>
  );
}

function Tally({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: number }) {
  return (
    <div className="bg-card px-3 py-2.5">
      <div className="flex items-center gap-1.5 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
        <Icon className="h-3 w-3" aria-hidden />
        {label}
      </div>
      <div className="tnum mt-1 font-mono text-lg font-semibold leading-none text-foreground">
        {formatInt(value)}
      </div>
    </div>
  );
}

/** One label/value line of the "Who they are" panel. */
function Detail({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words text-[12.5px] text-foreground">{children}</dd>
    </div>
  );
}

const linkClass = "text-primary underline-offset-2 hover:underline";

interface ChatDetailProps {
  /** the chat whose View was pressed; null = closed */
  chat: ChatConversation | null;
  /** every chat this person has had (same lead, else same browser), newest first */
  related: ChatConversation[];
  trail: ChatTrail | null;
  sales: ChatSalesState;
  sending: boolean;
  sendError: string | null;
  onSend: (leadId: string) => void;
  onClose: () => void;
}

/** Always mounted, so closing plays the exit animation instead of vanishing. */
export function ChatDetailModal(props: ChatDetailProps) {
  return (
    <AnimatePresence>
      {props.chat && <ChatDetailDialog key="chat-detail" {...props} chat={props.chat} />}
    </AnimatePresence>
  );
}

function ChatDetailDialog({
  chat,
  related,
  trail,
  sales,
  sending,
  sendError,
  onSend,
  onClose,
}: ChatDetailProps & { chat: ChatConversation }) {
  const reduce = useReducedMotion();
  const ref = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState(false);
  const copyTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useFocusTrap(true, ref);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // A different person means a different transcript — never a stale "Copied".
  useEffect(() => {
    setCopied(false);
    return () => {
      if (copyTimer.current) clearTimeout(copyTimer.current);
    };
  }, [chat.conversationId]);

  const chats = related.length > 0 ? related : [chat];
  const visibleEvents = useMemo(
    () => (trail ? trail.events.filter((e) => !isHiddenEvent(e.event)) : []),
    [trail],
  );

  const name = chatDisplayName(chat);
  const contact = chat.contact;
  const questions = chats.reduce((n, c) => n + c.exchanges.length, 0);
  const firstChat = chats.reduce((min, c) => (c.startedAt < min ? c.startedAt : min), chat.startedAt);
  const score = trail ? leadScore(trail) : null;
  const tier = score !== null ? scoreTier(score) : null;
  const leadFrom = chat.leadSource ? LEAD_ORIGIN_NAME[chat.leadSource] : null;
  const titleId = `chat-detail-title-${chat.conversationId}`;

  async function copyTranscript() {
    try {
      await navigator.clipboard.writeText(transcriptText(name, chats));
      setCopied(true);
      if (copyTimer.current) clearTimeout(copyTimer.current);
      copyTimer.current = setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable — the transcript is on screen and selectable */
    }
  }

  return (
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
          aria-labelledby={titleId}
          tabIndex={-1}
          className="flex max-h-[90vh] w-[min(96vw,48rem)] flex-col overflow-hidden rounded-2xl border border-border bg-card shadow-2xl outline-none"
          initial={reduce ? false : { opacity: 0, scale: 0.96, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={reduce ? { opacity: 0 } : { opacity: 0, scale: 0.97, y: 6 }}
          transition={{ duration: reduce ? 0 : 0.32, ease: EASE }}
        >
          {/* ── header ─────────────────────────────────────────────── */}
          <div className="flex items-start gap-3 border-b border-border px-5 py-4">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background text-primary">
              <MessagesSquare className="h-4 w-4" aria-hidden />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex min-w-0 flex-wrap items-center gap-2">
                <h2 id={titleId} className="truncate font-heading text-base font-semibold text-foreground">
                  {name}
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
              <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-[12.5px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5 font-medium text-foreground">
                  <ChatSourceMark channel={chat.channel} />
                  {sourceLabel(chat.channel)}
                </span>
                {leadFrom && <span>· lead from {leadFrom}</span>}
                <span>
                  · {formatInt(chats.length)} {chats.length === 1 ? "chat" : "chats"},{" "}
                  {formatInt(questions)} {questions === 1 ? "question" : "questions"}
                </span>
                <span>
                  · first chatted <span className="tnum">{fmtStamp(firstChat)}</span>
                </span>
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
            {/* 1 · who they are */}
            <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <PanelHead title="Who they are" icon={Building2} />
              <dl className="grid grid-cols-1 gap-x-4 gap-y-3 px-4 py-3 sm:grid-cols-2">
                <Detail label={chat.leadId ? "School / business" : "Visitor"}>{name}</Detail>
                {contact?.contactName && (
                  <Detail label="Contact">
                    {contact.contactTitle
                      ? `${contact.contactName} · ${contact.contactTitle}`
                      : contact.contactName}
                  </Detail>
                )}
                {contact && contact.emails.length > 0 && (
                  <Detail label={contact.emails.length === 1 ? "Email" : "Emails"}>
                    <span className="flex flex-col">
                      {contact.emails.map((email) => (
                        <a key={email} href={`mailto:${email}`} className={linkClass}>
                          {email}
                        </a>
                      ))}
                    </span>
                  </Detail>
                )}
                {contact?.phone && (
                  <Detail label="Phone">
                    <a href={`tel:${contact.phone.replace(/[^\d+]/g, "")}`} className={linkClass}>
                      {contact.phone}
                    </a>
                  </Detail>
                )}
                {contact?.website && (
                  <Detail label="Website">
                    <a
                      href={/^https?:\/\//i.test(contact.website) ? contact.website : `https://${contact.website}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={linkClass}
                    >
                      {contact.website.replace(/^https?:\/\//i, "").replace(/\/+$/, "")}
                    </a>
                  </Detail>
                )}
                {contact?.address && <Detail label="Address">{contact.address}</Detail>}
                {chat.category && <Detail label="Sector">{chat.category}</Detail>}
                {chat.campaign && <Detail label="Campaign">{chat.campaign}</Detail>}
                <Detail label="Came from">
                  <span className="inline-flex items-center gap-1.5">
                    <ChatSourceMark channel={chat.channel} />
                    {sourceLabel(chat.channel)}
                  </span>
                </Detail>
                {leadFrom && <Detail label="Lead from">{leadFrom}</Detail>}
                {chat.device && <Detail label="Chatted from">{chat.device}</Detail>}
                {chat.leadId && (
                  <Detail label="Lead ID">
                    <span className="font-mono text-[11px] text-muted-foreground">{chat.leadId}</span>
                  </Detail>
                )}
                {chat.visitorId && (
                  <Detail label="Visitor ID">
                    <span className="font-mono text-[11px] text-muted-foreground">{chat.visitorId}</span>
                  </Detail>
                )}
              </dl>
              {!chat.leadId ? (
                <p className="border-t border-border px-4 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                  No outreach email behind this visitor, so there&rsquo;s no lead record or contact
                  details &mdash; only what they typed in the chat. If they left a name or number in
                  there, it&rsquo;s in the transcript below.
                </p>
              ) : !contact ? (
                <p className="border-t border-border px-4 py-2.5 text-[12px] leading-relaxed text-muted-foreground">
                  This lead&rsquo;s record is no longer in the leads table (its folder was deleted), so
                  only the name it had when they chatted is left.
                </p>
              ) : null}
            </section>

            {/* 2 · portal activity */}
            <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <PanelHead
                title="Portal activity"
                icon={Activity}
                action={
                  trail ? (
                    <span className="font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                      last seen {fmtStamp(trail.lastSeen)}
                    </span>
                  ) : undefined
                }
              />
              {trail ? (
                <>
                  <div className="grid grid-cols-2 gap-px bg-border sm:grid-cols-5">
                    <Tally icon={Mail} label="Email clicks" value={trail.counts.emailClicks} />
                    <Tally icon={Eye} label="Portal visits" value={trail.counts.portalViews} />
                    <Tally icon={LayoutGrid} label="Services" value={trail.counts.serviceOpens} />
                    <Tally icon={MessageCircle} label="Chat Qs" value={trail.counts.chatPrompts} />
                    <Tally icon={Send} label="Enquiries" value={trail.counts.inquiries} />
                  </div>
                  {visibleEvents.length > 0 && (
                    <ol className="border-t border-border px-4 pb-4 pt-3">
                      {visibleEvents.map((ev, i) => (
                        <TimelineLine key={`${ev.ts}-${i}`} ev={ev} last={i === visibleEvents.length - 1} />
                      ))}
                    </ol>
                  )}
                </>
              ) : (
                <p className="px-4 py-3 text-[12px] leading-relaxed text-muted-foreground">
                  No click trail in Telemetry&rsquo;s current window for this{" "}
                  {chat.leadId ? "lead" : "visitor"}
                  {chat.channel === DIRECT_SOURCE
                    ? " — untagged visitors are only counted in the Anonymous card, not tracked one by one."
                    : "."}
                </p>
              )}
            </section>

            {/* 3 · every chat */}
            <section className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
              <PanelHead
                title={chats.length === 1 ? "Chat" : `Chats (${formatInt(chats.length)})`}
                icon={MessagesSquare}
                action={
                  <button
                    type="button"
                    onClick={copyTranscript}
                    data-track="telemetry_chat_copy"
                    className="inline-flex items-center gap-1.5 rounded-md px-1.5 py-1 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    {copied ? (
                      <Check className="h-3 w-3 text-primary" aria-hidden />
                    ) : (
                      <Copy className="h-3 w-3" aria-hidden />
                    )}
                    {copied ? "Copied" : "Copy transcript"}
                  </button>
                }
              />
              <div className="divide-y divide-border">
                {chats.map((c) => (
                  <div key={c.conversationId} className="px-4 py-3">
                    <div className="mb-2.5 flex flex-wrap items-center gap-2 font-mono text-[9.5px] uppercase tracking-[0.12em] text-muted-foreground">
                      <span className="tnum">{fmtStamp(c.startedAt)}</span>
                      <span>
                        · {formatInt(c.exchanges.length)} {c.exchanges.length === 1 ? "question" : "questions"}
                      </span>
                      {c.conversationId === chat.conversationId && chats.length > 1 && (
                        <span className="rounded-full border border-primary/40 px-1.5 py-px text-primary">
                          Opened
                        </span>
                      )}
                    </div>
                    <ol className="flex flex-col gap-2.5">
                      {c.exchanges.map((ex, i) => (
                        <li key={`${ex.ts}-${i}`} className="flex flex-col gap-1.5">
                          <div className="flex flex-col items-end">
                            <div className="max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-br-sm bg-primary/10 px-3 py-2 text-[13px] leading-relaxed text-foreground">
                              {ex.question}
                            </div>
                            <span className="mt-0.5 font-mono text-[9.5px] text-muted-foreground">
                              {name} · {fmtStamp(ex.ts)}
                            </span>
                          </div>
                          <div className="flex flex-col items-start">
                            <div
                              className={cn(
                                "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm px-3 py-2 text-[13px] leading-relaxed",
                                ex.outcome === "answered"
                                  ? "bg-muted text-foreground"
                                  : "border border-dashed border-border text-muted-foreground",
                              )}
                            >
                              {ex.reply}
                            </div>
                            <span className="mt-0.5 font-mono text-[9.5px] text-muted-foreground">
                              {ex.outcome === "answered"
                                ? "APMG Assistant"
                                : ex.outcome === "limit"
                                  ? "Automatic reply · question limit reached"
                                  : "Automatic reply · the assistant couldn’t answer"}
                            </span>
                          </div>
                        </li>
                      ))}
                    </ol>
                  </div>
                ))}
              </div>
            </section>
          </div>

          {/* ── footer: the hand-off ───────────────────────────────── */}
          <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border px-5 py-3">
            <p className="min-w-0 flex-1 text-[11.5px] leading-snug text-muted-foreground">
              {sendError ? (
                <span role="alert" className="text-destructive">
                  {sendError}
                </span>
              ) : sales.state === "sent" ? (
                <span className="inline-flex items-center gap-1.5 text-foreground">
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary" aria-hidden />
                  In Sales &mdash; handed over {fmtStamp(sales.at)}
                </span>
              ) : sales.state === "blocked" ? (
                sales.reason
              ) : (
                "Adds them to the Sales queue and emails the sales desk."
              )}
            </p>
            <div className="flex items-center gap-2">
              <Button variant="outline" size="sm" onClick={onClose}>
                Close
              </Button>
              {sales.state !== "sent" && (
                <Button
                  size="sm"
                  disabled={sales.state === "blocked" || sending || !chat.leadId}
                  onClick={() => chat.leadId && onSend(chat.leadId)}
                  data-track="telemetry_chat_send_to_sales"
                  className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                >
                  <ArrowRight className="h-3.5 w-3.5" aria-hidden />
                  {sending ? "Sending…" : "Send to Sales"}
                </Button>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </>
  );
}
