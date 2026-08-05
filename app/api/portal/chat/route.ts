import { sameOrigin } from "@/lib/pipeline/server";
import { draftPortalChatReply, isChatConfigured, type ChatTurn } from "@/lib/ai/portalChat";
import { clientIp, rateLimit } from "@/lib/portal/chatRateLimit";
import { MAX_HISTORY_MESSAGES, MAX_MESSAGE_CHARS, PROMPT_LIMIT } from "@/lib/portal/chatLimits";
import {
  dailyBudgetExhausted,
  openChatSlot,
  recordChatPrompt,
  releaseChatSlot,
  takeDailySlot,
} from "@/lib/portal/chatQuota";
import { isBotRequest, isInternalRequest } from "@/lib/portal/server";

/**
 * Public portal chat endpoint — the customer-facing chat bubble (PortalChat)
 * POSTs here. It spends the walled-off PORTAL_CHAT_ANTHROPIC_KEY (model:
 * claude-haiku-4-5, see lib/ai/portalChat) on behalf of anonymous visitors,
 * so it is a spend surface and carries layered guardrails, in gate order:
 *
 *   1. sameOrigin (CSRF floor) — only our own portal pages may call it.
 *   2. Bot/scanner filter — link-scanners, curl, headless browsers get the
 *      enquiry-form nudge WITHOUT a model call. Zero spend on non-humans.
 *   3. Per-IP rate limit (lib/portal/chatRateLimit) — N msgs / window, so one
 *      visitor or a script can't loop the key. Returns 429 + Retry-After.
 *   4. Hard input caps — message length + history-turn count, so a single
 *      request can't smuggle a huge (expensive) prompt.
 *   5. Configured-key check — with no PORTAL_CHAT_ANTHROPIC_KEY the model can
 *      never reply, so bail to the fallback BEFORE consuming anyone's
 *      allowance: a misconfigured deploy must not permanently burn durable
 *      quota slots on calls that were guaranteed to fail.
 *   6. Daily budget peek + PROMPT_LIMIT lifetime quota (lib/portal/chatQuota)
 *      — each visitor identity (validated lead via the apmg_ref email-click
 *      cookie, else IP) gets 10 prompts TOTAL. Lead usage is counted durably
 *      in the portal_events `chat_prompt` ledger. The final allowed prompt
 *      tells the model to close with the "leave your contact details /
 *      Enquire" CTA; past the limit the route answers with the CTA itself —
 *      no model call.
 *   7. Global daily circuit-breaker (takeDailySlot) — instance-wide cap on
 *      model calls per UTC day, the backstop that bounds worst-case spend.
 *      PORTAL_CHAT_DAILY_CAP=0 is honoured as a kill switch.
 *   8. KB-only system prompt (lib/ai/portalChat) — the model refuses off-topic
 *      / jailbreak use, so the bubble can't become a free general LLM.
 *
 * Operator browsers (apmg_internal cookie, set by the admin dashboard) are
 * demoted to the anonymous IP quota path and never written to the ledger —
 * portal_events stays customer-activity-only and a test session can't burn a
 * real lead's allowance, but the cookie is NOT a spend bypass (it's a plain
 * marker anyone could self-set; anonymous treatment gives it zero attack
 * value).
 *
 * Degrades gracefully: with no key configured or on any API error it returns a
 * friendly fallback (200, `fallback: true`) nudging the visitor to the enquiry
 * form, so the bubble is never a dead end.
 *
 * NOTE: the window limiter and the daily breaker are in-memory / per-instance.
 * The lifetime quota for attributed leads is Supabase-backed and durable.
 */
export const runtime = "nodejs";

/** Shown when we can't (or won't) produce a model reply — never a hard error to
 *  the visitor; always points them at the real lead-capture path. */
const FALLBACK =
  "I can't answer that right now — but the team can! Tap “Enquire” on any service above and we'll get straight back to you.";

/** Shown once the visitor's PROMPT_LIMIT allowance is spent. No model call is
 *  made for this (or any later) message — the CTA IS the reply. */
const LIMIT_REACHED =
  `That's the last of your ${PROMPT_LIMIT} chat questions — but this doesn't have to be goodbye! ` +
  "Tap “Enquire” on any service above and leave your name and contact details, " +
  "and the APMG team will get back to you personally.";

function isTurn(v: unknown): v is ChatTurn {
  if (!v || typeof v !== "object") return false;
  const t = v as Record<string, unknown>;
  return (t.role === "user" || t.role === "assistant") && typeof t.content === "string";
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  // (2) Bots, scanners and scripted clients never reach the model. They get
  // the same friendly shape a human would, so nothing retries or errors.
  if (isBotRequest(req)) {
    return Response.json({ ok: true, fallback: true, reply: FALLBACK });
  }

  // (3) Per-IP rate limit — before we parse or spend anything.
  const gate = rateLimit(clientIp(req));
  if (!gate.allowed) {
    const retryAfter = Math.ceil(gate.retryAfterMs / 1000);
    return Response.json(
      {
        ok: true,
        fallback: true,
        reply:
          "You've sent a lot of messages in a short time — give me a moment. Meanwhile, tap “Enquire” above and the team will reach out.",
      },
      { status: 429, headers: { "Retry-After": String(retryAfter) } },
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // (4) Input caps — validate the newest message and the history.
  const message = typeof b.message === "string" ? b.message.trim() : "";
  if (!message) {
    return Response.json({ ok: false, error: "Empty message." }, { status: 400 });
  }
  if (message.length > MAX_MESSAGE_CHARS) {
    return Response.json(
      { ok: false, error: `Please keep it under ${MAX_MESSAGE_CHARS} characters.` },
      { status: 400 },
    );
  }

  // History is optional; keep only the most recent valid, non-empty turns.
  // Leading assistant turns are dropped because the Messages API rejects a
  // conversation that opens with an assistant message — a crafted (or buggy)
  // history must degrade to a smaller prompt, not to a guaranteed-400 call
  // that would burn the visitor's quota slot for nothing.
  const history: ChatTurn[] = rawHistoryToTurns(b.history);

  // (5) Never consume anyone's allowance for a call that cannot succeed —
  // an unset/removed key would otherwise permanently drain durable lead
  // quotas on guaranteed-failure calls.
  if (!isChatConfigured()) {
    return Response.json({ ok: true, fallback: true, reply: FALLBACK });
  }

  // (6a) Daily budget peek — during an exhausted day (abuse wave, viral
  // spike) bail BEFORE claiming the visitor's slot or touching Supabase, so
  // legitimate leads keep their remaining prompts for tomorrow. No
  // `remaining` in this response: the prompt was NOT consumed, so reporting
  // the post-consumption number would understate their real allowance.
  if (dailyBudgetExhausted()) {
    return Response.json({ ok: true, fallback: true, reply: FALLBACK });
  }

  // (6b) Lifetime prompt quota — EVERY caller is quota'd; there is no bypass.
  // Operator browsers (apmg_internal) are demoted to the anonymous IP path —
  // see the header comment.
  const internal = isInternalRequest(req);
  const slot = await openChatSlot(req, { ignoreAttribution: internal });
  if (!slot.allowed) {
    return Response.json({ ok: true, limitReached: true, remaining: 0, reply: LIMIT_REACHED });
  }

  // (7) Claim the day's slot. It can race to exhaustion between the peek and
  // here — give the visitor their reservation back; nothing was spent.
  if (!takeDailySlot()) {
    releaseChatSlot(slot.identity);
    return Response.json({ ok: true, fallback: true, reply: FALLBACK });
  }

  // Persist the visitor's slot BEFORE the model call — a crash or timeout
  // mid-call must not hand out a free retry. Ledger write is best-effort;
  // the in-memory reservation already counts.
  await recordChatPrompt(slot, req, message.length);

  // (8) KB-grounded reply. null → degrade to the enquiry-form nudge (never
  // error). The slot stays consumed either way, so the limit flags must ride
  // on this branch too — on the final prompt the composer still locks.
  const reply = await draftPortalChatReply(history, message, {
    finalTurn: slot.finalTurn,
    userRef: slot.identity.userRef,
  });
  if (!reply) {
    return Response.json({
      ok: true,
      fallback: true,
      reply: FALLBACK,
      remaining: slot.remaining,
      limitReached: slot.remaining === 0,
    });
  }

  return Response.json({
    ok: true,
    reply,
    remaining: slot.remaining,
    limitReached: slot.remaining === 0,
  });
}

/** Sanitize client-supplied history: valid shape, capped turn count and
 *  lengths, no empty turns, never assistant-first. */
function rawHistoryToTurns(raw: unknown): ChatTurn[] {
  const turns = (Array.isArray(raw) ? raw : [])
    .filter(isTurn)
    .map((t) => ({ role: t.role, content: t.content.slice(0, MAX_MESSAGE_CHARS).trim() }))
    .filter((t) => t.content.length > 0)
    .slice(-MAX_HISTORY_MESSAGES);
  while (turns.length > 0 && turns[0].role === "assistant") turns.shift();
  return turns;
}
