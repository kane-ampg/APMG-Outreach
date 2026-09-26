# Hot-Lead Follow-Up Pipeline Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Follow-Ups tab where every lead scoring 66 or more gets up to two Claude-written, service-specific follow-up emails. A human approves each email, and it is sent through the same guards and n8n webhook as a cold send.

**Architecture:**
- The queue is derived on request from `portal_events` (service opens, enquiries, sends, hand-off/archive markers), the `leads` table, and a new `follow_ups` table. There is no stored queue and no scheduler.
- Drafting reuses `draftEmail()` with the live `compose_prompt` row, plus a new touch-specific prompt block.
- Sending goes through a `deliverCampaign()` function extracted from the cold send route, so both paths share one guard chain.

**Tech Stack:** Next.js 16 App Router (Node runtime), TypeScript, Supabase via PostgREST `fetch`, `@anthropic-ai/sdk` (existing `draftEmail`), Vitest, Tailwind + `components/ui` primitives, lucide-react.

**Spec:** [docs/superpowers/specs/2026-09-25-hot-lead-follow-up-design.md](../specs/2026-09-25-hot-lead-follow-up-design.md). Read it before starting any task.

## Global Constraints

**Repo and process**
- **Never commit, push, open a PR or create a worktree.** Kane publishes through GitHub Desktop. Each task ends with a checkpoint (tests green, then stop), not a commit.
- **Verification gate:** `npx tsc --noEmit`, `npx vitest run` and `npx next build`. `npm run lint` is broken; don't use it.

**Follow-up rules**
- **Trigger:** `leadScore >= 66`, inclusive. The constant is `FOLLOW_UP_MIN_SCORE = 66` in `lib/data/leadScore.ts`.
- **Touch 2** is due **5 business days** (Mon–Fri) after touch 1's `sent_at`, counted in **`Australia/Melbourne`** local dates.
- **"Likely scanner"** means the first service open came **< 60 seconds** after the most recent prior `email_sent`.
- **Campaign tag** for every follow-up send is exactly `hot-followup`.
- **Ledger rows:** each sent follow-up writes an `email_sent` row with `props = { kind: "follow_up", touch: "1" | "2" }`. `PortalEventRow.props` is `Record<string, string>`, so `touch` is a string.
- **Draft limits:** up to 8 leads per draft request (`COMPOSE_CHUNK_LEADS`). "Draft all" drafts at most 20 leads, in chunks of 8.

**Safety and copy**
- **Never write to the `compose_prompt` table.** Read it via `loadComposePrompt()` only.
- **Every send passes the Master Client List guard and the address and organisation opt-out checks.** They run inside `deliverCampaign`, never beside it.
- **Email copy must never mention, hint at or imply tracking.** The exported `NO_TRACKING_RULE` text must appear exactly once in every follow-up prompt.
- **Prompt text** is in Australian English with no em dashes, because it steers the email copy.

**UI and roles**
- **No background polling** on the Follow-Ups tab. It loads on mount and has a manual Refresh button (Vercel free-tier budget).
- **Admin** gets `followups.view` and `followups.send` (via `ALL_PERMISSIONS`). **Sales** gets neither.

## Review Focus

These are the inputs most likely to hurt a real user that the spec doesn't spell out. Each one is pinned by a test in the task that owns the code:

1. **Double send.** Double-clicking "Approve & send", or two tabs open, could send one draft twice. The second call must see `status !== "draft"`, skip it, and not call the webhook. *(Task 6)*
2. **Lead enquires between draft and send.** The draft must be marked `skipped` with a reason, never sent. *(Task 6)*
3. **Webhook accepts but marking rows `sent` fails.** The response must carry a `warning` saying not to resend. It must not report a clean success, which could invite a resend. *(Task 6)*
4. **Two leads share one email address in the same send.** The address is mailed once, and the second row is skipped with a reason. *(Task 6)*
5. **Hot lead with no `email_sent` row** (a pre-ledger warm-up send, or a lost row). The prompt must not invent a gap like "earlier today". *(Task 3)*

---

## File Structure

| File | Responsibility |
|---|---|
| `lib/followups/types.ts` (new) | Client-safe constants and types: rows, queue items, API responses |
| `lib/followups/schedule.ts` (new) | Pure Melbourne business-day maths |
| `lib/followups/eligibility.ts` (new) | Pure per-lead classification into a queue stage, scanner gap, sort |
| `lib/followups/labels.ts` (new) | Pure chip text for the Hot Leads row |
| `lib/ai/hotFollowUpPrompt.ts` (new) | Pure touch-1/touch-2 prompt block |
| `lib/ai/followUpPrompt.ts` (modify) | Export `serviceWords`, `joinWords`, `NO_TRACKING_RULE` (output byte-identical) |
| `lib/data/leadScore.ts` (modify) | Widen `leadScore` input; add `FOLLOW_UP_MIN_SCORE` |
| `lib/pipeline/deliver.ts` (new) | The guard → render → webhook → ledger chain, extracted from the send route |
| `app/api/pipeline/campaigns/send/route.ts` (modify) | Becomes parse + validate + `deliverCampaign` |
| `supabase/follow-ups.sql` (new) | `follow_ups` table |
| `lib/followups/server.ts` (new) | Server-only PostgREST reads and writes, plus `loadQueue` |
| `app/api/followups/route.ts` (new) | GET the queue; PATCH to edit a draft |
| `app/api/followups/draft/route.ts` (new) | POST: draft with Claude |
| `app/api/followups/send/route.ts` (new) | POST: send approved drafts |
| `app/api/followups/mark/route.ts` (new) | POST: skip / replied |
| `lib/rbac/permissions.ts`, `lib/rbac/sections.ts`, `lib/nav.ts`, `components/apmg/DashboardShell.tsx` (modify) | Permission, section, tab, render branch |
| `lib/followups/useFollowUps.ts` (new) | Client hook: load, refresh, actions |
| `components/apmg/FollowUpsPage.tsx` (new) | The tab UI |
| `components/apmg/HotLeadsPage.tsx` (modify) | Follow-up chip on each row |

---

### Task 1: Types, threshold constant, Melbourne business-day schedule

**Files:**
- Create: `lib/followups/types.ts`
- Create: `lib/followups/schedule.ts`
- Create: `lib/followups/schedule.test.ts`
- Modify: `lib/data/leadScore.ts` (the `leadScore` signature, plus a new constant after `HOT_LEAD_MIN_SCORE`)
- Create: `lib/data/leadScore.test.ts`

**Interfaces:**
- Produces:
  - `FOLLOW_UP_MIN_SCORE: 66`
  - `leadScore(lead: Pick<LeadActivity, "counts">): number`
  - Everything exported from `types.ts`
  - `melbourneYmd(ms: number): string`
  - `businessDaysSince(sentIso: string, nowMs: number): number`
  - `touch2DueOn(sentIso: string): string | null`
  - `isTouch2Due(sentIso: string, nowMs: number): boolean`

- [ ] **Step 1: Create `lib/followups/types.ts`**

```ts
/**
 * Client-safe contract for the Hot-Lead Follow-Up pipeline — constants, the
 * `follow_ups` row shape, the derived queue item, and every API response.
 * Imported by the pure modules, the server routes AND the client hook, so none
 * of them can drift apart. See docs/superpowers/specs/2026-09-25-hot-lead-follow-up-design.md.
 */

/** Campaign tag on every follow-up send (and its `email_sent` ledger rows). */
export const FOLLOW_UP_CAMPAIGN = "hot-followup";

/** Touch 2 comes due this many Mon–Fri days after touch 1 was sent. */
export const TOUCH2_BUSINESS_DAYS = 5;

/** A first service open this soon after delivery is probably a mail scanner. */
export const SCANNER_GAP_MS = 60_000;

/** Business days are counted on Melbourne calendar dates. */
export const FOLLOW_UP_TZ = "Australia/Melbourne";

/** Leads per draft REQUEST (one Claude call each, paced under COMPOSE_RATE). */
export const MAX_DRAFT_PER_REQUEST = 8;

/** Leads one "Draft all" click drafts (the client sends it in request-size chunks). */
export const MAX_DRAFT_ALL = 20;

/** Drafts per send request. */
export const MAX_SEND_PER_REQUEST = 50;

export const MAX_FOLLOW_UP_SUBJECT = 300;
export const MAX_FOLLOW_UP_HTML = 20_000;
export const MAX_FOLLOW_UP_NOTE = 500;

export const FOLLOW_UP_STATUSES = ["draft", "sent", "skipped", "blocked", "replied"] as const;
export type FollowUpStatus = (typeof FOLLOW_UP_STATUSES)[number];

export type Touch = 1 | 2;

/** One row of the `follow_ups` table (supabase/follow-ups.sql). */
export interface FollowUpRow {
  id: string;
  lead_id: string;
  touch: Touch;
  status: FollowUpStatus;
  subject: string | null;
  body_html: string | null;
  service_slug: string | null;
  model: string | null;
  note: string | null;
  drafted_at: string | null;
  sent_at: string | null;
  sent_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Where a lead sits in the pipeline:
 *   ready     — needs a draft for `touch`
 *   awaiting  — a draft for `touch` is waiting for approval
 *   waiting   — touch 1 sent, touch 2 not due until `touch2DueOn`
 *   done      — sequence over (touch 2 sent, skipped, replied or blocked) → Ready for Sales
 *   excluded  — not eligible (enquired, with Sales, archived, client, opted out, no email)
 */
export type FollowUpStage = "ready" | "awaiting" | "waiting" | "done" | "excluded";

export interface FollowUpQueueItem {
  leadId: string;
  business: string | null;
  category: string | null;
  website: string | null;
  email: string | null;
  score: number;
  /** most-opened service slug — the one the email leads with */
  service: string | null;
  /** every opened service slug, most-opened first */
  services: string[];
  stage: FollowUpStage;
  /** the touch in play (ready/awaiting/waiting); null when done/excluded */
  touch: Touch | null;
  /** why done/excluded */
  reason: string | null;
  /** the draft row when stage = awaiting */
  draft: FollowUpRow | null;
  touch1SentAt: string | null;
  /** Melbourne calendar date (YYYY-MM-DD) touch 2 comes due */
  touch2DueOn: string | null;
  likelyScanner: boolean;
  /** seconds from the last prior send to the first service open */
  scannerGapSeconds: number | null;
}

export interface FollowUpQueueResponse {
  ok: boolean;
  mode: "live" | "demo";
  /** the follow_ups table is missing — run supabase/follow-ups.sql */
  needsMigration?: boolean;
  error?: string;
  items: FollowUpQueueItem[];
}

export interface FollowUpDraftResponse {
  ok: boolean;
  error?: string;
  /** lead ids drafted and saved */
  drafted: string[];
  failed: Array<{ leadId: string; error: string }>;
  /** lead ids not attempted before the time budget ran out — resubmit them */
  remaining: string[];
}

export interface FollowUpSendResponse {
  ok: boolean;
  error?: string;
  mode?: string;
  sent: number;
  blocked: Array<{ leadId: string; reason: string }>;
  skipped: Array<{ leadId: string; reason: string }>;
  /** set when the emails went out but the rows couldn't all be marked sent */
  warning?: string;
}

export interface FollowUpMutationResponse {
  ok: boolean;
  error?: string;
  row?: FollowUpRow;
}
```

- [ ] **Step 2: Write the failing schedule test**

Create `lib/followups/schedule.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { businessDaysSince, isTouch2Due, melbourneYmd, touch2DueOn } from "./schedule";

describe("melbourneYmd", () => {
  it("reads the Melbourne calendar date, not the UTC one", () => {
    // 2026-09-24 14:00 UTC = Fri 25 Sep 00:00 AEST (UTC+10; DST starts 4 Oct)
    expect(melbourneYmd(Date.parse("2026-09-24T14:00:00Z"))).toBe("2026-09-25");
    expect(melbourneYmd(Date.parse("2026-09-24T13:59:00Z"))).toBe("2026-09-24");
  });
});

describe("touch2DueOn", () => {
  it("is five weekdays after a Monday send", () => {
    // Mon 21 Sep 10:00 local → Tue, Wed, Thu, Fri, Mon 28
    expect(touch2DueOn("2026-09-21T00:00:00Z")).toBe("2026-09-28");
  });

  it("skips the weekend after a Friday send", () => {
    // Fri 25 Sep 01:30 local → Mon 28 … Fri 2 Oct
    expect(touch2DueOn("2026-09-24T15:30:00Z")).toBe("2026-10-02");
  });

  it("uses the local date at the midnight boundary", () => {
    expect(touch2DueOn("2026-09-24T13:59:00Z")).toBe("2026-10-01"); // Thu 23:59 local
    expect(touch2DueOn("2026-09-24T14:00:00Z")).toBe("2026-10-02"); // Fri 00:00 local
  });

  it("is null for an unreadable timestamp", () => {
    expect(touch2DueOn("not a date")).toBeNull();
  });
});

describe("businessDaysSince / isTouch2Due", () => {
  const SENT = "2026-09-21T00:00:00Z"; // Mon 21 Sep 10:00 local

  it("does not count the send day or weekends", () => {
    expect(businessDaysSince(SENT, Date.parse("2026-09-21T08:00:00Z"))).toBe(0);
    expect(businessDaysSince(SENT, Date.parse("2026-09-25T08:00:00Z"))).toBe(4); // Fri
    expect(businessDaysSince(SENT, Date.parse("2026-09-27T08:00:00Z"))).toBe(4); // Sun
  });

  it("comes due on the due date, local time", () => {
    expect(isTouch2Due(SENT, Date.parse("2026-09-27T13:00:00Z"))).toBe(false); // Sun 23:00 local
    expect(isTouch2Due(SENT, Date.parse("2026-09-27T23:00:00Z"))).toBe(true); // Mon 28 09:00 local
  });

  it("treats an unreadable timestamp as not due", () => {
    expect(businessDaysSince("nope", Date.now())).toBe(0);
    expect(isTouch2Due("nope", Date.now())).toBe(false);
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/followups/schedule.test.ts`
Expected: FAIL, because `./schedule` cannot be resolved.

- [ ] **Step 4: Implement `lib/followups/schedule.ts`**

```ts
import { FOLLOW_UP_TZ, TOUCH2_BUSINESS_DAYS } from "./types";

/**
 * Melbourne business-day maths for touch 2. Pure and dependency-free.
 *
 * Days are counted on Melbourne CALENDAR dates, not 24-hour spans: an email
 * sent at 11pm Thursday is a Thursday send, and touch 2 comes due at local
 * midnight on its due date — matching the no-weekends send schedule
 * (documentation/send-schedule.md). Public holidays are not modelled.
 */

const YMD = new Intl.DateTimeFormat("en-CA", {
  timeZone: FOLLOW_UP_TZ,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/** The Melbourne calendar date of an instant, as YYYY-MM-DD. */
export function melbourneYmd(ms: number): string {
  const p: Record<string, string> = {};
  for (const part of YMD.formatToParts(new Date(ms))) p[part.type] = part.value;
  return `${p.year}-${p.month}-${p.day}`;
}

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function isWeekday(ymd: string): boolean {
  const [y, m, d] = ymd.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return dow >= 1 && dow <= 5;
}

/** A year of days is far past any follow-up window; bounds the loop. */
const MAX_SCAN_DAYS = 400;

/** Weekdays strictly after the send's local date, up to and including today's. */
export function businessDaysSince(sentIso: string, nowMs: number): number {
  const sent = Date.parse(sentIso);
  if (!Number.isFinite(sent)) return 0;
  const today = melbourneYmd(nowMs);
  let day = melbourneYmd(sent);
  let n = 0;
  for (let i = 0; i < MAX_SCAN_DAYS; i++) {
    day = addDays(day, 1);
    if (day > today) break;
    if (isWeekday(day)) n++;
  }
  return n;
}

/** The Melbourne date touch 2 comes due, or null for an unreadable timestamp. */
export function touch2DueOn(sentIso: string): string | null {
  const sent = Date.parse(sentIso);
  if (!Number.isFinite(sent)) return null;
  let day = melbourneYmd(sent);
  let n = 0;
  while (n < TOUCH2_BUSINESS_DAYS) {
    day = addDays(day, 1);
    if (isWeekday(day)) n++;
  }
  return day;
}

export function isTouch2Due(sentIso: string, nowMs: number): boolean {
  return businessDaysSince(sentIso, nowMs) >= TOUCH2_BUSINESS_DAYS;
}
```

- [ ] **Step 5: Run the schedule test to verify it passes**

Run: `npx vitest run lib/followups/schedule.test.ts`
Expected: PASS (all tests).

- [ ] **Step 6: Write the failing leadScore test**

Create `lib/data/leadScore.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FOLLOW_UP_MIN_SCORE, leadScore } from "./leadScore";

const counts = (c: Partial<Record<"inquiries" | "serviceOpens" | "portalViews" | "emailClicks" | "chatPrompts", number>>) => ({
  counts: { inquiries: 0, serviceOpens: 0, portalViews: 0, emailClicks: 0, chatPrompts: 0, ...c },
});

describe("FOLLOW_UP_MIN_SCORE", () => {
  it("is exactly what one service open scores", () => {
    expect(FOLLOW_UP_MIN_SCORE).toBe(66);
    expect(leadScore(counts({ serviceOpens: 1 }))).toBe(66);
  });

  it("is out of reach for a portal browser who opened no service", () => {
    expect(leadScore(counts({ portalViews: 50, emailClicks: 50 }))).toBeLessThan(FOLLOW_UP_MIN_SCORE);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run lib/data/leadScore.test.ts`
Expected: FAIL, because `FOLLOW_UP_MIN_SCORE` is not exported. `tsc` would also reject the object literal missing `LeadActivity` fields.

- [ ] **Step 8: Modify `lib/data/leadScore.ts`**

Change the signature line:

```ts
export function leadScore(lead: LeadActivity): number {
```

to:

```ts
export function leadScore(lead: Pick<LeadActivity, "counts">): number {
```

Then, directly after the `export const HOT_LEAD_MIN_SCORE = 50;` line, add:

```ts

/**
 * The Follow-Ups cut-off (INCLUSIVE). One service open scores
 * 60 + 29·(1 − e^(−1/4)) ≈ 66, so "66 or hotter" means the lead opened at
 * least one service card. Enquirers score 90+ but are excluded from
 * Follow-Ups separately — Sales owns them (lib/followups/eligibility).
 */
export const FOLLOW_UP_MIN_SCORE = 66;
```

- [ ] **Step 9: Run tests and type-check**

Run: `npx vitest run lib/data lib/followups` and `npx tsc --noEmit`
Expected: PASS. `tsc` passes because `isHotLead(lead: LeadActivity)` still satisfies the widened parameter.

- [ ] **Step 10: Checkpoint.** Don't commit. Leave the changes in the working tree.

---

### Task 2: Eligibility (queue stage, scanner gap, sort) and Hot Leads chip labels

**Files:**
- Create: `lib/followups/eligibility.ts`
- Create: `lib/followups/eligibility.test.ts`
- Create: `lib/followups/labels.ts`
- Create: `lib/followups/labels.test.ts`

**Interfaces:**
- Consumes: `leadScore`, `FOLLOW_UP_MIN_SCORE` (Task 1), `isTouch2Due`, `touch2DueOn` (Task 1), `SCANNER_GAP_MS` and the types (Task 1), `serviceBySlug` (`lib/pipeline/services.ts`).
- Produces:
  - `interface LeadSignals { leadId; serviceOpens: Record<string, number>; firstServiceOpenAt: string | null; inquiries: number; sends: string[]; handedOff: boolean; archived: boolean }`
  - `interface LeadContact { business; category; website; email: string | null }`
  - `interface LeadGuard { client: string | null; optedOut: boolean }`
  - `emptySignals(leadId: string): LeadSignals`
  - `rankedServices(opens): string[]`
  - `signalScore(s): number`
  - `scannerGap(s): number | null`
  - `classifyLead(input: { signals; contact: LeadContact | null; guard: LeadGuard; rows: FollowUpRow[]; now: number }): FollowUpQueueItem | null`
  - `sortQueue(items): FollowUpQueueItem[]`
  - `followUpChip(item: FollowUpQueueItem | undefined): string | null`

- [ ] **Step 1: Write the failing eligibility test**

Create `lib/followups/eligibility.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { classifyLead, emptySignals, rankedServices, scannerGap, sortQueue, type LeadSignals } from "./eligibility";
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
const CONTACT = { business: "Acme Childcare", category: "Childcare", website: "acme.test", email: "info@acme.test" };
const CLEAR = { client: null, optedOut: false };

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
const classify = (over: { s?: Partial<LeadSignals>; rows?: FollowUpRow[]; guard?: typeof CLEAR; contact?: typeof CONTACT | null } = {}) =>
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
    [{ s: { archived: true } }, /archived/i],
    [{ contact: null }, /leads table/i],
    [{ contact: { ...CONTACT, email: null } }, /no email/i],
    [{ guard: { client: "Whittles", optedOut: false } }, /existing client \(Whittles\)/i],
    [{ guard: { client: null, optedOut: true } }, /opted out/i],
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

  it("orders awaiting, ready, waiting, done, excluded — hottest first within a stage", () => {
    const base = classify()!;
    const items = [
      { ...base, leadId: "e", stage: "excluded" as const },
      { ...base, leadId: "r1", stage: "ready" as const, score: 70 },
      { ...base, leadId: "a", stage: "awaiting" as const },
      { ...base, leadId: "r2", stage: "ready" as const, score: 80 },
      { ...base, leadId: "w", stage: "waiting" as const },
      { ...base, leadId: "d", stage: "done" as const },
    ];
    expect(sortQueue(items).map((i) => i.leadId)).toEqual(["a", "r2", "r1", "w", "d", "e"]);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/followups/eligibility.test.ts`
Expected: FAIL, because `./eligibility` cannot be resolved.

- [ ] **Step 3: Implement `lib/followups/eligibility.ts`**

```ts
import { FOLLOW_UP_MIN_SCORE, leadScore } from "@/lib/data/leadScore";
import { serviceBySlug } from "@/lib/pipeline/services";
import { isTouch2Due, touch2DueOn } from "./schedule";
import { SCANNER_GAP_MS, type FollowUpQueueItem, type FollowUpRow, type FollowUpStage } from "./types";

/**
 * Where one lead sits in the Follow-Up pipeline — pure, so the queue, the
 * draft route and the send route all make the SAME decision, and it is
 * testable without Supabase. The server (lib/followups/server.ts) gathers the
 * facts; this module only judges them.
 *
 * Exclusions are checked BEFORE the lead's follow_ups rows on purpose: a draft
 * written yesterday for a lead who enquired this morning must read as
 * excluded, so the send route refuses it.
 */

/** What portal_events says about one lead. */
export interface LeadSignals {
  leadId: string;
  /** service slug → how many times they opened it */
  serviceOpens: Record<string, number>;
  /** ISO time of their first service open */
  firstServiceOpenAt: string | null;
  inquiries: number;
  /** every email_sent timestamp for this lead (any campaign) */
  sends: string[];
  handedOff: boolean;
  archived: boolean;
}

/** What the leads table says (null when the lead row is gone). */
export interface LeadContact {
  business: string | null;
  category: string | null;
  website: string | null;
  email: string | null;
}

/** What the Master Client List and the opt-out list say. */
export interface LeadGuard {
  /** client display name when the lead is an existing customer */
  client: string | null;
  optedOut: boolean;
}

export function emptySignals(leadId: string): LeadSignals {
  return {
    leadId,
    serviceOpens: {},
    firstServiceOpenAt: null,
    inquiries: 0,
    sends: [],
    handedOff: false,
    archived: false,
  };
}

/** Known service slugs, most-opened first (ties by slug, for stable output). */
export function rankedServices(opens: Record<string, number>): string[] {
  return Object.entries(opens)
    .filter(([slug, n]) => n > 0 && serviceBySlug(slug) !== null)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([slug]) => slug);
}

/** The shared intent score, fed only the counts that decide the top bands. */
export function signalScore(s: LeadSignals): number {
  const serviceOpens = rankedServices(s.serviceOpens).reduce((n, slug) => n + s.serviceOpens[slug], 0);
  return leadScore({
    counts: { inquiries: s.inquiries, serviceOpens, portalViews: 0, emailClicks: 0, chatPrompts: 0 },
  });
}

/** ms from the most recent send at or before the first service open, to that open. */
export function scannerGap(s: LeadSignals): number | null {
  if (!s.firstServiceOpenAt) return null;
  const open = Date.parse(s.firstServiceOpenAt);
  if (!Number.isFinite(open)) return null;
  let last = -Infinity;
  for (const iso of s.sends) {
    const t = Date.parse(iso);
    if (Number.isFinite(t) && t <= open && t > last) last = t;
  }
  return Number.isFinite(last) ? open - last : null;
}

export function classifyLead(input: {
  signals: LeadSignals;
  contact: LeadContact | null;
  guard: LeadGuard;
  rows: FollowUpRow[];
  now: number;
}): FollowUpQueueItem | null {
  const { signals, contact, guard, rows, now } = input;
  const score = signalScore(signals);
  if (score < FOLLOW_UP_MIN_SCORE) return null;

  const services = rankedServices(signals.serviceOpens);
  const gap = scannerGap(signals);
  const r1 = rows.find((r) => r.touch === 1) ?? null;
  const r2 = rows.find((r) => r.touch === 2) ?? null;

  const base: FollowUpQueueItem = {
    leadId: signals.leadId,
    business: contact?.business ?? null,
    category: contact?.category ?? null,
    website: contact?.website ?? null,
    email: contact?.email ?? null,
    score,
    service: services[0] ?? null,
    services,
    stage: "ready",
    touch: 1,
    reason: null,
    draft: null,
    touch1SentAt: r1?.status === "sent" ? r1.sent_at : null,
    touch2DueOn: null,
    likelyScanner: gap !== null && gap < SCANNER_GAP_MS,
    scannerGapSeconds: gap === null ? null : Math.round(gap / 1000),
  };
  const finish = (stage: FollowUpStage, reason: string): FollowUpQueueItem => ({ ...base, stage, touch: null, reason });

  if (signals.inquiries > 0) return finish("excluded", "Enquired — Sales owns this lead");
  if (signals.handedOff) return finish("excluded", "Already with Sales");
  if (signals.archived) return finish("excluded", "Archived on Hot Leads");
  if (!contact) return finish("excluded", "Lead is no longer in the leads table");
  if (!contact.email) return finish("excluded", "No email address on file");
  if (guard.client) return finish("excluded", `Existing client (${guard.client})`);
  if (guard.optedOut) return finish("excluded", "Opted out");

  const closed = rows.find((r) => r.status === "skipped" || r.status === "replied" || r.status === "blocked");
  if (closed) {
    const reason =
      closed.status === "replied"
        ? "Replied — stopped"
        : closed.status === "skipped"
          ? closed.note ? `Skipped: ${closed.note}` : "Skipped"
          : `Blocked: ${closed.note ?? "dropped at send"}`;
    return finish("done", reason);
  }
  if (r2?.status === "sent") return finish("done", "Both follow-ups sent");

  if (!r1) return base;
  if (r1.status === "draft") return { ...base, stage: "awaiting", touch: 1, draft: r1 };

  // touch 1 has been sent
  if (r2?.status === "draft") return { ...base, stage: "awaiting", touch: 2, draft: r2 };
  const due = r1.sent_at ? touch2DueOn(r1.sent_at) : null;
  if (r1.sent_at && isTouch2Due(r1.sent_at, now)) return { ...base, stage: "ready", touch: 2, touch2DueOn: due };
  return { ...base, stage: "waiting", touch: 2, touch2DueOn: due };
}

const STAGE_ORDER: Record<FollowUpStage, number> = { awaiting: 0, ready: 1, waiting: 2, done: 3, excluded: 4 };

export function sortQueue(items: FollowUpQueueItem[]): FollowUpQueueItem[] {
  return [...items].sort((a, b) => STAGE_ORDER[a.stage] - STAGE_ORDER[b.stage] || b.score - a.score);
}
```

- [ ] **Step 4: Run it to verify it passes**

Run: `npx vitest run lib/followups/eligibility.test.ts`
Expected: PASS.

- [ ] **Step 5: Write the failing labels test**

Create `lib/followups/labels.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { followUpChip } from "./labels";
import type { FollowUpQueueItem } from "./types";

const item = (over: Partial<FollowUpQueueItem>): FollowUpQueueItem => ({
  leadId: "x",
  business: null,
  category: null,
  website: null,
  email: "a@b.test",
  score: 70,
  service: "plumbing",
  services: ["plumbing"],
  stage: "ready",
  touch: 1,
  reason: null,
  draft: null,
  touch1SentAt: null,
  touch2DueOn: null,
  likelyScanner: false,
  scannerGapSeconds: null,
  ...over,
});

describe("followUpChip", () => {
  it("names each stage", () => {
    expect(followUpChip(item({ stage: "ready", touch: 1 }))).toBe("Follow-up ready to draft");
    expect(followUpChip(item({ stage: "ready", touch: 2 }))).toBe("Follow-up 2 due");
    expect(followUpChip(item({ stage: "awaiting", touch: 2 }))).toBe("Follow-up 2 drafted");
    expect(followUpChip(item({ stage: "waiting", touch: 2, touch2DueOn: "2026-09-28" }))).toBe("Follow-up 1 sent · #2 due 28 Sep");
    expect(followUpChip(item({ stage: "done", touch: null }))).toBe("Ready for Sales");
  });

  it("says nothing for excluded or unknown leads", () => {
    expect(followUpChip(item({ stage: "excluded", touch: null }))).toBeNull();
    expect(followUpChip(undefined)).toBeNull();
  });
});
```

- [ ] **Step 6: Run it to verify it fails**

Run: `npx vitest run lib/followups/labels.test.ts`
Expected: FAIL, because `./labels` cannot be resolved.

- [ ] **Step 7: Implement `lib/followups/labels.ts`**

```ts
import type { FollowUpQueueItem } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-28" → "28 Sep" (the date is already a Melbourne calendar date). */
function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] ?? ""}`.trim();
}

/** The one-line follow-up state a Hot Leads row shows, or null for none. */
export function followUpChip(item: FollowUpQueueItem | undefined): string | null {
  if (!item) return null;
  switch (item.stage) {
    case "ready":
      return item.touch === 2 ? "Follow-up 2 due" : "Follow-up ready to draft";
    case "awaiting":
      return `Follow-up ${item.touch ?? 1} drafted`;
    case "waiting":
      return item.touch2DueOn ? `Follow-up 1 sent · #2 due ${shortDate(item.touch2DueOn)}` : "Follow-up 1 sent";
    case "done":
      return "Ready for Sales";
    default:
      return null;
  }
}
```

- [ ] **Step 8: Run the follow-up tests**

Run: `npx vitest run lib/followups`
Expected: PASS.

- [ ] **Step 9: Checkpoint.** Don't commit.

---

### Task 3: Touch-specific Claude prompt

**Files:**
- Modify: `lib/ai/followUpPrompt.ts` (export `serviceWords`, `joinWords`; extract `NO_TRACKING_RULE`)
- Create: `lib/ai/hotFollowUpPrompt.ts`
- Create: `lib/ai/hotFollowUpPrompt.test.ts`
- Test (unchanged, must stay green): `lib/ai/followUpPrompt.test.ts`

**Interfaces:**
- Consumes: `buildFollowUpPrompt`, `FOLLOW_UP_ANGLES`, `LeadHistory` (existing), `serviceBySlug`, `Touch` (Task 1).
- Produces:
  - `NO_TRACKING_RULE: string`
  - `serviceWords(services: string[]): string[]`
  - `joinWords(list: string[]): string`
  - `followUpAngleFor(leadId: string): string`
  - `buildHotFollowUpPrompt(input: { history: LeadHistory | null; services: string[]; touch: Touch; leadId: string }): string`

- [ ] **Step 1: Refactor `lib/ai/followUpPrompt.ts` without changing its output**

1. Change `function serviceWords(` to `export function serviceWords(`.
2. Change `function joinWords(` to `export function joinWords(`.
3. Directly above `export function buildFollowUpPrompt`, add:

```ts
/**
 * The hard rule every follow-up prompt carries, word for word. Exported so the
 * hot-lead follow-up prompt (lib/ai/hotFollowUpPrompt.ts) uses the exact same
 * sentence rather than a paraphrase that could drift weaker.
 */
export const NO_TRACKING_RULE =
  `- CRITICAL: never mention, hint at, imply or reference that we can see what they viewed, clicked, opened or downloaded. Do not write "I saw you", "I noticed you", "you had a look at", "since you were browsing", or anything of that kind. The only sign of this knowledge may be that the email happens to be about the right thing. Breaking this rule is a serious error.`;
```

4. Inside `buildFollowUpPrompt`, replace the inline `` `- CRITICAL: never mention, … serious error.`, `` array element with `NO_TRACKING_RULE,`.

- [ ] **Step 2: Confirm the existing prompt tests still pass**

Run: `npx vitest run lib/ai/followUpPrompt.test.ts`
Expected: PASS, with no snapshot or text changes.

- [ ] **Step 3: Write the failing hot-follow-up prompt test**

Create `lib/ai/hotFollowUpPrompt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { FOLLOW_UP_ANGLES, NO_TRACKING_RULE, type LeadHistory } from "./followUpPrompt";
import { buildHotFollowUpPrompt, followUpAngleFor } from "./hotFollowUpPrompt";

const ID = "11111111-1111-4111-8111-111111111111";
const HISTORY: LeadHistory = {
  sends: 1,
  lastSentAt: "2026-09-18T00:00:00Z",
  daysSince: 7,
  services: ["plumbing"],
  engaged: true,
};
const count = (hay: string, needle: string) => hay.split(needle).length - 1;

describe("buildHotFollowUpPrompt — touch 1", () => {
  const p = buildHotFollowUpPrompt({ history: HISTORY, services: ["plumbing", "painting"], touch: 1, leadId: ID });

  it("makes the most-opened service the subject", () => {
    expect(p).toMatch(/follow-up 1 of 2/i);
    expect(p).toMatch(/make plumbing the whole subject/i);
    expect(p).toMatch(/subject line must be about plumbing/i);
  });

  it("grounds the service in its real description", () => {
    expect(p).toMatch(/What APMG's Plumbing Services covers/);
  });

  it("carries the no-tracking rule exactly once", () => {
    expect(count(p, NO_TRACKING_RULE)).toBe(1);
  });

  it("contains no em dashes (they leak into the copy)", () => {
    expect(p).not.toContain("—");
  });
});

describe("buildHotFollowUpPrompt — touch 2", () => {
  const p = buildHotFollowUpPrompt({ history: { ...HISTORY, sends: 2 }, services: ["plumbing"], touch: 2, leadId: ID });

  it("is the last touch, from a stable angle", () => {
    expect(p).toMatch(/follow-up 2 of 2/i);
    expect(p).toContain(followUpAngleFor(ID));
    expect(FOLLOW_UP_ANGLES).toContain(followUpAngleFor(ID));
    expect(followUpAngleFor(ID)).toBe(followUpAngleFor(ID));
  });

  it("offers an easy way out and forbids reusing the first email", () => {
    expect(p).toMatch(/do not reuse the opening/i);
    expect(p).toMatch(/timing isn't right/i);
  });

  it("carries the no-tracking rule exactly once", () => {
    expect(count(p, NO_TRACKING_RULE)).toBe(1);
  });
});

describe("buildHotFollowUpPrompt — no send on the ledger", () => {
  const p = buildHotFollowUpPrompt({ history: null, services: ["electrical"], touch: 1, leadId: ID });

  it("never invents when APMG last wrote", () => {
    expect(p).not.toMatch(/earlier today|yesterday|days ago|week/i);
    expect(p).toMatch(/do not say when APMG last wrote/i);
  });

  it("still leads with the service and keeps the rule", () => {
    expect(p).toMatch(/electrical work/);
    expect(count(p, NO_TRACKING_RULE)).toBe(1);
  });
});
```

- [ ] **Step 4: Run it to verify it fails**

Run: `npx vitest run lib/ai/hotFollowUpPrompt.test.ts`
Expected: FAIL, because `./hotFollowUpPrompt` cannot be resolved.

- [ ] **Step 5: Implement `lib/ai/hotFollowUpPrompt.ts`**

```ts
import { serviceBySlug } from "@/lib/pipeline/services";
import type { Touch } from "@/lib/followups/types";
import {
  buildFollowUpPrompt,
  FOLLOW_UP_ANGLES,
  joinWords,
  NO_TRACKING_RULE,
  serviceWords,
  type LeadHistory,
} from "./followUpPrompt";

/**
 * The touch-specific block for a HOT-LEAD follow-up (Follow-Ups tab), appended
 * to the user message after buildFollowUpPrompt's generic follow-up block —
 * never merged into the system prefix, so the live compose_prompt row stays in
 * charge and the cached KB prefix stays byte-identical.
 *
 * Touch 1 makes the lead's most-opened service the whole email. Touch 2 is the
 * last one: same service, a different angle, shorter, and an easy way out.
 * Both carry NO_TRACKING_RULE exactly once — the trail steers the topic and is
 * never spoken aloud (the trail is bot-inflated; see followUpPrompt.ts).
 *
 * No em dashes in any line here: prompt punctuation leaks into the copy.
 */

/** A stable angle per lead, so a redraft doesn't flip to a different one. */
export function followUpAngleFor(leadId: string): string {
  let h = 0;
  for (const ch of leadId) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return FOLLOW_UP_ANGLES[h % FOLLOW_UP_ANGLES.length];
}

export function buildHotFollowUpPrompt(input: {
  history: LeadHistory | null;
  services: string[];
  touch: Touch;
  leadId: string;
}): string {
  const services = input.services.length > 0 ? input.services : (input.history?.services ?? []);
  const words = serviceWords(services);
  const primary = words[0] ?? "looking after their site";
  const svc = serviceBySlug(services[0]);
  const lines: string[] = [];

  const base = input.history ? buildFollowUpPrompt({ ...input.history, services }) : "";
  if (base) {
    lines.push(base);
  } else {
    // No email_sent row for this lead (a pre-ledger warm-up send, or a lost
    // row). We know they heard from us (they clicked a tracked link) but not
    // WHEN, so the writer must not put a date on it.
    lines.push(
      `IMPORTANT: this lead has already heard from APMG. Write this as a short, friendly follow-up, not a first introduction, but do not say when APMG last wrote.`,
    );
    if (words.length > 0) {
      lines.push(`This lead has been looking at these APMG services on our website: ${joinWords(words)}.`);
    }
  }

  if (svc) {
    lines.push(`What APMG's ${svc.name} covers (the only facts you may use about it): ${svc.focus}`);
  }

  if (input.touch === 1) {
    lines.push(
      `THIS EMAIL (follow-up 1 of 2): make ${primary} the whole subject of the email. Give one concrete, practical example of how APMG handles ${primary} for a site like theirs, then one easy next step: a quick call, or a no-obligation site visit and quote.`,
      `- The subject line must be about ${primary} for their site. Never a generic "Following up" or "Checking in".`,
    );
  } else {
    lines.push(
      `THIS EMAIL (follow-up 2 of 2, the last one for now): stay on ${primary}, but come at it from this angle: ${followUpAngleFor(input.leadId)}.`,
      `- Do not reuse the opening, the example or the call to action from APMG's previous email.`,
      `- Keep it to the greeting, one short paragraph, the call to action and the sign-off.`,
      `- End with an easy, no-pressure line: if the timing isn't right, that's completely fine, and they can get in touch whenever it suits.`,
    );
  }

  if (!lines.some((l) => l.includes(NO_TRACKING_RULE))) lines.push(NO_TRACKING_RULE);
  return lines.join("\n");
}
```

- [ ] **Step 6: Run the AI tests**

Run: `npx vitest run lib/ai`
Expected: PASS, including the unchanged `followUpPrompt.test.ts`.

- [ ] **Step 7: Checkpoint.** Don't commit.

---

### Task 4: Extract `deliverCampaign` from the cold send route

**Files:**
- Create: `lib/pipeline/deliver.ts`
- Create: `lib/pipeline/deliver.test.ts`
- Modify: `app/api/pipeline/campaigns/send/route.ts` (replace everything after the recipient sanitize/dedupe with a `deliverCampaign` call)
- Test (unchanged, must stay green): `app/api/pipeline/campaigns/send/route.test.ts`

**Interfaces:**
- Produces:
  - `SENT_EVENT = "email_sent"`
  - `type SendMode`
  - `interface SendResult` (moved verbatim from the route)
  - `interface CleanRecipient` (the route's, plus `hero?: { url: string; alt?: string }` and `ledgerProps?: Record<string, string>`)
  - `interface DeliverInput { campaign: string; base: string; recipients: CleanRecipient[]; subject?: string; bodyHtml?: string; hero?: { url: string; alt?: string } | null; ledgerProps?: Record<string, string>; label?: string }`
  - `interface DeliverOutcome { status: number; result: SendResult; deliveredIds: string[]; drops: Array<{ id: string; reason: string }> }`
  - `deliverCampaign(input: DeliverInput): Promise<DeliverOutcome>`

**Behaviour contract:** the cold route's responses must stay byte-for-byte identical. That covers status codes, error strings, the order of checks and the payload shape. The only additions are per-recipient `hero` and per-recipient `ledgerProps`, which the cold route never sets.

- [ ] **Step 1: Write the failing deliver test**

Create `lib/pipeline/deliver.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const campaignWebhook = vi.fn();
const supabaseTarget = vi.fn(() => ({ state: "ok", base: "https://sb.test", key: "k" }) as unknown);
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, campaignWebhook: () => campaignWebhook(), supabaseTarget: () => supabaseTarget() };
});

const fetchSuppressedEmails = vi.fn(async () => new Set<string>());
const fetchSuppressedDomains = vi.fn(async () => new Map<string, string>());
// typed with rest args so mock.calls[0][2] (the rows) type-checks under tsc
const insertPortalEvents = vi.fn(async (..._a: unknown[]) => true);
vi.mock("@/lib/portal/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal/server")>();
  return {
    ...actual,
    fetchSuppressedEmails: (...a: unknown[]) => fetchSuppressedEmails(...(a as [])),
    fetchSuppressedDomains: (...a: unknown[]) => fetchSuppressedDomains(...(a as [])),
    insertPortalEvents: (...a: unknown[]) => insertPortalEvents(...a),
  };
});
vi.mock("@/lib/pipeline/sectorStore", () => ({ loadPlaybooks: async () => [], playbookPdfUrl: () => null }));

import { deliverCampaign, type CleanRecipient } from "./deliver";

const A: CleanRecipient = {
  id: "11111111-1111-4111-8111-111111111111",
  email: "info@northside.example",
  business: "Northside",
  subject: "Plumbing for Northside",
  html: "<p>Hi</p><p><a href=\"{{link}}\">Go</a></p>",
  category: "Childcare",
};
/** Whittles is a real client on the bundled Master Client List. */
const CLIENT: CleanRecipient = { ...A, id: "33333333-3333-4333-8333-333333333333", email: "x@whittles.com.au", business: "Whittles Strata" };

let fetchSpy: ReturnType<typeof vi.spyOn>;
beforeEach(() => {
  vi.clearAllMocks();
  supabaseTarget.mockReturnValue({ state: "ok", base: "https://sb.test", key: "k" });
  fetchSuppressedEmails.mockResolvedValue(new Set());
  fetchSuppressedDomains.mockResolvedValue(new Map());
  campaignWebhook.mockResolvedValue({ state: "ok", url: "https://n8n.example/hook", source: "setting" });
  fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 200 }));
});

function payload(): { campaign: string; messages: Array<Record<string, unknown>> } {
  const call = fetchSpy.mock.calls.find(([url]) => String(url) === "https://n8n.example/hook");
  return JSON.parse(String((call?.[1] as RequestInit).body));
}

describe("deliverCampaign", () => {
  it("uses a recipient's own hero over the send-level one", async () => {
    await deliverCampaign({
      campaign: "hot-followup",
      base: "https://x.test",
      hero: { url: "https://img/default.jpg", alt: "default" },
      recipients: [{ ...A, hero: { url: "https://img/plumbing.jpg", alt: "a plumber" } }],
    });
    expect(payload().messages[0]).toMatchObject({ hero: "https://img/plumbing.jpg", hero_alt: "a plumber" });
  });

  it("merges send-level and per-recipient ledger props onto email_sent rows", async () => {
    const out = await deliverCampaign({
      campaign: "hot-followup",
      base: "https://x.test",
      ledgerProps: { kind: "follow_up" },
      recipients: [{ ...A, ledgerProps: { touch: "2" } }],
    });
    expect(out.result.ok).toBe(true);
    expect(out.deliveredIds).toEqual([A.id]);
    const rows = insertPortalEvents.mock.calls[0][2] as Array<Record<string, unknown>>;
    expect(rows[0]).toMatchObject({ event: "email_sent", campaign: "hot-followup", props: { kind: "follow_up", touch: "2" } });
  });

  it("reports every dropped recipient by id with a reason", async () => {
    fetchSuppressedDomains.mockResolvedValue(new Map([["northside.example", "boss@northside.example"]]));
    const out = await deliverCampaign({ campaign: "c", base: "https://x.test", recipients: [A, CLIENT] });
    expect(out.drops).toEqual(
      expect.arrayContaining([
        { id: CLIENT.id, reason: expect.stringMatching(/existing client/i) },
        { id: A.id, reason: expect.stringMatching(/organisation opted out/i) },
      ]),
    );
    expect(out.deliveredIds).toEqual([]);
    expect(out.result.ok).toBe(false);
  });

  it("delivers nothing and marks nothing when the automation is paused", async () => {
    campaignWebhook.mockResolvedValue({ state: "paused", url: "u", source: "setting" });
    const out = await deliverCampaign({ campaign: "c", base: "https://x.test", recipients: [A] });
    expect(out.status).toBe(503);
    expect(out.deliveredIds).toEqual([]);
    expect(insertPortalEvents).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npx vitest run lib/pipeline/deliver.test.ts`
Expected: FAIL, because `./deliver` cannot be resolved.

- [ ] **Step 3: Create `lib/pipeline/deliver.ts`**

Move the code, keeping every comment from the route that explains a step:

```ts
import "server-only";
import { matchReason, partitionByClientGuard } from "@/lib/clients/guard";
import { clientGuardData } from "@/lib/clients/server";
import { htmlToText, renderBody, renderSubject, trackedLink } from "@/lib/pipeline/campaign";
import { campaignWebhook, isUuid, supabaseTarget, webhookAuthHeaders } from "@/lib/pipeline/server";
import { loadPlaybooks, playbookPdfUrl } from "@/lib/pipeline/sectorStore";
import { resolveSectorForCategory } from "@/lib/pipeline/sectors";
import {
  fetchSuppressedDomains,
  fetchSuppressedEmails,
  insertPortalEvents,
  organisationDomain,
} from "@/lib/portal/server";

/**
 * The ONE path an outreach email takes out of this app: client guard →
 * address opt-outs → organisation opt-outs → render with the tracked link →
 * refuse when the automation is paused/unconfigured → n8n webhook → the
 * `email_sent` ledger. Extracted from /api/pipeline/campaigns/send so the cold
 * send and the Follow-Ups send can never disagree about who may be emailed.
 *
 * Returns the exact SendResult + HTTP status the cold route has always
 * answered with, plus which recipients were delivered and which were dropped
 * (by id, with a human reason) so a caller can mark its own rows.
 */

/** The send-ledger event name (portal_events). Keep in sync with
 *  /api/portal/report, which aggregates it per period. */
export const SENT_EVENT = "email_sent";

/** How many client matches to name in the response. */
const MAX_REPORTED_CLIENTS = 25;

export type SendMode = "live" | "unconfigured" | "paused" | "noop";

// ── paste `interface SendResult { … }` here VERBATIM from the route, then add `export` ──

export interface CleanRecipient {
  id: string;
  email: string;
  business?: string;
  /** the lead's website, used only by the client guard */
  website?: string;
  /** per-lead AI draft overrides — fall back to the shared template */
  subject?: string;
  html?: string;
  /** the lead's CSV Category — resolved to a Sector Playbook to attach its PDF */
  category?: string | null;
  /** per-recipient hero image (Follow-Ups: each lead's own service photo) */
  hero?: { url: string; alt?: string };
  /** extra props for THIS recipient's email_sent ledger row */
  ledgerProps?: Record<string, string>;
}

export interface DeliverInput {
  campaign: string;
  /** origin the tracked /t/ links are built on */
  base: string;
  recipients: CleanRecipient[];
  /** shared template, for recipients without their own draft */
  subject?: string;
  bodyHtml?: string;
  /** send-level hero (the Step 2 service template) */
  hero?: { url: string; alt?: string } | null;
  /** props written on every email_sent row of this send */
  ledgerProps?: Record<string, string>;
  /** log prefix */
  label?: string;
}

export interface DeliverOutcome {
  status: number;
  result: SendResult;
  /** ids of recipients the automation accepted (empty unless result.ok) */
  deliveredIds: string[];
  /** recipients dropped by a guard, with why */
  drops: Array<{ id: string; reason: string }>;
}

export async function deliverCampaign(input: DeliverInput): Promise<DeliverOutcome> {
  const { campaign, base } = input;
  const label = input.label ?? "pipeline/campaigns";
  const subject = input.subject ?? "";
  const bodyHtml = input.bodyHtml ?? "";
  const recipients = [...input.recipients];
  const drops: Array<{ id: string; reason: string }> = [];
  const done = (result: SendResult, status = 200, deliveredIds: string[] = []): DeliverOutcome => ({
    status,
    result,
    deliveredIds,
    drops,
  });

  // (1) CLIENT GUARD — paste the route's block from `const clientCheck = …`
  //     through its `if (recipients.length === 0) { return json({... clients ...}, 400) }`.
  //     Changes while pasting:
  //       - replace `console.warn(\`[pipeline/campaigns] …` with `console.warn(\`[${label}] …`
  //       - after building `clientMatches`, add:
  //           for (const { prospect, match } of clientCheck.blocked) {
  //             drops.push({ id: prospect.id, reason: `Existing client (${match.clientName})` });
  //           }
  //       - replace `return json(X, 400)` with `return done(X, 400)`

  // (2) SUPPRESSION — paste from `let suppressedCount = 0;` through the
  //     "Every recipient has unsubscribed." early return. Changes:
  //       - in the address-suppression loop, before `recipients.splice(i, 1)` add:
  //           drops.push({ id: recipients[i].id, reason: "Opted out" });
  //       - in the domain loop, before `recipients.splice(i, 1)` add:
  //           drops.push({ id: recipients[i].id, reason: `Organisation opted out (${optedOut})` });
  //       - log prefix → `[${label}]`; `return json(X, 400)` → `return done(X, 400)`

  // (3) SHARED TEMPLATE REQUIREDNESS — paste the two `if (!subject && …)` /
  //     `if (!bodyHtml && …)` checks, `return json(X, 400)` → `return done(X, 400)`.

  // (4) BUILD MESSAGES — paste from `const playbooks = await loadPlaybooks();`
  //     through the end of `const messages = recipients.map(...)`, DELETING the
  //     route's `service` / `heroUrl` lines, and replace the two hero fields with:
  //         hero: (r.hero ?? input.hero)?.url,
  //         hero_alt: (r.hero ?? input.hero)?.alt,
  //     (undefined values are dropped by JSON.stringify, exactly as before).

  // (5) WEBHOOK — paste from `const target = await campaignWebhook();` through
  //     the `if (!res.ok) { … }` block. `return json(X, S)` → `return done(X, S)`,
  //     log prefix → `[${label}]`.

  // (6) LEDGER — paste the `if (sb.state === "ok") { await insertPortalEvents(...) }`
  //     block, changing `props: {}` to:
  //         props: { ...(input.ledgerProps ?? {}), ...(r.ledgerProps ?? {}) },

  // (7) SUCCESS — paste the final `return json({ ok: true, … })` and change it to:
  //     return done({ ok: true, … same object … }, 200, recipients.map((r) => r.id));
}
```

Once the paste is done, the numbered comment scaffolding must be gone: `deliver.ts` holds only real code and the route's original explanatory comments. Check that every `json(` in the pasted blocks became `done(`, since `deliver.ts` has no `json` helper. `tsc` will flag any that were missed.

- [ ] **Step 4: Shrink the route to parse + validate + deliver**

In `app/api/pipeline/campaigns/send/route.ts`:

1. **Imports.** Delete the imports that are now only used in `deliver.ts`: `matchReason`, `partitionByClientGuard`, `clientGuardData`, `htmlToText`, `renderBody`, `renderSubject`, `trackedLink`, `campaignWebhook`, `isUuid`, `SECTOR_ASSETS_BUCKET`'s co-imports that are unused, `supabaseTarget`, `webhookAuthHeaders`, `loadPlaybooks`, `playbookPdfUrl`, `resolveSectorForCategory`, and the four `@/lib/portal/server` imports. Keep `bestEmail`, `ensureLinkToken`, `isEmail`, `MAX_RECIPIENTS`, `safeCampaignTag`, `publicObjectUrl`, `sameOrigin`, `SECTOR_ASSETS_BUCKET`, `serviceBySlug`, `guardResponse` and `requirePermission`. Add:

```ts
import { deliverCampaign, type CleanRecipient, type SendResult } from "@/lib/pipeline/deliver";
```

2. **Type definitions.** Delete the route's local `SENT_EVENT`, `MAX_REPORTED_CLIENTS`, `SendMode`, `SendResult` and `CleanRecipient` definitions. `sanitizeRecipient` keeps returning `CleanRecipient`, now imported.

3. **Body.** Everything after `if (recipients.length === 0) { … "No recipients with a valid email address." … }` becomes:

```ts
  // Everything from here on — client guard, opt-outs, render, webhook, ledger —
  // is the shared delivery path (lib/pipeline/deliver.ts), so the Follow-Ups
  // send can never apply a weaker guard than this one.
  const base = process.env.NEXT_PUBLIC_TRACK_BASE || new URL(req.url).origin;
  // Service template picked on Step 2 (one per send) — resolves to the public
  // Storage URL of that service's photo, sent as the branded email's hero.
  const service = serviceBySlug(typeof b.service === "string" ? b.service : null);
  const heroUrl = service ? publicObjectUrl(SECTOR_ASSETS_BUCKET, service.image) : null;
  const out = await deliverCampaign({
    campaign,
    base,
    recipients,
    subject,
    bodyHtml,
    hero: heroUrl && service ? { url: heroUrl, alt: service.imageAlt } : null,
  });
  return json(out.result, out.status);
}
```

4. **Header comment.** Keep the route's top-of-file comment, and add one line under it: `// The delivery chain itself lives in lib/pipeline/deliver.ts.`

- [ ] **Step 5: Run the send-route and deliver tests**

Run: `npx vitest run app/api/pipeline/campaigns/send lib/pipeline/deliver.test.ts`
Expected: PASS. The route test runs unchanged, which proves the cold path is identical.

- [ ] **Step 6: Type-check**

Run: `npx tsc --noEmit`
Expected: no errors. That means no unused imports and no leftover `json(` calls in `deliver.ts`.

- [ ] **Step 7: Checkpoint.** Don't commit.

---

### Task 5: `follow_ups` table and server data layer

**Files:**
- Create: `supabase/follow-ups.sql`
- Create: `lib/followups/server.ts`
- Create: `lib/followups/server.test.ts`

**Interfaces:**
- Consumes: `classifyLead`, `emptySignals`, `sortQueue`, and the `LeadSignals` / `LeadContact` / `LeadGuard` types (Task 2); `FollowUpRow` and the other types (Task 1); `bestEmail`, `isUuid`, `isMissingPortalTable`, `fetchSuppressedEmails`, `fetchSuppressedDomains`, `organisationDomain`, `partitionByClientGuard`, `clientGuardData`, `HANDOFF_EVENT` and `ARCHIVE_EVENT` (existing).
- Produces:
  - `interface Sb { base: string; key: string }`
  - `readFollowUpRows(sb, leadIds?: string[]): Promise<FollowUpRow[] | "missing" | "error">`
  - `readFollowUpsByIds(sb, ids: string[]): Promise<FollowUpRow[] | "missing" | "error">`
  - `readCandidateIds(sb): Promise<string[] | "error">`
  - `readSignals(sb, leadIds: string[]): Promise<Map<string, LeadSignals> | "error">`
  - `readContacts(sb, leadIds: string[]): Promise<Map<string, LeadContact> | "error">`
  - `readGuards(sb, contacts: Map<string, LeadContact>): Promise<Map<string, LeadGuard>>`
  - `loadQueue(sb, opts?: { leadIds?: string[]; now?: number }): Promise<{ ok: true; items: FollowUpQueueItem[] } | { ok: false; reason: "missing" | "error" }>`
  - `writeFollowUp(sb, row: FollowUpWrite): Promise<FollowUpRow | null>`
  - `patchFollowUps(sb, ids: string[], patch: FollowUpPatch, onlyStatus?: FollowUpStatus): Promise<FollowUpRow[] | null>`
  - `type FollowUpWrite = { lead_id: string; touch: Touch } & Partial<Omit<FollowUpRow, "id" | "lead_id" | "touch" | "created_at">>`
  - `type FollowUpPatch = Partial<Omit<FollowUpRow, "id" | "lead_id" | "touch" | "created_at">>`

- [ ] **Step 1: Create `supabase/follow-ups.sql`**

```sql
-- Hot-Lead Follow-Up pipeline (docs/superpowers/specs/2026-09-25-hot-lead-follow-up-design.md).
-- One row per lead per touch. Hand-run in the Supabase SQL editor; idempotent.
-- Server-only: RLS on with no policies, so only the service role can read/write.

create table if not exists public.follow_ups (
  id            uuid primary key default gen_random_uuid(),
  lead_id       uuid not null references public.leads(id) on delete cascade,
  touch         smallint not null check (touch in (1, 2)),
  status        text not null default 'draft'
                check (status in ('draft', 'sent', 'skipped', 'blocked', 'replied')),
  subject       text,
  body_html     text,
  service_slug  text,
  model         text,
  note          text,
  drafted_at    timestamptz,
  sent_at       timestamptz,
  sent_by       text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (lead_id, touch)
);

create index if not exists follow_ups_status_idx on public.follow_ups (status);

alter table public.follow_ups enable row level security;
```

- [ ] **Step 2: Write the failing server test**

Create `lib/followups/server.test.ts`:

```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("@/lib/portal/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal/server")>();
  return {
    ...actual,
    fetchSuppressedEmails: async () => new Set<string>(),
    fetchSuppressedDomains: async () => new Map<string, string>(),
  };
});

import { loadQueue, readSignals } from "./server";

const SB = { base: "https://sb.test", key: "k" };
const LEAD = "11111111-1111-4111-8111-111111111111";

/** Route PostgREST GETs by table/event to canned rows. */
function stubRest(routes: Array<[RegExp, unknown[] | number]>) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url) => {
    const u = decodeURIComponent(String(url));
    for (const [re, body] of routes) {
      if (re.test(u)) {
        return typeof body === "number"
          ? new Response('{"code":"PGRST205","message":"Could not find the table"}', { status: body })
          : new Response(JSON.stringify(body), { status: 200 });
      }
    }
    return new Response("[]", { status: 200 });
  });
}

afterEach(() => vi.restoreAllMocks());

describe("readSignals", () => {
  it("folds a lead's events into opens, first open, enquiries, sends and markers", async () => {
    stubRest([
      [
        /portal_events\?select=lead_id,event,props,created_at/,
        [
          { lead_id: LEAD, event: "email_sent", props: {}, created_at: "2026-09-20T00:00:00Z" },
          { lead_id: LEAD, event: "portal_service_open", props: { service: "Plumbing" }, created_at: "2026-09-20T00:05:00Z" },
          { lead_id: LEAD, event: "portal_service_open", props: { service: "plumbing" }, created_at: "2026-09-21T00:00:00Z" },
          { lead_id: LEAD, event: "sales_handoff", props: {}, created_at: "2026-09-22T00:00:00Z" },
        ],
      ],
    ]);
    const map = await readSignals(SB, [LEAD]);
    if (map === "error") throw new Error("read failed");
    const s = map.get(LEAD)!;
    expect(s.serviceOpens).toEqual({ plumbing: 2 });
    expect(s.firstServiceOpenAt).toBe("2026-09-20T00:05:00Z");
    expect(s.sends).toEqual(["2026-09-20T00:00:00Z"]);
    expect(s.handedOff).toBe(true);
    expect(s.archived).toBe(false);
  });
});

describe("loadQueue", () => {
  it("reports a missing follow_ups table as 'missing'", async () => {
    stubRest([[/follow_ups\?/, 404]]);
    expect(await loadQueue(SB)).toEqual({ ok: false, reason: "missing" });
  });

  it("builds a ready item for a hot lead with a contact", async () => {
    stubRest([
      [/follow_ups\?/, []],
      [/portal_events\?select=lead_id&event=eq.portal_service_open/, [{ lead_id: LEAD }]],
      [
        /portal_events\?select=lead_id,event,props,created_at/,
        [{ lead_id: LEAD, event: "portal_service_open", props: { service: "painting" }, created_at: "2026-09-20T00:05:00Z" }],
      ],
      [/leads\?select=/, [{ id: LEAD, name: "Acme", category: "Childcare", website: "acme.test", emails: ["info@acme.test"] }]],
    ]);
    const q = await loadQueue(SB, { now: Date.parse("2026-09-25T02:00:00Z") });
    if (!q.ok) throw new Error("queue failed");
    expect(q.items).toHaveLength(1);
    expect(q.items[0]).toMatchObject({ leadId: LEAD, stage: "ready", touch: 1, service: "painting", email: "info@acme.test" });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/followups/server.test.ts`
Expected: FAIL, because `./server` cannot be resolved.

- [ ] **Step 4: Implement `lib/followups/server.ts`**

```ts
import "server-only";
import { partitionByClientGuard } from "@/lib/clients/guard";
import { clientGuardData } from "@/lib/clients/server";
import { bestEmail } from "@/lib/pipeline/campaign";
import { isUuid } from "@/lib/pipeline/server";
import {
  fetchSuppressedDomains,
  fetchSuppressedEmails,
  isMissingPortalTable,
  organisationDomain,
} from "@/lib/portal/server";
import { ARCHIVE_EVENT, HANDOFF_EVENT } from "@/lib/sales/handoff";
import { classifyLead, emptySignals, sortQueue, type LeadContact, type LeadGuard, type LeadSignals } from "./eligibility";
import type { FollowUpQueueItem, FollowUpRow, FollowUpStatus, Touch } from "./types";

/**
 * Server-only data layer for the Follow-Ups tab: plain PostgREST fetches with
 * the service-role key (same idiom as lib/pipeline/leadHistory.ts), plus
 * loadQueue, which gathers every fact classifyLead needs and returns the
 * judged, sorted queue. Every route (queue, draft, send, mark) goes through
 * loadQueue, so eligibility is decided in one place.
 */

export interface Sb {
  base: string;
  key: string;
}

export type FollowUpWrite = { lead_id: string; touch: Touch } & Partial<
  Omit<FollowUpRow, "id" | "lead_id" | "touch" | "created_at">
>;
export type FollowUpPatch = Partial<Omit<FollowUpRow, "id" | "lead_id" | "touch" | "created_at">>;

const TABLE = "follow_ups";
const ROW_COLS =
  "id,lead_id,touch,status,subject,body_html,service_slug,model,note,drafted_at,sent_at,sent_by,created_at,updated_at";
/** uuids per in.() list — keeps request URLs short (leadHistory uses the same). */
const CHUNK = 200;
const LIMIT = 5000;
const SERVICE_EVENT = "portal_service_open";
const INQUIRY_EVENT = "portal_inquiry";
const SENT_EVENT = "email_sent";
const SIGNAL_EVENTS = [SERVICE_EVENT, INQUIRY_EVENT, SENT_EVENT, HANDOFF_EVENT, ARCHIVE_EVENT];

function headers(key: string, extra?: Record<string, string>): HeadersInit {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

type Got = { ok: true; rows: unknown[] } | { ok: false; missing: boolean };

async function get(sb: Sb, pathAndQuery: string): Promise<Got> {
  try {
    const res = await fetch(`${sb.base}/rest/v1/${pathAndQuery}`, { headers: headers(sb.key), cache: "no-store" });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const missing = isMissingPortalTable(res.status, detail);
      if (!missing) console.error(`[followups] ${pathAndQuery.split("?")[0]} ${res.status}:`, detail.slice(0, 300));
      return { ok: false, missing };
    }
    const rows = await res.json().catch(() => null);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    console.error("[followups] read failed:", e);
    return { ok: false, missing: false };
  }
}

function chunks(ids: string[]): string[][] {
  const out: string[][] = [];
  for (let i = 0; i < ids.length; i += CHUNK) out.push(ids.slice(i, i + CHUNK));
  return out;
}

async function readRowsWhere(sb: Sb, column: "lead_id" | "id", ids?: string[]): Promise<FollowUpRow[] | "missing" | "error"> {
  const lists = ids === undefined ? [null] : chunks(ids.filter(isUuid));
  if (ids !== undefined && lists.length === 0) return [];
  const out: FollowUpRow[] = [];
  for (const list of lists) {
    const filter = list ? `&${column}=in.(${list.join(",")})` : "";
    const got = await get(sb, `${TABLE}?select=${ROW_COLS}${filter}&order=created_at.asc&limit=${LIMIT}`);
    if (!got.ok) return got.missing ? "missing" : "error";
    out.push(...(got.rows as FollowUpRow[]));
  }
  return out;
}

export function readFollowUpRows(sb: Sb, leadIds?: string[]) {
  return readRowsWhere(sb, "lead_id", leadIds);
}

export function readFollowUpsByIds(sb: Sb, ids: string[]) {
  return readRowsWhere(sb, "id", ids);
}

/** Every lead that has ever opened a service card. */
export async function readCandidateIds(sb: Sb): Promise<string[] | "error"> {
  const got = await get(
    sb,
    `portal_events?select=lead_id&event=eq.${SERVICE_EVENT}&lead_id=not.is.null&order=created_at.desc&limit=${LIMIT}`,
  );
  if (!got.ok) return got.missing ? [] : "error";
  const ids = new Set<string>();
  for (const r of got.rows as Array<{ lead_id?: unknown }>) if (isUuid(r.lead_id)) ids.add(r.lead_id);
  return [...ids];
}

export async function readSignals(sb: Sb, leadIds: string[]): Promise<Map<string, LeadSignals> | "error"> {
  const map = new Map<string, LeadSignals>();
  for (const list of chunks(leadIds.filter(isUuid))) {
    const got = await get(
      sb,
      `portal_events?select=lead_id,event,props,created_at&lead_id=in.(${list.join(",")})` +
        `&event=in.(${SIGNAL_EVENTS.join(",")})&order=created_at.asc&limit=${LIMIT}`,
    );
    if (!got.ok) return "error";
    for (const r of got.rows as Array<{ lead_id?: unknown; event?: unknown; props?: Record<string, unknown> | null; created_at?: unknown }>) {
      if (!isUuid(r.lead_id)) continue;
      const s = map.get(r.lead_id) ?? emptySignals(r.lead_id);
      map.set(r.lead_id, s);
      const at = typeof r.created_at === "string" ? r.created_at : "";
      switch (r.event) {
        case SERVICE_EVENT: {
          const slug = typeof r.props?.service === "string" ? r.props.service.trim().toLowerCase() : "";
          if (!slug) break;
          s.serviceOpens[slug] = (s.serviceOpens[slug] ?? 0) + 1;
          if (at && (!s.firstServiceOpenAt || at < s.firstServiceOpenAt)) s.firstServiceOpenAt = at;
          break;
        }
        case INQUIRY_EVENT:
          s.inquiries += 1;
          break;
        case SENT_EVENT:
          if (at) s.sends.push(at);
          break;
        case HANDOFF_EVENT:
          s.handedOff = true;
          break;
        case ARCHIVE_EVENT:
          s.archived = true;
          break;
      }
    }
  }
  return map;
}

export async function readContacts(sb: Sb, leadIds: string[]): Promise<Map<string, LeadContact> | "error"> {
  const map = new Map<string, LeadContact>();
  const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
  for (const list of chunks(leadIds.filter(isUuid))) {
    const got = await get(sb, `leads?select=id,name,category,website,emails&id=in.(${list.join(",")})`);
    if (!got.ok) return "error";
    for (const r of got.rows as Array<Record<string, unknown>>) {
      if (!isUuid(r.id)) continue;
      const emails = Array.isArray(r.emails) ? r.emails.filter((x): x is string => typeof x === "string") : [];
      map.set(r.id, { business: str(r.name), category: str(r.category), website: str(r.website), email: bestEmail(emails) });
    }
  }
  return map;
}

/** Master Client List + address/organisation opt-outs, per lead. Opt-out
 *  lookups fail open (empty) exactly as the send route's do — and the send
 *  route re-checks inside deliverCampaign regardless. */
export async function readGuards(sb: Sb, contacts: Map<string, LeadContact>): Promise<Map<string, LeadGuard>> {
  const out = new Map<string, LeadGuard>();
  const prospects = [...contacts.entries()]
    .filter(([, c]) => c.email)
    .map(([leadId, c]) => ({ leadId, name: c.business, email: c.email, website: c.website }));
  const clientOf = new Map<string, string>();
  for (const { prospect, match } of partitionByClientGuard(prospects, clientGuardData()).blocked) {
    clientOf.set(prospect.leadId, match.clientName);
  }
  const emails = prospects.map((p) => (p.email as string).toLowerCase());
  const [suppressed, domains] = await Promise.all([
    fetchSuppressedEmails(sb.base, sb.key, emails),
    fetchSuppressedDomains(sb.base, sb.key, emails),
  ]);
  for (const p of prospects) {
    const email = (p.email as string).toLowerCase();
    const domain = organisationDomain(email);
    out.set(p.leadId, {
      client: clientOf.get(p.leadId) ?? null,
      optedOut: suppressed.has(email) || Boolean(domain && domains.has(domain)),
    });
  }
  return out;
}

export async function loadQueue(
  sb: Sb,
  opts: { leadIds?: string[]; now?: number } = {},
): Promise<{ ok: true; items: FollowUpQueueItem[] } | { ok: false; reason: "missing" | "error" }> {
  const rows = await readFollowUpRows(sb, opts.leadIds);
  if (rows === "missing" || rows === "error") return { ok: false, reason: rows };

  let ids: string[];
  if (opts.leadIds) {
    ids = [...new Set(opts.leadIds.filter(isUuid))];
  } else {
    const candidates = await readCandidateIds(sb);
    if (candidates === "error") return { ok: false, reason: "error" };
    ids = [...new Set([...candidates, ...rows.map((r) => r.lead_id)])];
  }
  if (ids.length === 0) return { ok: true, items: [] };

  const [signals, contacts] = await Promise.all([readSignals(sb, ids), readContacts(sb, ids)]);
  if (signals === "error" || contacts === "error") return { ok: false, reason: "error" };
  const guards = await readGuards(sb, contacts);

  const rowsBy = new Map<string, FollowUpRow[]>();
  for (const r of rows) rowsBy.set(r.lead_id, [...(rowsBy.get(r.lead_id) ?? []), r]);

  const now = opts.now ?? Date.now();
  const items: FollowUpQueueItem[] = [];
  for (const id of ids) {
    const item = classifyLead({
      signals: signals.get(id) ?? emptySignals(id),
      contact: contacts.get(id) ?? null,
      guard: guards.get(id) ?? { client: null, optedOut: false },
      rows: rowsBy.get(id) ?? [],
      now,
    });
    if (item) items.push(item);
  }
  return { ok: true, items: sortQueue(items) };
}

/** Insert or update the (lead_id, touch) row. Only the columns passed are
 *  written on conflict (PostgREST merge-duplicates). */
export async function writeFollowUp(sb: Sb, row: FollowUpWrite): Promise<FollowUpRow | null> {
  try {
    const res = await fetch(`${sb.base}/rest/v1/${TABLE}?on_conflict=lead_id,touch&select=${ROW_COLS}`, {
      method: "POST",
      headers: headers(sb.key, {
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=representation",
      }),
      body: JSON.stringify([{ ...row, updated_at: new Date().toISOString() }]),
    });
    if (!res.ok) {
      console.error(`[followups] write ${res.status}:`, (await res.text().catch(() => "")).slice(0, 300));
      return null;
    }
    const out = (await res.json().catch(() => [])) as FollowUpRow[];
    return out[0] ?? null;
  } catch (e) {
    console.error("[followups] write failed:", e);
    return null;
  }
}

/** PATCH rows by id — only those still in `onlyStatus` when given (the
 *  optimistic guard that makes a double-send a no-op). null on failure. */
export async function patchFollowUps(
  sb: Sb,
  ids: string[],
  patch: FollowUpPatch,
  onlyStatus?: FollowUpStatus,
): Promise<FollowUpRow[] | null> {
  const list = ids.filter(isUuid);
  if (list.length === 0) return [];
  const status = onlyStatus ? `&status=eq.${onlyStatus}` : "";
  try {
    const res = await fetch(`${sb.base}/rest/v1/${TABLE}?id=in.(${list.join(",")})${status}&select=${ROW_COLS}`, {
      method: "PATCH",
      headers: headers(sb.key, { "Content-Type": "application/json", Prefer: "return=representation" }),
      body: JSON.stringify({ ...patch, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) {
      console.error(`[followups] patch ${res.status}:`, (await res.text().catch(() => "")).slice(0, 300));
      return null;
    }
    return ((await res.json().catch(() => [])) as FollowUpRow[]) ?? [];
  } catch (e) {
    console.error("[followups] patch failed:", e);
    return null;
  }
}
```

- [ ] **Step 5: Run the server tests and type-check**

Run: `npx vitest run lib/followups` and `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 6: Checkpoint.** Don't commit.

---

### Task 6: API routes (queue, edit, draft, send, mark)

**Changes from spec §5 (routes are consolidated, the behaviour is the same):**
- The draft edit is `PATCH /api/followups { id, … }` instead of `PATCH /api/followups/:id`. That avoids the repo's first dynamic API segment.
- Skip and replied share one `POST /api/followups/mark` instead of separate `/:id/skip` and `/:id/replied` endpoints. Mark works on leadId because a "Ready to draft" lead can be skipped before any row exists.

**Files:**
- Modify: `lib/rbac/permissions.ts`. The routes need `followups.view` and `followups.send` to type-check, so add them here. Task 7 does the rest of the RBAC wiring.
- Modify: `lib/rbac/sections.ts`. Place the two permissions now, because the compile-time exhaustiveness check requires it.
- Create: `app/api/followups/route.ts` (GET, PATCH)
- Create: `app/api/followups/draft/route.ts`
- Create: `app/api/followups/send/route.ts`
- Create: `app/api/followups/mark/route.ts`
- Create: `app/api/followups/send/route.test.ts`
- Create: `app/api/followups/draft/route.test.ts`

**Interfaces:**
- Consumes: `loadQueue`, `readFollowUpsByIds`, `writeFollowUp`, `patchFollowUps` (Task 5); `deliverCampaign` (Task 4); `buildHotFollowUpPrompt` (Task 3); `draftEmail`, `loadComposePrompt`, `resolveModel`, `readLeadHistories`, `buildComposeKb`, `loadPlaybooks`, `COMPOSE_RATE`, `ensureLinkToken`, `serviceBySlug`, `publicObjectUrl`, `SECTOR_ASSETS_BUCKET` (existing); and the constants and response types (Task 1).
- Produces (HTTP):
  - `GET /api/followups` → `FollowUpQueueResponse`
  - `PATCH /api/followups { id, subject, body_html }` → `FollowUpMutationResponse`
  - `POST /api/followups/draft { leadIds }` → `FollowUpDraftResponse`
  - `POST /api/followups/send { ids }` → `FollowUpSendResponse`
  - `POST /api/followups/mark { leadId, status: "skipped" | "replied", note? }` → `FollowUpMutationResponse`

- [ ] **Step 1: Add the permissions**

In `lib/rbac/permissions.ts`, directly after the `"campaigns.send": …,` line, add:

```ts
  // Hot-Lead Follow-Ups (Sell): an admin surface for now — reps see the result
  // (a lead arrives in Sales after its follow-ups), not the drafting desk.
  "followups.view": "View the hot-lead follow-up queue",
  "followups.send": "Draft, edit and send hot-lead follow-up emails",
```

In `lib/rbac/sections.ts`, in the `sell` section's `permissions` array, add these two entries **before** `{ perm: "sales.view", short: "Sales queue" },`:

```ts
      { perm: "followups.view", short: "Follow-Ups" },
      { perm: "followups.send", short: "Send follow-ups" },
```

Run: `npx vitest run lib/rbac`
Expected: PASS. Admin gets both permissions through `ALL_PERMISSIONS`, and Sales doesn't get them.

- [ ] **Step 2: Write the failing send-route test**

Create `app/api/followups/send/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { FollowUpQueueItem, FollowUpRow } from "@/lib/followups/types";

vi.mock("server-only", () => ({}));

const requirePermission = vi.fn();
vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac/server")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, supabaseTarget: () => ({ state: "ok", base: "https://sb.test", key: "k" }) };
});

const readFollowUpsByIds = vi.fn();
const loadQueue = vi.fn();
const patchFollowUps = vi.fn();
vi.mock("@/lib/followups/server", () => ({
  readFollowUpsByIds: (...a: unknown[]) => readFollowUpsByIds(...a),
  loadQueue: (...a: unknown[]) => loadQueue(...a),
  patchFollowUps: (...a: unknown[]) => patchFollowUps(...a),
}));
const deliverCampaign = vi.fn();
vi.mock("@/lib/pipeline/deliver", () => ({ deliverCampaign: (...a: unknown[]) => deliverCampaign(...a) }));

import { POST } from "./route";

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const R1 = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const R2 = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";

function row(id: string, lead: string, over: Partial<FollowUpRow> = {}): FollowUpRow {
  return {
    id, lead_id: lead, touch: 1, status: "draft", subject: "DB subject", body_html: "<p>DB body <a href=\"{{link}}\">Go</a></p>",
    service_slug: "plumbing", model: "m", note: null, drafted_at: null, sent_at: null, sent_by: null,
    created_at: "2026-09-20T00:00:00Z", updated_at: "2026-09-20T00:00:00Z", ...over,
  };
}
function item(lead: string, draft: FollowUpRow | null, over: Partial<FollowUpQueueItem> = {}): FollowUpQueueItem {
  return {
    leadId: lead, business: "Acme", category: "Childcare", website: null, email: `info@${lead.slice(0, 4)}.test`,
    score: 70, service: "plumbing", services: ["plumbing"], stage: "awaiting", touch: 1, reason: null, draft,
    touch1SentAt: null, touch2DueOn: null, likelyScanner: false, scannerGapSeconds: null, ...over,
  };
}
const req = (body: unknown) =>
  new Request("http://local/api/followups/send", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "kane@apmgservices.com.au", actingAs: null });
  patchFollowUps.mockImplementation(async (_sb: unknown, ids: string[]) => ids.map((id) => row(id, L1, { status: "sent" })));
  deliverCampaign.mockImplementation(async ({ recipients }: { recipients: Array<{ id: string }> }) => ({
    status: 200, result: { ok: true, sent: recipients.length, mode: "live" }, deliveredIds: recipients.map((r) => r.id), drops: [],
  }));
});

describe("POST /api/followups/send", () => {
  it("sends the DATABASE copy under the hot-followup tag with touch ledger props", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    const res = await POST(req({ ids: [R1], subject: "IGNORED" }));
    const data = await res.json();
    expect(data).toMatchObject({ ok: true, sent: 1 });
    const input = deliverCampaign.mock.calls[0][0];
    expect(input.campaign).toBe("hot-followup");
    expect(input.ledgerProps).toEqual({ kind: "follow_up" });
    expect(input.recipients[0]).toMatchObject({ id: L1, subject: "DB subject", ledgerProps: { touch: "1" } });
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], expect.objectContaining({ status: "sent", sent_by: "kane@apmgservices.com.au" }), "draft");
  });

  it("does not resend a draft that is no longer a draft (double click)", async () => {
    readFollowUpsByIds.mockResolvedValue([row(R1, L1, { status: "sent" })]);
    loadQueue.mockResolvedValue({ ok: true, items: [] });
    const data = await (await POST(req({ ids: [R1] }))).json();
    expect(deliverCampaign).not.toHaveBeenCalled();
    expect(data.sent).toBe(0);
    expect(data.skipped[0].reason).toMatch(/already sent or closed/i);
  });

  it("skips a draft whose lead enquired since it was written", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, null, { stage: "excluded", touch: null, reason: "Enquired — Sales owns this lead" })] });
    const data = await (await POST(req({ ids: [R1] }))).json();
    expect(deliverCampaign).not.toHaveBeenCalled();
    expect(data.skipped).toEqual([{ leadId: L1, reason: "Enquired — Sales owns this lead" }]);
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], { status: "skipped", note: "Enquired — Sales owns this lead" }, "draft");
  });

  it("mails a shared address once and skips the duplicate", async () => {
    const r1 = row(R1, L1);
    const r2 = row(R2, L2);
    readFollowUpsByIds.mockResolvedValue([r1, r2]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r1, { email: "same@x.test" }), item(L2, r2, { email: "Same@x.test" })] });
    const data = await (await POST(req({ ids: [R1, R2] }))).json();
    expect(deliverCampaign.mock.calls[0][0].recipients).toHaveLength(1);
    expect(data.skipped).toEqual([{ leadId: L2, reason: expect.stringMatching(/same address/i) }]);
  });

  it("marks guard drops as blocked with the reason", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    deliverCampaign.mockResolvedValue({ status: 400, result: { ok: false, sent: 0, mode: "noop", error: "x" }, deliveredIds: [], drops: [{ id: L1, reason: "Opted out" }] });
    const data = await (await POST(req({ ids: [R1] }))).json();
    expect(data.blocked).toEqual([{ leadId: L1, reason: "Opted out" }]);
    expect(patchFollowUps).toHaveBeenCalledWith(expect.anything(), [R1], { status: "blocked", note: "Opted out" }, "draft");
  });

  it("leaves drafts untouched when the automation refuses (paused)", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    deliverCampaign.mockResolvedValue({ status: 503, result: { ok: false, sent: 0, mode: "paused", error: "The campaign automation is paused." }, deliveredIds: [], drops: [] });
    const res = await POST(req({ ids: [R1] }));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data).toMatchObject({ ok: false, sent: 0, mode: "paused" });
    expect(patchFollowUps).not.toHaveBeenCalled();
  });

  it("warns — never a clean success — when sent rows can't be marked", async () => {
    const r = row(R1, L1);
    readFollowUpsByIds.mockResolvedValue([r]);
    loadQueue.mockResolvedValue({ ok: true, items: [item(L1, r)] });
    patchFollowUps.mockResolvedValue(null);
    const data = await (await POST(req({ ids: [R1] }))).json();
    expect(data.sent).toBe(1);
    expect(data.warning).toMatch(/do not send them again/i);
  });

  it("needs followups.send", async () => {
    requirePermission.mockResolvedValue({ ok: false, status: 403, error: "Forbidden — missing permission: followups.send" });
    const res = await POST(req({ ids: [R1] }));
    expect(res.status).toBe(403);
    expect(requirePermission).toHaveBeenCalledWith(expect.anything(), "followups.send");
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run app/api/followups/send`
Expected: FAIL, because `./route` cannot be resolved.

- [ ] **Step 4: Implement `app/api/followups/send/route.ts`**

```ts
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
// opt-outs, paused-webhook refusal, email_sent ledger. Only rows still in
// `draft` are marked, so a double click can't send one twice.
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
    const email = it.email.toLowerCase();
    if (seenEmail.has(email)) {
      skipped.push({ leadId: row.lead_id, reason: "Same address as another draft in this send" });
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

  const out = await deliverCampaign({
    campaign: FOLLOW_UP_CAMPAIGN,
    base: process.env.NEXT_PUBLIC_TRACK_BASE || new URL(req.url).origin,
    recipients,
    ledgerProps: { kind: "follow_up" },
    label: "followups/send",
  });

  for (const drop of out.drops) {
    const row = byLead.get(drop.id);
    if (!row) continue;
    blocked.push({ leadId: drop.id, reason: drop.reason });
    await patchFollowUps(sb, [row.id], { status: "blocked", note: drop.reason }, "draft");
  }

  // The automation refused the whole send (paused / unconfigured / unreachable)
  // and no guard dropped anyone: the drafts stay drafts, and we say so.
  if (!out.result.ok && out.deliveredIds.length === 0 && out.drops.length === 0) {
    return json(
      { ok: false, error: out.result.error ?? "Nothing was sent.", mode: out.result.mode, ...EMPTY, blocked, skipped },
      out.status,
    );
  }

  const sentRowIds = out.deliveredIds.map((id) => byLead.get(id)?.id).filter((x): x is string => Boolean(x));
  const marked = await patchFollowUps(
    sb,
    sentRowIds,
    { status: "sent", sent_at: new Date().toISOString(), sent_by: guard.email },
    "draft",
  );
  const warning =
    marked === null || marked.length < sentRowIds.length
      ? `Sent, but ${sentRowIds.length - (marked?.length ?? 0)} draft(s) couldn't be marked as sent. Do not send them again. Refresh and check.`
      : undefined;
  if (warning) console.error(`[followups/send] ${warning}`);

  return json({ ok: true, mode: out.result.mode, sent: out.deliveredIds.length, blocked, skipped, warning });
}
```

- [ ] **Step 5: Run the send-route test**

Run: `npx vitest run app/api/followups/send`
Expected: PASS.

- [ ] **Step 6: Write the failing draft-route test**

Create `app/api/followups/draft/route.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const requirePermission = vi.fn();
vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac/server")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, supabaseTarget: () => ({ state: "ok", base: "https://sb.test", key: "k" }) };
});
const loadQueue = vi.fn();
const writeFollowUp = vi.fn();
vi.mock("@/lib/followups/server", () => ({
  loadQueue: (...a: unknown[]) => loadQueue(...a),
  writeFollowUp: (...a: unknown[]) => writeFollowUp(...a),
}));
const draftEmail = vi.fn();
vi.mock("@/lib/ai/composeEmail", () => ({ draftEmail: (...a: unknown[]) => draftEmail(...a) }));
vi.mock("@/lib/ai/composeStore", () => ({
  loadComposePrompt: async () => ({ model: "claude-opus-4-8", instructions: "i", leadPromptTemplate: "t", outputSchema: {} }),
  resolveModel: (m: string) => m,
}));
vi.mock("@/lib/pipeline/sectorStore", () => ({ loadPlaybooks: async () => [], buildComposeKb: async () => "KB" }));
vi.mock("@/lib/pipeline/leadHistory", () => ({ readLeadHistories: async () => new Map() }));
vi.mock("@/lib/pipeline/campaign", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/campaign")>();
  return { ...actual, COMPOSE_RATE: { RPM: 1000, CONCURRENCY: 1, MIN_INTERVAL_MS: 0 } };
});

import { POST } from "./route";

const L1 = "11111111-1111-4111-8111-111111111111";
const req = (body: unknown) =>
  new Request("http://local/api/followups/draft", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
const ready = { leadId: L1, business: "Acme", category: "Childcare", website: null, email: "a@acme.test", score: 66, service: "plumbing", services: ["plumbing"], stage: "ready", touch: 1, reason: null, draft: null, touch1SentAt: null, touch2DueOn: null, likelyScanner: false, scannerGapSeconds: null };

beforeEach(() => {
  vi.clearAllMocks();
  process.env.ANTHROPIC_API_KEY = "test";
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "kane@x", actingAs: null });
  writeFollowUp.mockImplementation(async (_sb: unknown, row: Record<string, unknown>) => ({ id: "r", ...row }));
});

describe("POST /api/followups/draft", () => {
  it("drafts a ready lead with the touch prompt and saves it as a draft", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [ready] });
    draftEmail.mockResolvedValue({ subject: "Plumbing for Acme", html: "<p>Hi</p><p><a href=\"{{link}}\">Go</a></p>" });
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(data).toMatchObject({ ok: true, drafted: [L1], failed: [], remaining: [] });
    const followUpBlock = draftEmail.mock.calls[0][5] as string;
    expect(followUpBlock).toMatch(/follow-up 1 of 2/i);
    expect(writeFollowUp).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ lead_id: L1, touch: 1, status: "draft", service_slug: "plumbing" }));
  });

  it("refuses an ineligible lead and calls no model", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [{ ...ready, stage: "excluded", touch: null, reason: "Opted out" }] });
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(draftEmail).not.toHaveBeenCalled();
    expect(data.failed).toEqual([{ leadId: L1, error: "Opted out" }]);
  });

  it("saves nothing when Claude fails", async () => {
    loadQueue.mockResolvedValue({ ok: true, items: [ready] });
    draftEmail.mockResolvedValue(null);
    const data = await (await POST(req({ leadIds: [L1] }))).json();
    expect(writeFollowUp).not.toHaveBeenCalled();
    expect(data.failed[0].error).toMatch(/couldn't draft/i);
  });

  it("503s without an API key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    const res = await POST(req({ leadIds: [L1] }));
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run app/api/followups/draft`
Expected: FAIL, because `./route` cannot be resolved.

- [ ] **Step 8: Implement `app/api/followups/draft/route.ts`**

```ts
import { draftEmail } from "@/lib/ai/composeEmail";
import { loadComposePrompt, resolveModel } from "@/lib/ai/composeStore";
import { buildHotFollowUpPrompt } from "@/lib/ai/hotFollowUpPrompt";
import { loadQueue, writeFollowUp } from "@/lib/followups/server";
import {
  MAX_DRAFT_PER_REQUEST,
  MAX_FOLLOW_UP_HTML,
  MAX_FOLLOW_UP_SUBJECT,
  type FollowUpDraftResponse,
} from "@/lib/followups/types";
import { COMPOSE_RATE, ensureLinkToken } from "@/lib/pipeline/campaign";
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
export const runtime = "nodejs";
export const maxDuration = 300;
const SOFT_DEADLINE_MS = (maxDuration - 60) * 1000;

function json(body: FollowUpDraftResponse, status = 200): Response {
  return Response.json(body, { status });
}
const EMPTY = { drafted: [], failed: [], remaining: [] };

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
    const wait = Math.max(0, nextSlot - Date.now());
    nextSlot = Math.max(Date.now(), nextSlot) + COMPOSE_RATE.MIN_INTERVAL_MS;
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    const drafted = await draftEmail(
      { business: item.business ?? "there", category: item.category, website: item.website },
      await kbFor(item.category),
      promptCfg,
      undefined,
      undefined,
      buildHotFollowUpPrompt({ history: histories.get(leadId) ?? null, services: item.services, touch: item.touch, leadId }),
    );
    if (!drafted) {
      result.failed.push({ leadId, error: "Claude couldn't draft this one. Try again." });
      continue;
    }
    const saved = await writeFollowUp(sb, {
      lead_id: leadId,
      touch: item.touch,
      status: "draft",
      subject: drafted.subject.slice(0, MAX_FOLLOW_UP_SUBJECT),
      body_html: ensureLinkToken(drafted.html.slice(0, MAX_FOLLOW_UP_HTML)),
      service_slug: item.service,
      model: resolveModel(promptCfg.model),
      note: null,
      drafted_at: new Date().toISOString(),
    });
    if (saved) result.drafted.push(leadId);
    else result.failed.push({ leadId, error: "Drafted, but the draft couldn't be saved." });
  }
  return json(result);
}
```

- [ ] **Step 9: Implement `app/api/followups/route.ts` (GET queue, PATCH edit)**

```ts
import { loadQueue, patchFollowUps } from "@/lib/followups/server";
import {
  MAX_FOLLOW_UP_HTML,
  MAX_FOLLOW_UP_SUBJECT,
  type FollowUpMutationResponse,
  type FollowUpQueueResponse,
} from "@/lib/followups/types";
import { ensureLinkToken } from "@/lib/pipeline/campaign";
import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// GET /api/followups — the judged Follow-Ups queue (lib/followups/server
// loadQueue). Read on tab open and on Refresh only — never polled.
// PATCH /api/followups { id, subject, body_html } — save an edit to a draft;
// refused (409) once the row has left `draft`.
export const runtime = "nodejs";

export async function GET(req: Request): Promise<Response> {
  const q = (body: FollowUpQueueResponse, status = 200) => Response.json(body, { status });
  if (!sameOrigin(req)) return q({ ok: false, mode: "live", error: "Forbidden.", items: [] }, 403);
  const guard = await requirePermission(req, "followups.view");
  if (!guard.ok) return guardResponse(guard);

  const sb = supabaseTarget();
  if (sb.state !== "ok") return q({ ok: true, mode: "demo", items: [] });
  const queue = await loadQueue(sb);
  if (!queue.ok) {
    return queue.reason === "missing"
      ? q({ ok: true, mode: "demo", needsMigration: true, items: [] })
      : q({ ok: false, mode: "live", error: "Couldn't read the follow-up queue.", items: [] }, 502);
  }
  return q({ ok: true, mode: "live", items: queue.items });
}

export async function PATCH(req: Request): Promise<Response> {
  const m = (body: FollowUpMutationResponse, status = 200) => Response.json(body, { status });
  if (!sameOrigin(req)) return m({ ok: false, error: "Forbidden." }, 403);
  const guard = await requirePermission(req, "followups.send");
  if (!guard.ok) return guardResponse(guard);

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = b?.id;
  const subject = typeof b?.subject === "string" ? b.subject.trim() : "";
  const bodyHtml = typeof b?.body_html === "string" ? b.body_html.trim() : "";
  if (!isUuid(id)) return m({ ok: false, error: "Invalid draft id." }, 400);
  if (!subject || !bodyHtml) return m({ ok: false, error: "Subject and body are both required." }, 400);
  if (subject.length > MAX_FOLLOW_UP_SUBJECT || bodyHtml.length > MAX_FOLLOW_UP_HTML) {
    return m({ ok: false, error: "That draft is too long." }, 400);
  }
  const sb = supabaseTarget();
  if (sb.state !== "ok") return m({ ok: false, error: "Supabase isn't configured." }, 503);

  const rows = await patchFollowUps(sb, [id], { subject, body_html: ensureLinkToken(bodyHtml) }, "draft");
  if (rows === null) return m({ ok: false, error: "Couldn't save the draft." }, 502);
  if (rows.length === 0) return m({ ok: false, error: "This draft was already sent or closed." }, 409);
  return m({ ok: true, row: rows[0] });
}
```

- [ ] **Step 10: Implement `app/api/followups/mark/route.ts`**

```ts
import { loadQueue, writeFollowUp } from "@/lib/followups/server";
import { MAX_FOLLOW_UP_NOTE, type FollowUpMutationResponse } from "@/lib/followups/types";
import { isUuid, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// POST /api/followups/mark { leadId, status: "skipped" | "replied", note? } —
// end a lead's sequence by hand. "replied" exists because nothing reads the
// outreach inbox: a person who answers by email must be stopped manually.
// The touch is decided here from the queue, never by the client.
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  const m = (body: FollowUpMutationResponse, status = 200) => Response.json(body, { status });
  if (!sameOrigin(req)) return m({ ok: false, error: "Forbidden." }, 403);
  const guard = await requirePermission(req, "followups.send");
  if (!guard.ok) return guardResponse(guard);

  const b = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const leadId = b?.leadId;
  const status = b?.status;
  const note = typeof b?.note === "string" && b.note.trim() ? b.note.trim().slice(0, MAX_FOLLOW_UP_NOTE) : null;
  if (!isUuid(leadId)) return m({ ok: false, error: "Invalid lead id." }, 400);
  if (status !== "skipped" && status !== "replied") return m({ ok: false, error: "Status must be skipped or replied." }, 400);

  const sb = supabaseTarget();
  if (sb.state !== "ok") return m({ ok: false, error: "Supabase isn't configured." }, 503);
  const queue = await loadQueue(sb, { leadIds: [leadId] });
  if (!queue.ok) return m({ ok: false, error: "Couldn't read the queue." }, 502);
  const item = queue.items.find((i) => i.leadId === leadId);
  if (!item || item.touch === null || item.stage === "done" || item.stage === "excluded") {
    return m({ ok: false, error: "This lead isn't in an active follow-up." }, 409);
  }
  const row = await writeFollowUp(sb, { lead_id: leadId, touch: item.touch, status, note });
  if (!row) return m({ ok: false, error: "Couldn't save that." }, 502);
  return m({ ok: true, row });
}
```

- [ ] **Step 11: Run all follow-up route tests and type-check**

Run: `npx vitest run app/api/followups lib` and `npx tsc --noEmit`
Expected: PASS.

- [ ] **Step 12: Checkpoint.** Don't commit.

---

### Task 7: Follow-Ups tab (nav, shell, client hook, page)

**Files:**
- Modify: `lib/nav.ts`
- Modify: `components/apmg/DashboardShell.tsx`
- Create: `lib/followups/useFollowUps.ts`
- Create: `components/apmg/FollowUpsPage.tsx`

**Interfaces:**
- Consumes: the HTTP contracts from Task 6, `MAX_DRAFT_ALL`, `MAX_DRAFT_PER_REQUEST` and the types (Task 1), `htmlToText` (`lib/pipeline/campaign.ts`, pure), `serviceName` (`lib/data/leadActivity.ts`), `Button`, `Can`, `Reveal`, `Footer`.
- Produces:
  - `useFollowUps(): FollowUpsState & FollowUpsActions`, where the state is `{ status: "loading" | "ready" | "error"; mode; needsMigration; error: string | null; items; busy: ReadonlySet<string>; notice: string | null }` and the actions are:
    - `refresh(): Promise<void>`
    - `draft(leadIds: string[]): Promise<void>`
    - `save(id: string, subject: string, bodyHtml: string): Promise<boolean>`
    - `send(rows: Array<{ id: string; leadId: string }>): Promise<void>`
    - `mark(leadId: string, status: "skipped" | "replied", note?: string): Promise<void>`
  - `<FollowUpsPage />`

- [ ] **Step 1: Add the tab to `lib/nav.ts`**

1. Add `MailPlus,` to the lucide import list, in alphabetical position after `LayoutDashboard,`.
2. Add `| "followups"` to `TabId`, directly after `| "enquiries"`.
3. In the `"Sell"` section's `items`, add this as the **first** item:

```ts
      // Email first, then Sales: hot leads get their follow-up emails here,
      // and arrive on Hot Leads as "Ready for Sales" once the sequence ends.
      { id: "followups", label: "Follow-Ups", icon: MailPlus, perm: "followups.view" },
```

4. In `TAB_LABEL`, add `followups: "Follow-Ups",` after `enquiries: "Enquiries",`.

- [ ] **Step 2: Render the tab in `components/apmg/DashboardShell.tsx`**

Add `import { FollowUpsPage } from "./FollowUpsPage";` next to the other page imports. Then, in the tab chain, directly after the `activeTab === "enquiries" ? ( <EnquiriesPage /> )` branch, add:

```tsx
                  ) : activeTab === "followups" ? (
                    <FollowUpsPage />
```

- [ ] **Step 3: Create `lib/followups/useFollowUps.ts`**

```ts
"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MAX_DRAFT_ALL,
  MAX_DRAFT_PER_REQUEST,
  type FollowUpDraftResponse,
  type FollowUpMutationResponse,
  type FollowUpQueueItem,
  type FollowUpQueueResponse,
  type FollowUpSendResponse,
} from "./types";

/**
 * Client state for the Follow-Ups tab. Loads once on mount and on Refresh —
 * deliberately NO polling (Vercel free-tier transfer budget). Every action
 * re-reads the queue afterwards, so the page always shows the server's
 * judgement rather than an optimistic guess.
 */

export interface FollowUpsState {
  status: "loading" | "ready" | "error";
  mode: "live" | "demo";
  needsMigration: boolean;
  error: string | null;
  items: FollowUpQueueItem[];
  /** lead ids with an action in flight */
  busy: ReadonlySet<string>;
  /** the last action's outcome, in words */
  notice: string | null;
}

async function call<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  const res = await fetch(url, {
    cache: "no-store",
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  return { ...data, ok: res.ok && data.ok !== false, error: data.error ?? (res.ok ? undefined : `Request failed (${res.status})`) };
}

export function useFollowUps() {
  const [state, setState] = useState<FollowUpsState>({
    status: "loading",
    mode: "live",
    needsMigration: false,
    error: null,
    items: [],
    busy: new Set(),
    notice: null,
  });

  const setBusy = (ids: string[], on: boolean) =>
    setState((s) => {
      const busy = new Set(s.busy);
      for (const id of ids) (on ? busy.add(id) : busy.delete(id));
      return { ...s, busy };
    });
  const setNotice = (notice: string | null) => setState((s) => ({ ...s, notice }));

  const refresh = useCallback(async () => {
    const data = await call<FollowUpQueueResponse>("/api/followups");
    setState((s) => ({
      ...s,
      status: data.ok ? "ready" : "error",
      mode: data.mode ?? "live",
      needsMigration: Boolean(data.needsMigration),
      error: data.ok ? null : (data.error ?? "Couldn't load the queue."),
      items: data.ok ? (data.items ?? []) : s.items,
    }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const draft = useCallback(
    async (leadIds: string[]) => {
      let queue = leadIds.slice(0, MAX_DRAFT_ALL);
      setBusy(queue, true);
      let drafted = 0;
      const failed: string[] = [];
      try {
        while (queue.length > 0) {
          const chunk = queue.slice(0, MAX_DRAFT_PER_REQUEST);
          const data = await call<FollowUpDraftResponse>("/api/followups/draft", {
            method: "POST",
            body: JSON.stringify({ leadIds: chunk }),
          });
          if (!data.ok) {
            failed.push(data.error ?? "Drafting failed.");
            break;
          }
          drafted += data.drafted.length;
          failed.push(...data.failed.map((f) => f.error));
          // unreached leads go back on the front of the queue
          queue = [...data.remaining, ...queue.slice(chunk.length)];
          if (data.drafted.length === 0 && data.failed.length === 0) break; // no progress
        }
      } finally {
        setBusy(leadIds, false);
      }
      setNotice(
        `${drafted} draft${drafted === 1 ? "" : "s"} written` + (failed.length ? ` · ${failed.length} failed: ${failed[0]}` : ""),
      );
      await refresh();
    },
    [refresh],
  );

  const save = useCallback(
    async (id: string, subject: string, bodyHtml: string): Promise<boolean> => {
      const data = await call<FollowUpMutationResponse>("/api/followups", {
        method: "PATCH",
        body: JSON.stringify({ id, subject, body_html: bodyHtml }),
      });
      setNotice(data.ok ? "Draft saved" : (data.error ?? "Couldn't save the draft."));
      // Always re-read: the card is keyed on the row's updated_at, so the
      // refresh remounts it with the saved copy and clears its "dirty" state
      // (otherwise Approve & send would stay disabled after a successful save).
      await refresh();
      return data.ok;
    },
    [refresh],
  );

  const send = useCallback(
    async (rows: Array<{ id: string; leadId: string }>) => {
      setBusy(rows.map((r) => r.leadId), true);
      try {
        const data = await call<FollowUpSendResponse>("/api/followups/send", {
          method: "POST",
          body: JSON.stringify({ ids: rows.map((r) => r.id) }),
        });
        const parts = [
          data.ok ? `${data.sent ?? 0} sent` : (data.error ?? "Nothing was sent."),
          data.blocked?.length ? `${data.blocked.length} blocked (${data.blocked[0].reason})` : "",
          data.skipped?.length ? `${data.skipped.length} skipped (${data.skipped[0].reason})` : "",
          data.warning ?? "",
        ].filter(Boolean);
        setNotice(parts.join(" · "));
      } finally {
        setBusy(rows.map((r) => r.leadId), false);
      }
      await refresh();
    },
    [refresh],
  );

  const mark = useCallback(
    async (leadId: string, status: "skipped" | "replied", note?: string) => {
      setBusy([leadId], true);
      try {
        const data = await call<FollowUpMutationResponse>("/api/followups/mark", {
          method: "POST",
          body: JSON.stringify({ leadId, status, note }),
        });
        setNotice(data.ok ? (status === "replied" ? "Marked as replied" : "Skipped") : (data.error ?? "Couldn't save that."));
      } finally {
        setBusy([leadId], false);
      }
      await refresh();
    },
    [refresh],
  );

  return { ...state, refresh, draft, save, send, mark };
}
```

- [ ] **Step 4: Create `components/apmg/FollowUpsPage.tsx`**

```tsx
"use client";

import { useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, MailPlus, RefreshCw, Reply, Send, SkipForward, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/rbac/Can";
import { serviceName } from "@/lib/data/leadActivity";
import { useFollowUps } from "@/lib/followups/useFollowUps";
import { MAX_DRAFT_ALL, type FollowUpQueueItem } from "@/lib/followups/types";
import { htmlToText } from "@/lib/pipeline/campaign";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";

/**
 * Follow-Ups — hot leads (score 66+, i.e. opened a service) get up to two
 * Claude-written emails about the service they opened, each approved here
 * before it leaves. Email first, then Sales: a finished sequence shows as
 * "Ready for Sales" on Hot Leads. See the spec:
 * docs/superpowers/specs/2026-09-25-hot-lead-follow-up-design.md
 */

function Chip({ children, tone = "muted" }: { children: ReactNode; tone?: "muted" | "primary" | "warn" }) {
  const cls =
    tone === "primary"
      ? "border-primary/40 bg-primary/10 text-primary"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-border bg-background text-muted-foreground";
  return <span className={`inline-flex items-center gap-1 rounded-full border px-2 py-px text-[10.5px] font-medium ${cls}`}>{children}</span>;
}

function LeadHeader({ item }: { item: FollowUpQueueItem }) {
  return (
    <div className="min-w-0">
      <div className="truncate text-[14px] font-semibold text-foreground">{item.business ?? "Unnamed lead"}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {item.service && <Chip tone="primary">{serviceName(item.service)}</Chip>}
        <Chip>score {item.score}</Chip>
        {item.touch && <Chip>touch {item.touch} of 2</Chip>}
        {item.likelyScanner && (
          <Chip tone="warn">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            likely scanner ({item.scannerGapSeconds}s after delivery)
          </Chip>
        )}
        {item.email && <span className="truncate font-mono text-[10.5px] text-muted-foreground">{item.email}</span>}
      </div>
    </div>
  );
}

function DraftCard({
  item,
  busy,
  onSave,
  onSend,
  onRedraft,
  onSkip,
}: {
  item: FollowUpQueueItem;
  busy: boolean;
  onSave: (subject: string, body: string) => Promise<boolean>;
  onSend: () => void;
  onRedraft: () => void;
  onSkip: () => void;
}) {
  const draft = item.draft!;
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body_html ?? "");
  const dirty = subject !== (draft.subject ?? "") || body !== (draft.body_html ?? "");
  const preview = useMemo(() => htmlToText(body.replace(/\{\{link\}\}/g, "https://…")), [body]);

  return (
    <li className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <LeadHeader item={item} />
      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Subject</label>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
      />
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Body (HTML, keep the {"{{link}}"} button)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs"
          />
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">As sent (plain text)</div>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2.5 text-xs text-foreground">{preview}</pre>
        </div>
      </div>
      <Can perm="followups.send">
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={busy} onClick={onSkip} className="gap-1.5">
            <SkipForward className="h-3.5 w-3.5" aria-hidden /> Skip
          </Button>
          <Button variant="outline" size="sm" disabled={busy} onClick={onRedraft} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Redraft
          </Button>
          {dirty && (
            <Button variant="outline" size="sm" disabled={busy} onClick={() => void onSave(subject, body)}>
              Save edits
            </Button>
          )}
          <Button
            size="sm"
            disabled={busy || dirty || !subject.trim() || !body.trim()}
            title={dirty ? "Save your edits first" : undefined}
            onClick={onSend}
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" aria-hidden /> {busy ? "Working…" : "Approve & send"}
          </Button>
        </div>
      </Can>
    </li>
  );
}

function Section({ title, count, children, action }: { title: string; count: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {title} <span className="font-mono text-xs text-muted-foreground">{count}</span>
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function FollowUpsPage() {
  const fu = useFollowUps();
  const by = (stage: FollowUpQueueItem["stage"]) => fu.items.filter((i) => i.stage === stage);
  const ready = by("ready");
  const awaiting = by("awaiting");
  const inSequence = [...by("waiting"), ...by("done")];
  const excluded = by("excluded");
  const skip = (leadId: string) => {
    const note = window.prompt("Skip this follow-up? Optional reason (e.g. scanner trail):") ?? null;
    if (note !== null) void fu.mark(leadId, "skipped", note || undefined);
  };

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <Reveal className="mb-2" y={6}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sell</div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">Follow-Ups</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Leads who opened a service (score 66+) get up to two personal emails about that service, written by Claude and
              approved by you. Replies aren&apos;t detected: if someone answers by email, mark them replied.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fu.refresh()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
          </Button>
        </div>
      </Reveal>

      {fu.notice && <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-foreground">{fu.notice}</div>}
      {fu.needsMigration && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          Run <code>supabase/follow-ups.sql</code> in the Supabase SQL editor to switch this tab on.
        </div>
      )}
      {fu.status === "error" && <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{fu.error}</div>}
      {fu.status === "loading" && <p className="mt-6 text-xs text-muted-foreground">Loading the queue…</p>}

      {fu.status !== "loading" && (
        <>
          <Section
            title="Awaiting approval"
            count={awaiting.length}
            action={
              awaiting.length > 1 && (
                <Can perm="followups.send">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    onClick={() => {
                      if (window.confirm(`Send all ${awaiting.length} drafts as they are now?`)) {
                        void fu.send(awaiting.map((i) => ({ id: i.draft!.id, leadId: i.leadId })));
                      }
                    }}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden /> Send all
                  </Button>
                </Can>
              )
            }
          >
            {awaiting.length === 0 ? (
              <p className="text-xs text-muted-foreground">No drafts waiting.</p>
            ) : (
              <ul className="grid gap-3">
                {awaiting.map((item) => (
                  <DraftCard
                    key={item.draft!.id + item.draft!.updated_at}
                    item={item}
                    busy={fu.busy.has(item.leadId)}
                    onSave={(s, b) => fu.save(item.draft!.id, s, b)}
                    onSend={() => void fu.send([{ id: item.draft!.id, leadId: item.leadId }])}
                    onRedraft={() => void fu.draft([item.leadId])}
                    onSkip={() => skip(item.leadId)}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Ready to draft"
            count={ready.length}
            action={
              ready.length > 0 && (
                <Can perm="followups.send">
                  <Button variant="outline" size="sm" className="gap-1.5" onClick={() => void fu.draft(ready.map((i) => i.leadId))}>
                    <Sparkles className="h-3.5 w-3.5" aria-hidden /> Draft {Math.min(ready.length, MAX_DRAFT_ALL)}
                  </Button>
                </Can>
              )
            }
          >
            {ready.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nobody new. Leads arrive here once they open a service on the portal.</p>
            ) : (
              <ul className="grid gap-2">
                {ready.map((item) => (
                  <li key={item.leadId} className="flex items-center justify-between gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
                    <LeadHeader item={item} />
                    <Can perm="followups.send">
                      <div className="flex shrink-0 gap-2">
                        <Button variant="ghost" size="sm" disabled={fu.busy.has(item.leadId)} onClick={() => skip(item.leadId)}>
                          Skip
                        </Button>
                        <Button size="sm" disabled={fu.busy.has(item.leadId)} onClick={() => void fu.draft([item.leadId])} className="gap-1.5">
                          <MailPlus className="h-3.5 w-3.5" aria-hidden /> {fu.busy.has(item.leadId) ? "Drafting…" : "Draft"}
                        </Button>
                      </div>
                    </Can>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="In sequence / done" count={inSequence.length}>
            {inSequence.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing sent yet.</p>
            ) : (
              <ul className="grid gap-2">
                {inSequence.map((item) => (
                  <li key={item.leadId} className="flex items-center justify-between gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
                    <LeadHeader item={item} />
                    <div className="flex shrink-0 items-center gap-2">
                      {item.stage === "waiting" ? (
                        <>
                          <Chip>
                            <Clock className="h-3 w-3" aria-hidden /> #2 due {item.touch2DueOn ?? "soon"}
                          </Chip>
                          <Can perm="followups.send">
                            <Button variant="outline" size="sm" disabled={fu.busy.has(item.leadId)} onClick={() => void fu.mark(item.leadId, "replied")} className="gap-1.5">
                              <Reply className="h-3.5 w-3.5" aria-hidden /> Replied
                            </Button>
                          </Can>
                        </>
                      ) : (
                        <Chip tone="primary">
                          <CheckCircle2 className="h-3 w-3" aria-hidden /> Ready for Sales · {item.reason}
                        </Chip>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {excluded.length > 0 && (
            <details className="mt-6 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Not eligible ({excluded.length})</summary>
              <ul className="mt-2 grid gap-1">
                {excluded.map((item) => (
                  <li key={item.leadId}>
                    {item.business ?? item.leadId} · {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <div className="mt-auto pt-8">
        <Footer />
      </div>
    </div>
  );
}
```

- [ ] **Step 5: Type-check and build**

Run: `npx tsc --noEmit` and `npx next build`
Expected: both succeed. `TAB_LABEL`'s `Record<TabId, string>` forces the label entry, so a missed step fails `tsc`.

- [ ] **Step 6: Smoke-test in the browser**

Run `npm run dev`, sign in as admin, and open **Follow-Ups**.
Expected:
- The tab sits first under "Sell".
- Before the SQL is run, it shows the "Run supabase/follow-ups.sql" banner.
- Refresh re-reads the queue.
- Nothing polls: the Network tab shows no repeating `/api/followups` requests.

If Turbopack replays a stale error or 404s the new route, run `rm -rf .next` and restart. A dev restart alone won't clear it.

- [ ] **Step 7: Checkpoint.** Don't commit.

---

### Task 8: Follow-up chip on Hot Leads rows

**Files:**
- Modify: `components/apmg/HotLeadsPage.tsx` (the `HotLeadRow` props at ~L266–296, the counts row at ~L380–397, and the row render at ~L1021–1036)

**Interfaces:**
- Consumes: `followUpChip` (Task 2); `FollowUpQueueResponse`, `FollowUpQueueItem` (Task 1); `useRbac` (`lib/rbac/RbacProvider`).

- [ ] **Step 1: Load follow-up state once, gated on permission**

At the top of `HotLeadsPage.tsx`, add these imports:

```ts
import { followUpChip } from "@/lib/followups/labels";
import type { FollowUpQueueItem, FollowUpQueueResponse } from "@/lib/followups/types";
import { useRbac } from "@/lib/rbac/RbacProvider";
```

Inside the exported page component, next to its other hooks, add:

```ts
  // Follow-up state per lead — read ONCE on mount (not on the 20s poll: the
  // queue read is heavier than the hot-lead poll and changes only on action).
  const { can } = useRbac();
  const canFollowUps = can("followups.view");
  const [followUps, setFollowUps] = useState<ReadonlyMap<string, FollowUpQueueItem>>(new Map());
  useEffect(() => {
    if (!canFollowUps) return;
    let live = true;
    fetch("/api/followups", { cache: "no-store" })
      .then((r) => r.json() as Promise<FollowUpQueueResponse>)
      .then((d) => {
        if (live && d.ok) setFollowUps(new Map(d.items.map((i) => [i.leadId, i])));
      })
      .catch(() => {});
    return () => {
      live = false;
    };
  }, [canFollowUps]);
```

Make sure `useEffect` and `useState` are in the file's `react` import.

- [ ] **Step 2: Pass the chip to each row**

In the `HotLeadRow` props type, add:

```ts
  /** follow-up pipeline state, e.g. "Follow-up 1 sent · #2 due 28 Sep" */
  followUp: string | null;
```

Add `followUp` to the destructured parameter list. In the `.map((lead) => <HotLeadRow … />)` render, add:

```tsx
                        followUp={followUpChip(followUps.get(lead.leadId))}
```

- [ ] **Step 3: Render the chip after the enquiries pill**

In `HotLeadRow`, directly after the `{inquiries > 0 && ( … )}` block inside the counts row, add:

```tsx
        {followUp && (
          <span
            className={
              followUp === "Ready for Sales"
                ? "inline-flex items-center rounded-full border border-primary/40 bg-primary/10 px-1.5 py-px font-semibold text-primary"
                : "inline-flex items-center rounded-full border border-border bg-background px-1.5 py-px text-muted-foreground"
            }
            title="Follow-Ups pipeline"
          >
            {followUp}
          </span>
        )}
```

- [ ] **Step 4: Type-check, test, build**

Run: `npx tsc --noEmit`, `npx vitest run` and `npx next build`
Expected: all pass.

- [ ] **Step 5: Checkpoint.** Don't commit.

---

### Task 9: Whole-branch verification and hand-over

**Files:**
- Modify: `docs/superpowers/specs/2026-09-25-hot-lead-follow-up-design.md` (Status line only)

- [ ] **Step 1: Run the full gate**

Run: `npx tsc --noEmit`, `npx vitest run` and `npx next build`
Expected: all green. Paste the actual output tails into the hand-over message. If anything fails, report it with the output; don't paper over it.

- [ ] **Step 2: Check that the cold send is unchanged**

Run: `git diff --stat app/api/pipeline/campaigns/send/route.ts lib/pipeline/deliver.ts`, then `npx vitest run app/api/pipeline/campaigns/send`
Expected: the route shrank, `deliver.ts` is new, and the original route suite passes unmodified. `git diff` on `route.test.ts` must be empty.

- [ ] **Step 3: Mark the spec implemented**

In the spec, change `**Status:** Draft — awaiting Kane's review` to `**Status:** Implemented 2026-09-25 — pending supabase/follow-ups.sql and a live test send`.

- [ ] **Step 4: Hand over to Kane**

Report:
1. What was built.
2. The gate results.
3. Kane's manual steps: run `supabase/follow-ups.sql` in Supabase; then send one real follow-up to a test lead and check that its tracked CTA and unsubscribe link both work under `hot-followup`.
4. That nothing was committed, and `git status` lists the files for GitHub Desktop.
