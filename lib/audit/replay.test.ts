import { describe, expect, it } from "vitest";
import { type AuditRow } from "./types";
import { INITIAL_LEAD_STATE, replay, replayByLead } from "./replay";

/**
 * The reducer is the whole trust model: a lead's status is whatever its rows
 * fold to, so these tests are the specification of what the Sales desk shows.
 */

let seq = 0;
function row(partial: Partial<AuditRow> & Pick<AuditRow, "action">): AuditRow {
  seq += 1;
  return {
    id: `row-${String(seq).padStart(4, "0")}`,
    actorEmail: "rep@apmgservices.com.au",
    actorRole: "sales",
    actingAs: null,
    source: "claimed",
    leadId: "lead-1",
    targetEmail: null,
    note: null,
    valueCents: null,
    createdAt: `2026-08-09T10:${String(seq).padStart(2, "0")}:00.000Z`,
    ...partial,
  };
}

describe("replay", () => {
  it("a lead with no rows is new, not an error", () => {
    expect(replay([])).toEqual(INITIAL_LEAD_STATE);
  });

  it("folds a hand-off then a contact into contacted", () => {
    const state = replay([row({ action: "handoff" }), row({ action: "contacted" })]);
    expect(state.status).toBe("contacted");
  });

  it("carries the note, value, time and author off a win", () => {
    const state = replay([
      row({ action: "handoff" }),
      row({ action: "contacted" }),
      row({
        action: "closed_won",
        note: "Signed a 6-month retainer",
        valueCents: 1_200_000,
        actorEmail: "farbod@apmgservices.com.au",
        createdAt: "2026-08-09T14:22:00.000Z",
      }),
    ]);
    expect(state).toEqual({
      status: "closed_won",
      closedNote: "Signed a 6-month retainer",
      closedValueCents: 1_200_000,
      closedAt: "2026-08-09T14:22:00.000Z",
      closedBy: "farbod@apmgservices.com.au",
    });
  });

  it("records a loss with its note and no value", () => {
    const state = replay([row({ action: "closed_lost", note: "Already with a competitor" })]);
    expect(state.status).toBe("closed_lost");
    expect(state.closedNote).toBe("Already with a competitor");
    expect(state.closedValueCents).toBeNull();
  });

  it("reopening clears the close snapshot and returns to contacted when it had been contacted", () => {
    const state = replay([
      row({ action: "contacted" }),
      row({ action: "closed_won", note: "won", valueCents: 500_000 }),
      row({ action: "reopened" }),
    ]);
    expect(state).toEqual({
      status: "contacted",
      closedNote: null,
      closedValueCents: null,
      closedAt: null,
      closedBy: null,
    });
  });

  it("reopening a lead that was never contacted returns it to new", () => {
    const state = replay([
      row({ action: "closed_won", note: "won", valueCents: 500_000 }),
      row({ action: "reopened" }),
    ]);
    expect(state.status).toBe("new");
  });

  it("undoing a contact returns the lead to new", () => {
    const state = replay([row({ action: "contacted" }), row({ action: "uncontacted" })]);
    expect(state.status).toBe("new");
  });

  it("a later hand-off starts a fresh cycle, so an old close does not leak into it", () => {
    const state = replay([
      row({ action: "handoff" }),
      row({ action: "closed_lost", note: "not interested" }),
      row({ action: "returned", note: "already a client" }),
      row({ action: "handoff" }),
    ]);
    expect(state).toEqual(INITIAL_LEAD_STATE);
  });

  it("ignores actions that are not lead lifecycle", () => {
    const state = replay([
      row({ action: "contacted" }),
      row({ action: "campaign_send", source: "witnessed" }),
      row({ action: "view_as" }),
    ]);
    expect(state.status).toBe("contacted");
  });

  it("folds in time order regardless of input order, breaking ties on id", () => {
    const first = row({ action: "contacted", createdAt: "2026-08-09T10:00:00.000Z", id: "a" });
    const second = row({ action: "closed_lost", createdAt: "2026-08-09T10:00:00.000Z", id: "b" });
    expect(replay([second, first]).status).toBe("closed_lost");
    expect(replay([first, second]).status).toBe("closed_lost");
  });

  it("groups by lead, ignoring rows with no lead id", () => {
    const byLead = replayByLead([
      row({ action: "contacted", leadId: "lead-1" }),
      row({ action: "closed_lost", note: "no", leadId: "lead-2" }),
      row({ action: "role_change", leadId: null }),
    ]);
    expect(byLead.get("lead-1")?.status).toBe("contacted");
    expect(byLead.get("lead-2")?.status).toBe("closed_lost");
    expect(byLead.size).toBe(2);
  });
});
