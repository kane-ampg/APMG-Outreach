# Console Audit Trail Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist every Sales interaction to an append-only table attributed to the Google SSO identity that performed it, derive lead status from that table, and give admins a readable trail with timestamp, actor, note and value.

**Architecture:** One `console_audit` table is the source of truth. A lead's status is *replayed* by folding its rows in time order, so state cannot exist without an author. Route handlers read the actor from the verified session cookie — never from the request body — and a failed audit insert fails the request.

**Tech Stack:** Next.js App Router (route handlers, `runtime = "nodejs"`), TypeScript, Supabase via raw PostgREST `fetch`, Vitest (node environment), Tailwind.

## Global Constraints

- Spec: `docs/superpowers/specs/2026-08-09-console-audit-trail-design.md`.
- Branch: `feat/console-audit-trail` (already created; the spec is committed on it).
- Money is **AUD integer cents** in storage and over the wire. Dollars exist only inside form inputs and formatters.
- Client-safe contract modules must never `import "server-only"` — they are imported by both route handlers and client components (pattern: `lib/sales/queue.ts`).
- Route handlers: `export const runtime = "nodejs"`, then `sameOrigin(req)` → `requirePermission` → `guardResponse`, a local `json()` helper spreading a fully-typed default body, and `console.error("[area/route] …", detail.slice(0, 500))` on failures.
- PostgREST reads always pass `cache: "no-store"` and `apikey` + `Authorization` headers.
- Any test importing `lib/rbac/server.ts` needs `vi.mock("server-only", () => ({}))`.
- `vitest.config.ts` includes only `lib/**/*.test.ts` and `app/**/*.test.ts`. There are no component tests — do not write one and expect it to run.
- Repo comment style: block comments explain **why**, not what. Match it.
- Run tests with `npx vitest run <path>`.

**Naming deviation from the spec:** the spec called the reducer module `lib/sales/audit.ts`. It is split into `lib/audit/types.ts` + `lib/audit/replay.ts` because the trail covers more than Sales (sends, view-as, role changes) and a `lib/sales/` home would misfile it.

## File Structure

**Create**
- `supabase/console-audit.sql` — the table, its indexes, and the `role_change_log` drop.
- `lib/audit/types.ts` — client-safe: action catalog, `AuditRow`, display labels.
- `lib/audit/replay.ts` — client-safe pure reducer: `LeadState`, `replay()`.
- `lib/audit/replay.test.ts` — reducer unit tests.
- `lib/audit/write.ts` — server-only writer, `recordAudit()`.
- `lib/audit/log.ts` — client-safe contract for the admin read API.
- `lib/sales/status.ts` — client-safe contract for `POST /api/sales/status`.
- `app/api/sales/status/route.ts` + `route.test.ts` — the write endpoint.
- `app/api/admin/audit/route.ts` + `route.test.ts` — the admin read endpoint.
- `components/apmg/AuditPage.tsx` — the Audit tab.
- `components/apmg/LeadDecisionHistory.tsx` — per-lead history block.

**Modify**
- `supabase/app-users.sql` — remove the `role_change_log` block.
- `supabase/schema.sql` — footer pointer to the new migration.
- `lib/rbac/server.ts` + `server.test.ts` — widen `GuardResult`.
- `lib/rbac/permissions.ts`, `lib/rbac/sections.ts` — add `audit.view`.
- `lib/nav.ts` — `TabId`, `NAV` System items, `TAB_LABEL`.
- `components/apmg/DashboardShell.tsx` — render the Audit tab, pass `user` to `SalesPage`.
- `app/api/sales/queue/route.ts` — fold audit rows into row status + `statusTotals`.
- `lib/sales/queue.ts` — add `status` to `SalesQueueRow`, `statusTotals` to the response.
- `components/apmg/SalesProvider.tsx` — server state replaces in-memory maps.
- `components/apmg/SalesPage.tsx` — rep name from session; lost-deal modal.
- `components/apmg/CloseDealModal.tsx` — reused for losses; AUD label.
- `lib/data/sales.ts` — delete `SALES_LEADS` and `SALES_REP` (keep the types).

---

### Task 1: The `console_audit` migration

**Files:**
- Create: `supabase/console-audit.sql`
- Modify: `supabase/app-users.sql:54-74` (remove the `role_change_log` block)
- Modify: `supabase/schema.sql` (footer pointer)

**Interfaces:**
- Consumes: nothing.
- Produces: table `public.console_audit` with columns `id, action, actor_email, actor_role, acting_as, source, lead_id, target_email, note, value_cents, meta, created_at`.

- [ ] **Step 1: Write the migration**

Create `supabase/console-audit.sql`:

```sql
-- APMG Lead Gen — the console audit trail.
--
-- One append-only row per operator action: who did it (their verified Google
-- SSO address), what they did, to which lead or user, and the note and value
-- they entered. A lead's Sales status is REPLAYED from these rows rather than
-- stored anywhere, which is the point: a closed deal cannot exist without the
-- row naming the person who closed it.
--
-- Deliberately NOT a foreign key on lead_id or target_email: the log must
-- outlive the row it describes, or reimporting a lead (which happens on every
-- scrape) or deleting a user would erase exactly the history an audit log
-- exists to keep. Same rule portal_events already follows for lead_id.

create table if not exists public.console_audit (
  id           uuid primary key default gen_random_uuid(),
  action       text not null,
  -- The verified session identity. Never accepted from a request body.
  actor_email  text not null,
  actor_role   text not null,
  -- Non-null ONLY when an admin performed this while previewing another role,
  -- so "was this impersonated?" is a null check rather than a join.
  acting_as    text,
  -- 'claimed'   — a human asserted it (marked contacted, closed a deal)
  -- 'witnessed' — the system observed it (send accepted by the automation)
  source       text not null default 'claimed'
               check (source in ('claimed', 'witnessed')),
  lead_id      uuid,
  target_email text,
  note         text,
  -- AUD cents. Integers only — money never round-trips through a float.
  value_cents  bigint,
  -- Action-specific detail: from_role/to_role, campaign, recipient count,
  -- resolved webhook mode. Kept out of columns so adding an action never
  -- needs a migration.
  meta         jsonb not null default '{}'::jsonb,
  created_at   timestamptz not null default now()
);

-- The replay read: every row for a set of leads, in fold order.
create index if not exists console_audit_lead_idx
  on public.console_audit (lead_id, created_at);
-- The Audit tab's default view.
create index if not exists console_audit_created_idx
  on public.console_audit (created_at desc);
-- "What did this person do?"
create index if not exists console_audit_actor_idx
  on public.console_audit (actor_email);

-- RLS on with NO policies: the service role bypasses it, so the app is
-- unaffected, but an anon key could never read the trail if one is ever
-- introduced client-side.
alter table public.console_audit enable row level security;

-- Supersedes role_change_log (formerly in app-users.sql), which declared a
-- writer that was never built and therefore held zero rows. Role changes are
-- recorded here now, as action in ('role_change','invite','force_logout')
-- with target_email set. Two audit logs is worse than one.
drop table if exists public.role_change_log;
```

- [ ] **Step 2: Remove the superseded block**

Delete lines 54-74 of `supabase/app-users.sql` (the comment block, `create table … role_change_log`, its index, and its `enable row level security`). Replace with:

```sql
-- Access changes are recorded in console_audit (supabase/console-audit.sql),
-- not here. This file used to declare a role_change_log table whose writer was
-- never built; console-audit.sql drops it.
```

- [ ] **Step 3: Announce the migration from schema.sql**

In `supabase/schema.sql`, in the same footer band that announces `portal-telemetry.sql` (around line 91), add:

```sql
--   supabase/console-audit.sql   — the operator audit trail (console_audit);
--                                  every Sales close, hand-off and send, with
--                                  the SSO identity that performed it.
```

- [ ] **Step 4: Run it**

Open the Supabase SQL editor for project `iskvglrdgqubwcmyjsbq` and run `supabase/console-audit.sql` in full. It is idempotent — re-running is safe.

- [ ] **Step 5: Verify the table exists and is empty**

```bash
SB=$(awk -F= '/^SUPABASE_URL=/{print $2}' .env.local | tr -d '\r"')
KEY=$(awk -F= '/^SUPABASE_SERVICE_ROLE_KEY=/{print substr($0,index($0,"=")+1)}' .env.local | tr -d '\r"')
curl -s -D - -o /dev/null -G "$SB/rest/v1/console_audit" \
  --data-urlencode "select=id" --data-urlencode "limit=1" \
  -H "apikey: $KEY" -H "Authorization: Bearer $KEY" -H "Prefer: count=exact" | grep -i content-range
```

Expected: `Content-Range: */0`. A 404 means the migration did not run.

- [ ] **Step 6: Commit**

```bash
git add supabase/console-audit.sql supabase/app-users.sql supabase/schema.sql
git commit -m "feat: add console_audit table, superseding the unused role_change_log"
```

---

### Task 2: Action catalog and types

**Files:**
- Create: `lib/audit/types.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: `AuditAction`, `AuditSource`, `AuditRow`, `LEAD_ACTIONS`, `isLeadAction()`, `ACTION_LABEL`, `MIN_NOTE_LEN`.

- [ ] **Step 1: Write the module**

```ts
// Client-safe audit vocabulary: the action catalog, the row shape the API
// returns, and display labels. Imported by route handlers AND by the Audit
// tab, so it must never import `server-only` (same rule as lib/sales/queue.ts).

/** Actions that move a lead through the Sales desk. Replayed into status. */
export const LEAD_ACTIONS = [
  "handoff",
  "contacted",
  "uncontacted",
  "closed_won",
  "closed_lost",
  "reopened",
  "returned",
] as const;

/** Actions recorded for the trail but which never change a lead's status. */
export const ADMIN_ACTIONS = [
  "campaign_send",
  "role_change",
  "invite",
  "force_logout",
  "view_as",
] as const;

export type LeadAction = (typeof LEAD_ACTIONS)[number];
export type AdminAction = (typeof ADMIN_ACTIONS)[number];
export type AuditAction = LeadAction | AdminAction;

export function isLeadAction(v: unknown): v is LeadAction {
  return typeof v === "string" && (LEAD_ACTIONS as readonly string[]).includes(v);
}

/**
 * Whether a human asserted the action or the system observed it.
 *
 * The distinction is the honest answer to "is this proof?": marking a lead
 * contacted is a claim a named person stakes their account on, while a send
 * accepted by the automation is something the server actually saw. The Audit
 * tab badges them differently so an admin never mistakes one for the other.
 */
export type AuditSource = "claimed" | "witnessed";

/** One audit row as the API returns it (camelCase; the table is snake_case). */
export interface AuditRow {
  id: string;
  action: AuditAction;
  actorEmail: string;
  actorRole: string;
  /** set only when an admin acted while previewing another role */
  actingAs: string | null;
  source: AuditSource;
  leadId: string | null;
  targetEmail: string | null;
  note: string | null;
  /** AUD cents */
  valueCents: number | null;
  createdAt: string;
}

export const ACTION_LABEL: Record<AuditAction, string> = {
  handoff: "Handed to Sales",
  contacted: "Marked contacted",
  uncontacted: "Undid contacted",
  closed_won: "Closed won",
  closed_lost: "Closed lost",
  reopened: "Reopened",
  returned: "Returned to admin",
  campaign_send: "Sent campaign",
  role_change: "Changed role",
  invite: "Invited user",
  force_logout: "Forced sign-out",
  view_as: "Viewed as another role",
};

/**
 * Minimum closing-note length. Shared with CloseDealModal rather than
 * redeclared there — the server rule and the button's enable rule must be the
 * same number or the UI enables a submit the API rejects.
 */
export const MIN_NOTE_LEN = 3;
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors from `lib/audit/types.ts`.

- [ ] **Step 3: Commit**

```bash
git add lib/audit/types.ts
git commit -m "feat: add the console audit action catalog and row types"
```

---

### Task 3: The replay reducer

**Files:**
- Create: `lib/audit/replay.test.ts`
- Create: `lib/audit/replay.ts`

**Interfaces:**
- Consumes: `AuditRow`, `LeadAction` from `lib/audit/types.ts`.
- Produces: `SalesStatus`, `LeadState`, `INITIAL_LEAD_STATE`, `replay(rows: AuditRow[]): LeadState`, `replayByLead(rows: AuditRow[]): Map<string, LeadState>`.

- [ ] **Step 1: Write the failing tests**

Create `lib/audit/replay.test.ts`:

```ts
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
    const state = replay([
      row({ action: "closed_lost", note: "Already with a competitor" }),
    ]);
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
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run lib/audit/replay.test.ts`
Expected: FAIL — `Failed to resolve import "./replay"`.

- [ ] **Step 3: Write the reducer**

Create `lib/audit/replay.ts`:

```ts
import { isLeadAction, type AuditRow } from "./types";

/**
 * Deriving a lead's Sales status by folding its audit rows.
 *
 * Status is NOT stored anywhere. That is deliberate: the fold makes it
 * impossible for a closed deal to exist without the row naming who closed it,
 * which is the guarantee the whole audit trail exists to provide. Pure and
 * dependency-free so it can be unit-tested without a database and reused on
 * both sides of the wire.
 */

export type SalesStatus = "new" | "contacted" | "closed_won" | "closed_lost";

export interface LeadState {
  status: SalesStatus;
  closedNote: string | null;
  /** AUD cents; null on a loss or an open lead */
  closedValueCents: number | null;
  closedAt: string | null;
  /** the SSO address that closed it */
  closedBy: string | null;
}

export const INITIAL_LEAD_STATE: LeadState = {
  status: "new",
  closedNote: null,
  closedValueCents: null,
  closedAt: null,
  closedBy: null,
};

/** Fold order. The id tiebreaker is required for determinism when two rows
 *  share a timestamp, and matches the ordering the queue route already uses. */
function inFoldOrder(rows: AuditRow[]): AuditRow[] {
  return [...rows].sort((a, b) =>
    a.createdAt === b.createdAt
      ? a.id < b.id
        ? -1
        : a.id > b.id
          ? 1
          : 0
      : a.createdAt < b.createdAt
        ? -1
        : 1,
  );
}

export function replay(rows: AuditRow[]): LeadState {
  let state: LeadState = { ...INITIAL_LEAD_STATE };
  // Whether a contact was claimed in the CURRENT desk cycle — that is what a
  // reopen falls back to, so reopening a worked deal doesn't pretend the calls
  // never happened, and reopening one closed straight from new doesn't invent
  // a contact that was never claimed.
  let contactedThisCycle = false;

  for (const r of inFoldOrder(rows)) {
    if (!isLeadAction(r.action)) continue;
    switch (r.action) {
      // A hand-off starts a fresh cycle, and a return ends one. Both reset:
      // without this, a lead returned to admin and later handed over again
      // would replay its previous outcome forever.
      case "handoff":
      case "returned":
        state = { ...INITIAL_LEAD_STATE };
        contactedThisCycle = false;
        break;
      case "contacted":
        state = { ...INITIAL_LEAD_STATE, status: "contacted" };
        contactedThisCycle = true;
        break;
      case "uncontacted":
        state = { ...INITIAL_LEAD_STATE };
        contactedThisCycle = false;
        break;
      case "closed_won":
        state = {
          status: "closed_won",
          closedNote: r.note,
          closedValueCents: r.valueCents,
          closedAt: r.createdAt,
          closedBy: r.actorEmail,
        };
        break;
      case "closed_lost":
        state = {
          status: "closed_lost",
          closedNote: r.note,
          closedValueCents: null,
          closedAt: r.createdAt,
          closedBy: r.actorEmail,
        };
        break;
      case "reopened":
        state = {
          ...INITIAL_LEAD_STATE,
          status: contactedThisCycle ? "contacted" : "new",
        };
        break;
    }
  }
  return state;
}

/** Replay many leads at once. Rows with no lead id (role changes, view-as)
 *  are skipped — they belong to the trail, not to any lead's status. */
export function replayByLead(rows: AuditRow[]): Map<string, LeadState> {
  const grouped = new Map<string, AuditRow[]>();
  for (const r of rows) {
    if (!r.leadId) continue;
    const list = grouped.get(r.leadId);
    if (list) list.push(r);
    else grouped.set(r.leadId, [r]);
  }
  const out = new Map<string, LeadState>();
  for (const [leadId, leadRows] of grouped) out.set(leadId, replay(leadRows));
  return out;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/audit/replay.test.ts`
Expected: PASS, 11 tests.

- [ ] **Step 5: Commit**

```bash
git add lib/audit/replay.ts lib/audit/replay.test.ts
git commit -m "feat: derive Sales lead status by replaying audit rows"
```

---

### Task 4: Widen `GuardResult` to carry the actor

**Files:**
- Modify: `lib/rbac/server.ts:64-78`
- Modify: `lib/rbac/server.test.ts:140-147, 170-177`

**Interfaces:**
- Consumes: `ResolvedSession` (already exists).
- Produces: `GuardResult` success shape `{ ok: true, role, email, trueRole, actingAs }` — every later task reads `guard.email`, `guard.role` and `guard.actingAs`.

- [ ] **Step 1: Update the two failing assertions first**

In `lib/rbac/server.test.ts`, the two `toEqual` assertions on a successful guard fail on extra properties. At line ~147:

```ts
    expect(guard).toEqual({
      ok: true,
      role: "sales",
      email: "rep@apmgservices.com.au",
      trueRole: "sales",
      actingAs: null,
    });
```

And at line ~177 (admin viewing as sales — this is the case that proves impersonation is captured):

```ts
    expect(guard).toEqual({
      ok: true,
      role: "sales",
      email: "kane@apmgservices.com.au",
      trueRole: "admin",
      actingAs: "sales",
    });
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run lib/rbac/server.test.ts`
Expected: FAIL — the two updated tests report missing `trueRole` / `actingAs`.

- [ ] **Step 3: Widen the type and the return**

In `lib/rbac/server.ts`, replace the `GuardResult` type and the success return:

```ts
export type GuardResult =
  | {
      ok: true;
      /** effective role — what enforcement used */
      role: Role;
      email: string;
      /** what app_users says they are, regardless of any view-as */
      trueRole: Role;
      /**
       * The role being previewed, or null when they are simply themselves.
       *
       * Carried so the audit trail can say "kane@ (as sales)". Without it an
       * admin acting while impersonating is indistinguishable in the record
       * from the rep whose seat they borrowed.
       */
      actingAs: Role | null;
    }
  | { ok: false; status: 401 | 403; error: string };

export async function requirePermission(
  req: Request,
  perm: Permission,
): Promise<GuardResult> {
  const session = await resolveSession(req);
  if (!session) return { ok: false, status: 401, error: "Not authenticated" };
  if (!roleCan(session.role, perm)) {
    return { ok: false, status: 403, error: `Forbidden — missing permission: ${perm}` };
  }
  return {
    ok: true,
    role: session.role,
    email: session.email,
    trueRole: session.trueRole,
    actingAs: session.role === session.trueRole ? null : session.role,
  };
}
```

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run lib/rbac/server.test.ts`
Expected: PASS, all tests.

- [ ] **Step 5: Typecheck the whole repo**

Run: `npx tsc --noEmit`
Expected: no errors. Existing callers destructure `guard.ok` / `guard.email` and are unaffected by added fields.

- [ ] **Step 6: Commit**

```bash
git add lib/rbac/server.ts lib/rbac/server.test.ts
git commit -m "feat: carry the true role and impersonation through the permission guard"
```

---

### Task 5: The audit writer

**Files:**
- Create: `lib/audit/write.ts`

**Interfaces:**
- Consumes: `supabaseTarget()` from `lib/pipeline/server.ts`; `isMissingPortalTable()` from `lib/portal/server.ts`; `AuditAction`, `AuditSource` from `lib/audit/types.ts`; `GuardResult` success shape from Task 4.
- Produces: `AuditActor`, `AuditEntry`, `AuditWriteResult`, `actorFromGuard(guard)`, `recordAudit(actor, entry): Promise<AuditWriteResult>`.

- [ ] **Step 1: Write the module**

```ts
import "server-only";
import { supabaseTarget } from "@/lib/pipeline/server";
import { isMissingPortalTable } from "@/lib/portal/server";
import { type AuditAction, type AuditSource } from "./types";

/**
 * The audit writer.
 *
 * Its contract is deliberately the INVERSE of insertPortalEvents: that helper
 * returns false and lets callers shrug, because a missed telemetry beacon is
 * not worth failing a page load. An audit row is not telemetry — if we cannot
 * record who did something, the something must not be treated as done. Every
 * caller is expected to fail its request on anything but `ok`.
 */

export interface AuditActor {
  email: string;
  role: string;
  /** non-null only while previewing another role */
  actingAs: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  /** defaults to 'claimed' — pass 'witnessed' only for things the server saw */
  source?: AuditSource;
  leadId?: string | null;
  targetEmail?: string | null;
  note?: string | null;
  /** AUD cents */
  valueCents?: number | null;
  meta?: Record<string, unknown>;
}

export type AuditWriteResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "missing_table" | "error" };

/** Narrow a successful permission guard to just the identity the trail needs. */
export function actorFromGuard(guard: {
  email: string;
  role: string;
  actingAs: string | null;
}): AuditActor {
  return { email: guard.email, role: guard.role, actingAs: guard.actingAs };
}

export async function recordAudit(
  actor: AuditActor,
  entries: AuditEntry | AuditEntry[],
): Promise<AuditWriteResult> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return { ok: true };

  const target = supabaseTarget();
  if (target.state !== "ok") return { ok: false, reason: "unconfigured" };

  const rows = list.map((e) => ({
    action: e.action,
    actor_email: actor.email,
    actor_role: actor.role,
    acting_as: actor.actingAs,
    source: e.source ?? "claimed",
    lead_id: e.leadId ?? null,
    target_email: e.targetEmail ?? null,
    note: e.note ?? null,
    value_cents: e.valueCents ?? null,
    meta: e.meta ?? {},
  }));

  try {
    const res = await fetch(`${target.base}/rest/v1/console_audit`, {
      method: "POST",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (res.ok) return { ok: true };
    const detail = await res.text().catch(() => "");
    console.error(`[audit] console_audit insert ${res.status}:`, detail.slice(0, 500));
    return {
      ok: false,
      reason: isMissingPortalTable(res.status, detail) ? "missing_table" : "error",
    };
  } catch (e) {
    console.error("[audit] console_audit insert failed:", e);
    return { ok: false, reason: "error" };
  }
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add lib/audit/write.ts
git commit -m "feat: add recordAudit, whose failure fails the caller's request"
```

---

### Task 6: `POST /api/sales/status`

**Files:**
- Create: `lib/sales/status.ts`
- Create: `app/api/sales/status/route.ts`
- Create: `app/api/sales/status/route.test.ts`

**Interfaces:**
- Consumes: `recordAudit`, `actorFromGuard` (Task 5); `replay` (Task 3); `isLeadAction`, `MIN_NOTE_LEN` (Task 2); `requirePermission`, `guardResponse` (Task 4); `isUuid`, `sameOrigin`, `supabaseTarget` from `lib/pipeline/server.ts`.
- Produces: `SalesStatusRequest`, `SalesStatusResponse` in `lib/sales/status.ts`; the route itself.

- [ ] **Step 1: Write the contract module**

Create `lib/sales/status.ts`:

```ts
import { type LeadState } from "@/lib/audit/replay";
import { type LeadAction } from "@/lib/audit/types";

// Shared contract for POST /api/sales/status. Client-safe (types only), so the
// route and SalesProvider cannot drift — same pattern as lib/sales/queue.ts.

/** Actions a rep may take from the Sales desk. `handoff` and `returned` are
 *  deliberately absent: they belong to /api/sales/handoff, which owns the
 *  ledger row that actually gates queue membership. */
export type SalesStatusAction = Exclude<LeadAction, "handoff" | "returned">;

export interface SalesStatusRequest {
  leadId: string;
  action: SalesStatusAction;
  note?: string;
  /** AUD cents; required on closed_won */
  valueCents?: number;
}

export interface SalesStatusResponse {
  ok: boolean;
  /** the lead's state AFTER the write, replayed from the trail */
  state?: LeadState;
  error?: string;
}
```

- [ ] **Step 2: Write the failing tests**

Create `app/api/sales/status/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rbac/server", () => ({
  requirePermission: vi.fn(),
  guardResponse: (g: { status: number; error: string }) =>
    Response.json({ error: g.error }, { status: g.status }),
}));
vi.mock("@/lib/audit/write", () => ({
  recordAudit: vi.fn(),
  actorFromGuard: (g: { email: string; role: string; actingAs: string | null }) => ({
    email: g.email,
    role: g.role,
    actingAs: g.actingAs,
  }),
}));
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }) };
});

import { recordAudit } from "@/lib/audit/write";
import { requirePermission } from "@/lib/rbac/server";
import { POST } from "./route";

const mockGuard = vi.mocked(requirePermission);
const mockRecord = vi.mocked(recordAudit);

const LEAD = "0df6326c-42ce-46f6-805c-8d03ec6f493f";

function req(body: unknown): Request {
  return new Request("http://localhost/api/sales/status", {
    method: "POST",
    headers: { origin: "http://localhost", host: "localhost", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function allow() {
  mockGuard.mockResolvedValue({
    ok: true,
    role: "sales",
    email: "rep@apmgservices.com.au",
    trueRole: "sales",
    actingAs: null,
  });
}

beforeEach(() => {
  mockGuard.mockReset();
  mockRecord.mockReset();
  mockRecord.mockResolvedValue({ ok: true });
  // the route re-reads the lead's rows after writing; empty history is fine
  vi.stubGlobal("fetch", vi.fn(async () => Response.json([])));
});

describe("POST /api/sales/status", () => {
  it("401s when the guard refuses", async () => {
    mockGuard.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    const res = await POST(req({ leadId: LEAD, action: "contacted" }));
    expect(res.status).toBe(401);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects a lead id that is not a uuid", async () => {
    allow();
    const res = await POST(req({ leadId: "not-a-uuid", action: "contacted" }));
    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects an unknown action", async () => {
    allow();
    const res = await POST(req({ leadId: LEAD, action: "deleted" }));
    expect(res.status).toBe(400);
  });

  it("rejects handoff and returned, which belong to the handoff route", async () => {
    allow();
    for (const action of ["handoff", "returned"]) {
      expect((await POST(req({ leadId: LEAD, action }))).status).toBe(400);
    }
  });

  it("rejects a win whose note is too short", async () => {
    allow();
    const res = await POST(req({ leadId: LEAD, action: "closed_won", note: "ok", valueCents: 100 }));
    expect(res.status).toBe(400);
    expect(mockRecord).not.toHaveBeenCalled();
  });

  it("rejects a win with a negative value", async () => {
    allow();
    const res = await POST(
      req({ leadId: LEAD, action: "closed_won", note: "signed the retainer", valueCents: -1 }),
    );
    expect(res.status).toBe(400);
  });

  it("records a win with its note and value in cents", async () => {
    allow();
    const res = await POST(
      req({ leadId: LEAD, action: "closed_won", note: "signed the retainer", valueCents: 1_200_000 }),
    );
    expect(res.status).toBe(200);
    expect(mockRecord).toHaveBeenCalledWith(
      { email: "rep@apmgservices.com.au", role: "sales", actingAs: null },
      expect.objectContaining({
        action: "closed_won",
        leadId: LEAD,
        note: "signed the retainer",
        valueCents: 1_200_000,
      }),
    );
  });

  it("ignores an actor_email supplied by the client", async () => {
    allow();
    await POST(
      req({
        leadId: LEAD,
        action: "contacted",
        actorEmail: "someone.else@apmgservices.com.au",
        actor_email: "someone.else@apmgservices.com.au",
      }),
    );
    expect(mockRecord).toHaveBeenCalledWith(
      expect.objectContaining({ email: "rep@apmgservices.com.au" }),
      expect.anything(),
    );
  });

  it("fails the request when the audit write fails, so no state changes unrecorded", async () => {
    allow();
    mockRecord.mockResolvedValue({ ok: false, reason: "error" });
    const res = await POST(req({ leadId: LEAD, action: "contacted" }));
    expect(res.status).toBe(502);
    expect(((await res.json()) as { ok: boolean }).ok).toBe(false);
  });

  it("answers 409 when the migration has not been run", async () => {
    allow();
    mockRecord.mockResolvedValue({ ok: false, reason: "missing_table" });
    const res = await POST(req({ leadId: LEAD, action: "contacted" }));
    expect(res.status).toBe(409);
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run app/api/sales/status/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 4: Write the route**

Create `app/api/sales/status/route.ts`:

```ts
import { actorFromGuard, recordAudit } from "@/lib/audit/write";
import { replay } from "@/lib/audit/replay";
import { isLeadAction, MIN_NOTE_LEN, type AuditRow } from "@/lib/audit/types";
import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";
import { type SalesStatusResponse } from "@/lib/sales/status";

// The Sales desk's single write endpoint.
//
// THE WRITE IS THE ACTION. There is no separate "status" store to update — the
// audit row IS the state change, so a request that cannot be recorded is a
// request that did not happen. The response carries the replayed state so the
// client renders what the server believes rather than a local guess.
//
// `handoff` and `returned` are deliberately NOT accepted here: they live on
// /api/sales/handoff, which owns the portal_events row that gates queue
// membership. Two write paths for one action is how ledgers drift.
export const runtime = "nodejs";

/** Actions and the permission each one demands. */
const PERMISSION = {
  contacted: "leads.contact",
  uncontacted: "leads.contact",
  closed_won: "leads.close",
  closed_lost: "leads.close",
  reopened: "leads.close",
} as const;

type Accepted = keyof typeof PERMISSION;

function isAccepted(v: unknown): v is Accepted {
  return typeof v === "string" && Object.prototype.hasOwnProperty.call(PERMISSION, v);
}

function json(partial: SalesStatusResponse, status = 200): Response {
  return Response.json(partial, { status });
}

/** Read this lead's whole trail back so the response is the server's truth. */
async function stateAfterWrite(leadId: string) {
  const target = supabaseTarget();
  if (target.state !== "ok") return null;
  try {
    const res = await fetch(
      `${target.base}/rest/v1/console_audit?select=id,action,actor_email,actor_role,acting_as,source,lead_id,target_email,note,value_cents,created_at` +
        `&lead_id=eq.${leadId}&order=created_at.asc,id.asc`,
      {
        headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return null;
    const raw = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
    const rows: AuditRow[] = (Array.isArray(raw) ? raw : []).map((r) => ({
      id: String(r.id),
      action: r.action as AuditRow["action"],
      actorEmail: String(r.actor_email ?? ""),
      actorRole: String(r.actor_role ?? ""),
      actingAs: typeof r.acting_as === "string" ? r.acting_as : null,
      source: r.source === "witnessed" ? "witnessed" : "claimed",
      leadId: typeof r.lead_id === "string" ? r.lead_id : null,
      targetEmail: typeof r.target_email === "string" ? r.target_email : null,
      note: typeof r.note === "string" ? r.note : null,
      valueCents: typeof r.value_cents === "number" ? r.value_cents : null,
      createdAt: String(r.created_at ?? ""),
    }));
    return replay(rows);
  } catch (e) {
    console.error("[sales/status] state re-read failed:", e);
    return null;
  }
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ ok: false, error: "Forbidden." }, 403);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const raw = (body ?? {}) as Record<string, unknown>;

  // Parsed before authorising because the permission DEPENDS on the action.
  // Parsing has no side effect, and the guard still runs before any write.
  const action = raw.action;
  if (!isAccepted(action)) {
    return json(
      {
        ok: false,
        error: isLeadAction(action)
          ? "That action is recorded by the hand-off endpoint, not here."
          : "Unknown action.",
      },
      400,
    );
  }

  const guard = await requirePermission(req, PERMISSION[action]);
  if (!guard.ok) return guardResponse(guard);

  const leadId = typeof raw.leadId === "string" ? raw.leadId : "";
  if (!isUuid(leadId)) return json({ ok: false, error: "A valid lead id is required." }, 400);

  const note = typeof raw.note === "string" ? raw.note.trim() : "";
  // Both closes demand a note. A loss without one is how leads used to vanish
  // with no record of why.
  const closing = action === "closed_won" || action === "closed_lost";
  if (closing && note.length < MIN_NOTE_LEN) {
    return json({ ok: false, error: `A closing note of at least ${MIN_NOTE_LEN} characters is required.` }, 400);
  }

  let valueCents: number | null = null;
  if (action === "closed_won") {
    const v = raw.valueCents;
    if (typeof v !== "number" || !Number.isFinite(v) || !Number.isInteger(v) || v < 0) {
      return json({ ok: false, error: "A closed value in whole cents is required." }, 400);
    }
    valueCents = v;
  }

  // Identity comes from the verified session, never the body — any actorEmail
  // the client sent is simply never read.
  const written = await recordAudit(actorFromGuard(guard), {
    action,
    leadId,
    note: note || null,
    valueCents,
  });
  if (!written.ok) {
    if (written.reason === "missing_table") {
      return json(
        { ok: false, error: "Run supabase/console-audit.sql before working the queue." },
        409,
      );
    }
    return json({ ok: false, error: "Couldn't record that — nothing was changed." }, 502);
  }

  const state = await stateAfterWrite(leadId);
  return json({ ok: true, state: state ?? undefined });
}
```

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run app/api/sales/status/route.test.ts`
Expected: PASS, 10 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/sales/status.ts app/api/sales/status/
git commit -m "feat: add POST /api/sales/status, where the audit row is the state change"
```

---

### Task 7: Fold audit state into the Sales queue read

**Files:**
- Modify: `lib/sales/queue.ts:8-31` (add `status` and close fields to `SalesQueueRow`), `:40-80` (add `statusTotals`)
- Modify: `app/api/sales/queue/route.ts`

**Interfaces:**
- Consumes: `replayByLead`, `LeadState` (Task 3); `AuditRow` (Task 2).
- Produces: `SalesQueueRow.status`, `.closedNote`, `.closedValueCents`, `.closedAt`, `.closedBy`; `SalesQueueResponse.statusTotals`.

- [ ] **Step 1: Extend the contract**

In `lib/sales/queue.ts`, add to `SalesQueueRow`:

```ts
  /** replayed from console_audit — never stored, so it always has an author */
  status: SalesStatus;
  closedNote: string | null;
  /** AUD cents */
  closedValueCents: number | null;
  closedAt: string | null;
  /** SSO address that closed it */
  closedBy: string | null;
```

with `import { type SalesStatus } from "@/lib/audit/replay";` at the top, and add to `SalesQueueResponse`:

```ts
  /**
   * Counts across the WHOLE queue, not just this page — the desk's tally and
   * the Closed-deals tab both need every lead's terminal state, which a
   * page-scoped read cannot supply.
   */
  statusTotals: Record<SalesStatus, number>;
  /** total closed-won value across the queue, AUD cents */
  wonValueCents: number;
```

- [ ] **Step 2: Scan the audit table in the queue route**

In `app/api/sales/queue/route.ts`, add a scanner next to `scanLedger` (it follows the same paging bounds so a large trail cannot stall the read):

```ts
/** Page the whole audit trail for the queued leads, oldest first. Returns null
 *  when console_audit doesn't exist yet, "error" on anything else. */
async function scanAudit(target: Target): Promise<AuditRow[] | null | "error"> {
  const out: AuditRow[] = [];
  let offset = 0;
  while (offset < EVENT_LIMIT) {
    let res: Response;
    try {
      res = await fetch(
        `${target.base}/rest/v1/console_audit?select=id,action,actor_email,actor_role,acting_as,source,lead_id,note,value_cents,created_at` +
          `&lead_id=not.is.null&order=created_at.asc,id.asc&limit=${EVENT_PAGE}&offset=${offset}`,
        { headers: headers(target.key), cache: "no-store" },
      );
    } catch (e) {
      console.error("[sales/queue] audit fetch failed:", e);
      return "error";
    }
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (isMissingPortalTable(res.status, detail)) return null;
      console.error(`[sales/queue] audit ${res.status}:`, detail.slice(0, 500));
      return "error";
    }
    const rows = (await res.json().catch(() => [])) as Array<Record<string, unknown>>;
    if (!Array.isArray(rows) || rows.length === 0) break;
    for (const r of rows) {
      const leadId = typeof r.lead_id === "string" ? r.lead_id : "";
      if (!isUuid(leadId)) continue;
      out.push({
        id: String(r.id),
        action: r.action as AuditRow["action"],
        actorEmail: String(r.actor_email ?? ""),
        actorRole: String(r.actor_role ?? ""),
        actingAs: typeof r.acting_as === "string" ? r.acting_as : null,
        source: r.source === "witnessed" ? "witnessed" : "claimed",
        leadId,
        targetEmail: null,
        note: typeof r.note === "string" ? r.note : null,
        valueCents: typeof r.value_cents === "number" ? r.value_cents : null,
        createdAt: String(r.created_at ?? ""),
      });
    }
    if (rows.length < EVENT_PAGE) break;
    offset += rows.length;
  }
  return out;
}
```

Add the imports: `import { replayByLead, type LeadState, type SalesStatus } from "@/lib/audit/replay";` and `import { type AuditRow } from "@/lib/audit/types";`.

- [ ] **Step 3: Use it, and stop hardcoding status**

After the hand-off ledger is read and `orderedIds` computed, add:

```ts
  // Replayed state for every queued lead. A missing table degrades to "every
  // lead is new" rather than failing the queue — the migration may not have
  // been run yet, and the desk must still show what admin handed over.
  const auditRows = await scanAudit(target);
  const queued = new Set(orderedIds);
  const stateByLead = Array.isArray(auditRows)
    ? replayByLead(auditRows.filter((r) => r.leadId && queued.has(r.leadId)))
    : new Map<string, LeadState>();

  const statusTotals: Record<SalesStatus, number> = {
    new: 0,
    contacted: 0,
    closed_won: 0,
    closed_lost: 0,
  };
  let wonValueCents = 0;
  for (const id of orderedIds) {
    const s = stateByLead.get(id);
    statusTotals[s?.status ?? "new"] += 1;
    if (s?.status === "closed_won") wonValueCents += s.closedValueCents ?? 0;
  }
```

Note the `queued.has` filter: leads returned to admin lose their hand-off row, so their audit rows must not leak into the desk's tallies.

In `toRow`, add the state fields:

```ts
    const state = stateByLead.get(id) ?? INITIAL_LEAD_STATE;
```

and include in the returned object:

```ts
      status: state.status,
      closedNote: state.closedNote,
      closedValueCents: state.closedValueCents,
      closedAt: state.closedAt,
      closedBy: state.closedBy,
```

Add `statusTotals` and `wonValueCents` to every `json(...)` success return, and to the defaults in the `json()` helper at the bottom:

```ts
    statusTotals: { new: 0, contacted: 0, closed_won: 0, closed_lost: 0 },
    wonValueCents: 0,
```

- [ ] **Step 4: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors ONLY in `components/apmg/SalesProvider.tsx` (it constructs `SalesQueueRow`-shaped objects) — Task 8 fixes those.

- [ ] **Step 5: Commit**

```bash
git add lib/sales/queue.ts app/api/sales/queue/route.ts
git commit -m "feat: return replayed lead status and queue-wide totals from the Sales queue"
```

---

### Task 8: SalesProvider reads server state

**Files:**
- Modify: `components/apmg/SalesProvider.tsx` — remove `overrides`, `statusHistory`, the `SALES_LEADS` demo seeding (`:294-308`), and the hardcoded `status: "new"` (`:191`); rewrite `markContacted`, `markLost`, `closeDeal`, `revertStatus` as server calls.
- Modify: `lib/data/sales.ts` — delete `SALES_LEADS` (`:50-272`) and `SALES_REP` (`:274`); keep `SalesLead` / `SalesStatus`.

**Interfaces:**
- Consumes: `SalesQueueRow.status` and close fields (Task 7); `POST /api/sales/status` (Task 6).
- Produces: `useSales()` context whose `leads` carry server status, plus `actionError: string | null`.

- [ ] **Step 1: Delete the preset**

In `lib/data/sales.ts`, delete the `SALES_LEADS` array and the `SALES_REP` constant. Keep `SalesStatus` and `SalesLead`, and replace the file's header comment with:

```ts
/**
 * Sales queue types.
 *
 * This file used to also export an eight-record demo preset and a fabricated
 * rep name ("Dana Okafor"). Both are gone: the preset rendered as real leads
 * whenever Supabase was unconfigured, and the rep name printed over live data.
 * Status now comes from the console_audit replay via /api/sales/queue.
 */
```

- [ ] **Step 2: Map the new fields**

In `SalesProvider.tsx`, `toSalesLead` currently hardcodes `status: "new"`. Replace with the server's values:

```ts
    status: r.status,
    closedNote: r.closedNote ?? undefined,
    closedValue: r.closedValueCents === null ? undefined : r.closedValueCents / 100,
    closedAt: fmtStamp(r.closedAt),
```

- [ ] **Step 3: Delete the demo branch and the in-memory maps**

Remove the `if (data.mode === "demo") { … }` block at `:294-308` entirely, along with the `demoSeeded` ref and the `SALES_LEADS` import. Replace with:

```ts
      if (data.mode === "demo") {
        // No database configured. Show nothing rather than a preset — a queue
        // of invented businesses is worse than an empty one.
        setMode("demo");
        setRows([]);
        setRecentRows([]);
        setHandoffs([]);
        setTotal(0);
        setEngagedTotal(0);
        setNeedsMigration(false);
      } else {
```

Delete the `overrides` and `statusHistory` state and every reference to them. `statusOf(id)` becomes `rows.find((l) => l.id === id)?.status ?? "new"`.

- [ ] **Step 4: Rewrite the mutations as server calls**

```ts
  const [actionError, setActionError] = useState<string | null>(null);

  /**
   * One write path for every desk action. The server records the audit row and
   * answers with the lead's replayed state; we then refetch rather than patch
   * locally, so what the rep sees is always what the trail says. A failure
   * leaves the row untouched — there is no optimistic close.
   */
  const act = useCallback(
    async (leadId: string, action: SalesStatusAction, extra?: { note?: string; valueCents?: number }) => {
      setActionError(null);
      try {
        const res = await fetch("/api/sales/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ leadId, action, ...extra }),
        });
        const data = (await res.json()) as SalesStatusResponse;
        if (!res.ok || !data.ok) {
          setActionError(data.error ?? "Couldn't record that.");
          return false;
        }
        setReloadTick((t) => t + 1);
        return true;
      } catch {
        setActionError("Couldn't reach the server — nothing was changed.");
        return false;
      }
    },
    [],
  );

  const markContacted = useCallback((id: string) => { void act(id, "contacted"); }, [act]);
  const markLost = useCallback(
    (id: string, note: string) => { void act(id, "closed_lost", { note }); },
    [act],
  );
  const closeDeal = useCallback(
    (id: string, input: CloseDealInput) =>
      void act(id, "closed_won", { note: input.note, valueCents: Math.round(input.value * 100) }),
    [act],
  );
  const revertStatus = useCallback(
    (id: string) => {
      const current = rows.find((l) => l.id === id)?.status ?? "new";
      void act(id, current === "contacted" ? "uncontacted" : "reopened");
    },
    [act, rows],
  );
```

Delete `pushStatus`, `statusHistory`, and the `closedDeals` snapshot state — the Closed-deals tab now filters `rows` on `status === "closed_won"`, which survives paging because the server owns it. Add `actionError` to the context value and its dependency array.

- [ ] **Step 5: Typecheck**

Run: `npx tsc --noEmit`
Expected: errors only in `SalesPage.tsx` / `ClosedDealsPage.tsx` where `markLost` now takes a note — Task 9 fixes those.

- [ ] **Step 6: Commit**

```bash
git add components/apmg/SalesProvider.tsx lib/data/sales.ts
git commit -m "feat: Sales state comes from the server; delete the preset and in-memory overrides"
```

---

### Task 9: Real rep name, and a note on every loss

**Files:**
- Modify: `components/apmg/DashboardShell.tsx:141` — pass `user` to `SalesPage`
- Modify: `components/apmg/SalesPage.tsx:22` (import), `:947` (rep name), `:373-382` (lost button)
- Modify: `components/apmg/CloseDealModal.tsx` — a `lost` variant and the AUD label

**Interfaces:**
- Consumes: `SessionUser` from `components/apmg/Sidebar.tsx`; `markLost(id, note)` (Task 8).
- Produces: `CloseDealModal` gains `variant: "won" | "lost"`.

- [ ] **Step 1: Pass the session user through**

`DashboardShell.tsx:141`: `<SalesPage />` becomes `<SalesPage user={user} />`.

`SalesPage.tsx`: accept `user?: SessionUser`, drop the `SALES_REP` import, and replace line 947:

```tsx
              <span className="text-foreground/80">{user?.name ?? user?.email ?? "—"}</span>
```

- [ ] **Step 2: Give the modal a lost variant**

In `CloseDealModal.tsx`, add `variant: "won" | "lost"` to the props. When `lost`: title "Mark as lost", the value input is not rendered, the note label reads "Reason lost *", and the confirm button reads "Mark lost". Replace the hardcoded `MIN_NOTE = 3` with `import { MIN_NOTE_LEN } from "@/lib/audit/types"`, and relabel line 112 to `Closed value (AUD)`.

- [ ] **Step 3: Route the lost button through it**

In `SalesPage.tsx:373-382`, the bare X button currently calls `markLost(lead.id)` directly. Change it to open the modal in `lost` variant, and on confirm call `markLost(lead.id, note)`.

- [ ] **Step 4: Verify by hand**

Run `npm run dev`, sign in, open Sales. Confirm: the header shows your own name; marking a lead contacted survives a full page reload; closing a deal requires a note; marking one lost now asks for a reason; and a reload keeps every one of those.

- [ ] **Step 5: Commit**

```bash
git add components/apmg/DashboardShell.tsx components/apmg/SalesPage.tsx components/apmg/CloseDealModal.tsx
git commit -m "feat: real rep name from the session, and a required reason on every lost deal"
```

---

### Task 10: The `audit.view` permission

**Files:**
- Modify: `lib/rbac/permissions.ts:36` (after `roles.viewas`)
- Modify: `lib/rbac/sections.ts:85-92` (System section)

**Interfaces:**
- Consumes: nothing.
- Produces: `audit.view` permission, held by `admin` only (it is in `ALL_PERMISSIONS`, which `admin` receives wholesale; `sales` lists its permissions explicitly and does not get it).

- [ ] **Step 1: Add the permission**

In `lib/rbac/permissions.ts`, inside `PERMISSIONS`:

```ts
  "audit.view": "Read the console audit trail (who did what, when)",
```

- [ ] **Step 2: Run the suite to see the compile-time gate fire**

Run: `npx vitest run lib/rbac/`
Expected: FAIL — `_assertEverythingIsSectioned` in `sections.ts` names `audit.view` as unsectioned, and `sections.test.ts` fails.

- [ ] **Step 3: Section it**

In `lib/rbac/sections.ts`, add to the `system` section's permissions, after `roles.viewas`:

```ts
      { perm: "audit.view", short: "Audit trail" },
```

- [ ] **Step 4: Run to verify it passes**

Run: `npx vitest run lib/rbac/`
Expected: PASS. Confirm `sales` does not hold it — `roles.ts:30-47` lists the sales bundle explicitly and is untouched.

- [ ] **Step 5: Commit**

```bash
git add lib/rbac/permissions.ts lib/rbac/sections.ts
git commit -m "feat: add the admin-only audit.view permission"
```

---

### Task 11: `GET /api/admin/audit`

**Files:**
- Create: `lib/audit/log.ts`
- Create: `app/api/admin/audit/route.ts`
- Create: `app/api/admin/audit/route.test.ts`

**Interfaces:**
- Consumes: `AuditRow` (Task 2); `requirePermission` (Task 4); `audit.view` (Task 10).
- Produces: `AuditLogResponse` in `lib/audit/log.ts`; the route.

- [ ] **Step 1: Write the contract**

Create `lib/audit/log.ts`:

```ts
import { type AuditRow } from "./types";

// Shared contract for GET /api/admin/audit. Client-safe (types only).

/** An audit row joined to the business name, so the tab reads as English
 *  rather than uuids. `business` is null when the lead has since been
 *  reimported or deleted — the row deliberately outlives it. */
export interface AuditLogEntry extends AuditRow {
  business: string | null;
}

export interface AuditLogResponse {
  ok: boolean;
  rows: AuditLogEntry[];
  total: number;
  page: number;
  pageSize: number;
  needsMigration?: boolean;
  error?: string;
}

export const AUDIT_PAGE_SIZE = 50;
```

- [ ] **Step 2: Write the failing tests**

Create `app/api/admin/audit/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/rbac/server", () => ({
  requirePermission: vi.fn(),
  guardResponse: (g: { status: number; error: string }) =>
    Response.json({ error: g.error }, { status: g.status }),
}));
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, supabaseTarget: () => ({ state: "ok", base: "https://db.test", key: "k" }) };
});

import { requirePermission } from "@/lib/rbac/server";
import { GET } from "./route";

const mockGuard = vi.mocked(requirePermission);

function req(query = ""): Request {
  return new Request(`http://localhost/api/admin/audit${query}`, {
    headers: { origin: "http://localhost", host: "localhost" },
  });
}

beforeEach(() => {
  mockGuard.mockReset();
  vi.stubGlobal(
    "fetch",
    vi.fn(async () =>
      new Response(JSON.stringify([]), {
        status: 200,
        headers: { "content-range": "0-0/0", "content-type": "application/json" },
      }),
    ),
  );
});

describe("GET /api/admin/audit", () => {
  it("403s a role without audit.view", async () => {
    mockGuard.mockResolvedValue({ ok: false, status: 403, error: "Forbidden — missing permission: audit.view" });
    expect((await GET(req())).status).toBe(403);
  });

  it("asks for the audit.view permission specifically", async () => {
    mockGuard.mockResolvedValue({ ok: false, status: 403, error: "no" });
    await GET(req());
    expect(mockGuard).toHaveBeenCalledWith(expect.anything(), "audit.view");
  });

  it("answers with an empty page for an admin when nothing is recorded", async () => {
    mockGuard.mockResolvedValue({
      ok: true, role: "admin", email: "kane@apmgservices.com.au", trueRole: "admin", actingAs: null,
    });
    const res = await GET(req());
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; rows: unknown[]; total: number };
    expect(body).toMatchObject({ ok: true, rows: [], total: 0 });
  });
});
```

- [ ] **Step 3: Run to verify they fail**

Run: `npx vitest run app/api/admin/audit/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 4: Write the route**

Create `app/api/admin/audit/route.ts`. It follows the house shape: `sameOrigin` → `requirePermission(req, "audit.view")` → `supabaseTarget()`, then a `count=exact` PostgREST read with `order=created_at.desc,id.desc`, `limit`/`offset` from `?page=&pageSize=`, and optional `actor=`, `action=`, `leadId=`, `from=`, `to=` filters appended as `actor_email=eq.`, `action=eq.`, `lead_id=eq.`, `created_at=gte.`, `created_at=lte.`. It maps snake_case to the `AuditRow` camelCase shape exactly as `stateAfterWrite` does in Task 6, then makes one follow-up `leads?select=id,name&id=in.(…)` read to attach `business`, leaving it `null` for ids that no longer resolve. A missing table returns `{ ok: true, needsMigration: true, rows: [] }`.

- [ ] **Step 5: Run to verify they pass**

Run: `npx vitest run app/api/admin/audit/route.test.ts`
Expected: PASS, 3 tests.

- [ ] **Step 6: Commit**

```bash
git add lib/audit/log.ts app/api/admin/audit/
git commit -m "feat: add the admin-only audit log read endpoint"
```

---

### Task 12: The Audit tab

**Files:**
- Modify: `lib/nav.ts:21-35` (`TabId`), `:89-95` (System items), `:131-146` (`TAB_LABEL`)
- Modify: `components/apmg/DashboardShell.tsx` (import + switch case)
- Create: `components/apmg/AuditPage.tsx`
- Create: `components/apmg/LeadDecisionHistory.tsx`

**Interfaces:**
- Consumes: `AuditLogResponse`, `AuditLogEntry` (Task 11); `ACTION_LABEL` (Task 2).
- Produces: the `audit` tab.

- [ ] **Step 1: Register the tab**

`lib/nav.ts`: add `| "audit"` to `TabId`; add to the System section's items, before Settings — `{ id: "audit", label: "Audit trail", icon: ScrollText, perm: "audit.view" }` (import a distinct icon, e.g. `History`, rather than reusing `ScrollText`); add `audit: "Audit trail"` to `TAB_LABEL`.

The item goes under the **existing** System caption. Do not add a new caption — `sections.test.ts:44-46` pins section captions to NAV captions in order.

- [ ] **Step 2: Run the nav/rbac suite**

Run: `npx vitest run lib/rbac/ lib/nav*`
Expected: PASS — an added item under an existing caption keeps the caption lists identical.

- [ ] **Step 3: Build the page**

`components/apmg/AuditPage.tsx` fetches `/api/admin/audit`, renders reverse-chronological entries and paginates. Each entry shows, in this order: the timestamp; the actor's email with `(as sales)` appended when `actingAs` is set; a `claimed` / `witnessed` badge; `ACTION_LABEL[action]`; the business name (or `lead no longer in the database` when `business` is null); the value formatted from `valueCents / 100`; and the note in full, never truncated — it is the reason the trail exists. Filter controls for actor, action and date range map to the route's query params. Follow the existing table/filter idiom in `components/apmg/EnquiriesPage.tsx`.

Empty state: `Nothing recorded yet. Actions taken from the Sales desk appear here.` Include the standing note that the 4 hand-offs of 2026-08-01 and the 2,338 sends of 2026-07-15→28 predate SSO and carry no actor.

- [ ] **Step 4: Build the per-lead history**

`components/apmg/LeadDecisionHistory.tsx` takes `leadId`, fetches `/api/admin/audit?leadId=<id>`, and renders the same entry rows without filters. Named "Decision history" deliberately — "lead trail" already means click telemetry (`components/apmg/LeadTrail.tsx`).

- [ ] **Step 5: Wire the tab**

In `DashboardShell.tsx`, import `AuditPage` and add the `case "audit":` branch alongside the existing tab cases.

- [ ] **Step 6: Verify by hand**

Run `npm run dev`. As admin: the Audit trail tab appears under System; closing a deal from Sales adds an entry naming you, with the note and value. Then use view-as to become Sales: the tab disappears, and an action taken while previewing records `(as sales)` against your own address.

- [ ] **Step 7: Commit**

```bash
git add lib/nav.ts components/apmg/DashboardShell.tsx components/apmg/AuditPage.tsx components/apmg/LeadDecisionHistory.tsx
git commit -m "feat: add the admin Audit trail tab and per-lead decision history"
```

---

## Status and coordination

**Tasks 1-6 are complete** (commits `9009611`, `9bfb912`, `f09b0c5`, `930ae7d`). The
foundation is in: the migration, the action catalog, the replay reducer, the
widened guard, the audit writer, and the write endpoint. Full suite green at
197 tests.

**Tasks 7-12 are HELD.** A parallel effort — `docs/superpowers/plans/2026-08-09-fabrication-removal.md`,
already executing on this same branch — modifies four of the files those tasks
touch:

| File | That plan | This plan |
|---|---|---|
| `app/api/sales/queue/route.ts` | Task 4 (fail-closed sweep) | Task 7 |
| `components/apmg/SalesProvider.tsx` | Task 6 | Task 8 |
| `components/apmg/SalesPage.tsx` | Task 6 | Task 9 |
| `lib/data/sales.ts` | Task 6 | Task 8 |

Its Task 6 already deletes `SALES_LEADS` and `SALES_REP` and takes the rep name
from the session, which supersedes this plan's Task 8 Step 1 and Task 9 Step 1
— do not do them twice. Resume Tasks 7-12 only after that plan finishes, and
**re-derive every line number first**: `SalesPage.tsx` has already moved from
947 to 1030 under commit `e66168b`.

**Superseded outright.** These were listed here as "plan 2" work and are now
owned by the fabrication-removal plan, three of them already shipped:

- ~~`requireLiveSupabase()` across the demo-branching routes~~ — shipped, `c1fb76e`.
- ~~The campaign send's fabricated success~~ — shipped, `99cd183`.
- ~~The lead importer's phantom inserts~~ — shipped, `efe418e`.
- `DEMO_*` datasets in `lib/data/enquiries.ts` and `lib/data/leadActivity.ts` — its Task 5.

**Still unowned by either plan** — carry these forward:

- Audit writes on `/api/sales/handoff` (before its destructive delete), `/api/pipeline/campaigns/send`, `/api/auth/view-as`, `/api/admin/users`.
- `PATCH /api/portal/inquiries` — add the missing `requirePermission("enquiries.manage")`; the file still has none.
- Currency: `formatUsd` → `formatAud`, `usd0` → `aud0`, and the five call sites.

## Self-review

**Spec coverage.** Data model → Task 1. Reducer → Task 3. Write path and identity → Tasks 4-6. Queue folding → Task 7. Preset removal in Sales → Task 8. `SALES_REP` → Task 9. Lost-deal note → Task 9. Permission → Task 10. Admin surface → Tasks 11-12. Legacy pre-SSO labelling → Task 12 Step 3. Console-wide hardening, other routes' audit writes and currency → explicitly deferred to plan 2 above, not dropped.

**Placeholders.** None: every code step carries the actual code. Task 11 Step 4 and Task 12 Steps 3-4 describe route/component bodies prose-first because they are long and follow an existing in-repo idiom that is named precisely (`EnquiriesPage.tsx`, and the mapping code given verbatim in Task 6) — the field lists, ordering, filters and empty-state copy are all stated exactly.

**Type consistency.** `AuditRow` is defined once (Task 2) and the snake_case→camelCase mapping is identical in Tasks 6, 7 and 11. `LeadState` field names (`closedNote`, `closedValueCents`, `closedAt`, `closedBy`) are used unchanged in Tasks 3, 7 and 8. `valueCents` is cents everywhere on the wire; the only `/100` conversions are in Task 8 Step 2 and Task 12 Step 3, and the only `*100` in Task 8 Step 4. `markLost` gains its `note` parameter in Task 8 and every caller is updated in Task 9.
