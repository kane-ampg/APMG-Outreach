import { draftEmail } from "@/lib/ai/composeEmail";
import { loadComposePrompt, resolveModel } from "@/lib/ai/composeStore";
import { buildHotFollowUpPrompt } from "@/lib/ai/hotFollowUpPrompt";
import { loadQueue, patchFollowUps, readFollowUpRows, writeFollowUp } from "@/lib/followups/server";
import {
  MAX_DRAFT_PER_REQUEST,
  MAX_FOLLOW_UP_HTML,
  MAX_FOLLOW_UP_SUBJECT,
  type FollowUpDraftResponse,
  type FollowUpRow,
} from "@/lib/followups/types";
import { COMPOSE_RATE, ensureLinkToken, htmlToText } from "@/lib/pipeline/campaign";
import { readLeadHistories } from "@/lib/pipeline/leadHistory";
import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { buildComposeKb, loadPlaybooks } from "@/lib/pipeline/sectorStore";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// POST /api/followups/draft { leadIds } — Claude writes each lead's next
// follow-up (touch 1 or 2, decided by loadQueue, never by the client) with the
// LIVE compose_prompt row + the lead's sector KB, plus the touch block from
// lib/ai/hotFollowUpPrompt. Saved as a `draft` row for a human to approve.
// No template fallback: a generic follow-up defeats the point, so a failed
// draft writes nothing and says so. Paced under COMPOSE_RATE; leads not reached
// before the soft deadline come back in `remaining` for the client to resubmit.
//
// The Claude call is slow, so the row may be sent, skipped or claimed by a send
// while it runs. A redraft therefore PATCHES the existing draft only while it
// is still `draft`, and a first draft is INSERT-ONLY: neither can overwrite a
// row that has moved on. Touch 2 is shown touch 1's saved email and keeps its
// service, so the pair reads as one sequence.
export const runtime = "nodejs";
export const maxDuration = 300;
const SOFT_DEADLINE_MS = (maxDuration - 60) * 1000;

function json(body: FollowUpDraftResponse, status = 200): Response {
  return Response.json(body, { status });
}
const EMPTY = { drafted: [], failed: [], remaining: [] };

/** A saved draft as the lead read it, minus the tracked-link token. */
function asSentText(html: string): string {
  return htmlToText(html).replace(/\s*\(\{\{link\}\}\)/g, "").replace(/\{\{link\}\}/g, "");
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ ok: false, error: "Forbidden.", ...EMPTY }, 403);
  const guard = await requirePermission(req, "followups.send");
  if (!guard.ok) return guardResponse(guard);

  const body = (await req.json().catch(() => null)) as { leadIds?: unknown } | null;
  const leadIds = Array.isArray(body?.leadIds) ? [...new Set(body.leadIds.filter(isUuid))] : [];
  if (leadIds.length === 0) return json({ ok: false, error: "Pick at least one lead.", ...EMPTY }, 400);
  if (leadIds.length > MAX_DRAFT_PER_REQUEST) {
    return json({ ok: false, error: `Draft up to ${MAX_DRAFT_PER_REQUEST} leads per request.`, ...EMPTY }, 413);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return json({ ok: false, error: "ANTHROPIC_API_KEY isn't set, so Claude can't draft.", ...EMPTY }, 503);
  }
  const sb = supabaseTarget();
  if (sb.state !== "ok") return json({ ok: false, error: "Supabase isn't configured.", ...EMPTY }, 503);

  const queue = await loadQueue(sb, { leadIds });
  if (!queue.ok) {
    return json(
      { ok: false, error: queue.reason === "missing" ? "Run supabase/follow-ups.sql first." : "Couldn't read the queue.", ...EMPTY },
      queue.reason === "missing" ? 503 : 502,
    );
  }
  const items = new Map(queue.items.map((i) => [i.leadId, i]));
  const [promptCfg, playbooks, histories] = await Promise.all([
    loadComposePrompt(),
    loadPlaybooks(),
    readLeadHistories(sb.base, sb.key, leadIds, "followups"),
  ]);
  // Touch 1's saved row for every touch-2 lead in this request (one read).
  const touch2Leads = leadIds.filter((id) => items.get(id)?.touch === 2);
  const firstRows = touch2Leads.length > 0 ? await readFollowUpRows(sb, touch2Leads) : [];
  const touch1Of = new Map<string, FollowUpRow>();
  if (Array.isArray(firstRows)) for (const r of firstRows) if (r.touch === 1) touch1Of.set(r.lead_id, r);
  const kbByCategory = new Map<string, Promise<string>>();
  const kbFor = (category: string | null) => {
    const key = (category ?? "").toLowerCase().trim();
    if (!kbByCategory.has(key)) kbByCategory.set(key, buildComposeKb(category, playbooks));
    return kbByCategory.get(key) as Promise<string>;
  };

  const result: FollowUpDraftResponse = { ok: true, drafted: [], failed: [], remaining: [] };
  const startedAt = Date.now();
  let nextSlot = startedAt;
  for (const leadId of leadIds) {
    if (Date.now() - startedAt > SOFT_DEADLINE_MS) {
      result.remaining.push(leadId);
      continue;
    }
    const item = items.get(leadId);
    if (!item || (item.stage !== "ready" && item.stage !== "awaiting") || item.touch === null) {
      result.failed.push({ leadId, error: item?.reason ?? "Not due for a follow-up right now" });
      continue;
    }
    // Touch 2 stays on touch 1's service and is told what touch 1 said. Without
    // that read it could only repeat itself, so it isn't drafted blind.
    let services = item.services;
    let previous: { subject: string; text: string } | undefined;
    if (item.touch === 2) {
      if (!Array.isArray(firstRows)) {
        result.failed.push({ leadId, error: "Couldn't read the first follow-up, so this one wasn't drafted. Try again." });
        continue;
      }
      const r1 = touch1Of.get(leadId);
      if (r1?.service_slug) services = [r1.service_slug, ...item.services.filter((s) => s !== r1.service_slug)];
      if (r1) previous = { subject: r1.subject ?? "", text: asSentText(r1.body_html ?? "") };
    }
    const wait = Math.max(0, nextSlot - Date.now());
    nextSlot = Math.max(Date.now(), nextSlot) + COMPOSE_RATE.MIN_INTERVAL_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const drafted = await draftEmail(
      { business: item.business ?? "there", category: item.category, website: item.website },
      await kbFor(item.category),
      promptCfg,
      undefined,
      undefined,
      buildHotFollowUpPrompt({ history: histories.get(leadId) ?? null, services, touch: item.touch, leadId, previous }),
    );
    if (!drafted) {
      result.failed.push({ leadId, error: "Claude couldn't draft this one. Try again." });
      continue;
    }
    const copy = {
      subject: drafted.subject.slice(0, MAX_FOLLOW_UP_SUBJECT),
      body_html: ensureLinkToken(drafted.html.slice(0, MAX_FOLLOW_UP_HTML)),
      service_slug: services[0] ?? item.service,
      model: resolveModel(promptCfg.model),
      note: null,
      drafted_at: new Date().toISOString(),
    };
    if (item.stage === "awaiting" && item.draft) {
      const rows = await patchFollowUps(sb, [item.draft.id], copy, "draft");
      if (rows === null) result.failed.push({ leadId, error: "Drafted, but the draft couldn't be saved." });
      else if (rows.length === 0) result.failed.push({ leadId, error: "Sent or closed while Claude was writing — refresh." });
      else result.drafted.push(leadId);
      continue;
    }
    const saved = await writeFollowUp(sb, { lead_id: leadId, touch: item.touch, status: "draft", ...copy }, { insertOnly: true });
    if (saved === "conflict") {
      result.failed.push({ leadId, error: "Another draft was saved for this lead meanwhile — refresh." });
    } else if (saved) result.drafted.push(leadId);
    else result.failed.push({ leadId, error: "Drafted, but the draft couldn't be saved." });
  }
  return json(result);
}
