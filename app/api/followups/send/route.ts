import { deliverCampaign, type CleanRecipient } from "@/lib/pipeline/deliver";
import { ensureLinkToken } from "@/lib/pipeline/campaign";
import { isUuid, publicObjectUrl, sameOrigin, SECTOR_ASSETS_BUCKET, supabaseTarget } from "@/lib/pipeline/server";
import { serviceBySlug } from "@/lib/pipeline/services";
import { loadQueue, patchFollowUps, readFollowUpsByIds } from "@/lib/followups/server";
import { FOLLOW_UP_CAMPAIGN, MAX_SEND_PER_REQUEST, type FollowUpRow, type FollowUpSendResponse } from "@/lib/followups/types";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// POST /api/followups/send { ids } — send approved follow-up drafts. The copy
// is ALWAYS re-read from the follow_ups table (edits are saved first via PATCH
// /api/followups), eligibility is re-judged by loadQueue, and delivery goes
// through the same deliverCampaign chain as a cold send — client guard,
// opt-outs, paused-webhook refusal, email_sent ledger.
//
// Two overlapping sends must not both deliver a draft, so the rows are CLAIMED
// (draft → sending, guarded on status) before anything goes to n8n, and only
// the rows this request claimed are delivered. They then settle from
// `sending`: delivered → sent, guard-dropped → blocked, and back to draft only
// when n8n was never called (paused / unconfigured / noop). A row left in
// `sending` (n8n was called and failed, the server died, or marking it sent
// failed) can't be sent again; the queue shows it as "check the Sent folder".
export const runtime = "nodejs";

function json(body: FollowUpSendResponse, status = 200): Response {
  return Response.json(body, { status });
}
const EMPTY = { sent: 0, blocked: [], skipped: [] };

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ ok: false, error: "Forbidden.", ...EMPTY }, 403);
  const guard = await requirePermission(req, "followups.send");
  if (!guard.ok) return guardResponse(guard);

  const body = (await req.json().catch(() => null)) as { ids?: unknown } | null;
  const ids = Array.isArray(body?.ids) ? [...new Set(body.ids.filter(isUuid))] : [];
  if (ids.length === 0) return json({ ok: false, error: "Pick at least one draft to send.", ...EMPTY }, 400);
  if (ids.length > MAX_SEND_PER_REQUEST) {
    return json({ ok: false, error: `Send up to ${MAX_SEND_PER_REQUEST} follow-ups at a time.`, ...EMPTY }, 413);
  }

  const sb = supabaseTarget();
  if (sb.state !== "ok") return json({ ok: false, error: "Supabase isn't configured.", ...EMPTY }, 503);

  const rows = await readFollowUpsByIds(sb, ids);
  if (rows === "missing") return json({ ok: false, error: "Run supabase/follow-ups.sql first.", ...EMPTY }, 503);
  if (rows === "error") return json({ ok: false, error: "Couldn't read the drafts.", ...EMPTY }, 502);

  const skipped: FollowUpSendResponse["skipped"] = [];
  const blocked: FollowUpSendResponse["blocked"] = [];
  const drafts = rows.filter((r) => {
    if (r.status === "draft") return true;
    skipped.push({ leadId: r.lead_id, reason: "Already sent or closed" });
    return false;
  });
  if (drafts.length === 0) return json({ ok: true, ...EMPTY, skipped });

  const queue = await loadQueue(sb, { leadIds: drafts.map((r) => r.lead_id) });
  if (!queue.ok) return json({ ok: false, error: "Couldn't re-check eligibility, so nothing was sent.", ...EMPTY, skipped }, 502);
  const items = new Map(queue.items.map((i) => [i.leadId, i]));

  const stale: Array<{ row: FollowUpRow; reason: string }> = [];
  const byLead = new Map<string, FollowUpRow>();
  const seenEmail = new Set<string>();
  const recipients: CleanRecipient[] = [];
  for (const row of drafts) {
    const it = items.get(row.lead_id);
    if (!it || it.stage !== "awaiting" || it.draft?.id !== row.id || !it.email) {
      stale.push({ row, reason: it?.reason ?? "No longer eligible for a follow-up" });
      continue;
    }
    if (!row.subject?.trim() || !row.body_html?.trim()) {
      stale.push({ row, reason: "Draft is empty" });
      continue;
    }
    // One address, one sequence: the duplicate is closed for good, not just
    // left out of this send (loadQueue guards across requests).
    const email = it.email.toLowerCase();
    if (seenEmail.has(email)) {
      stale.push({ row, reason: "Same address as another follow-up" });
      continue;
    }
    seenEmail.add(email);
    byLead.set(row.lead_id, row);
    const svc = serviceBySlug(row.service_slug);
    const heroUrl = svc ? publicObjectUrl(SECTOR_ASSETS_BUCKET, svc.image) : null;
    recipients.push({
      id: row.lead_id,
      email: it.email,
      business: it.business ?? undefined,
      website: it.website ?? undefined,
      subject: row.subject.trim(),
      html: ensureLinkToken(row.body_html.trim()),
      category: it.category,
      hero: heroUrl && svc ? { url: heroUrl, alt: svc.imageAlt } : undefined,
      ledgerProps: { touch: String(row.touch) },
    });
  }

  for (const { row, reason } of stale) {
    skipped.push({ leadId: row.lead_id, reason });
    await patchFollowUps(sb, [row.id], { status: "skipped", note: reason }, "draft");
  }
  if (recipients.length === 0) return json({ ok: true, ...EMPTY, blocked, skipped });

  // Claim BEFORE delivering. Whatever another request (or a skip/redraft)
  // already moved out of `draft` comes back missing here, and is not sent.
  const claimed = await patchFollowUps(sb, [...byLead.values()].map((r) => r.id), { status: "sending" }, "draft");
  if (claimed === null) {
    return json({ ok: false, error: "Couldn't lock the drafts, so nothing was sent.", ...EMPTY, blocked, skipped }, 502);
  }
  const mine = new Set(claimed.map((r) => r.id));
  const toSend = recipients.filter((r) => mine.has(byLead.get(r.id)?.id ?? ""));
  for (const r of recipients) {
    if (!toSend.includes(r)) skipped.push({ leadId: r.id, reason: "Already being sent or closed" });
  }
  if (toSend.length === 0) return json({ ok: true, ...EMPTY, blocked, skipped });

  const out = await deliverCampaign({
    campaign: FOLLOW_UP_CAMPAIGN,
    base: process.env.NEXT_PUBLIC_TRACK_BASE || new URL(req.url).origin,
    recipients: toSend,
    ledgerProps: { kind: "follow_up" },
    label: "followups/send",
  });

  const settled = new Set<string>();
  for (const drop of out.drops) {
    const row = byLead.get(drop.id);
    if (!row || !mine.has(row.id)) continue;
    settled.add(row.id);
    blocked.push({ leadId: drop.id, reason: drop.reason });
    await patchFollowUps(sb, [row.id], { status: "blocked", note: drop.reason }, "sending");
  }

  // Not delivered: never a success, even with drops to report. What happens to
  // the claimed rows nobody dropped depends on whether n8n was ever called:
  // - paused / unconfigured / noop: the webhook was NOT called, so nothing can
  //   have gone out; they go back to draft, to be sent later.
  // - live (unreachable, timed out, non-2xx): n8n WAS called and may have sent
  //   some of them. They stay `sending` (outcome unknown), so nothing can
  //   re-send them; the queue tells the operator to check the Sent folder.
  if (!out.result.ok && out.deliveredIds.length === 0) {
    const error = out.result.error ?? "Nothing was sent.";
    const unclaimed = [...mine].filter((id) => !settled.has(id));
    if (out.result.mode === "live") {
      return json(
        {
          ok: false,
          error: `${error} The drafts were left locked because some emails may already have gone — check the outreach mailbox's Sent folder.`,
          mode: out.result.mode,
          ...EMPTY,
          blocked,
          skipped,
        },
        out.status,
      );
    }
    const reverted = unclaimed.length > 0 ? await patchFollowUps(sb, unclaimed, { status: "draft" }, "sending") : [];
    const stuck = unclaimed.length - (reverted?.length ?? 0);
    const warning =
      stuck > 0
        ? `Nothing was sent, but ${stuck} draft(s) couldn't be unlocked and will show as sending. Fix them in Supabase.`
        : undefined;
    if (warning) console.error(`[followups/send] ${warning}`);
    return json({ ok: false, error, mode: out.result.mode, ...EMPTY, blocked, skipped, warning }, out.status);
  }

  // If marking sent fails the rows stay `sending`: nothing can re-send them.
  const sentRowIds = out.deliveredIds.map((id) => byLead.get(id)?.id).filter((x): x is string => Boolean(x));
  const marked = await patchFollowUps(
    sb,
    sentRowIds,
    { status: "sent", sent_at: new Date().toISOString(), sent_by: guard.email },
    "sending",
  );
  const warning =
    marked === null || marked.length < sentRowIds.length
      ? `Sent, but ${sentRowIds.length - (marked?.length ?? 0)} draft(s) couldn't be marked as sent. Do not send them again. Refresh and check.`
      : undefined;
  if (warning) console.error(`[followups/send] ${warning}`);

  return json({ ok: true, mode: out.result.mode, sent: out.deliveredIds.length, blocked, skipped, warning });
}
