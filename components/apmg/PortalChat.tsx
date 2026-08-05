"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { track } from "@/lib/telemetry";
import { COMPANY } from "@/lib/legal/company";
import { MAX_MESSAGE_CHARS, MAX_HISTORY_MESSAGES } from "@/lib/portal/chatLimits";
// Chathead for assistant turns — same self-hosted headshot the team roster uses
// (see TeamSection), so it's static-imported and optimised, not a CDN hotlink.
import simon from "@/app/team/simon-taranek.jpg";

/**
 * Customer-facing chat bubble for the public /portal (ui-standards §17.8 signal
 * accent). Mounted ONLY on the standalone host (see ServicesPortal) so it never
 * appears inside the internal dashboard's "Our Services" tab.
 *
 * Behaviour:
 *  - AUTO-OPENS once, 30 seconds after the visitor lands — long enough that
 *    they've read the page first. (Was 3s: a cold outreach recipient hit a
 *    consent modal, then a chat popup, before reading a single service — two
 *    interruptions that read as spam, not help.) Skipped if they've already
 *    opened/closed it this session (sessionStorage).
 *  - HONESTY: the panel is labelled as an automated assistant (never passed
 *    off as a person) and always offers the phone number as the human path.
 *    Assistant turns carry a chathead (Simon's headshot) for warmth, but the
 *    header keeps the "Automated" label — the face is decoration beside an
 *    explicit disclosure, not a claim that a person is typing. The floating
 *    launcher stays a plain message icon on purpose.
 *  - Talks to /api/portal/chat, which is KB-grounded, rate-limited, and spends a
 *    walled-off key (see the route). The client keeps only the last few turns and
 *    caps input length to match the server's guardrails.
 *
 * Theming: uses the portal's LIGHT theme tokens (bg-card, text-foreground,
 * bg-primary, ring-*) so it inherits the surface automatically. Motion follows
 * the house ease (§14.1) and is fully disabled under reduced motion (§14.5).
 */

const EASE = [0.16, 1, 0.3, 1] as const;
const AUTO_OPEN_MS = 30_000;
/** Once per browser session: don't re-spring the panel after the visitor has
 *  engaged with it. */
const SEEN_KEY = "apmg-portal-chat-seen";

type Msg = { role: "user" | "assistant"; content: string };

/** Assistant-side chathead in the transcript. Purely decorative — the honest
 *  "APMG Assistant · Automated" label in the header is what identifies the
 *  speaker, so this carries no alt text and is hidden from screen readers. */
function ChatHead() {
  return (
    <Image
      src={simon}
      alt=""
      aria-hidden
      width={28}
      height={28}
      sizes="28px"
      className="mb-0.5 h-7 w-7 shrink-0 rounded-full object-cover ring-1 ring-foreground/10"
    />
  );
}

/** Invisible stand-in so follow-on assistant bubbles keep the chathead's indent. */
function ChatHeadSpacer() {
  return <span aria-hidden className="mb-0.5 h-7 w-7 shrink-0" />;
}

const GREETING: Msg = {
  role: "assistant",
  content: `Hi! I'm APMG's automated assistant 👋 I can answer questions about our property maintenance services. Prefer a person? Call us on ${COMPANY.phone}, or tap “Enquire” on any service and the team will get back to you.`,
};

export function PortalChat() {
  const reduce = useReducedMotion();
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  // Server-enforced prompt allowance (see /api/portal/chat). `remaining` is
  // whatever the last reply reported (null until then); once the server says
  // the allowance is spent we lock the composer — the Enquire form is the
  // conversation's next step. Enforcement lives server-side; this is just UX.
  const [remaining, setRemaining] = useState<number | null>(null);
  const [limitReached, setLimitReached] = useState(false);

  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Auto-open once, 3s after mount — the signature "open the moment they reach
  // the site" behaviour. Skipped if they've already engaged this session.
  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(SEEN_KEY) === "1";
    } catch {
      /* private mode / storage disabled — just auto-open */
    }
    if (seen) return;
    const id = window.setTimeout(() => {
      setOpen(true);
      track("portal_chat_autoopen");
    }, AUTO_OPEN_MS);
    return () => window.clearTimeout(id);
  }, []);

  // Keep the transcript pinned to the newest message and focus the input when
  // the panel opens.
  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
    if (!reduce) inputRef.current?.focus();
  }, [open, messages, reduce]);

  function markSeen() {
    try {
      sessionStorage.setItem(SEEN_KEY, "1");
    } catch {
      /* ignore */
    }
  }

  function toggle() {
    markSeen();
    setOpen((v) => {
      const next = !v;
      track(next ? "portal_chat_open" : "portal_chat_close");
      return next;
    });
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text || sending || limitReached) return;

    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
    markSeen();
    track("portal_chat_send");

    // Send only the trailing turns (minus the static greeting) — mirrors the
    // server's history cap so the request never grows unbounded.
    const history = nextMessages
      .filter((m) => m !== GREETING)
      .slice(-MAX_HISTORY_MESSAGES - 1, -1);

    try {
      const res = await fetch("/api/portal/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: text, history }),
      });
      const data = (await res.json().catch(() => null)) as
        | { reply?: string; remaining?: number; limitReached?: boolean }
        | null;
      const reply =
        data?.reply?.trim() ||
        "Sorry — something went wrong on my end. Please tap “Enquire” above and the team will be in touch.";
      setMessages((m) => [...m, { role: "assistant", content: reply }]);
      if (typeof data?.remaining === "number") setRemaining(data.remaining);
      if (data?.limitReached) {
        setLimitReached(true);
        track("portal_chat_limit_reached");
      }
    } catch {
      setMessages((m) => [
        ...m,
        {
          role: "assistant",
          content:
            "I couldn't reach the server just now. Please tap “Enquire” above and the team will get back to you.",
        },
      ]);
    } finally {
      setSending(false);
    }
  }

  return (
    <>
      {/* ── Chat panel ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            role="dialog"
            aria-label="Chat with the APMG assistant"
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: 16, scale: 0.96 }}
            transition={{ duration: reduce ? 0.15 : 0.32, ease: EASE }}
            className="fixed bottom-[calc(1.25rem+3.5rem+0.75rem)] right-5 z-50 flex h-[28rem] max-h-[calc(100dvh-2.5rem)] w-[min(22rem,calc(100vw-2.5rem))] flex-col overflow-hidden rounded-2xl bg-card text-foreground shadow-2xl ring-1 ring-foreground/10"
            style={{ transformOrigin: "bottom right" }}
          >
            {/* Header */}
            <div className="flex items-center gap-3 border-b border-border bg-primary px-4 py-3 text-primary-foreground">
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-white/15">
                <MessageCircle className="h-4 w-4" aria-hidden />
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold leading-tight">APMG Assistant</p>
                {/* Honest label: never let a customer mistake the bot for a person. */}
                <p className="truncate text-[11px] leading-tight text-primary-foreground/80">
                  Automated · or call{" "}
                  <a href={COMPANY.phoneHref} className="font-semibold underline underline-offset-2">
                    {COMPANY.phone}
                  </a>
                </p>
              </div>
              <button
                type="button"
                onClick={toggle}
                aria-label="Close chat"
                className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-primary-foreground/90 transition-colors hover:bg-white/15"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* Transcript */}
            <div
              ref={scrollRef}
              className="flex-1 space-y-3 overflow-y-auto px-4 py-4"
            >
              {messages.map((m, i) => {
                const isUser = m.role === "user";
                // Chathead leads the first turn of each assistant run only —
                // repeating the face down a whole column is clutter. Later
                // turns in the run get an invisible spacer so their bubbles
                // stay on the same left edge.
                const leadsRun = !isUser && messages[i - 1]?.role !== "assistant";
                return (
                  <motion.div
                    key={i}
                    initial={reduce ? false : { opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: reduce ? 0 : 0.24, ease: EASE }}
                    className={cn(
                      "flex items-end gap-2",
                      isUser ? "justify-end" : "justify-start",
                    )}
                  >
                    {!isUser && (leadsRun ? <ChatHead /> : <ChatHeadSpacer />)}
                    <span
                      className={cn(
                        "max-w-[85%] whitespace-pre-wrap break-words rounded-2xl px-3 py-2 text-[13px] leading-relaxed",
                        isUser
                          ? "rounded-br-sm bg-primary text-primary-foreground"
                          : "rounded-bl-sm bg-muted text-foreground",
                      )}
                    >
                      {m.content}
                    </span>
                  </motion.div>
                );
              })}

              {sending && (
                <motion.div
                  initial={reduce ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  className="flex items-end justify-start gap-2"
                >
                  <ChatHead />
                  <span className="inline-flex items-center gap-2 rounded-2xl rounded-bl-sm bg-muted px-3 py-2 text-[13px] text-muted-foreground">
                    <Loader2 className={cn("h-3.5 w-3.5", !reduce && "animate-spin")} aria-hidden />
                    Typing…
                  </span>
                </motion.div>
              )}
            </div>

            {/* Composer. Locks once the server reports the prompt allowance is
                spent — the Enquire form takes over as the conversation path. */}
            <form
              onSubmit={send}
              className="border-t border-border px-3 py-3"
            >
              {!limitReached && remaining !== null && remaining <= 2 && (
                <p className="mb-2 px-1 text-[11px] leading-tight text-muted-foreground">
                  {remaining === 0
                    ? "That was your last question."
                    : `${remaining} question${remaining === 1 ? "" : "s"} left`}{" "}
                  — need more? Tap “Enquire” on a service above.
                </p>
              )}
              <div className="flex items-center gap-2">
                <input
                  ref={inputRef}
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  maxLength={MAX_MESSAGE_CHARS}
                  disabled={limitReached}
                  placeholder={
                    limitReached
                      ? "Chat limit reached — tap “Enquire” above"
                      : "Type your question…"
                  }
                  aria-label="Your message"
                  className="min-w-0 flex-1 rounded-xl bg-muted px-3 py-2 text-[13px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={!input.trim() || sending || limitReached}
                  aria-label="Send message"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  <Send className="h-4 w-4" aria-hidden />
                </button>
              </div>
            </form>
          </motion.div>
        )}
      </AnimatePresence>

      {/* ── Launcher bubble ────────────────────────────────────────────────── */}
      <motion.button
        type="button"
        onClick={toggle}
        aria-label={open ? "Close chat" : "Chat with us"}
        aria-expanded={open}
        initial={reduce ? false : { scale: 0, opacity: 0 }}
        animate={{ scale: 1, opacity: 1 }}
        transition={{ duration: reduce ? 0 : 0.4, ease: EASE, delay: reduce ? 0 : 0.3 }}
        whileHover={reduce ? undefined : { scale: 1.05 }}
        whileTap={reduce ? undefined : { scale: 0.95 }}
        className="fixed bottom-5 right-5 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-primary text-primary-foreground shadow-xl ring-1 ring-black/5 transition-colors hover:bg-primary/90"
      >
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={open ? "close" : "open"}
            initial={reduce ? false : { rotate: -90, opacity: 0 }}
            animate={{ rotate: 0, opacity: 1 }}
            exit={reduce ? { opacity: 0 } : { rotate: 90, opacity: 0 }}
            transition={{ duration: reduce ? 0.12 : 0.2, ease: EASE }}
          >
            {open ? (
              <X className="h-6 w-6" aria-hidden />
            ) : (
              <MessageCircle className="h-6 w-6" aria-hidden />
            )}
          </motion.span>
        </AnimatePresence>

        {/* Idle attention pulse on the closed launcher — a soft ring, disabled
            under reduced motion. Purely decorative. */}
        {!open && !reduce && (
          <span
            aria-hidden
            className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-primary/40 motion-safe:animate-ping"
          />
        )}
      </motion.button>
    </>
  );
}
