"use client";

import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import Image from "next/image";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { MessageCircle, X, Send, Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { useFocusTrap } from "@/lib/useFocusTrap";
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
 *  - CLICK TO OPEN, and only that. The panel used to auto-open on a timer (3s,
 *    then 30s once a cold outreach recipient hit a consent modal *and* a chat
 *    popup before reading a single service). The timer is gone entirely, for
 *    SC 2.4.11 Focus Not Obscured: an uninvited panel parked itself over both
 *    hero CTAs, all three section tabs, every service card and the whole footer
 *    contact row, and — being non-modal — the tab ring kept walking that content
 *    underneath it, so ~20 controls could hold focus while 100% covered
 *    (verified in-browser at 390px and 1440px). Opening is now always the
 *    visitor's own deliberate act via the floating launcher, which also means
 *    there is no "have they seen it yet" state left to remember (the
 *    sessionStorage flag existed only to stop the timer re-firing).
 *  - MODAL once open: role="dialog" + aria-modal="true", focus trapped inside
 *    the panel via useFocusTrap (which owns initial focus and restores focus to
 *    the launcher on close), and Escape closes it — the same grammar as
 *    ServiceInquiryModal, so the two customer-facing dialogs behave alike.
 *    Nothing behind the panel is reachable, so nothing behind it can be
 *    focused while obscured.
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

  /** The dialog surface itself — the focus trap's container. */
  const panelRef = useRef<HTMLDivElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  /** Header Close button — where focus rests when the composer locks. */
  const closeRef = useRef<HTMLButtonElement>(null);

  // SC 2.4.11 Focus Not Obscured: the panel is a modal dialog, so keyboard
  // focus stays inside it while open. The hook also takes initial focus and
  // hands focus back to the launcher on close, so there is no manual focus
  // call anywhere in this component's open path.
  useFocusTrap(open, panelRef);

  /** The one close path, so the header X, the launcher toggle and Escape all
   *  emit exactly one `portal_chat_close`. useCallback keeps the identity
   *  stable for the Escape listener's dependency list. */
  const closePanel = useCallback(() => {
    setOpen(false);
    track("portal_chat_close");
  }, []);

  // SC 2.1.2 / 2.4.11: a dialog that traps focus MUST offer a keyboard way out
  // that isn't "hunt for the Close button". Document-level keydown, listener
  // mounted only while open — mirrors ServiceInquiryModal so both
  // customer-facing dialogs answer Escape identically.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") closePanel();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, closePanel]);

  // Keep the transcript pinned to the newest message. Initial focus is
  // deliberately NOT set here any more: it used to be coupled to `!reduce`,
  // which made focus behaviour differ between visitors for no reason, and
  // useFocusTrap now owns it.
  useEffect(() => {
    if (!open) return;
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [open, messages]);

  // SC 2.4.11 again, for the two transitions that disable the control the
  // visitor is standing on: the submit button disables itself the instant a
  // send starts, and the whole composer locks when the server reports the
  // allowance spent. The browser drops focus to <body> in both cases, and
  // useFocusTrap's key handler is bound to the panel — so from <body> the next
  // Tab would walk the page *behind* the panel, which is precisely the
  // obscured-focus failure this dialog was made modal to fix. Same guard, and
  // the same reason, as ServiceInquiryModal's post-submit refocus.
  //
  // The limit-reached move to Close is only defensible because the role="status"
  // region in the composer announces WHY the composer locked at the same moment
  // (SC 3.2.2: a context change the visitor can account for). If that message is
  // ever gated out of the live region again, this focus move becomes an
  // unexplained jump — the two belong together.
  useEffect(() => {
    if (!open) return;
    if (limitReached) closeRef.current?.focus();
    else if (sending) inputRef.current?.focus();
  }, [open, sending, limitReached]);

  function toggle() {
    if (open) {
      closePanel();
      return;
    }
    setOpen(true);
    track("portal_chat_open");
  }

  async function send(e: FormEvent) {
    e.preventDefault();
    const text = input.trim().slice(0, MAX_MESSAGE_CHARS);
    if (!text || sending || limitReached) return;

    const nextMessages = [...messages, { role: "user" as const, content: text }];
    setMessages(nextMessages);
    setInput("");
    setSending(true);
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
      {/* ── Backdrop ───────────────────────────────────────────────────────────
          Without this the `aria-modal="true"` below is a lie, and not a harmless
          one. useFocusTrap binds its Tab handler to the PANEL (lib/useFocusTrap.ts),
          so it only ever sees keydowns from inside: one mouse click on the page
          behind an open panel moves focus out of the container and the trap can
          never intercept another Tab. From there the ring walks the page, landing
          on controls sitting underneath the panel — the exact SC 2.4.11 failure
          this dialog was made modal to close. Blocking pointer access to the
          background is what makes the trap unescapable in practice.

          z-40 sits UNDER the panel's z-50 but well under ServiceInquiryModal's
          z-[80]/[81], so if the two ever coexist the enquiry modal still wins.
          Lighter than the enquiry modal's black/55: this is a corner widget, not
          a full-page interruption, and it should not read as one. */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="chat-backdrop"
            className="fixed inset-0 z-40 bg-black/30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: reduce ? 0 : 0.18 }}
            onClick={closePanel}
            aria-hidden
          />
        )}
      </AnimatePresence>

      {/* ── Chat panel ─────────────────────────────────────────────────────── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="panel"
            ref={panelRef}
            role="dialog"
            aria-modal="true"
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
                {/* Honest label: never let a customer mistake the bot for a person.
                    Full-opacity white, NOT /80: SC 1.4.3 — white-at-80% on the red
                    --primary measured 3.86:1 (needs 4.5:1), and the nested tel:
                    link inherited it. At full opacity both run at 5.31:1. This one
                    line is simultaneously the "you're talking to a machine"
                    disclosure and the escape hatch to a human, so it is the last
                    text on the panel that should be hard to read. */}
                <p className="truncate text-[11px] leading-tight text-primary-foreground">
                  Automated · or call{" "}
                  <a href={COMPANY.phoneHref} className="font-semibold underline underline-offset-2">
                    {COMPANY.phone}
                  </a>
                </p>
              </div>
              {/* Full-opacity white on the red header for the same SC 1.4.3
                  reason as the subtitle above — the X glyph was at /90. */}
              <button
                ref={closeRef}
                type="button"
                onClick={toggle}
                aria-label="Close chat"
                className="-mr-1 flex h-8 w-8 items-center justify-center rounded-full text-primary-foreground transition-colors hover:bg-white/15"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </div>

            {/* Transcript. SC 4.1.3 Status Messages: assistant replies arrive
                without any change of focus or context, so without a live region
                a screen-reader user is simply never told the answer came back —
                the chat had zero live regions before this. role="log" is the
                right role (not "status"/"alert"): a transcript is an ordered
                run of messages appended at the END, which is exactly log's
                semantics, and it tells AT to read only what's new rather than
                re-reading the whole conversation. The region has to already be
                in the DOM when content changes for the announcement to fire,
                which this container is — it mounts with the panel, before any
                reply lands — so the live region belongs HERE, on the persistent
                scroller, and NOT on each message (a live region that mounts
                together with its own content is unreliable). */}
            <div
              ref={scrollRef}
              role="log"
              aria-live="polite"
              aria-relevant="additions"
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

              {/* "Typing…" is a status message too (SC 4.1.3) — sighted visitors
                  get the spinner, so the pending state must be announced rather
                  than leaving a non-visual user in silence wondering whether
                  their question went anywhere. The visible word "Typing…" is the
                  announced text; the spinner stays aria-hidden. */}
              {sending && (
                <motion.div
                  role="status"
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
              {/* SC 4.1.3: the quota warning used to appear in complete silence,
                  so a non-visual visitor only discovered the allowance was spent
                  when the composer went dead under them. The role="status"
                  wrapper is rendered UNCONDITIONALLY (empty, zero height, until
                  there's something to say) because a live region must already
                  exist in the DOM when its content changes — putting the role on
                  the conditional <p> itself would announce nothing.

                  The limit-reached case MUST be inside this region, not gated
                  out of it. The server sets `limitReached: slot.remaining === 0`
                  (app/api/portal/chat/route.ts), so `remaining === 0` and
                  `limitReached === true` always arrive in the SAME response.
                  An earlier version read `!limitReached && remaining <= 2`,
                  which meant the one transition worth announcing — the composer
                  locking — emptied this region instead of filling it, and made
                  a "that was your last question" branch that could never render.
                  It is also what explains the focus move to Close above, so the
                  two must stay in step: SC 3.2.2 wants a context change the
                  visitor can account for. */}
              <div role="status">
                {limitReached ? (
                  <p className="mb-2 px-1 text-[11px] leading-tight text-muted-foreground">
                    That was your last question — tap “Enquire” on any service
                    above and the team will pick it up from here.
                  </p>
                ) : remaining !== null && remaining <= 2 ? (
                  <p className="mb-2 px-1 text-[11px] leading-tight text-muted-foreground">
                    {`${remaining} question${remaining === 1 ? "" : "s"} left`} —
                    need more? Tap “Enquire” on a service above.
                  </p>
                ) : null}
              </div>
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
            under reduced motion. Purely decorative.
            SC 2.2.2 Pause Stop Hide: this used to loop forever (Tailwind's
            animate-ping is animation-iteration-count: infinite) with no way to
            stop it. prefers-reduced-motion mitigates but is NOT the "mechanism
            to pause" the criterion asks for — and since the pulse is pure
            attention-seeking decoration, the honest fix is to make it finite
            rather than to bolt a pause control onto a decoration. Three
            iterations of animate-ping's 1s timing is ~3s, comfortably inside the
            5-second threshold, after which the criterion no longer applies. The
            !reduce and motion-safe: guards stay exactly as they were.
            fill-mode forwards goes WITH the bounded count, not decoration on top
            of it: ping's resting (un-animated) state is a fully opaque ring at
            scale 1, which an infinite animation never lets you see — stop the
            animation without a fill mode and it snaps back to exactly that,
            stranding a permanent red halo on the launcher. Holding the last
            keyframe (scale 2, opacity 0) ends the pulse invisibly instead. Both
            declarations are inline because Tailwind sets iteration-count via the
            `animation` shorthand, which only an inline longhand can override. */}
        {!open && !reduce && (
          <span
            aria-hidden
            style={{ animationIterationCount: 3, animationFillMode: "forwards" }}
            className="pointer-events-none absolute inset-0 rounded-full ring-2 ring-primary/40 motion-safe:animate-ping"
          />
        )}
      </motion.button>
    </>
  );
}
