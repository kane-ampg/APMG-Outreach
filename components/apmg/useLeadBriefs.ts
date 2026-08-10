"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { adminHeaders } from "@/lib/portal/adminKey";
import { type PortalInquiry } from "@/lib/data/enquiries";
import { type LeadActivity, type LeadActivityEvent } from "@/lib/data/leadActivity";

/**
 * The two reads behind the Sales queue's per-row "View", both keyed by lead id:
 *
 *   GET /api/portal/lead-activity → what the lead clicked (the whole brief, for
 *                                   the handed-over leads that never enquired —
 *                                   which is nearly all of them)
 *   GET /api/portal/inquiries     → their enquiry, on the rare row that has one,
 *                                   so Sales shows the same richer modal the
 *                                   Enquiries tab does rather than a thinner
 *                                   version of the same lead
 *
 * SECONDARY BY DESIGN, exactly like the Enquiries tab's trail read: a brief is
 * context, not the queue. Both reads resolve rather than throw, a failure lands
 * on `unavailable` (the modal says so), and the queue itself never waits on or
 * breaks over either one.
 *
 * Read ONCE on mount rather than per row: the payloads are small, capped
 * server-side, and shared across every row on the page — opening a modal must
 * not cost a round trip. The queue's own 20s poll (SalesProvider) is what keeps
 * the LIST live; a brief is only ever read when the rep opens one.
 *
 * Both endpoints sit behind the shared PORTAL_ADMIN_KEY secret (lib/portal/
 * adminKey), same as everywhere else that touches portal PII.
 */

export type BriefState = "loading" | "ready" | "unavailable";

export interface LeadBriefs {
  state: BriefState;
  /** the lead's click trail, or null when nothing is tracked for them */
  trailOf: (leadId: string) => LeadActivity | null;
  /** their most recent enquiry, or null — the usual case on this queue */
  enquiryOf: (leadId: string) => PortalInquiry | null;
}

const num = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? v : 0);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/** Rebuild one trail field-by-field so a partial payload can never leave an
 *  undefined array behind (the modal maps over `events`). Mirrors the
 *  normalisers in EnquiriesPage / TelemetryPage / lib/data/hotLeads. */
function toLead(v: unknown): LeadActivity | null {
  const o = (v ?? {}) as Partial<LeadActivity>;
  if (typeof o.leadId !== "string" || !o.leadId) return null;
  const events: LeadActivityEvent[] = (Array.isArray(o.events) ? o.events : [])
    .filter((e): e is LeadActivityEvent => {
      const ev = (e ?? {}) as Partial<LeadActivityEvent>;
      return typeof ev.event === "string" && typeof ev.ts === "string";
    })
    .map((e) => ({
      event: e.event,
      service: str(e.service),
      destination: str(e.destination),
      version: str(e.version),
      ts: e.ts,
    }));
  const c = (o.counts ?? {}) as Partial<LeadActivity["counts"]>;
  return {
    leadId: o.leadId,
    business: str(o.business),
    category: str(o.category),
    campaign: str(o.campaign),
    firstSeen: str(o.firstSeen) ?? events[0]?.ts ?? "",
    lastSeen: str(o.lastSeen) ?? events[events.length - 1]?.ts ?? "",
    events,
    counts: {
      emailClicks: num(c.emailClicks),
      portalViews: num(c.portalViews),
      serviceOpens: num(c.serviceOpens),
      inquiries: num(c.inquiries),
      chatPrompts: num(c.chatPrompts),
    },
  };
}

/** Newest enquiry per lead. The list arrives newest-first, so the first one
 *  seen for a lead wins and later (older) ones are skipped. */
function indexEnquiries(rows: PortalInquiry[]): Map<string, PortalInquiry> {
  const out = new Map<string, PortalInquiry>();
  for (const q of rows) {
    if (!q?.leadId || out.has(q.leadId)) continue;
    out.set(q.leadId, q);
  }
  return out;
}

const EMPTY_TRAILS: ReadonlyMap<string, LeadActivity> = new Map();
const EMPTY_ENQUIRIES: ReadonlyMap<string, PortalInquiry> = new Map();

export function useLeadBriefs(): LeadBriefs {
  const [state, setState] = useState<BriefState>("loading");
  const [trails, setTrails] = useState<ReadonlyMap<string, LeadActivity>>(EMPTY_TRAILS);
  const [enquiries, setEnquiries] =
    useState<ReadonlyMap<string, PortalInquiry>>(EMPTY_ENQUIRIES);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async () => {
    let ok = false;

    try {
      const res = await fetch("/api/portal/lead-activity", {
        cache: "no-store",
        headers: adminHeaders(),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; mode?: string; leads?: unknown }
        | null;
      if (!mounted.current) return;
      if (data?.mode === "demo") {
        // Not connected: no tracked trails or enquiries to show — an honest
        // empty brief rather than a fabricated one.
        setEnquiries(indexEnquiries([]));
        setState("ready");
        return;
      }
      if (res.ok && data?.ok) {
        const leads = (Array.isArray(data.leads) ? data.leads : [])
          .map(toLead)
          .filter((l): l is LeadActivity => l !== null);
        setTrails(new Map(leads.map((l) => [l.leadId, l])));
        ok = true;
      }
    } catch {
      /* handled by `ok` staying false */
    }
    if (!mounted.current) return;

    // The enquiry read is the softer of the two: a lead without one is the norm
    // here, so its failure must not turn a perfectly good trail into "unavailable".
    try {
      const res = await fetch("/api/portal/inquiries", {
        cache: "no-store",
        headers: adminHeaders(),
      });
      const data = (await res.json().catch(() => null)) as
        | { mode?: string; inquiries?: PortalInquiry[] }
        | null;
      if (!mounted.current) return;
      if (res.ok && Array.isArray(data?.inquiries)) {
        setEnquiries(indexEnquiries(data.inquiries));
      }
    } catch {
      /* the trail alone is a complete brief for these leads */
    }
    if (mounted.current) setState(ok ? "ready" : "unavailable");
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return useMemo<LeadBriefs>(
    () => ({
      state,
      trailOf: (leadId) => trails.get(leadId) ?? null,
      enquiryOf: (leadId) => enquiries.get(leadId) ?? null,
    }),
    [state, trails, enquiries],
  );
}
