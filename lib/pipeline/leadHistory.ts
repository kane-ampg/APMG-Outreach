import "server-only";
import { isUuid } from "@/lib/pipeline/server";
import { CUSTOMER_JOURNEY_EVENTS, isMissingPortalTable } from "@/lib/portal/server";
import { daysSince, type LeadHistory } from "@/lib/ai/followUpPrompt";

/**
 * "Have we emailed this lead before, and what did they do about it?" — read in
 * ONE batch for a whole compose run.
 *
 * The compose route drafts up to a few hundred leads per request, so the answer
 * has to arrive in a fixed number of round trips rather than two per lead. Two
 * chunked PostgREST GETs do it:
 *
 *   1. the `email_sent` ledger for the selected leads  → who has been mailed,
 *      how many times, and when the most recent one went out;
 *   2. the customer-journey trail, for THOSE LEADS ONLY → which services they
 *      opened on the portal, and whether anything came back at all.
 *
 * The second read is scoped to already-mailed leads because that's the only
 * cohort whose answer changes anything: a lead with no send composes cold, and
 * its trail would be thrown away.
 *
 * DEGRADES TO EMPTY, ALWAYS. Every failure path — no Supabase, missing tables,
 * RLS, a network blip — returns an empty map, and every lead in the batch then
 * composes exactly as it does today. Follow-up wording is an improvement on a
 * cold email, never a prerequisite for sending one.
 *
 * Server-only: takes the Supabase service-role key.
 */

const SENT_EVENT = "email_sent";
const SERVICE_EVENT = "portal_service_open";

/** Chunk the id list so a large folder can't build an over-long request URL —
 *  same ceiling as countEmailsSentByLead in lib/portal/server. */
const CHUNK = 200;

/** A lead's trail is small, but a scanner-hammered one is not. Bound the read;
 *  the tallies only need enough rows to rank three services. */
const EVENTS_LIMIT = 2_000;

export type { LeadHistory };

type SentRow = { lead_id?: unknown; created_at?: unknown };
type TrailRow = { lead_id?: unknown; event?: unknown; props?: Record<string, unknown> | null };

function restGet(base: string, key: string, pathAndQuery: string): Promise<Response> {
  return fetch(`${base}/rest/v1/${pathAndQuery}`, {
    headers: { apikey: key, Authorization: `Bearer ${key}` },
    cache: "no-store",
  });
}

/**
 * Read the send history + engagement trail for a batch of leads.
 *
 * Returns a leadId → LeadHistory map containing ONLY leads with at least one
 * `email_sent` row; a lead absent from the map has never been emailed and gets
 * the normal cold prompt. `label` names the calling surface in server logs.
 */
export async function readLeadHistories(
  base: string,
  key: string,
  leadIds: string[],
  label = "compose",
): Promise<Map<string, LeadHistory>> {
  const ids = [...new Set(leadIds.filter(isUuid))];
  const histories = new Map<string, LeadHistory>();
  if (ids.length === 0) return histories;

  // ── 1. the send ledger ────────────────────────────────────────────────────
  const lastSent = new Map<string, string>();
  try {
    for (let i = 0; i < ids.length; i += CHUNK) {
      const inList = ids.slice(i, i + CHUNK).join(",");
      const res = await restGet(
        base,
        key,
        `portal_events?select=lead_id,created_at&event=eq.${SENT_EVENT}&lead_id=in.(${inList})`,
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (!isMissingPortalTable(res.status, detail)) {
          console.error(`[${label}] send-history read ${res.status}:`, detail.slice(0, 300));
        }
        // Partial history is worse than none: half the batch would compose as
        // follow-ups and half as cold introductions, for no reason the operator
        // could see. Give up cleanly and let the whole run be cold.
        return new Map();
      }
      for (const row of ((await res.json().catch(() => [])) as SentRow[]) ?? []) {
        const id = typeof row.lead_id === "string" ? row.lead_id : "";
        if (!id) continue;
        const prev = histories.get(id);
        if (prev) prev.sends += 1;
        else {
          histories.set(id, {
            sends: 1,
            lastSentAt: null,
            daysSince: 0,
            services: [],
            engaged: false,
          });
        }
        const at = typeof row.created_at === "string" ? row.created_at : "";
        if (at && (!lastSent.has(id) || at > (lastSent.get(id) as string))) lastSent.set(id, at);
      }
    }
  } catch (e) {
    console.error(`[${label}] send-history read failed:`, e);
    return new Map();
  }

  if (histories.size === 0) return histories;
  for (const [id, h] of histories) {
    const at = lastSent.get(id) ?? null;
    h.lastSentAt = at;
    h.daysSince = daysSince(at);
  }

  // ── 2. the trail, for the mailed leads only ───────────────────────────────
  // Best-effort in its own right: a trail we can't read costs the follow-ups
  // their service steer, not the follow-up wording itself.
  const mailed = [...histories.keys()];
  const opens = new Map<string, Map<string, number>>();
  try {
    for (let i = 0; i < mailed.length; i += CHUNK) {
      const inList = mailed.slice(i, i + CHUNK).join(",");
      const res = await restGet(
        base,
        key,
        `portal_events?select=lead_id,event,props&lead_id=in.(${inList})` +
          `&event=in.(${CUSTOMER_JOURNEY_EVENTS.join(",")})` +
          `&order=created_at.desc&limit=${EVENTS_LIMIT}`,
      );
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        if (!isMissingPortalTable(res.status, detail)) {
          console.error(`[${label}] trail read ${res.status}:`, detail.slice(0, 300));
        }
        break; // keep the send history; drop the service steer
      }
      for (const row of ((await res.json().catch(() => [])) as TrailRow[]) ?? []) {
        const id = typeof row.lead_id === "string" ? row.lead_id : "";
        const h = id ? histories.get(id) : undefined;
        if (!h) continue;
        h.engaged = true;
        if (row.event !== SERVICE_EVENT) continue;
        const slug = typeof row.props?.service === "string" ? row.props.service.trim() : "";
        if (!slug) continue;
        const tally = opens.get(id) ?? new Map<string, number>();
        tally.set(slug, (tally.get(slug) ?? 0) + 1);
        opens.set(id, tally);
      }
    }
  } catch (e) {
    console.error(`[${label}] trail read failed:`, e);
  }

  // Rank each lead's services most-opened first, so the email leads with what
  // they came back to rather than whatever they happened to click last.
  for (const [id, tally] of opens) {
    const h = histories.get(id);
    if (!h) continue;
    h.services = [...tally.entries()].sort((a, b) => b[1] - a[1]).map(([slug]) => slug);
  }

  return histories;
}
