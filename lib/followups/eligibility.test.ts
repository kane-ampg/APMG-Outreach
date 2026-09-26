import { describe, expect, it } from "vitest";
import { classifyLead, emptySignals, rankedServices, scannerGap, sortQueue, type LeadGuard, type LeadSignals } from "./eligibility";
import type { FollowUpRow } from "./types";

const ID = "11111111-1111-4111-8111-111111111111";
const NOW = Date.parse("2026-09-25T02:00:00Z"); // Fri 25 Sep 12:00 local

function signals(over: Partial<LeadSignals> = {}): LeadSignals {
  return {
    ...emptySignals(ID),
    serviceOpens: { plumbing: 2, painting: 1 },
    firstServiceOpenAt: "2026-09-20T01:00:00Z",
    sends: ["2026-09-19T23:00:00Z"],
    ...over,
  };
}
const CONTACT = { business: "Acme Childcare", category: "Childcare", website: "acme.test", email: "info@acme.test", emails: ["info@acme.test"] };
const CLEAR: LeadGuard = { client: null, optedOut: false, sharedWith: null, clientWarning: null };

function row(over: Partial<FollowUpRow>): FollowUpRow {
  return {
    id: "row-" + (over.touch ?? 1),
    lead_id: ID,
    touch: 1,
    status: "draft",
    subject: "s",
    body_html: "<p>b {{link}}</p>",
    service_slug: "plumbing",
    model: "m",
    note: null,
    drafted_at: null,
    sent_at: null,
    sent_by: null,
    created_at: "2026-09-20T00:00:00Z",
    updated_at: "2026-09-20T00:00:00Z",
    ...over,
  };
}
const classify = (over: { s?: Partial<LeadSignals>; rows?: FollowUpRow[]; guard?: LeadGuard; contact?: typeof CONTACT | null } = {}) =>
  classifyLead({
    signals: signals(over.s),
    contact: over.contact === undefined ? CONTACT : over.contact,
    guard: over.guard ?? CLEAR,
    rows: over.rows ?? [],
    now: NOW,
  });

describe("classifyLead — who is in the pipeline", () => {
  it("ignores a lead that never opened a service (score < 66)", () => {
    expect(classify({ s: { serviceOpens: {} } })).toBeNull();
  });

  it("ignores opens of unknown service slugs", () => {
    expect(classify({ s: { serviceOpens: { "not-a-service": 9 } } })).toBeNull();
  });

  it("puts a fresh hot lead in ready for touch 1, leading with its most-opened service", () => {
    const item = classify();
    expect(item?.stage).toBe("ready");
    expect(item?.touch).toBe(1);
    expect(item?.service).toBe("plumbing");
    expect(item?.services).toEqual(["plumbing", "painting"]);
    expect(item?.score).toBeGreaterThanOrEqual(66);
  });

  it.each([
    [{ s: { inquiries: 1 } }, /enquired/i],
    [{ s: { handedOff: true } }, /with sales/i],
    [{ s: { returned: true, returnedNote: "we already work with them" } }, /^Returned by Sales: we already work with them$/],
    [{ s: { returned: true } }, /^Returned by Sales$/],
    [{ s: { archived: true } }, /archived/i],
    [{ contact: null }, /leads table/i],
    [{ contact: { ...CONTACT, email: null } }, /no email/i],
    [{ guard: { ...CLEAR, client: "Whittles" } }, /existing client \(Whittles\)/i],
    [{ guard: { ...CLEAR, optedOut: true } }, /opted out/i],
    [{ guard: { ...CLEAR, sharedWith: "Acme Kinder" } }, /^Same address as Acme Kinder \(already in follow-ups\)$/],
  ])("excludes %j", (over, reason) => {
    const item = classify(over as Parameters<typeof classify>[0]);
    expect(item?.stage).toBe("excluded");
    expect(item?.touch).toBeNull();
    expect(item?.reason).toMatch(reason);
  });

  it("shows a touch-1 draft as awaiting approval", () => {
    const item = classify({ rows: [row({ touch: 1, status: "draft" })] });
    expect(item?.stage).toBe("awaiting");
    expect(item?.touch).toBe(1);
    expect(item?.draft?.id).toBe("row-1");
  });

  it("waits for touch 2 until five business days have passed", () => {
    const item = classify({ rows: [row({ touch: 1, status: "sent", sent_at: "2026-09-21T00:00:00Z" })] });
    expect(item?.stage).toBe("waiting");
    expect(item?.touch).toBe(2);
    expect(item?.touch2DueOn).toBe("2026-09-28");
    expect(item?.touch1SentAt).toBe("2026-09-21T00:00:00Z");
  });

  it("makes touch 2 ready once due", () => {
    const item = classify({ rows: [row({ touch: 1, status: "sent", sent_at: "2026-09-14T00:00:00Z" })] });
    expect(item?.stage).toBe("ready");
    expect(item?.touch).toBe(2);
  });

  it("shows a touch-2 draft as awaiting", () => {
    const item = classify({
      rows: [row({ touch: 1, status: "sent", sent_at: "2026-09-14T00:00:00Z" }), row({ touch: 2, status: "draft" })],
    });
    expect(item?.stage).toBe("awaiting");
    expect(item?.touch).toBe(2);
  });

  it.each([
    [[row({ touch: 1, status: "sent", sent_at: "2026-09-01T00:00:00Z" }), row({ touch: 2, status: "sent" })], /both/i],
    [[row({ touch: 1, status: "skipped", note: "bot trail" })], /skipped: bot trail/i],
    [[row({ touch: 1, status: "sent", sent_at: "2026-09-21T00:00:00Z" }), row({ touch: 2, status: "replied" })], /replied/i],
    [[row({ touch: 1, status: "blocked", note: "Organisation opted out" })], /blocked: organisation opted out/i],
  ])("finishes the sequence: %#", (rows, reason) => {
    const item = classify({ rows });
    expect(item?.stage).toBe("done");
    expect(item?.reason).toMatch(reason);
  });

  it("checks exclusions before the rows, so a stale draft is not sendable", () => {
    const item = classify({ s: { inquiries: 1 }, rows: [row({ touch: 1, status: "draft" })] });
    expect(item?.stage).toBe("excluded");
  });

  it("keeps a Sales-returned lead out even with a waiting draft", () => {
    const item = classify({ s: { returned: true, returnedNote: "client" }, rows: [row({ touch: 1, status: "draft" })] });
    expect(item?.stage).toBe("excluded");
    expect(item?.reason).toBe("Returned by Sales: client");
  });

  it("shows an in-flight row as sending, with no draft to act on", () => {
    const item = classify({ rows: [row({ touch: 1, status: "sending" })] });
    expect(item?.stage).toBe("sending");
    expect(item?.touch).toBe(1);
    expect(item?.draft).toBeNull();
    expect(item?.reason).toMatch(/^Sending — if this stays here for more than a few minutes, check the outreach mailbox's Sent folder/);
  });

  it("shows touch 2 in flight as sending touch 2", () => {
    const item = classify({
      rows: [row({ touch: 1, status: "sent", sent_at: "2026-09-14T00:00:00Z" }), row({ touch: 2, status: "sending" })],
    });
    expect(item?.stage).toBe("sending");
    expect(item?.touch).toBe(2);
  });

  it("still excludes a sending row's lead when an exclusion applies", () => {
    const item = classify({ guard: { ...CLEAR, optedOut: true }, rows: [row({ touch: 1, status: "sending" })] });
    expect(item?.stage).toBe("excluded");
  });

  it("carries a client resemblance warning without excluding", () => {
    const item = classify({ guard: { ...CLEAR, clientWarning: "Hive Strata" } });
    expect(item?.stage).toBe("ready");
    expect(item?.clientWarning).toBe("Hive Strata");
    expect(classify()?.clientWarning).toBeNull();
  });
});

describe("scanner gap", () => {
  it("measures from the most recent send BEFORE the first open", () => {
    const s = signals({
      firstServiceOpenAt: "2026-09-20T00:00:30Z",
      sends: ["2026-09-19T00:00:00Z", "2026-09-20T00:00:00Z", "2026-09-22T00:00:00Z"],
    });
    expect(scannerGap(s)).toBe(30_000);
  });

  it("flags an open under 60s after delivery as a likely scanner", () => {
    const item = classify({ s: { firstServiceOpenAt: "2026-09-20T00:00:30Z", sends: ["2026-09-20T00:00:00Z"] } });
    expect(item?.likelyScanner).toBe(true);
    expect(item?.scannerGapSeconds).toBe(30);
  });

  it("does not flag when there is no earlier send", () => {
    const item = classify({ s: { sends: [] } });
    expect(item?.likelyScanner).toBe(false);
    expect(item?.scannerGapSeconds).toBeNull();
  });
});

describe("rankedServices / sortQueue", () => {
  it("ranks by opens, then slug, dropping unknown slugs", () => {
    expect(rankedServices({ painting: 1, plumbing: 3, electrical: 1, nope: 9 })).toEqual(["plumbing", "electrical", "painting"]);
  });

  it("orders awaiting, sending, ready, waiting, done, excluded — hottest first within a stage", () => {
    const base = classify()!;
    const items = [
      { ...base, leadId: "e", stage: "excluded" as const },
      { ...base, leadId: "r1", stage: "ready" as const, score: 70 },
      { ...base, leadId: "s", stage: "sending" as const },
      { ...base, leadId: "a", stage: "awaiting" as const },
      { ...base, leadId: "r2", stage: "ready" as const, score: 80 },
      { ...base, leadId: "w", stage: "waiting" as const },
      { ...base, leadId: "d", stage: "done" as const },
    ];
    expect(sortQueue(items).map((i) => i.leadId)).toEqual(["a", "s", "r2", "r1", "w", "d", "e"]);
  });
});
