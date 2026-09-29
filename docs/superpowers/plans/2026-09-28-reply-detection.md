# Reply Detection Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read every inbound message on outreach@, sort it (human / automated / bounce / unsubscribe / internal / unmatched), act on it, and show human replies on the Telemetry PDF report.

**Architecture:** An n8n workflow watches the outreach@ Gmail inbox with the existing `APMG - Official Lead Gen Mail` credential and POSTs each message to a new secret-protected route, `POST /api/inbound/replies`. The route runs pure, unit-tested modules (`lib/replies/*`) to classify and match the message, stores one `email_replies` row per Gmail message, suppresses emailed opt-outs and hard bounces, and hands n8n an alert to send for human replies. Follow-up eligibility, the shared send path and the period report read `email_replies`.

**Tech Stack:** Next.js 16 App Router route handlers (Node runtime), TypeScript, Supabase PostgREST via `fetch` with the service-role key, Vitest (node environment), n8n (Gmail Trigger, Gmail node, HTTP Request, Code, IF).

**Spec:** [docs/superpowers/specs/2026-09-28-reply-detection-design.md](../specs/2026-09-28-reply-detection-design.md) — read it alongside this plan.

## Global Constraints

- **Git:** never commit, push, open a PR, or create a worktree in this repo. Kane publishes through GitHub Desktop. Every task ends with its tests green and the changes left uncommitted in the working tree.
- **Verification gate** (lint is broken in this repo): `npx tsc --noEmit`, `npx vitest run`, `npx next build`. If `next build` reports an error that looks stale or 404s an existing route, `rm -rf .next` and rebuild — Turbopack replays cached failures.
- **Vitest** runs in the `node` environment and only collects `lib/**/*.test.ts` and `app/**/*.test.ts`. Any test importing a module that imports `server-only` must `vi.mock("server-only", () => ({}))`.
- **Route files** (`app/**/route.ts`) may only export HTTP handlers and route config such as `runtime` — no other named exports, or `next build` fails.
- **PostgREST silently caps every read at 1000 rows.** List reads go through `readAllRows` (`lib/portal/server.ts`) with a total order ending in `id`.
- **The business name column is `leads.name`.** There is no `business` column.
- **Own domains:** `apmgservices.com.au`, `apmgmaintenance.com.au`.
- **Suppression reasons:** `unsubscribe` (portal link), `unsubscribe-email` (emailed opt-out), `bounce-unknown` (hard bounce). Only the two opt-out reasons (`OPT_OUT_REASONS`) roll up to a whole organisation. A portal `unsubscribe` merges on conflict; every other reason inserts with ignore-on-conflict.
- **Only hard bounces are suppressed.** Policy (5.7.x) and soft bounces are recorded, never suppressed.
- **Caps:** ingest `subject` ≤ 1,000 chars, `text` ≤ 20,000, headers ≤ 100 entries with values ≤ 2,000; stored snippet ≤ 500 chars of new text only; alert text quotes ≤ 1,000 chars; PDF snippet ≤ 140 chars.
- **Inbound auth:** header `x-apmg-secret` compared in constant time with `N8N_WEBHOOK_SECRET`; unset secret → `503` for every request; wrong secret → `401`.
- **Backfill** (`backfill: true`) never alerts; suppressions and the follow-up stop still apply.
- **Code style:** match the surrounding files — explanatory "why" comments on non-obvious decisions, plain PostgREST `fetch` calls, fail-open reads on the send path.

## Review Focus

The inputs the spec implies but a task could easily miss, most likely first. Each line's test is included in the owning task.

1. **A lead's stored address has different casing from the reply** (`Info@Acme.com.au` on the lead, `info@acme.com.au` in the header, or the reverse) — the reply must still match. Pinned in Task 5 (`leadsHolding` queries the exact and lowercase variants) and Task 6 (the route passes the thread address with its original casing).
2. **A sender on a shared domain** (`office.ps@education.vic.gov.au`) writes a fresh email with no thread — it must never match a different school through the domain tier. Pinned in Task 6.
3. **A human reply with no new text** (empty body, or only the quoted original) — still a human reply; the alert says there is no new text instead of sending an empty quote. Pinned in Tasks 2 and 6.
4. **A reply in this period to a campaign sent in an earlier one** — the campaign row appears with `sent: 0` and a dash for reply rate, never `NaN` or `Infinity`. Pinned in Task 9.
5. **HTML or script inside a reply snippet or business name** — escaped in the PDF. Pinned in Task 10.

---

## File structure

| File | Responsibility |
|---|---|
| `lib/replies/types.ts` | Kinds, the ingest contract, caps, suppression reason names. Dependency-free and client-safe. |
| `lib/replies/address.ts` | `"Name" <addr>` parsing: lowercased address, original casing, display name. |
| `lib/replies/payload.ts` | Validates and normalises the body n8n posts. |
| `lib/replies/classify.ts` | New-text extraction and the nine-rule classifier. Pure. |
| `lib/replies/match.ts` | Picks a lead and campaign from candidate leads. Pure. |
| `lib/replies/alert.ts` | Subject and text of the alert email. Pure. |
| `lib/replies/server.ts` | PostgREST reads/writes: candidates, claim/finish a row, human-reply lookups. |
| `lib/replies/report.ts` | Tallies `email_replies` rows for the period report. Pure. |
| `lib/replies/reportHtml.ts` | The PDF's "Replies this period" section. Pure, client-safe. |
| `lib/html.ts` | `escapeHtml`, shared by the report component and the section builder. |
| `app/api/inbound/replies/route.ts` | The ingest endpoint. |
| `supabase/email-replies.sql` | Table, indexes, domain lookup function. |
| `references/APMG Reply Capture.json` | The n8n workflow to import. |

Modified: `proxy.ts`, `lib/portal/server.ts`, `supabase/suppress-bounces.sql`, `.env.local.example`, `lib/followups/eligibility.ts`, `lib/followups/server.ts`, `lib/pipeline/deliver.ts`, `components/apmg/pipeline/SendCampaigns.tsx`, `app/api/portal/report/route.ts`, `components/apmg/TelemetryReportExport.tsx`, and their tests.

---

### Task 1: Inbound contract, address parsing, payload validation

**Files:**
- Create: `lib/replies/types.ts`
- Create: `lib/replies/address.ts`
- Create: `lib/replies/payload.ts`
- Test: `lib/replies/address.test.ts`
- Test: `lib/replies/payload.test.ts`

**Interfaces:**
- Consumes: nothing.
- Produces:
  - `types.ts`: `REPLY_KINDS`, `type ReplyKind = "human" | "auto_reply" | "bounce" | "unsubscribe" | "internal" | "unmatched"`, `type BounceType = "hard" | "policy" | "soft"`, `type MatchVia = "thread" | "sender" | "domain"`, `OWN_DOMAINS`, `REASON_EMAILED_UNSUBSCRIBE = "unsubscribe-email"`, `REASON_HARD_BOUNCE = "bounce-unknown"`, caps `MAX_SUBJECT_LEN`, `MAX_TEXT_LEN`, `MAX_HEADERS`, `MAX_HEADER_VALUE_LEN`, `MAX_ID_LEN`, `SNIPPET_LEN`, `ALERT_TEXT_LEN`, `interface InboundMessage`, `interface ReplyAlert { to; subject; text }`, `type IngestResponse`.
  - `address.ts`: `parseAddress(raw: string | null | undefined): { email: string | null; name: string | null; original: string | null }`, `domainOf(email: string | null): string | null`, `localPartOf(email: string | null): string | null`.
  - `payload.ts`: `parseInbound(body: unknown): { ok: true; value: InboundMessage } | { ok: false; error: string }`.

- [ ] **Step 1: Write the types file** (no test of its own — every later test exercises it)

`lib/replies/types.ts`:
```ts
/**
 * Client-safe contract for reply detection: the kinds a message can be sorted
 * into, the body n8n's "APMG Reply Capture" workflow posts, the ingest
 * response, and the caps. Dependency-free so the route, the pure modules, the
 * report and lib/portal/server.ts can all import it without cycles. See
 * docs/superpowers/specs/2026-09-28-reply-detection-design.md.
 */

export const REPLY_KINDS = ["human", "auto_reply", "bounce", "unsubscribe", "internal", "unmatched"] as const;
export type ReplyKind = (typeof REPLY_KINDS)[number];

export type BounceType = "hard" | "policy" | "soft";
export type MatchVia = "thread" | "sender" | "domain";

/** Mail from these is staff, a test, or a reply to one of our own alerts. */
export const OWN_DOMAINS: readonly string[] = ["apmgservices.com.au", "apmgmaintenance.com.au"];

/** email_suppression reasons the ingest route writes. Keep in step with the
 *  greppable list in supabase/suppress-bounces.sql. */
export const REASON_EMAILED_UNSUBSCRIBE = "unsubscribe-email";
export const REASON_HARD_BOUNCE = "bounce-unknown";

export const MAX_SUBJECT_LEN = 1_000;
export const MAX_TEXT_LEN = 20_000;
export const MAX_HEADERS = 100;
export const MAX_HEADER_VALUE_LEN = 2_000;
/** Gmail message/thread ids are ~16 hex chars; this only stops garbage. */
export const MAX_ID_LEN = 200;
/** Stored on the row: the new text only, never the quoted original. */
export const SNIPPET_LEN = 500;
/** How much of the new text the alert email quotes. */
export const ALERT_TEXT_LEN = 1_000;

/** One inbound message, as validated by parseInbound. */
export interface InboundMessage {
  gmailId: string;
  threadId: string | null;
  /** ISO — from Gmail's internalDate */
  receivedAt: string;
  /** the raw From header, e.g. `"Jane Smith" <jane@acme.com.au>` */
  from: string;
  subject: string;
  /** header names lowercased; the first occurrence of a repeated header wins */
  headers: Record<string, string>;
  /** plain text (HTML flattened by n8n when there was no text part) */
  text: string;
  /** raw To header of the thread's first SENT message — the address we wrote to */
  originalTo: string | null;
  originalSentAt: string | null;
  /** true for the one-off import: never alerts */
  backfill: boolean;
}

/** The alert n8n sends to the enquiry notification list for a human reply. */
export interface ReplyAlert {
  /** comma-separated list, passed straight to the Gmail node */
  to: string;
  subject: string;
  text: string;
}

export type IngestResponse =
  | { ok: true; kind: ReplyKind; duplicate: boolean; alert: ReplyAlert | null }
  | { ok: false; error: string; needsMigration?: true };
```

- [ ] **Step 2: Write the failing address tests**

`lib/replies/address.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { domainOf, localPartOf, parseAddress } from "./address";

describe("parseAddress", () => {
  it("splits a display name from an angle address, lowercasing the address but keeping its original casing", () => {
    expect(parseAddress('"Jane Smith" <Jane.Smith@Acme.com.au>')).toEqual({
      email: "jane.smith@acme.com.au",
      name: "Jane Smith",
      original: "Jane.Smith@Acme.com.au",
    });
  });

  it("keeps a comma inside a quoted display name", () => {
    expect(parseAddress('"Smith, Jane" <jane@acme.com.au>').name).toBe("Smith, Jane");
  });

  it("reads a bare address", () => {
    expect(parseAddress("info@acme.com.au")).toEqual({ email: "info@acme.com.au", name: null, original: "info@acme.com.au" });
  });

  it("takes the first of several addresses", () => {
    expect(parseAddress("a@one.com.au, b@two.com.au").email).toBe("a@one.com.au");
  });

  it("strips mailto: and trailing punctuation", () => {
    expect(parseAddress("<mailto:Info@Acme.com.au>.").original).toBe("Info@Acme.com.au");
  });

  it("returns nulls for junk, empty and missing input", () => {
    for (const raw of ["", "   ", "not an address", null, undefined]) {
      expect(parseAddress(raw)).toEqual({ email: null, name: null, original: null });
    }
  });
});

describe("domainOf / localPartOf", () => {
  it("splits an address at the last @", () => {
    expect(domainOf("jane@acme.com.au")).toBe("acme.com.au");
    expect(localPartOf("Mailer-Daemon@googlemail.com")).toBe("mailer-daemon");
  });

  it("returns null without an address", () => {
    expect(domainOf(null)).toBeNull();
    expect(localPartOf("no-at-sign")).toBeNull();
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run lib/replies/address.test.ts`
Expected: FAIL — `Failed to resolve import "./address"`.

- [ ] **Step 4: Implement `lib/replies/address.ts`**

```ts
/**
 * Address parsing for inbound mail headers. Pure and client-safe.
 *
 * `original` keeps the casing the header carried because the To header of our
 * own sent message reproduces the address exactly as it is stored on the lead
 * (`Info@Acme.com.au`), and the lead lookup tries that exact string first.
 */

const ANGLE_RE = /<\s*([^<>\s]+@[^<>\s]+)\s*>/;
const BARE_RE = /([^\s<>"',;:()]+@[^\s<>"',;:()]+\.[^\s<>"',;:()]+)/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export interface ParsedAddress {
  /** lowercased, or null when there was no usable address */
  email: string | null;
  name: string | null;
  /** the address as written in the header (casing preserved) */
  original: string | null;
}

const NONE: ParsedAddress = { email: null, name: null, original: null };

function normalise(addr: string): { email: string; original: string } | null {
  const original = addr.trim().replace(/^mailto:/i, "").replace(/[.,;:]+$/, "");
  const email = original.toLowerCase();
  return EMAIL_RE.test(email) ? { email, original } : null;
}

/** `"Jane Smith" <Jane@Acme.com.au>` → address, display name, original casing.
 *  Takes the FIRST address when a header lists several. Total — never throws. */
export function parseAddress(raw: string | null | undefined): ParsedAddress {
  const s = (raw ?? "").trim();
  if (!s) return NONE;
  const angle = ANGLE_RE.exec(s);
  if (angle) {
    const addr = normalise(angle[1]);
    if (!addr) return NONE;
    const name = s.slice(0, angle.index).trim().replace(/^"+|"+$/g, "").trim();
    return { ...addr, name: name || null };
  }
  const bare = BARE_RE.exec(s);
  const addr = bare ? normalise(bare[1]) : null;
  return addr ? { ...addr, name: null } : NONE;
}

/** The part after the last @, lowercased, or null. */
export function domainOf(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(at + 1).toLowerCase() : null;
}

/** The part before the last @, lowercased, or null. */
export function localPartOf(email: string | null): string | null {
  if (!email) return null;
  const at = email.lastIndexOf("@");
  return at > 0 ? email.slice(0, at).toLowerCase() : null;
}
```

- [ ] **Step 5: Run the address tests to verify they pass**

Run: `npx vitest run lib/replies/address.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Write the failing payload tests**

`lib/replies/payload.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { parseInbound } from "./payload";
import { MAX_HEADER_VALUE_LEN, MAX_HEADERS, MAX_SUBJECT_LEN, MAX_TEXT_LEN } from "./types";

const VALID = {
  gmailId: "18c2f0a1b2c3d4e5",
  threadId: "18c2f0a1b2c3d4e0",
  receivedAt: "2026-09-28T01:02:03.000Z",
  from: "Jane <jane@acme.com.au>",
  subject: "Re: Maintenance",
  headers: { "Auto-Submitted": "no", "Content-Type": "text/plain" },
  text: "Yes please",
  originalTo: "jane@acme.com.au",
  originalSentAt: "2026-09-21T00:00:00.000Z",
  backfill: false,
};

function errorOf(body: unknown): string {
  const r = parseInbound(body);
  if (r.ok) throw new Error("expected a rejection");
  return r.error;
}

describe("parseInbound", () => {
  it("accepts a well-formed message and lowercases header names", () => {
    const r = parseInbound(VALID);
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toMatchObject({ gmailId: VALID.gmailId, threadId: VALID.threadId, backfill: false, text: "Yes please" });
    expect(r.value.headers).toEqual({ "auto-submitted": "no", "content-type": "text/plain" });
  });

  it("defaults every optional field", () => {
    const r = parseInbound({ gmailId: "abc", receivedAt: VALID.receivedAt, from: "a@b.com" });
    if (!r.ok) throw new Error(r.error);
    expect(r.value).toEqual({
      gmailId: "abc",
      threadId: null,
      receivedAt: VALID.receivedAt,
      from: "a@b.com",
      subject: "",
      headers: {},
      text: "",
      originalTo: null,
      originalSentAt: null,
      backfill: false,
    });
  });

  it("normalises receivedAt to UTC ISO", () => {
    const r = parseInbound({ ...VALID, receivedAt: "2026-09-28T11:02:03+10:00" });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.receivedAt).toBe("2026-09-28T01:02:03.000Z");
  });

  it("keeps the first of two headers whose names differ only in case", () => {
    const r = parseInbound({ ...VALID, headers: { Precedence: "bulk", precedence: "list" } });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.headers.precedence).toBe("bulk");
  });

  it("never lets a __proto__ header change the headers object's prototype", () => {
    const r = parseInbound({ ...VALID, headers: JSON.parse('{"__proto__": "x", "list-id": "y"}') });
    if (!r.ok) throw new Error(r.error);
    expect(r.value.headers["list-id"]).toBe("y");
    expect(Object.getPrototypeOf(r.value.headers)).toBe(Object.prototype);
  });

  it.each([null, [], "text", 42])("rejects a body that is not an object (%s)", (body) => {
    expect(errorOf(body)).toMatch(/JSON object/);
  });

  it.each(["", "../etc", "a".repeat(201)])("rejects an unsafe gmailId (%s)", (gmailId) => {
    expect(errorOf({ ...VALID, gmailId })).toMatch(/gmailId/);
  });

  it("rejects a malformed threadId", () => {
    expect(errorOf({ ...VALID, threadId: "has space" })).toMatch(/threadId/);
  });

  it("rejects an unreadable receivedAt", () => {
    expect(errorOf({ ...VALID, receivedAt: "yesterday" })).toMatch(/receivedAt/);
  });

  it("rejects a missing from", () => {
    expect(errorOf({ ...VALID, from: "  " })).toMatch(/from/);
  });

  it("rejects text, subject and header values over their caps", () => {
    expect(errorOf({ ...VALID, text: "x".repeat(MAX_TEXT_LEN + 1) })).toMatch(/text/);
    expect(errorOf({ ...VALID, subject: "x".repeat(MAX_SUBJECT_LEN + 1) })).toMatch(/subject/);
    expect(errorOf({ ...VALID, headers: { a: "x".repeat(MAX_HEADER_VALUE_LEN + 1) } })).toMatch(/header "a"/);
  });

  it("rejects too many headers and non-string header values", () => {
    const many = Object.fromEntries(Array.from({ length: MAX_HEADERS + 1 }, (_, i) => [`h${i}`, "v"]));
    expect(errorOf({ ...VALID, headers: many })).toMatch(/at most 100/);
    expect(errorOf({ ...VALID, headers: { a: 1 } })).toMatch(/header "a"/);
    expect(errorOf({ ...VALID, headers: ["a"] })).toMatch(/headers must be an object/);
  });

  it("rejects a non-boolean backfill and an unreadable originalSentAt", () => {
    expect(errorOf({ ...VALID, backfill: "yes" })).toMatch(/backfill/);
    expect(errorOf({ ...VALID, originalSentAt: "soon" })).toMatch(/originalSentAt/);
  });
});
```

- [ ] **Step 7: Run it to verify it fails**

Run: `npx vitest run lib/replies/payload.test.ts`
Expected: FAIL — `Failed to resolve import "./payload"`.

- [ ] **Step 8: Implement `lib/replies/payload.ts`**

```ts
import {
  MAX_HEADER_VALUE_LEN,
  MAX_HEADERS,
  MAX_ID_LEN,
  MAX_SUBJECT_LEN,
  MAX_TEXT_LEN,
  type InboundMessage,
} from "./types";

/**
 * Validates the body n8n's "APMG Reply Capture" workflow posts to
 * /api/inbound/replies. Total — never throws. Anything over a cap is REJECTED
 * rather than trimmed: the n8n Code node already trims to the same caps, so an
 * oversize field means a broken workflow, and a 400 in n8n's execution log is
 * how that gets noticed.
 */

/** Gmail ids are URL-safe; the id is spliced into PostgREST filters later. */
const ID_RE = /^[A-Za-z0-9_-]+$/;
const MAX_ADDRESS_HEADER_LEN = 1_000;

export type ParseResult = { ok: true; value: InboundMessage } | { ok: false; error: string };

const fail = (error: string): ParseResult => ({ ok: false, error });

/** undefined / null / "" → null; a string within `max` → itself; anything else → false. */
function optionalString(v: unknown, max: number): string | null | false {
  if (v === undefined || v === null || v === "") return null;
  return typeof v === "string" && v.length <= max ? v : false;
}

export function parseInbound(body: unknown): ParseResult {
  if (!body || typeof body !== "object" || Array.isArray(body)) return fail("Expected a JSON object.");
  const b = body as Record<string, unknown>;

  const gmailId = typeof b.gmailId === "string" ? b.gmailId.trim() : "";
  if (!gmailId || gmailId.length > MAX_ID_LEN || !ID_RE.test(gmailId)) {
    return fail("gmailId is required (letters, digits, - and _ only).");
  }

  const threadId = optionalString(b.threadId, MAX_ID_LEN);
  if (threadId === false || (threadId !== null && !ID_RE.test(threadId))) return fail("threadId is malformed.");

  const receivedMs = typeof b.receivedAt === "string" ? Date.parse(b.receivedAt) : NaN;
  if (!Number.isFinite(receivedMs)) return fail("receivedAt must be an ISO date.");

  const from = typeof b.from === "string" ? b.from.trim() : "";
  if (!from || from.length > MAX_ADDRESS_HEADER_LEN) return fail("from is required.");

  const subject = b.subject ?? "";
  if (typeof subject !== "string" || subject.length > MAX_SUBJECT_LEN) {
    return fail(`subject must be a string of at most ${MAX_SUBJECT_LEN} characters.`);
  }

  const text = b.text ?? "";
  if (typeof text !== "string" || text.length > MAX_TEXT_LEN) {
    return fail(`text must be a string of at most ${MAX_TEXT_LEN} characters.`);
  }

  const rawHeaders = b.headers ?? {};
  if (typeof rawHeaders !== "object" || Array.isArray(rawHeaders)) return fail("headers must be an object.");
  const entries = Object.entries(rawHeaders as Record<string, unknown>);
  if (entries.length > MAX_HEADERS) return fail(`headers may carry at most ${MAX_HEADERS} entries.`);
  // Built through a Map + Object.fromEntries: every key becomes an OWN property,
  // so a header literally named "__proto__" can't reach the prototype.
  const seen = new Map<string, string>();
  for (const [name, value] of entries) {
    if (typeof value !== "string" || value.length > MAX_HEADER_VALUE_LEN) {
      return fail(`header "${name.slice(0, 60)}" must be a string of at most ${MAX_HEADER_VALUE_LEN} characters.`);
    }
    const key = name.trim().toLowerCase();
    if (key && !seen.has(key)) seen.set(key, value);
  }

  const originalTo = optionalString(b.originalTo, MAX_ADDRESS_HEADER_LEN);
  if (originalTo === false) return fail("originalTo is malformed.");

  const sentRaw = optionalString(b.originalSentAt, 64);
  const sentMs = typeof sentRaw === "string" ? Date.parse(sentRaw) : null;
  if (sentRaw === false || (sentMs !== null && !Number.isFinite(sentMs))) return fail("originalSentAt must be an ISO date.");

  if (b.backfill !== undefined && typeof b.backfill !== "boolean") return fail("backfill must be true or false.");

  return {
    ok: true,
    value: {
      gmailId,
      threadId,
      receivedAt: new Date(receivedMs).toISOString(),
      from,
      subject,
      headers: Object.fromEntries(seen),
      text,
      originalTo,
      originalSentAt: sentMs === null ? null : new Date(sentMs).toISOString(),
      backfill: b.backfill === true,
    },
  };
}
```

- [ ] **Step 9: Run the task's tests to verify they pass**

Run: `npx vitest run lib/replies`
Expected: PASS (address + payload suites).

- [ ] **Step 10: Type-check and leave the changes uncommitted**

Run: `npx tsc --noEmit`
Expected: no errors. Do not commit.

---

### Task 2: The classifier

**Files:**
- Create: `lib/replies/classify.ts`
- Test: `lib/replies/classify.test.ts`

**Interfaces:**
- Consumes: `parseAddress`, `domainOf`, `localPartOf` (Task 1); `OWN_DOMAINS`, `BounceType`, `InboundMessage`, `ReplyKind` (Task 1).
- Produces:
  - `interface Bounce { type: BounceType; code: string | null; recipient: string | null }`
  - `interface Classification { kind: Exclude<ReplyKind, "unmatched">; rule: string; bounce: Bounce | null; newText: string }`
  - `type ClassifyInput = Pick<InboundMessage, "from" | "subject" | "headers" | "text" | "originalTo">`
  - `newTextOf(text: string): string`
  - `classify(msg: ClassifyInput): Classification`
  - `finalKind(c: Classification, matched: boolean): ReplyKind`

- [ ] **Step 1: Write the failing tests**

`lib/replies/classify.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { classify, finalKind, newTextOf, type ClassifyInput } from "./classify";

const msg = (over: Partial<ClassifyInput> = {}): ClassifyInput => ({
  from: "Jane Smith <jane@acme.com.au>",
  subject: "Re: Maintenance for Acme Childcare",
  headers: {},
  text: "",
  originalTo: "jane@acme.com.au",
  ...over,
});

const ATTRIBUTION = "On Mon, 21 Sep 2026 at 9:00 am, George Collins <outreach@apmgmaintenance.com.au> wrote:";

describe("newTextOf — only the text above the quoted original", () => {
  it("cuts at a Gmail attribution line", () => {
    expect(newTextOf(`Yes please.\n\n${ATTRIBUTION}\n> Hi team\n> Unsubscribe`)).toBe("Yes please.");
  });

  it("cuts at an attribution that wraps onto two lines", () => {
    const text = "Great, thanks\n\nOn Tue, 22 Sep 2026 at 10:14, George Collins <\noutreach@apmgmaintenance.com.au> wrote:\n> Unsubscribe here";
    expect(newTextOf(text)).toBe("Great, thanks");
  });

  it("cuts at an Outlook From:/Sent: header block", () => {
    const text = "Interested — what are your rates?\n\nFrom: George Collins <outreach@apmgmaintenance.com.au>\nSent: Tuesday, 22 September 2026 10:14 AM\nTo: info@acme.com.au\nSubject: Maintenance\n\nHi team … unsubscribe";
    expect(newTextOf(text)).toBe("Interested — what are your rates?");
  });

  it("cuts at > quotes, Original Message and underscore separators", () => {
    expect(newTextOf("Sounds good\n> quoted")).toBe("Sounds good");
    expect(newTextOf("Sounds good\n-----Original Message-----\nunsubscribe")).toBe("Sounds good");
    expect(newTextOf("Sounds good\n________________________________\nFrom: x")).toBe("Sounds good");
  });

  it("returns the whole text when nothing is quoted, and empty for an empty body", () => {
    expect(newTextOf("Line one\r\nLine two")).toBe("Line one\nLine two");
    expect(newTextOf("")).toBe("");
  });
});

describe("classify — internal and bounces", () => {
  it("files our own staff as internal before anything else", () => {
    expect(classify(msg({ from: "Kane <kane@apmgservices.com.au>", subject: "unsubscribe" }))).toMatchObject({ kind: "internal", rule: "sender:own-domain" });
  });

  it("reads a Google 'address not found' bounce as hard, with the failed address", () => {
    const c = classify(msg({
      from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
      subject: "Delivery Status Notification (Failure)",
      headers: { "x-failed-recipients": "old.staff@acme.com.au" },
      text: "Address not found\nYour message wasn't delivered to old.staff@acme.com.au because the address couldn't be found.\nThe response from the remote server was:\n550 5.1.1 The email account that you tried to reach does not exist.",
      originalTo: "old.staff@acme.com.au",
    }));
    expect(c).toMatchObject({ kind: "bounce", rule: "sender:mailer-daemon", bounce: { type: "hard", code: "5.1.1", recipient: "old.staff@acme.com.au" } });
  });

  it("reads a Microsoft 550 5.1.10 NDR as hard, taking Final-Recipient", () => {
    const c = classify(msg({
      from: "postmaster@acme.onmicrosoft.com",
      subject: "Undeliverable: Maintenance for Acme Childcare",
      headers: { "content-type": "multipart/report; report-type=delivery-status; boundary=x" },
      text: "Remote Server returned '550 5.1.10 RESOLVER.ADR.RecipientNotFound; Recipient info@acme.com.au not found by SMTP address lookup'\n\nFinal-Recipient: rfc822;info@acme.com.au",
      originalTo: null,
    }));
    expect(c.bounce).toEqual({ type: "hard", code: "5.1.10", recipient: "info@acme.com.au" });
  });

  it("reads a 5.7.1 gateway block as policy, falling back to the thread's address", () => {
    const c = classify(msg({
      from: "Mail Delivery System <MAILER-DAEMON@barracuda.bluemountains.edu.au>",
      subject: "Undelivered Mail Returned to Sender",
      text: "550 #5.7.1 Your access to submit messages to this e-mail system has been rejected.",
      originalTo: "enquiry@bluemountains.edu.au",
    }));
    expect(c.bounce).toEqual({ type: "policy", code: "5.7.1", recipient: "enquiry@bluemountains.edu.au" });
  });

  it("reads a full mailbox as soft", () => {
    const c = classify(msg({ from: "mailer-daemon@googlemail.com", text: "552 5.2.2 The email account that you tried to reach is over quota." }));
    expect(c.bounce?.type).toBe("soft");
  });

  it("falls back to wording when a bounce carries no status code", () => {
    const c = classify(msg({ from: "postmaster@acme.com.au", subject: "Returned mail", text: "Recipient address rejected: User unknown in local recipient table" }));
    expect(c.bounce?.type).toBe("hard");
  });
});

describe("classify — unsubscribes", () => {
  it("reads the mailto unsubscribe button's email", () => {
    expect(classify(msg({ subject: "unsubscribe" }))).toMatchObject({ kind: "unsubscribe", rule: "subject:unsubscribe" });
  });

  it("honours the button's email even when the client stamps Auto-Submitted on it", () => {
    expect(classify(msg({ subject: "Unsubscribe", headers: { "auto-submitted": "auto-generated" } })).kind).toBe("unsubscribe");
  });

  it("reads a human 'please remove us' above the quote", () => {
    const c = classify(msg({ text: `Please remove us from your mailing list.\n\n${ATTRIBUTION}\n> Hi Acme team` }));
    expect(c).toMatchObject({ kind: "unsubscribe", rule: "text:opt-out", newText: "Please remove us from your mailing list." });
  });

  it("honours an opt-out even inside an out-of-office line", () => {
    expect(classify(msg({ text: "I'm out of the office — please remove us anyway." })).kind).toBe("unsubscribe");
  });
});

describe("classify — automated", () => {
  it("reads an Outlook out-of-office by Auto-Submitted", () => {
    const c = classify(msg({
      subject: "Automatic reply: Maintenance for Acme Childcare",
      headers: { "auto-submitted": "auto-generated", "x-auto-response-suppress": "All" },
      text: "I am currently out of the office until 6 October.",
    }));
    expect(c).toMatchObject({ kind: "auto_reply", rule: "header:auto-submitted" });
  });

  it("reads an Outlook out-of-office with only X-Auto-Response-Suppress by its subject", () => {
    const c = classify(msg({ subject: "Automatic reply: Maintenance for Acme Childcare", headers: { "x-auto-response-suppress": "All" } }));
    expect(c).toMatchObject({ kind: "auto_reply", rule: "subject:automatic" });
  });

  it("does not treat X-Auto-Response-Suppress alone as automated", () => {
    const c = classify(msg({ headers: { "x-auto-response-suppress": "DR, OOF, AutoReply" }, text: "Yes, please call me Tuesday." }));
    expect(c.kind).toBe("human");
  });

  it("reads a Gmail vacation responder", () => {
    expect(classify(msg({ headers: { "auto-submitted": "auto-replied", precedence: "bulk" } })).rule).toBe("header:auto-submitted");
  });

  it("reads a newsletter by List-Id", () => {
    expect(classify(msg({ subject: "Acme September news", headers: { "list-id": "<news.acme.com.au>" } }))).toMatchObject({ kind: "auto_reply", rule: "header:list-id" });
  });

  it("reads a no-reply sender", () => {
    expect(classify(msg({ from: "noreply@acme-portal.com.au", subject: "Your enquiry" }))).toMatchObject({ kind: "auto_reply", rule: "sender:no-reply" });
  });

  it("reads a helpdesk acknowledgement as automated, not as an opt-out", () => {
    const c = classify(msg({
      from: "Acme Support <support@acme.com.au>",
      subject: "[Ticket #48213] Re: Maintenance for Acme Childcare",
      text: "Thanks, we have received your request. To unsubscribe from these notifications, reply STOP.",
    }));
    expect(c).toMatchObject({ kind: "auto_reply", rule: "subject:automatic" });
  });

  it("reads first-person out-of-office wording with no headers", () => {
    const c = classify(msg({ text: "I am currently out of the office until Monday 5 October with limited access to email." }));
    expect(c).toMatchObject({ kind: "auto_reply", rule: "text:automatic" });
  });
});

describe("classify — human", () => {
  it("counts a reply that quotes our footer's unsubscribe link as human, not an opt-out", () => {
    const c = classify(msg({
      text: `Yes, we'd like a quote for the gutters. Call me on 0400 000 000.\n\n${ATTRIBUTION}\n> Hi team\n> Unsubscribe: https://customer.apmgservices.com.au/api/portal/unsubscribe?e=x`,
    }));
    expect(c).toMatchObject({ kind: "human", rule: "default:human", newText: "Yes, we'd like a quote for the gutters. Call me on 0400 000 000." });
  });

  it("counts a reply that quotes an out-of-office phrase as human", () => {
    expect(classify(msg({ text: "Sounds good, send through the details.\n\n> I am currently out of the office" })).kind).toBe("human");
  });

  it("counts past-tense 'out of the office' as human", () => {
    expect(classify(msg({ text: "I was out of the office last week, but yes please send a quote." })).kind).toBe("human");
  });

  it("counts a reply with no new text at all as human", () => {
    expect(classify(msg({ text: `${ATTRIBUTION}\n> Hi team` }))).toMatchObject({ kind: "human", newText: "" });
  });
});

describe("finalKind", () => {
  it("turns an unmatched human into unmatched and leaves every other kind alone", () => {
    const human = classify(msg({ text: "Yes please" }));
    expect(finalKind(human, true)).toBe("human");
    expect(finalKind(human, false)).toBe("unmatched");
    const bounce = classify(msg({ from: "mailer-daemon@googlemail.com", text: "550 5.1.1" }));
    expect(finalKind(bounce, false)).toBe("bounce");
  });
});
```

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run lib/replies/classify.test.ts`
Expected: FAIL — `Failed to resolve import "./classify"`.

- [ ] **Step 3: Implement `lib/replies/classify.ts`**

```ts
import { domainOf, localPartOf, parseAddress } from "./address";
import { OWN_DOMAINS, type BounceType, type InboundMessage, type ReplyKind } from "./types";

/**
 * Sorts one inbound message into exactly one kind. Pure — the ingest route
 * gathers the facts, this only judges them, so every rule is testable without
 * Supabase or Gmail. The first matching rule wins and `rule` names it, so a
 * wrong call can be traced from its email_replies row. Rule order and the
 * reasons behind it: docs/superpowers/specs/2026-09-28-reply-detection-design.md §5.
 *
 * The costliest mistake is a real reply filed as automated — that is the
 * number the report exists to show — so every automated rule is narrow, and
 * `x-auto-response-suppress` (which can ride on ordinary Outlook mail) is
 * deliberately not one of them.
 */

export interface Bounce {
  type: BounceType;
  code: string | null;
  recipient: string | null;
}

export interface Classification {
  /** "human" here means "human IF it matches a lead" — see finalKind. */
  kind: Exclude<ReplyKind, "unmatched">;
  rule: string;
  bounce: Bounce | null;
  /** the body above the quoted original — the only text the wording rules read */
  newText: string;
}

export type ClassifyInput = Pick<InboundMessage, "from" | "subject" | "headers" | "text" | "originalTo">;

const has = (h: Record<string, string>, k: string) => Object.prototype.hasOwnProperty.call(h, k);

/* ── new text ───────────────────────────────────────────────────────────────
   Our own email contains an unsubscribe link. A normal reply quotes it, so
   reading the whole body would turn every "yes please" into an opt-out. */

const QUOTE_LINE = [
  /^\s*>/,
  /^\s*-{2,}\s*Original Message\s*-{2,}/i,
  /^\s*-{2,}\s*Forwarded message\s*-{2,}/i,
  /^\s*_{10,}\s*$/,
];
const WROTE_END = /\bwrote:\s*$/i;
const ON_START = /^\s*On\s/i;
const OUTLOOK_FROM = /^\s*From:\s/i;
const OUTLOOK_NEXT = /^\s*(Sent|Date|To|Subject):\s/i;

export function newTextOf(text: string): string {
  const lines = text.replace(/\r\n?/g, "\n").split("\n");
  let cut = lines.length;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (QUOTE_LINE.some((re) => re.test(line))) {
      cut = i;
      break;
    }
    if (WROTE_END.test(line)) {
      // Gmail wraps a long attribution: "On Tue, … George Collins <" then
      // "outreach@…> wrote:". Cut at the "On" line when it is the one above.
      cut = i > 0 && !ON_START.test(line) && ON_START.test(lines[i - 1]) ? i - 1 : i;
      break;
    }
    if (OUTLOOK_FROM.test(line) && lines.slice(i + 1, i + 4).some((l) => OUTLOOK_NEXT.test(l))) {
      cut = i;
      break;
    }
  }
  return lines.slice(0, cut).join("\n").trim();
}

/* ── bounces ────────────────────────────────────────────────────────────── */

const BOUNCE_LOCAL = /^(mailer-daemon|postmaster)$/i;
const BOUNCE_SUBJECT =
  /^(delivery status notification \(failure\)|undeliverable:|undelivered mail returned|mail delivery failed|returned mail|delivery failure|failure notice)/i;
/** The first RFC 3463 enhanced status code, e.g. 5.1.1 or 5.1.10. */
const STATUS_CODE = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/;
const SOFT_PHRASE = /mailbox (is )?full|over quota|quota exceeded|temporar|try again later|deferred/i;
const HARD_PHRASE =
  /address not found|address couldn'?t be found|user unknown|unknown user|does not exist|no such user|recipient not found|recipientnotfound|mailbox unavailable|invalid recipient/i;
const POLICY_PHRASE = /blocked|rejected|access denied|spam|blacklist|blocklist|policy/i;
const FINAL_RECIPIENT = /Final-Recipient:\s*rfc822;\s*<?([^\s<>;]+@[^\s<>;]+?)>?\s*$/im;
const NOT_DELIVERED_TO = /(?:wasn'?t|was not|could not be|couldn'?t be) delivered to\s+<?([^\s<>]+@[^\s<>]+?)>?[\s.,]/i;

function bounceRuleOf(msg: ClassifyInput, senderLocal: string | null, subject: string): string | null {
  if (senderLocal && BOUNCE_LOCAL.test(senderLocal)) return "sender:mailer-daemon";
  if (has(msg.headers, "x-failed-recipients")) return "header:x-failed-recipients";
  const ct = (has(msg.headers, "content-type") ? msg.headers["content-type"] : "").toLowerCase();
  if (ct.includes("multipart/report") && ct.includes("delivery-status")) return "header:delivery-report";
  if (BOUNCE_SUBJECT.test(subject)) return "subject:bounce";
  return null;
}

function bounceType(code: string | null, text: string): BounceType {
  if (code) {
    if (code.startsWith("5.1.")) return "hard";
    if (code.startsWith("5.7.")) return "policy";
    if (code === "5.2.2" || code.startsWith("4.")) return "soft";
  }
  // No decisive code: soft first ("temporarily rejected" is soft), hard before
  // policy ("Recipient address rejected: User unknown" is a dead address).
  if (SOFT_PHRASE.test(text)) return "soft";
  if (HARD_PHRASE.test(text)) return "hard";
  if (POLICY_PHRASE.test(text)) return "policy";
  return "soft";
}

function bounceRecipient(msg: ClassifyInput): string | null {
  const failed = has(msg.headers, "x-failed-recipients") ? parseAddress(msg.headers["x-failed-recipients"]).email : null;
  if (failed) return failed;
  const inText = FINAL_RECIPIENT.exec(msg.text)?.[1] ?? NOT_DELIVERED_TO.exec(msg.text)?.[1] ?? null;
  return (inText ? parseAddress(inText).email : null) ?? parseAddress(msg.originalTo).email;
}

/* ── opt-outs and automated mail ────────────────────────────────────────── */

/** Exactly what our List-Unsubscribe mailto puts in the subject. */
const UNSUB_SUBJECT = /^\s*unsubscribe\s*$/i;
const OPT_OUT_TEXT =
  /\b(unsubscribe|remove (me|us|my (email|address)|our (email|address)|this (email|address))|take (me|us) off|stop (emailing|sending|contacting)|(do not|don'?t) (email|contact)|opt(ed)?[- ]?out|no longer (wish|want) to receive)\b/i;

const AUTO_HEADERS = ["x-autoreply", "x-autorespond", "x-autoresponder"];
const BULK_PRECEDENCE = new Set(["auto_reply", "bulk", "junk", "list"]);
const NOREPLY_LOCAL = /^(no-?reply|do-?not-?reply)([-.+_].*)?$/i;
const AUTO_SUBJECT_START =
  /^\s*(automatic reply|auto[- ]?reply|autoreply|auto:|out of (the )?office|ooo\b|away:|on leave|annual leave|réponse automatique|abwesenheitsnotiz)/i;
const AUTO_SUBJECT_ANY =
  /(thank you for (your email|contacting|your enquiry|your inquiry|your message)|we have received your|we'?ve received your|\[ticket|ticket #|case #|request received)/i;
/** First-person and present tense on purpose — "I was out of the office last
 *  week, but yes please" is a real reply. */
const AUTO_BODY = [
  /\bI(?:'m| am| will be)\s+(?:currently\s+)?(?:out of (?:the )?office|away from (?:the|my) (?:office|desk)|on (?:annual|parental|maternity|paternity|sick|long service) leave|on leave)\b/i,
  /\blimited access to (?:my )?email\b/i,
  /\bthis (?:mailbox|inbox|email address) is (?:not|no longer) (?:being )?monitored\b/i,
  /\bthis is an automated (?:message|response|reply|email)\b/i,
];

function autoHeaderRule(h: Record<string, string>): string | null {
  if (has(h, "auto-submitted") && h["auto-submitted"].trim().toLowerCase() !== "no") return "header:auto-submitted";
  for (const k of AUTO_HEADERS) if (has(h, k)) return `header:${k}`;
  if (has(h, "precedence") && BULK_PRECEDENCE.has(h.precedence.trim().toLowerCase())) return "header:precedence";
  if (has(h, "list-id")) return "header:list-id";
  if (has(h, "list-unsubscribe")) return "header:list-unsubscribe";
  return null;
}

export function classify(msg: ClassifyInput): Classification {
  const sender = parseAddress(msg.from).email;
  const senderDomain = domainOf(sender);
  const senderLocal = localPartOf(sender);
  const subject = msg.subject.trim();
  const newText = newTextOf(msg.text);
  const out = (kind: Classification["kind"], rule: string, bounce: Bounce | null = null): Classification => ({
    kind,
    rule,
    bounce,
    newText,
  });

  // 1 — staff, tests, replies to our own alerts
  if (senderDomain && OWN_DOMAINS.includes(senderDomain)) return out("internal", "sender:own-domain");
  // 2 — delivery failures
  const bounceRule = bounceRuleOf(msg, senderLocal, subject);
  if (bounceRule) {
    const code = STATUS_CODE.exec(msg.text)?.[0] ?? null;
    return out("bounce", bounceRule, { type: bounceType(code, msg.text), code, recipient: bounceRecipient(msg) });
  }
  // 3 — the mailto unsubscribe button, BEFORE the automated rules: a mail client
  //     may stamp Auto-Submitted on the message it sends, and an opt-out must
  //     never be lost to that
  if (UNSUB_SUBJECT.test(subject)) return out("unsubscribe", "subject:unsubscribe");
  // 4 — automated, by header
  const header = autoHeaderRule(msg.headers);
  if (header) return out("auto_reply", header);
  // 5 — automated, by sender or subject (before 6, so a helpdesk ack that says
  //     "to unsubscribe from these notifications" is not an opt-out)
  if (senderLocal && NOREPLY_LOCAL.test(senderLocal)) return out("auto_reply", "sender:no-reply");
  if (AUTO_SUBJECT_START.test(subject) || AUTO_SUBJECT_ANY.test(subject)) return out("auto_reply", "subject:automatic");
  // 6 — a person asking to be removed
  if (OPT_OUT_TEXT.test(newText)) return out("unsubscribe", "text:opt-out");
  // 7 — automated, by wording (after 6, so "I'm on leave — remove us anyway" is honoured)
  if (AUTO_BODY.some((re) => re.test(newText))) return out("auto_reply", "text:automatic");
  // 8/9 — human if it matches a lead (finalKind decides)
  return out("human", "default:human");
}

/** A rule-8 message that matched no lead is unmatched; every other kind stands. */
export function finalKind(c: Classification, matched: boolean): ReplyKind {
  return c.kind === "human" && !matched ? "unmatched" : c.kind;
}
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run lib/replies/classify.test.ts`
Expected: PASS (all suites). If a wording test fails, fix the regex, not the test — the test inputs are the real-world shapes the spec lists.

- [ ] **Step 5: Type-check and leave uncommitted**

Run: `npx tsc --noEmit`
Expected: no errors. Do not commit.

---

### Task 3: Lead matching

**Files:**
- Create: `lib/replies/match.ts`
- Test: `lib/replies/match.test.ts`

**Interfaces:**
- Consumes: `MatchVia` (Task 1).
- Produces:
  - `interface LeadCandidate { id: string; business: string | null; sends: Array<{ at: string; campaign: string | null }> }`
  - `interface MatchCandidates { thread: LeadCandidate[]; sender: LeadCandidate[]; domain: LeadCandidate[] }`
  - `interface MatchResult { leadId: string | null; business: string | null; campaign: string | null; via: MatchVia | null }`
  - `NO_MATCH: MatchResult`
  - `matchLead(c: MatchCandidates, receivedAt: string): MatchResult`

- [ ] **Step 1: Write the failing tests**

`lib/replies/match.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { matchLead, NO_MATCH, type LeadCandidate } from "./match";

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";
const AT = "2026-09-28T01:00:00.000Z";

const lead = (id: string, sends: LeadCandidate["sends"] = [], business: string | null = "Acme"): LeadCandidate => ({ id, business, sends });
const none = { thread: [], sender: [], domain: [] };

describe("matchLead", () => {
  it("matches through the thread even with no send on record", () => {
    expect(matchLead({ ...none, thread: [lead(L1)] }, AT)).toEqual({ leadId: L1, business: "Acme", campaign: null, via: "thread" });
  });

  it("picks the lead emailed most recently before the reply, with that send's campaign", () => {
    const out = matchLead(
      {
        ...none,
        thread: [
          lead(L1, [{ at: "2026-09-01T00:00:00.000Z", campaign: "a" }]),
          lead(L2, [
            { at: "2026-09-20T00:00:00.000Z", campaign: "b" },
            { at: "2026-10-05T00:00:00.000Z", campaign: "after-the-reply" },
          ]),
        ],
      },
      AT,
    );
    expect(out).toMatchObject({ leadId: L2, campaign: "b", via: "thread" });
  });

  it("falls back to the sender, then the domain", () => {
    const sent = [{ at: "2026-09-20T00:00:00.000Z", campaign: "c" }];
    expect(matchLead({ ...none, sender: [lead(L1, sent)] }, AT)).toMatchObject({ leadId: L1, via: "sender" });
    expect(matchLead({ ...none, domain: [lead(L2, sent)] }, AT)).toMatchObject({ leadId: L2, via: "domain" });
  });

  it("never matches a sender or domain lead that was never emailed", () => {
    expect(matchLead({ thread: [], sender: [lead(L1)], domain: [lead(L2)] }, AT)).toEqual(NO_MATCH);
  });

  it("ignores sends after the reply", () => {
    expect(matchLead({ ...none, sender: [lead(L1, [{ at: "2026-10-01T00:00:00.000Z", campaign: "x" }])] }, AT)).toEqual(NO_MATCH);
  });

  it("breaks a tie on id so the answer is stable", () => {
    const sent = [{ at: "2026-09-20T00:00:00.000Z", campaign: "c" }];
    expect(matchLead({ ...none, thread: [lead(L2, sent), lead(L1, sent)] }, AT).leadId).toBe(L1);
  });

  it("returns no match with no candidates", () => {
    expect(matchLead(none, AT)).toEqual(NO_MATCH);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/replies/match.test.ts`
Expected: FAIL — `Failed to resolve import "./match"`.

- [ ] **Step 3: Implement `lib/replies/match.ts`**

```ts
import type { MatchVia } from "./types";

/**
 * Which lead (and campaign) an inbound message belongs to. Pure — the server
 * reads the candidates (lib/replies/server.ts), this picks one. Tiers, most
 * trusted first:
 *   thread — the address our original email in the Gmail thread went to
 *   sender — the sender's own address
 *   domain — any address at the sender's organisation domain
 * A thread hit needs no send on record: the thread itself proves we wrote to
 * that address. Sender and domain hits do, or any vendor who happens to share
 * a prospect's domain would count as a reply.
 */

export interface LeadCandidate {
  id: string;
  business: string | null;
  /** this lead's email_sent rows — any order; later ones are ignored */
  sends: Array<{ at: string; campaign: string | null }>;
}

export interface MatchCandidates {
  thread: LeadCandidate[];
  sender: LeadCandidate[];
  domain: LeadCandidate[];
}

export interface MatchResult {
  leadId: string | null;
  business: string | null;
  campaign: string | null;
  via: MatchVia | null;
}

export const NO_MATCH: MatchResult = { leadId: null, business: null, campaign: null, via: null };

type Send = { at: number; campaign: string | null };

function latestSend(c: LeadCandidate, atMs: number): Send | null {
  let best: Send | null = null;
  for (const s of c.sends) {
    const t = Date.parse(s.at);
    if (!Number.isFinite(t) || t > atMs) continue;
    if (!best || t > best.at) best = { at: t, campaign: s.campaign };
  }
  return best;
}

function pick(cands: LeadCandidate[], atMs: number, requireSend: boolean, via: MatchVia): MatchResult | null {
  // Sorted by id first so a tie always resolves the same way.
  const sorted = [...cands].sort((a, b) => a.id.localeCompare(b.id));
  let chosen: { c: LeadCandidate; send: Send } | null = null;
  for (const c of sorted) {
    const send = latestSend(c, atMs);
    if (send && (!chosen || send.at > chosen.send.at)) chosen = { c, send };
  }
  if (chosen) return { leadId: chosen.c.id, business: chosen.c.business, campaign: chosen.send.campaign, via };
  if (requireSend || sorted.length === 0) return null;
  return { leadId: sorted[0].id, business: sorted[0].business, campaign: null, via };
}

export function matchLead(c: MatchCandidates, receivedAt: string): MatchResult {
  const parsed = Date.parse(receivedAt);
  const atMs = Number.isFinite(parsed) ? parsed : Number.POSITIVE_INFINITY;
  return (
    pick(c.thread, atMs, false, "thread") ??
    pick(c.sender, atMs, true, "sender") ??
    pick(c.domain, atMs, true, "domain") ??
    NO_MATCH
  );
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/replies/match.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Type-check and leave uncommitted**

Run: `npx tsc --noEmit` — no errors.

---

### Task 4: Suppression reasons — bounces never mute an organisation

**Files:**
- Modify: `lib/portal/server.ts` (imports at top; `recordUnsubscribe` ~line 700; `fetchSuppressedDomains` query ~line 850)
- Modify: `supabase/suppress-bounces.sql` (the reason-list comment)
- Test: `lib/portal/suppressionReasons.test.ts` (new)

**Interfaces:**
- Consumes: `REASON_EMAILED_UNSUBSCRIBE` (Task 1).
- Produces:
  - `OPT_OUT_REASONS: readonly ["unsubscribe", "unsubscribe-email"]` exported from `lib/portal/server.ts`.
  - `recordUnsubscribe(base, key, email, ctx?: { leadId?: string | null; campaign?: string | null; reason?: string }): Promise<"ok" | "needs_migration" | "error">` — `reason` defaults to `"unsubscribe"`.

- [ ] **Step 1: Write the failing tests**

`lib/portal/suppressionReasons.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchSuppressedDomains, OPT_OUT_REASONS, recordUnsubscribe } from "./server";

afterEach(() => vi.unstubAllGlobals());

function capture(body: unknown = []) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: unknown, init?: RequestInit) => {
      calls.push({ url: String(url), init });
      return new Response(JSON.stringify(body), { status: 200 });
    }),
  );
  return calls;
}
const prefer = (init?: RequestInit) => (init?.headers as Record<string, string>).Prefer;

describe("recordUnsubscribe — reasons", () => {
  it("writes a portal opt-out as 'unsubscribe' and merges on conflict", async () => {
    const calls = capture();
    expect(await recordUnsubscribe("https://db.test", "k", "Jane@Acme.com.au")).toBe("ok");
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ email: "jane@acme.com.au", reason: "unsubscribe" });
    expect(prefer(calls[0].init)).toContain("resolution=merge-duplicates");
  });

  it("writes an emailed opt-out with its own reason, adding a row only", async () => {
    const calls = capture();
    await recordUnsubscribe("https://db.test", "k", "jane@acme.com.au", { reason: "unsubscribe-email", leadId: null, campaign: "vic-1" });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ reason: "unsubscribe-email", campaign: "vic-1" });
    expect(prefer(calls[0].init)).toContain("resolution=ignore-duplicates");
  });

  it("never lets a bounce overwrite an existing opt-out", async () => {
    const calls = capture();
    await recordUnsubscribe("https://db.test", "k", "old@acme.com.au", { reason: "bounce-unknown" });
    expect(JSON.parse(String(calls[0].init?.body))).toMatchObject({ reason: "bounce-unknown" });
    expect(prefer(calls[0].init)).toContain("resolution=ignore-duplicates");
  });
});

describe("fetchSuppressedDomains — opt-outs only", () => {
  it("asks only for the opt-out reasons, so a bounce never mutes an organisation", async () => {
    const calls = capture([]);
    await fetchSuppressedDomains("https://db.test", "k", ["info@acme.com.au"]);
    expect(OPT_OUT_REASONS).toEqual(["unsubscribe", "unsubscribe-email"]);
    expect(decodeURIComponent(calls[0].url)).toContain("reason=in.(unsubscribe,unsubscribe-email)");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/portal/suppressionReasons.test.ts`
Expected: FAIL — `OPT_OUT_REASONS` is not exported / the reason filter is absent.

- [ ] **Step 3: Implement in `lib/portal/server.ts`**

Add to the imports at the top:
```ts
import { REASON_EMAILED_UNSUBSCRIBE } from "@/lib/replies/types";
```

Directly above `export async function recordUnsubscribe(`, add:
```ts
/**
 * The suppression reasons that are OPT-OUTS: a click on the portal link, or an
 * email to outreach@ asking to be removed. Only these roll up to the whole
 * organisation (fetchSuppressedDomains). A bounce row blocks its one dead
 * address and nothing else — `oldstaff@school` bouncing must not mute a live
 * `info@school`.
 */
export const OPT_OUT_REASONS = ["unsubscribe", REASON_EMAILED_UNSUBSCRIBE] as const;
```

Replace the body of `recordUnsubscribe` from its signature down to the `fetch` call's headers. The current code:
```ts
export async function recordUnsubscribe(
  base: string,
  key: string,
  email: string,
  ctx?: { leadId?: string | null; campaign?: string | null },
): Promise<"ok" | "needs_migration" | "error"> {
  const addr = email.trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return "error";
  const row = {
    email: addr,
    lead_id: ctx?.leadId && isUuid(ctx.leadId) ? ctx.leadId : null,
    campaign: ctx?.campaign ? ctx.campaign.slice(0, MAX_CAMPAIGN_LEN) : null,
    reason: "unsubscribe",
  };
  try {
    // Upsert so a second click can't 409 on the unique index.
    const res = await fetch(
      `${base}/rest/v1/email_suppression?on_conflict=email`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: "resolution=merge-duplicates,return=minimal",
        },
```
becomes:
```ts
export async function recordUnsubscribe(
  base: string,
  key: string,
  email: string,
  ctx?: { leadId?: string | null; campaign?: string | null; reason?: string },
): Promise<"ok" | "needs_migration" | "error"> {
  const addr = email.trim().toLowerCase();
  if (!EMAIL_RE.test(addr)) return "error";
  const reason = ctx?.reason ?? "unsubscribe";
  const row = {
    email: addr,
    lead_id: ctx?.leadId && isUuid(ctx.leadId) ? ctx.leadId : null,
    campaign: ctx?.campaign ? ctx.campaign.slice(0, MAX_CAMPAIGN_LEN) : null,
    reason,
  };
  // A portal click merges, so a second click can't 409 on the unique index
  // (an opt-out always wins). Every other reason — an emailed opt-out, a bounce
  // from /api/inbound/replies — only ever ADDS a row: a bounce overwriting an
  // existing opt-out would silently drop that organisation out of the domain
  // rollup.
  const resolution = reason === "unsubscribe" ? "merge-duplicates" : "ignore-duplicates";
  try {
    const res = await fetch(
      `${base}/rest/v1/email_suppression?on_conflict=email`,
      {
        method: "POST",
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          "Content-Type": "application/json",
          Prefer: `resolution=${resolution},return=minimal`,
        },
```

In `fetchSuppressedDomains`, the query line:
```ts
    const res = await fetch(
      `${base}/rest/v1/email_suppression?select=email&or=${encodeURIComponent(or)}`,
```
becomes:
```ts
    // Opt-outs only (OPT_OUT_REASONS): a bounce is a dead ADDRESS, never a
    // request from the organisation.
    const res = await fetch(
      `${base}/rest/v1/email_suppression?select=email&reason=in.(${OPT_OUT_REASONS.join(",")})&or=${encodeURIComponent(or)}`,
```

- [ ] **Step 4: Update the reason list in `supabase/suppress-bounces.sql`**

Replace:
```sql
-- `reason` is free text; keep to these so the log stays greppable:
--   bounce-policy   550 5.7.x — recipient gateway policy/reputation rejection
--   bounce-unknown  550 5.1.1 — no such user (list-quality problem)
--   bounce-full     552 / 5.2.2 — mailbox full
--   unsubscribe     the default, written by /api/portal/unsubscribe
```
with:
```sql
-- `reason` is free text; keep to these so the log stays greppable:
--   bounce-policy      550 5.7.x — recipient gateway policy/reputation rejection
--   bounce-unknown     550 5.1.1 — no such user (list-quality problem); also
--                      written automatically by /api/inbound/replies
--   bounce-full        552 / 5.2.2 — mailbox full
--   unsubscribe        the default, written by /api/portal/unsubscribe
--   unsubscribe-email  an opt-out emailed to outreach@, written by /api/inbound/replies
--
-- Only the two unsubscribe reasons roll up to the whole organisation
-- (fetchSuppressedDomains / OPT_OUT_REASONS). A bounce blocks its exact address
-- and nothing else.
```

- [ ] **Step 5: Run the new and existing suppression tests**

Run: `npx vitest run lib/portal`
Expected: PASS — `suppressionReasons.test.ts` and the existing `domainSuppression.test.ts` (its stubs answer every URL, so the added filter doesn't change them).

- [ ] **Step 6: Type-check and leave uncommitted**

Run: `npx tsc --noEmit` — no errors.

---

### Task 5: Migration and the replies data layer

**Files:**
- Create: `supabase/email-replies.sql`
- Create: `lib/replies/server.ts`
- Test: `lib/replies/server.test.ts`

**Interfaces:**
- Consumes: `isUuid` (`lib/pipeline/server.ts`); `isMissingPortalTable`, `readAllRows` (`lib/portal/server.ts`); `LeadCandidate`, `MatchCandidates` (Task 3); `BounceType`, `MatchVia`, `ReplyKind` (Task 1).
- Produces (all in `lib/replies/server.ts`):
  - `interface Sb { base: string; key: string }`
  - `interface ReplyRow { gmail_id; thread_id; received_at; from_email; from_name; subject; snippet; kind: ReplyKind; rule; bounce_type: BounceType | null; bounce_code; bounce_recipient; lead_id; campaign; match_via: MatchVia | null; original_to; backfill: boolean }`
  - `type Claim = { state: "inserted" } | { state: "exists"; kind: ReplyKind; processed: boolean } | { state: "missing" } | { state: "error" }`
  - `claimReply(sb: Sb, row: ReplyRow): Promise<Claim>`
  - `finishReply(sb: Sb, gmailId: string, actions: string[]): Promise<boolean>`
  - `interface CandidateQuery { threadAddress: string | null; sender: string | null; senderDomain: string | null; receivedAt: string }`
  - `readMatchCandidates(sb: Sb, q: CandidateQuery): Promise<MatchCandidates | "error">`
  - `readHumanReplies(sb: Sb, leadIds: string[]): Promise<Map<string, string> | "missing" | "error">` — lead id → latest human reply time.

- [ ] **Step 1: Write the migration** (hand-run by Kane; no test)

`supabase/email-replies.sql`:
```sql
-- Reply detection (docs/superpowers/specs/2026-09-28-reply-detection-design.md).
-- One row per inbound Gmail message on outreach@, written by
-- /api/inbound/replies when n8n's "APMG Reply Capture" workflow forwards it.
--
-- HOW TO RUN
--   Supabase dashboard -> SQL Editor -> New query -> paste -> Run.
--   Idempotent — safe to re-run.
--
-- Server-only: RLS on with no policies, so only the service role can read/write.
--
-- kind:
--   human        a real reply to our outreach — counted on the PDF report,
--                stops follow-ups, keeps the lead out of later cold sends
--   auto_reply   out-of-office, ticket acknowledgements, newsletters — ignored
--   bounce       delivery failure; bounce_type hard (suppressed as
--                'bounce-unknown'), policy or soft (recorded only)
--   unsubscribe  an emailed opt-out — suppressed as 'unsubscribe-email'
--   internal     from our own domains — ignored
--   unmatched    looked human but linked to nothing we sent — ignored
-- `rule` names the classifier rule that decided the kind; `actions` lists what
-- the route did. processed_at null = stored but not finished — the next
-- delivery of the same message resumes it.

create table if not exists public.email_replies (
  id               uuid primary key default gen_random_uuid(),
  gmail_id         text not null unique,
  thread_id        text,
  received_at      timestamptz not null,
  from_email       text not null,
  from_name        text,
  subject          text,
  snippet          text,          -- new text only, <= 500 chars
  kind             text not null
                   check (kind in ('human','auto_reply','bounce','unsubscribe','internal','unmatched')),
  rule             text not null,
  bounce_type      text check (bounce_type in ('hard','policy','soft')),
  bounce_code      text,
  bounce_recipient text,
  -- set null, not cascade: a reply stays counted after its lead's folder is deleted
  lead_id          uuid references public.leads(id) on delete set null,
  campaign         text,
  match_via        text check (match_via in ('thread','sender','domain')),
  original_to      text,
  backfill         boolean not null default false,
  actions          text[] not null default '{}',
  processed_at     timestamptz,
  created_at       timestamptz not null default now()
);

create index if not exists email_replies_received_idx on public.email_replies (received_at);
create index if not exists email_replies_lead_kind_idx on public.email_replies (lead_id, kind);

alter table public.email_replies enable row level security;

-- Domain-tier matching: leads holding any address at an organisation domain.
-- PostgREST can't filter a text[] by suffix, so the route calls this through
-- /rest/v1/rpc/leads_by_email_domain. The domain arrives validated to
-- [a-z0-9.-] (organisationDomain), so LIKE has no wildcards to worry about.
create or replace function public.leads_by_email_domain(p_domain text)
returns table (id uuid, name text)
language sql stable
as $$
  select l.id, l.name
    from public.leads l
   where exists (select 1 from unnest(l.emails) e where lower(e) like '%@' || lower(p_domain))
   limit 50
$$;

-- Never callable with the public anon key (it would enumerate leads); the
-- service role keeps its grant.
revoke execute on function public.leads_by_email_domain(text) from public, anon, authenticated;

-- Check what landed:
--   select received_at, kind, rule, from_email, campaign, left(snippet, 80)
--     from public.email_replies order by received_at desc limit 50;
```

- [ ] **Step 2: Write the failing data-layer tests**

`lib/replies/server.test.ts`:
```ts
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

import { claimReply, finishReply, readHumanReplies, readMatchCandidates, type ReplyRow } from "./server";

const SB = { base: "https://sb.test", key: "k" };
const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";

type Handler = (url: string, init?: RequestInit) => Response;
function stub(routes: Array<[RegExp, Handler]>) {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  vi.spyOn(globalThis, "fetch").mockImplementation(async (input, init) => {
    const url = decodeURIComponent(String(input));
    calls.push({ url, init });
    for (const [re, handler] of routes) if (re.test(url)) return handler(url, init);
    return new Response("[]", { status: 200 });
  });
  return calls;
}
const json = (body: unknown, status = 200): Handler => () => new Response(JSON.stringify(body), { status });
const missing: Handler = () => new Response('{"code":"PGRST205","message":"Could not find the table"}', { status: 404 });

afterEach(() => vi.restoreAllMocks());

const ROW: ReplyRow = {
  gmail_id: "g1",
  thread_id: "t1",
  received_at: "2026-09-28T01:00:00.000Z",
  from_email: "jane@acme.com.au",
  from_name: "Jane Smith",
  subject: "Re: Maintenance",
  snippet: "Yes please",
  kind: "human",
  rule: "default:human",
  bounce_type: null,
  bounce_code: null,
  bounce_recipient: null,
  lead_id: L1,
  campaign: "vic-1",
  match_via: "thread",
  original_to: "jane@acme.com.au",
  backfill: false,
};

describe("claimReply", () => {
  it("reports a fresh insert, asking PostgREST to ignore a duplicate", async () => {
    const calls = stub([[/email_replies\?on_conflict=gmail_id/, json([{ id: "r1" }], 201)]]);
    expect(await claimReply(SB, ROW)).toEqual({ state: "inserted" });
    expect((calls[0].init?.headers as Record<string, string>).Prefer).toBe("resolution=ignore-duplicates,return=representation");
    expect(JSON.parse(String(calls[0].init?.body))).toEqual([ROW]);
  });

  it("reports an already-processed duplicate with its stored kind", async () => {
    stub([
      [/on_conflict=gmail_id/, json([], 201)],
      [/gmail_id=eq\.g1&select=kind,processed_at/, json([{ kind: "auto_reply", processed_at: "2026-09-28T00:00:00Z" }])],
    ]);
    expect(await claimReply(SB, ROW)).toEqual({ state: "exists", kind: "auto_reply", processed: true });
  });

  it("reports an unprocessed duplicate so the caller resumes it", async () => {
    stub([
      [/on_conflict=gmail_id/, json([], 201)],
      [/gmail_id=eq\.g1&select=kind,processed_at/, json([{ kind: "human", processed_at: null }])],
    ]);
    expect(await claimReply(SB, ROW)).toEqual({ state: "exists", kind: "human", processed: false });
  });

  it("reports a missing table and a failed insert", async () => {
    stub([[/on_conflict/, missing]]);
    expect(await claimReply(SB, ROW)).toEqual({ state: "missing" });
    vi.restoreAllMocks();
    stub([[/on_conflict/, json({ message: "boom" }, 500)]]);
    expect(await claimReply(SB, ROW)).toEqual({ state: "error" });
  });
});

describe("finishReply", () => {
  it("patches the row's actions and processed_at", async () => {
    // 204 must carry a null body — `new Response("null", { status: 204 })` throws.
    const calls = stub([[/email_replies\?gmail_id=eq\.g1/, () => new Response(null, { status: 204 })]]);
    expect(await finishReply(SB, "g1", ["alert"])).toBe(true);
    expect(calls[0].init?.method).toBe("PATCH");
    const body = JSON.parse(String(calls[0].init?.body));
    expect(body.actions).toEqual(["alert"]);
    expect(typeof body.processed_at).toBe("string");
  });

  it("reports a failed patch", async () => {
    stub([[/email_replies\?gmail_id=eq\.g1/, json({ message: "boom" }, 500)]]);
    expect(await finishReply(SB, "g1", [])).toBe(false);
  });
});

describe("readMatchCandidates", () => {
  it("tries the address with its stored casing and lowercased, and attaches each lead's sends", async () => {
    const calls = stub([
      [/leads\?select=id,name&emails=cs\.\{"Info@Acme\.com\.au"\}/, json([{ id: L1, name: "Acme Childcare" }])],
      [/leads\?select=id,name&emails=cs\.\{"info@acme\.com\.au"\}/, json([{ id: L1, name: "Acme Childcare" }])],
      [/rpc\/leads_by_email_domain\?p_domain=acme\.com\.au/, json([{ id: L2, name: "Acme Group" }])],
      [
        /portal_events\?select=lead_id,campaign,created_at&event=eq\.email_sent/,
        json([
          { lead_id: L1, campaign: "vic-1", created_at: "2026-09-20T00:00:00Z" },
          { lead_id: L2, campaign: null, created_at: "2026-09-21T00:00:00Z" },
        ]),
      ],
    ]);
    const out = await readMatchCandidates(SB, {
      threadAddress: "Info@Acme.com.au",
      sender: null,
      senderDomain: "acme.com.au",
      receivedAt: "2026-09-28T01:00:00.000Z",
    });
    expect(out).toEqual({
      thread: [{ id: L1, business: "Acme Childcare", sends: [{ at: "2026-09-20T00:00:00Z", campaign: "vic-1" }] }],
      sender: [],
      domain: [{ id: L2, business: "Acme Group", sends: [{ at: "2026-09-21T00:00:00Z", campaign: null }] }],
    });
    expect(calls.find((c) => c.url.includes("portal_events"))?.url).toContain("created_at=lte.2026-09-28T01:00:00.000Z");
  });

  it("treats a missing domain function as no domain candidates", async () => {
    stub([[/rpc\/leads_by_email_domain/, missing]]);
    const out = await readMatchCandidates(SB, { threadAddress: null, sender: null, senderDomain: "acme.com.au", receivedAt: "2026-09-28T01:00:00.000Z" });
    expect(out).toEqual({ thread: [], sender: [], domain: [] });
  });

  it("reports an error when the leads read fails", async () => {
    stub([[/leads\?select=id,name/, json({ message: "boom" }, 500)]]);
    const out = await readMatchCandidates(SB, { threadAddress: "a@b.com", sender: null, senderDomain: null, receivedAt: "2026-09-28T01:00:00.000Z" });
    expect(out).toBe("error");
  });
});

describe("readHumanReplies", () => {
  it("maps each lead to its latest human reply", async () => {
    const calls = stub([
      [
        /email_replies\?select=lead_id,received_at/,
        json([
          { lead_id: L1, received_at: "2026-09-22T00:00:00Z" },
          { lead_id: L1, received_at: "2026-09-25T00:00:00Z" },
        ]),
      ],
    ]);
    const out = await readHumanReplies(SB, [L1, "not-a-uuid"]);
    expect(out).toEqual(new Map([[L1, "2026-09-25T00:00:00Z"]]));
    expect(calls[0].url).toContain("kind=eq.human");
    expect(calls[0].url).not.toContain("not-a-uuid");
  });

  it("says missing before the migration has run", async () => {
    stub([[/email_replies/, missing]]);
    expect(await readHumanReplies(SB, [L1])).toBe("missing");
  });

  it("asks nothing for no leads", async () => {
    const calls = stub([]);
    expect(await readHumanReplies(SB, [])).toEqual(new Map());
    expect(calls).toHaveLength(0);
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run lib/replies/server.test.ts`
Expected: FAIL — `Failed to resolve import "./server"`.

- [ ] **Step 4: Implement `lib/replies/server.ts`**

```ts
import "server-only";
import { isUuid } from "@/lib/pipeline/server";
import { isMissingPortalTable, readAllRows } from "@/lib/portal/server";
import type { LeadCandidate, MatchCandidates } from "./match";
import type { BounceType, MatchVia, ReplyKind } from "./types";

/**
 * Server-only data layer for reply detection: plain PostgREST calls with the
 * service-role key, the same idiom as lib/followups/server.ts. The decisions
 * live in classify.ts / match.ts; this file only reads and writes.
 */

export interface Sb {
  base: string;
  key: string;
}

const TABLE = "email_replies";
const SENT_EVENT = "email_sent";
/** Leads one address or domain lookup may return. More duplicates than this
 *  sharing one address is a data problem, not a reply to match. */
const MAX_CANDIDATES = 50;
/** uuids per in.() list — keeps request URLs short. */
const CHUNK = 200;

/** One email_replies row as the ingest route writes it (supabase/email-replies.sql). */
export interface ReplyRow {
  gmail_id: string;
  thread_id: string | null;
  received_at: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  snippet: string | null;
  kind: ReplyKind;
  rule: string;
  bounce_type: BounceType | null;
  bounce_code: string | null;
  bounce_recipient: string | null;
  lead_id: string | null;
  campaign: string | null;
  match_via: MatchVia | null;
  original_to: string | null;
  backfill: boolean;
}

export type Claim =
  | { state: "inserted" }
  | { state: "exists"; kind: ReplyKind; processed: boolean }
  | { state: "missing" }
  | { state: "error" };

function headers(key: string, extra?: Record<string, string>): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}`, ...extra };
}

type Got = { ok: true; rows: unknown[] } | { ok: false; missing: boolean };

async function get(sb: Sb, pathAndQuery: string): Promise<Got> {
  try {
    const res = await fetch(`${sb.base}/rest/v1/${pathAndQuery}`, { headers: headers(sb.key), cache: "no-store" });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      const missing = isMissingPortalTable(res.status, detail);
      if (!missing) console.error(`[replies] ${pathAndQuery.split("?")[0]} ${res.status}:`, detail.slice(0, 300));
      return { ok: false, missing };
    }
    const rows = await res.json().catch(() => null);
    return { ok: true, rows: Array.isArray(rows) ? rows : [] };
  } catch (e) {
    console.error("[replies] read failed:", e);
    return { ok: false, missing: false };
  }
}

/**
 * Insert the row, or report the one already stored for this Gmail message.
 * The unique gmail_id is what makes n8n retries and a re-run backfill safe:
 * ignore-duplicates answers an empty array for a message we already hold.
 */
export async function claimReply(sb: Sb, row: ReplyRow): Promise<Claim> {
  try {
    const res = await fetch(`${sb.base}/rest/v1/${TABLE}?on_conflict=gmail_id`, {
      method: "POST",
      headers: headers(sb.key, {
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=representation",
      }),
      body: JSON.stringify([row]),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      if (isMissingPortalTable(res.status, detail)) return { state: "missing" };
      console.error(`[replies] insert ${res.status}:`, detail.slice(0, 500));
      return { state: "error" };
    }
    const inserted = await res.json().catch(() => null);
    if (Array.isArray(inserted) && inserted.length > 0) return { state: "inserted" };
  } catch (e) {
    console.error("[replies] insert failed:", e);
    return { state: "error" };
  }
  const got = await get(sb, `${TABLE}?gmail_id=eq.${encodeURIComponent(row.gmail_id)}&select=kind,processed_at&limit=1`);
  if (!got.ok) return got.missing ? { state: "missing" } : { state: "error" };
  const existing = got.rows[0] as { kind?: unknown; processed_at?: unknown } | undefined;
  if (!existing || typeof existing.kind !== "string") return { state: "error" };
  return { state: "exists", kind: existing.kind as ReplyKind, processed: typeof existing.processed_at === "string" };
}

/** Record what was done and mark the row finished. */
export async function finishReply(sb: Sb, gmailId: string, actions: string[]): Promise<boolean> {
  try {
    const res = await fetch(`${sb.base}/rest/v1/${TABLE}?gmail_id=eq.${encodeURIComponent(gmailId)}`, {
      method: "PATCH",
      headers: headers(sb.key, { "Content-Type": "application/json", Prefer: "return=minimal" }),
      body: JSON.stringify({ actions, processed_at: new Date().toISOString() }),
    });
    if (res.ok) return true;
    console.error(`[replies] finish ${res.status}:`, (await res.text().catch(() => "")).slice(0, 300));
    return false;
  } catch (e) {
    console.error("[replies] finish failed:", e);
    return false;
  }
}

export interface CandidateQuery {
  /** the address our original email went to, casing as written in the header */
  threadAddress: string | null;
  sender: string | null;
  /** organisationDomain(sender) — null for shared providers and school domains */
  senderDomain: string | null;
  receivedAt: string;
}

type Lead = { id: string; name: string | null };

function toLeads(rows: unknown[]): Lead[] {
  const out: Lead[] = [];
  for (const r of rows as Array<{ id?: unknown; name?: unknown }>) {
    if (!isUuid(r.id)) continue;
    out.push({ id: r.id, name: typeof r.name === "string" && r.name.trim() ? r.name.trim() : null });
  }
  return out;
}

/** Leads whose `emails` array holds this address. The To header carries the
 *  stored casing, so the exact string is tried first, then lowercase. */
async function leadsHolding(sb: Sb, address: string): Promise<Lead[] | "error"> {
  const variants = [...new Set([address.trim(), address.trim().toLowerCase()])].filter(Boolean);
  const out = new Map<string, Lead>();
  for (const v of variants) {
    // A Postgres array literal with the element quoted: {"a@b.com"}
    const literal = `{"${v.replace(/["\\{}]/g, "")}"}`;
    const got = await get(sb, `leads?select=id,name&emails=cs.${encodeURIComponent(literal)}&limit=${MAX_CANDIDATES}`);
    if (!got.ok) return "error";
    for (const l of toLeads(got.rows)) out.set(l.id, l);
  }
  return [...out.values()];
}

/** Leads holding any address at an organisation domain (supabase/email-replies.sql).
 *  A missing function reads as no candidates — matching still has two tiers. */
async function leadsAtDomain(sb: Sb, domain: string): Promise<Lead[] | "error"> {
  const got = await get(sb, `rpc/leads_by_email_domain?p_domain=${encodeURIComponent(domain)}`);
  if (!got.ok) return got.missing ? [] : "error";
  return toLeads(got.rows);
}

/** Each lead's email_sent rows at or before the message. */
async function readSends(
  sb: Sb,
  ids: string[],
  receivedAt: string,
): Promise<Map<string, LeadCandidate["sends"]> | "error"> {
  const out = new Map<string, LeadCandidate["sends"]>();
  const valid = ids.filter(isUuid);
  for (let i = 0; i < valid.length; i += CHUNK) {
    const list = valid.slice(i, i + CHUNK);
    let read: Awaited<ReturnType<typeof readAllRows>>;
    try {
      read = await readAllRows(
        sb.base,
        sb.key,
        `portal_events?select=lead_id,campaign,created_at&event=eq.${SENT_EVENT}&lead_id=in.(${list.join(",")})` +
          `&created_at=lte.${encodeURIComponent(receivedAt)}&order=created_at.asc,id.asc`,
      );
    } catch (e) {
      console.error("[replies] send-history read failed:", e);
      return "error";
    }
    if (!read.ok) {
      console.error(`[replies] send-history read ${read.status}:`, read.detail.slice(0, 300));
      return "error";
    }
    for (const r of read.rows as Array<{ lead_id?: unknown; campaign?: unknown; created_at?: unknown }>) {
      if (!isUuid(r.lead_id) || typeof r.created_at !== "string") continue;
      const sends = out.get(r.lead_id) ?? [];
      sends.push({ at: r.created_at, campaign: typeof r.campaign === "string" && r.campaign ? r.campaign : null });
      out.set(r.lead_id, sends);
    }
  }
  return out;
}

/** Every candidate lead for the three matching tiers, with its send history. */
export async function readMatchCandidates(sb: Sb, q: CandidateQuery): Promise<MatchCandidates | "error"> {
  const [thread, sender, domain] = await Promise.all([
    q.threadAddress ? leadsHolding(sb, q.threadAddress) : Promise.resolve<Lead[]>([]),
    q.sender ? leadsHolding(sb, q.sender) : Promise.resolve<Lead[]>([]),
    q.senderDomain ? leadsAtDomain(sb, q.senderDomain) : Promise.resolve<Lead[]>([]),
  ]);
  if (thread === "error" || sender === "error" || domain === "error") return "error";
  const ids = [...new Set([...thread, ...sender, ...domain].map((l) => l.id))];
  const sends = await readSends(sb, ids, q.receivedAt);
  if (sends === "error") return "error";
  const withSends = (list: Lead[]): LeadCandidate[] =>
    list.map((l) => ({ id: l.id, business: l.name, sends: sends.get(l.id) ?? [] }));
  return { thread: withSends(thread), sender: withSends(sender), domain: withSends(domain) };
}

/**
 * Lead id → the time of its latest HUMAN reply, for the given leads. Read by
 * follow-up eligibility and by deliverCampaign. "missing" before
 * supabase/email-replies.sql has run — both callers treat that as "no replies".
 */
export async function readHumanReplies(sb: Sb, leadIds: string[]): Promise<Map<string, string> | "missing" | "error"> {
  const ids = [...new Set(leadIds.filter(isUuid))];
  const out = new Map<string, string>();
  for (let i = 0; i < ids.length; i += CHUNK) {
    const list = ids.slice(i, i + CHUNK);
    let read: Awaited<ReturnType<typeof readAllRows>>;
    try {
      read = await readAllRows(
        sb.base,
        sb.key,
        `${TABLE}?select=lead_id,received_at&kind=eq.human&lead_id=in.(${list.join(",")})&order=received_at.asc,id.asc`,
      );
    } catch (e) {
      console.error("[replies] human-reply read failed:", e);
      return "error";
    }
    if (!read.ok) {
      if (isMissingPortalTable(read.status, read.detail)) return "missing";
      console.error(`[replies] human-reply read ${read.status}:`, read.detail.slice(0, 300));
      return "error";
    }
    // Ascending, so the last row seen for a lead is its latest reply.
    for (const r of read.rows as Array<{ lead_id?: unknown; received_at?: unknown }>) {
      if (isUuid(r.lead_id) && typeof r.received_at === "string") out.set(r.lead_id, r.received_at);
    }
  }
  return out;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/replies/server.test.ts`
Expected: PASS.

- [ ] **Step 6: Type-check and leave uncommitted**

Run: `npx tsc --noEmit` — no errors.

---

### Task 6: Alert text, the ingest route, and the proxy exemption

**Files:**
- Create: `lib/replies/alert.ts`
- Test: `lib/replies/alert.test.ts`
- Create: `app/api/inbound/replies/route.ts`
- Test: `app/api/inbound/replies/route.test.ts`
- Modify: `proxy.ts` (`isPublicAdminPath`, ~line 59)
- Modify: `.env.local.example` (append)

**Interfaces:**
- Consumes: everything from Tasks 1–5; `readSetting`, `SETTING_ENQUIRY_NOTIFY_EMAIL`, `supabaseTarget` (`lib/pipeline/server.ts`); `organisationDomain`, `recordUnsubscribe` (`lib/portal/server.ts`).
- Produces:
  - `buildAlert(a: AlertInput): ReplyAlert` where `AlertInput = { notifyTo: string; business: string | null; fromName: string | null; fromEmail: string; campaign: string | null; receivedAt: string; subject: string; newText: string }`.
  - `POST /api/inbound/replies` answering `IngestResponse` (Task 1).

- [ ] **Step 1: Write the failing alert tests**

`lib/replies/alert.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { buildAlert } from "./alert";

const BASE = {
  notifyTo: "sales@apmgservices.com.au, george@apmgservices.com.au",
  business: "Acme Childcare",
  fromName: "Jane Smith",
  fromEmail: "jane@acme.com.au",
  campaign: "vic-2026-09",
  receivedAt: "2026-09-28T01:00:00.000Z",
  subject: "Re: Maintenance for Acme Childcare",
  newText: "Yes, send a quote please.",
};

describe("buildAlert", () => {
  it("addresses the notification list and names the business, sender and campaign", () => {
    const a = buildAlert(BASE);
    expect(a.to).toBe(BASE.notifyTo);
    expect(a.subject).toBe("Reply from Acme Childcare — vic-2026-09");
    expect(a.text).toContain("From:      Jane Smith <jane@acme.com.au>");
    expect(a.text).toContain("Campaign:  vic-2026-09");
    expect(a.text).toContain("Yes, send a quote please.");
  });

  it("formats the received time in Melbourne", () => {
    expect(buildAlert(BASE).text).toMatch(/Received:\s+28 Sept? 2026, 11:00/i);
  });

  it("falls back to the sender's name when no business is known", () => {
    expect(buildAlert({ ...BASE, business: null, campaign: null }).subject).toBe("Reply from Jane Smith");
  });

  it("says so when the reply has no new text", () => {
    expect(buildAlert({ ...BASE, newText: "   " }).text).toContain("(No new text — open the full email in the outreach@ inbox.)");
  });

  it("keeps the subject on one line", () => {
    expect(buildAlert({ ...BASE, business: "Acme\r\nBcc: x@evil.test" }).subject).not.toMatch(/[\r\n]/);
  });

  it("clips a long reply to 1,000 characters", () => {
    const a = buildAlert({ ...BASE, newText: "x".repeat(5000) });
    expect(a.text).toContain(`${"x".repeat(999)}…`);
    expect(a.text).not.toContain("x".repeat(1000));
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/replies/alert.test.ts`
Expected: FAIL — `Failed to resolve import "./alert"`.

- [ ] **Step 3: Implement `lib/replies/alert.ts`**

```ts
import { ALERT_TEXT_LEN, type ReplyAlert } from "./types";

/**
 * The internal alert for a human reply — sent by n8n's "APMG Reply Capture"
 * workflow through the outreach@ Gmail, to the enquiry notification list.
 * Plain text on purpose: it is a nudge to go and answer, not a document.
 */

export interface AlertInput {
  /** the enquiry notification list (comma-separated, as stored) */
  notifyTo: string;
  business: string | null;
  fromName: string | null;
  fromEmail: string;
  campaign: string | null;
  receivedAt: string;
  subject: string;
  /** the reply's new text (above the quote) */
  newText: string;
}

/** Header values must stay on one line — a CR/LF in a business name must not
 *  become a header of its own. */
const oneLine = (s: string) => s.replace(/[\r\n]+/g, " ").trim();

function clip(s: string, max: number): string {
  return s.length <= max ? s : `${s.slice(0, max - 1).trimEnd()}…`;
}

export function buildAlert(a: AlertInput): ReplyAlert {
  const who = oneLine(a.business ?? a.fromName ?? a.fromEmail);
  const when = new Date(a.receivedAt).toLocaleString("en-AU", {
    timeZone: "Australia/Melbourne",
    dateStyle: "medium",
    timeStyle: "short",
  });
  const said = a.newText.trim()
    ? clip(a.newText.trim(), ALERT_TEXT_LEN)
    : "(No new text — open the full email in the outreach@ inbox.)";
  return {
    to: a.notifyTo,
    subject: clip(oneLine(`Reply from ${who}${a.campaign ? ` — ${a.campaign}` : ""}`), 200),
    text: [
      `${who} replied to an outreach email.`,
      "",
      `Business:  ${a.business ? oneLine(a.business) : "Not matched to a lead"}`,
      `From:      ${a.fromName ? `${oneLine(a.fromName)} <${a.fromEmail}>` : a.fromEmail}`,
      `Campaign:  ${a.campaign ?? "—"}`,
      `Received:  ${when}`,
      `Subject:   ${oneLine(a.subject) || "(no subject)"}`,
      "",
      "What they wrote:",
      said,
      "",
      "Reply from the outreach@apmgmaintenance.com.au mailbox so the conversation stays in one thread.",
    ].join("\n"),
  };
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/replies/alert.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Write the failing route tests**

`app/api/inbound/replies/route.test.ts`:
```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const readSetting = vi.fn();
vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return {
    ...actual,
    supabaseTarget: () => ({ state: "ok", base: "https://sb.test", key: "k" }),
    readSetting: (...a: unknown[]) => readSetting(...a),
  };
});

// organisationDomain stays REAL — the shared-domain case below depends on it.
const recordUnsubscribe = vi.fn();
vi.mock("@/lib/portal/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/portal/server")>();
  return { ...actual, recordUnsubscribe: (...a: unknown[]) => recordUnsubscribe(...a) };
});

const claimReply = vi.fn();
const finishReply = vi.fn();
const readMatchCandidates = vi.fn();
vi.mock("@/lib/replies/server", () => ({
  claimReply: (...a: unknown[]) => claimReply(...a),
  finishReply: (...a: unknown[]) => finishReply(...a),
  readMatchCandidates: (...a: unknown[]) => readMatchCandidates(...a),
}));

import { POST } from "./route";

const LEAD = "11111111-1111-4111-8111-111111111111";
const SECRET = "s3cret";
const CANDIDATE = { id: LEAD, business: "Acme Childcare", sends: [{ at: "2026-09-21T00:00:00.000Z", campaign: "vic-2026-09" }] };
const NOTIFY = "sales@apmgservices.com.au, george@apmgservices.com.au";

function body(over: Record<string, unknown> = {}) {
  return {
    gmailId: "g1",
    threadId: "t1",
    receivedAt: "2026-09-28T01:00:00.000Z",
    from: "Jane Smith <jane@acme.com.au>",
    subject: "Re: Maintenance for Acme Childcare",
    headers: {},
    text: "Yes, send a quote please.",
    originalTo: "jane@acme.com.au",
    originalSentAt: "2026-09-21T00:00:00.000Z",
    backfill: false,
    ...over,
  };
}

function req(b: unknown, secret: string | null = SECRET): Request {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (secret !== null) headers["x-apmg-secret"] = secret;
  return new Request("http://local/api/inbound/replies", {
    method: "POST",
    headers,
    body: typeof b === "string" ? b : JSON.stringify(b),
  });
}

async function call(b: unknown, secret?: string | null) {
  const res = await POST(req(b, secret));
  return { status: res.status, data: await res.json() };
}

const claimedRow = () => claimReply.mock.calls[0][1] as Record<string, unknown>;

beforeEach(() => {
  vi.clearAllMocks();
  process.env.N8N_WEBHOOK_SECRET = SECRET;
  readSetting.mockResolvedValue(NOTIFY);
  readMatchCandidates.mockResolvedValue({ thread: [CANDIDATE], sender: [], domain: [] });
  claimReply.mockResolvedValue({ state: "inserted" });
  finishReply.mockResolvedValue(true);
  recordUnsubscribe.mockResolvedValue("ok");
});
afterEach(() => {
  delete process.env.N8N_WEBHOOK_SECRET;
});

describe("POST /api/inbound/replies — who may call it", () => {
  it("refuses everything while N8N_WEBHOOK_SECRET is unset", async () => {
    delete process.env.N8N_WEBHOOK_SECRET;
    expect((await call(body())).status).toBe(503);
    expect(claimReply).not.toHaveBeenCalled();
  });

  it("401s a wrong or missing secret", async () => {
    expect((await call(body(), "nope")).status).toBe(401);
    expect((await call(body(), null)).status).toBe(401);
  });

  it("400s invalid JSON and an invalid payload", async () => {
    expect((await call("{not json")).status).toBe(400);
    const { status, data } = await call(body({ gmailId: "" }));
    expect(status).toBe(400);
    expect(data.error).toMatch(/gmailId/);
  });
});

describe("POST /api/inbound/replies — human replies", () => {
  it("stores a matched human reply and hands n8n an alert for the notification list", async () => {
    const { status, data } = await call(body());
    expect(status).toBe(200);
    expect(data).toMatchObject({ ok: true, kind: "human", duplicate: false });
    expect(data.alert).toMatchObject({ to: NOTIFY, subject: "Reply from Acme Childcare — vic-2026-09" });
    expect(claimedRow()).toMatchObject({
      gmail_id: "g1",
      kind: "human",
      rule: "default:human",
      lead_id: LEAD,
      campaign: "vic-2026-09",
      match_via: "thread",
      from_email: "jane@acme.com.au",
      from_name: "Jane Smith",
      snippet: "Yes, send a quote please.",
      backfill: false,
    });
    expect(finishReply).toHaveBeenCalledWith(expect.anything(), "g1", ["alert"]);
  });

  it("never alerts during the backfill", async () => {
    const { data } = await call(body({ backfill: true }));
    expect(data.alert).toBeNull();
    expect(finishReply).toHaveBeenCalledWith(expect.anything(), "g1", ["alert-skipped:backfill"]);
  });

  it("stores the reply without an alert when nobody is on the notification list", async () => {
    readSetting.mockResolvedValue(null);
    const { data } = await call(body());
    expect(data).toMatchObject({ ok: true, kind: "human", alert: null });
    expect(finishReply).toHaveBeenCalledWith(expect.anything(), "g1", ["alert-skipped:no-recipients"]);
  });

  it("alerts on a reply with no new text, saying so", async () => {
    const { data } = await call(body({ text: "On Mon, 21 Sep 2026 at 9:00 am, George <outreach@apmgmaintenance.com.au> wrote:\n> Hi" }));
    expect(data.kind).toBe("human");
    expect(data.alert.text).toContain("(No new text");
  });

  it("files a human-looking message that matches no lead as unmatched, without an alert", async () => {
    readMatchCandidates.mockResolvedValue({ thread: [], sender: [], domain: [] });
    const { data } = await call(body());
    expect(data).toMatchObject({ kind: "unmatched", alert: null });
    expect(claimedRow()).toMatchObject({ kind: "unmatched", lead_id: null, match_via: null });
  });

  it("looks the thread address up with its original casing", async () => {
    await call(body({ originalTo: "Info@Acme.com.au" }));
    expect(readMatchCandidates).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ threadAddress: "Info@Acme.com.au" }));
  });

  it("never matches a shared school domain by domain", async () => {
    await call(body({ from: "Office <office.ps@education.vic.gov.au>", originalTo: null }));
    expect(readMatchCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ sender: "office.ps@education.vic.gov.au", senderDomain: null, threadAddress: null }),
    );
  });

  it("asks for the sender's organisation domain otherwise", async () => {
    await call(body({ originalTo: null }));
    expect(readMatchCandidates).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ senderDomain: "acme.com.au" }));
  });
});

describe("POST /api/inbound/replies — the other kinds", () => {
  it("suppresses an emailed unsubscribe from the sender", async () => {
    const { data } = await call(body({ subject: "unsubscribe", text: "" }));
    expect(data).toMatchObject({ kind: "unsubscribe", alert: null });
    expect(recordUnsubscribe).toHaveBeenCalledWith("https://sb.test", "k", "jane@acme.com.au", {
      leadId: LEAD,
      campaign: "vic-2026-09",
      reason: "unsubscribe-email",
    });
    expect(finishReply).toHaveBeenCalledWith(expect.anything(), "g1", ["suppressed:jane@acme.com.au"]);
  });

  it("suppresses a hard bounce's failed address and never searches by the daemon's sender", async () => {
    const { data } = await call(
      body({
        from: "Mail Delivery Subsystem <mailer-daemon@googlemail.com>",
        subject: "Delivery Status Notification (Failure)",
        headers: { "x-failed-recipients": "old.staff@acme.com.au" },
        text: "550 5.1.1 The email account that you tried to reach does not exist.",
        originalTo: "old.staff@acme.com.au",
      }),
    );
    expect(data.kind).toBe("bounce");
    expect(readMatchCandidates).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ threadAddress: "old.staff@acme.com.au", sender: null, senderDomain: null }),
    );
    expect(recordUnsubscribe).toHaveBeenCalledWith("https://sb.test", "k", "old.staff@acme.com.au", expect.objectContaining({ reason: "bounce-unknown" }));
    expect(claimedRow()).toMatchObject({ bounce_type: "hard", bounce_code: "5.1.1", bounce_recipient: "old.staff@acme.com.au" });
  });

  it("records a policy bounce without suppressing anyone", async () => {
    await call(body({ from: "mailer-daemon@googlemail.com", subject: "Returned mail", text: "550 5.7.1 rejected by policy" }));
    expect(recordUnsubscribe).not.toHaveBeenCalled();
    expect(claimedRow()).toMatchObject({ kind: "bounce", bounce_type: "policy" });
  });

  it("files staff mail as internal without reading leads", async () => {
    const { data } = await call(body({ from: "Kane <kane@apmgservices.com.au>" }));
    expect(data.kind).toBe("internal");
    expect(readMatchCandidates).not.toHaveBeenCalled();
  });
});

describe("POST /api/inbound/replies — retries and failures", () => {
  it("does nothing twice for a message already processed", async () => {
    claimReply.mockResolvedValue({ state: "exists", kind: "unsubscribe", processed: true });
    const { data } = await call(body({ subject: "unsubscribe" }));
    expect(data).toEqual({ ok: true, kind: "unsubscribe", duplicate: true, alert: null });
    expect(recordUnsubscribe).not.toHaveBeenCalled();
    expect(finishReply).not.toHaveBeenCalled();
  });

  it("resumes a message stored but never finished", async () => {
    claimReply.mockResolvedValue({ state: "exists", kind: "unsubscribe", processed: false });
    await call(body({ subject: "unsubscribe" }));
    expect(recordUnsubscribe).toHaveBeenCalled();
    expect(finishReply).toHaveBeenCalled();
  });

  it("500s without finishing the row when a suppression write fails, so n8n retries", async () => {
    recordUnsubscribe.mockResolvedValue("error");
    const { status } = await call(body({ subject: "unsubscribe" }));
    expect(status).toBe(500);
    expect(finishReply).not.toHaveBeenCalled();
  });

  it("500s when the row cannot be finished", async () => {
    finishReply.mockResolvedValue(false);
    expect((await call(body())).status).toBe(500);
  });

  it("503s with needsMigration before the table exists", async () => {
    claimReply.mockResolvedValue({ state: "missing" });
    const { status, data } = await call(body());
    expect(status).toBe(503);
    expect(data.needsMigration).toBe(true);
  });

  it("502s when leads cannot be read", async () => {
    readMatchCandidates.mockResolvedValue("error");
    expect((await call(body())).status).toBe(502);
    expect(claimReply).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run app/api/inbound/replies/route.test.ts`
Expected: FAIL — `Failed to resolve import "./route"`.

- [ ] **Step 7: Implement `app/api/inbound/replies/route.ts`**

```ts
import { timingSafeEqual } from "node:crypto";
import { readSetting, SETTING_ENQUIRY_NOTIFY_EMAIL, supabaseTarget } from "@/lib/pipeline/server";
import { organisationDomain, recordUnsubscribe } from "@/lib/portal/server";
import { parseAddress } from "@/lib/replies/address";
import { buildAlert } from "@/lib/replies/alert";
import { classify, finalKind } from "@/lib/replies/classify";
import { matchLead, NO_MATCH, type MatchResult } from "@/lib/replies/match";
import { parseInbound } from "@/lib/replies/payload";
import { claimReply, finishReply, readMatchCandidates, type ReplyRow } from "@/lib/replies/server";
import {
  REASON_EMAILED_UNSUBSCRIBE,
  REASON_HARD_BOUNCE,
  SNIPPET_LEN,
  type IngestResponse,
  type ReplyAlert,
} from "@/lib/replies/types";

// POST /api/inbound/replies — n8n's "APMG Reply Capture" workflow
// (references/APMG Reply Capture.json) posts every new message from the
// outreach@ inbox here, one at a time. This route:
//   1. classifies it (lib/replies/classify.ts) and matches it to a lead and
//      campaign (lib/replies/match.ts)
//   2. stores ONE email_replies row per Gmail message — the unique gmail_id
//      makes n8n retries and a re-run backfill harmless
//   3. acts: an emailed unsubscribe or a hard bounce goes on the suppression
//      list; a human reply comes back with an `alert` for n8n to email to the
//      enquiry notification list (never during the backfill)
//   4. marks the row processed only after every action succeeded, so a failure
//      answers 500, n8n retries, and the retry resumes the unfinished row
// Follow-ups and cold sends need no write here: both read email_replies.
//
// Auth is the shared n8n secret (x-apmg-secret = N8N_WEBHOOK_SECRET), compared
// in constant time. proxy.ts lets exactly this path past the session gate on
// the admin host; the customer host 404s it like every other non-portal API.
// Spec: docs/superpowers/specs/2026-09-28-reply-detection-design.md
export const runtime = "nodejs";

const SECRET_HEADER = "x-apmg-secret";

function secretState(req: Request): "unset" | "bad" | "ok" {
  const expected = process.env.N8N_WEBHOOK_SECRET;
  if (!expected) return "unset";
  const a = Buffer.from(req.headers.get(SECRET_HEADER) ?? "");
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b) ? "ok" : "bad";
}

const reply = (body: IngestResponse, status = 200) => Response.json(body, { status });

export async function POST(req: Request): Promise<Response> {
  const secret = secretState(req);
  if (secret === "unset") {
    // Fail closed: without the secret this endpoint would let anyone suppress
    // addresses or fire alerts.
    console.error("[inbound/replies] N8N_WEBHOOK_SECRET is not set — refusing every request.");
    return reply({ ok: false, error: "Reply capture is not configured on this server." }, 503);
  }
  if (secret === "bad") return reply({ ok: false, error: "Unauthorised." }, 401);

  const sb = supabaseTarget();
  if (sb.state !== "ok") return reply({ ok: false, error: "The database is not configured." }, 503);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return reply({ ok: false, error: "Invalid JSON body." }, 400);
  }
  const parsed = parseInbound(body);
  if (!parsed.ok) return reply({ ok: false, error: parsed.error }, 400);
  const msg = parsed.value;

  const c = classify(msg);
  const sender = parseAddress(msg.from);
  const original = parseAddress(msg.originalTo);

  // Internal mail is never a lead's. A bounce comes from a mail daemon, so only
  // the address it failed on (the thread's, or the one it names) can match.
  let match: MatchResult = NO_MATCH;
  if (c.kind !== "internal") {
    const isBounce = c.kind === "bounce";
    const candidates = await readMatchCandidates(sb, {
      threadAddress: original.original ?? (isBounce ? (c.bounce?.recipient ?? null) : null),
      sender: isBounce ? null : sender.original,
      senderDomain: isBounce || !sender.email ? null : organisationDomain(sender.email),
      receivedAt: msg.receivedAt,
    });
    if (candidates === "error") return reply({ ok: false, error: "Could not read leads to match this message." }, 502);
    match = matchLead(candidates, msg.receivedAt);
  }
  const kind = finalKind(c, match.leadId !== null);

  const row: ReplyRow = {
    gmail_id: msg.gmailId,
    thread_id: msg.threadId,
    received_at: msg.receivedAt,
    from_email: sender.email ?? msg.from.slice(0, 320),
    from_name: sender.name,
    subject: msg.subject || null,
    snippet: c.newText.slice(0, SNIPPET_LEN) || null,
    kind,
    rule: c.rule,
    bounce_type: c.bounce?.type ?? null,
    bounce_code: c.bounce?.code ?? null,
    bounce_recipient: c.bounce?.recipient ?? null,
    lead_id: match.leadId,
    campaign: match.campaign,
    match_via: match.via,
    original_to: original.email,
    backfill: msg.backfill,
  };

  const claim = await claimReply(sb, row);
  if (claim.state === "missing") {
    return reply({ ok: false, error: "Reply tracking isn't set up — run supabase/email-replies.sql.", needsMigration: true }, 503);
  }
  if (claim.state === "error") return reply({ ok: false, error: "Could not store this message." }, 502);
  if (claim.state === "exists" && claim.processed) {
    return reply({ ok: true, kind: claim.kind, duplicate: true, alert: null });
  }

  const actions: string[] = [];

  if (kind === "unsubscribe") {
    if (!sender.email) {
      actions.push("suppress-skipped:no-address");
    } else {
      const r = await recordUnsubscribe(sb.base, sb.key, sender.email, {
        leadId: match.leadId,
        campaign: match.campaign,
        reason: REASON_EMAILED_UNSUBSCRIBE,
      });
      if (r !== "ok") return reply({ ok: false, error: "Could not add this address to the opt-out list." }, 500);
      actions.push(`suppressed:${sender.email}`);
    }
  }

  // Only a HARD bounce is suppressed: a broken DKIM/DMARC on our side would
  // 5.7.x every recipient, and suppressing those would erase the list.
  if (kind === "bounce" && c.bounce?.type === "hard") {
    if (!c.bounce.recipient) {
      actions.push("suppress-skipped:no-recipient");
    } else {
      const r = await recordUnsubscribe(sb.base, sb.key, c.bounce.recipient, {
        leadId: match.leadId,
        campaign: match.campaign,
        reason: REASON_HARD_BOUNCE,
      });
      if (r !== "ok") return reply({ ok: false, error: "Could not suppress the bounced address." }, 500);
      actions.push(`suppressed:${c.bounce.recipient}`);
    }
  }

  let alert: ReplyAlert | null = null;
  if (kind === "human") {
    if (msg.backfill) {
      actions.push("alert-skipped:backfill");
    } else {
      const notifyTo = (await readSetting(SETTING_ENQUIRY_NOTIFY_EMAIL)) ?? "";
      if (!notifyTo) {
        console.warn("[inbound/replies] a human reply arrived but the enquiry notification list is empty — no alert sent.");
        actions.push("alert-skipped:no-recipients");
      } else {
        alert = buildAlert({
          notifyTo,
          business: match.business,
          fromName: sender.name,
          fromEmail: row.from_email,
          campaign: match.campaign,
          receivedAt: msg.receivedAt,
          subject: msg.subject,
          newText: c.newText,
        });
        actions.push("alert");
      }
    }
  }

  if (!(await finishReply(sb, msg.gmailId, actions))) {
    return reply({ ok: false, error: "Could not record what was done with this message." }, 500);
  }
  return reply({ ok: true, kind, duplicate: false, alert });
}
```

- [ ] **Step 8: Let the route past the session gate in `proxy.ts`**

Replace:
```ts
/** Paths reachable on the admin host WITHOUT a session. Everything else needs one. */
function isPublicAdminPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  return isPortalPath(pathname);
}
```
with:
```ts
/** Paths reachable on the admin host WITHOUT a session. Everything else needs one. */
function isPublicAdminPath(pathname: string): boolean {
  if (pathname === "/login") return true;
  if (pathname.startsWith("/api/auth/")) return true;
  // n8n's reply-capture workflow posts here server-to-server; the route
  // authenticates it with the x-apmg-secret header instead of a session.
  // Exact match only — nothing else under /api/inbound gets this pass.
  if (pathname === "/api/inbound/replies") return true;
  return isPortalPath(pathname);
}
```

- [ ] **Step 9: Document the secret in `.env.local.example`**

Append:
```bash

# Shared secret with n8n. Sent as the x-apmg-secret header on every outbound
# webhook, and REQUIRED on inbound POST /api/inbound/replies — reply capture
# refuses every request while this is unset. Must match the Header Auth
# credential on the n8n side.
# N8N_WEBHOOK_SECRET=
```

- [ ] **Step 10: Run the task's tests**

Run: `npx vitest run lib/replies app/api/inbound`
Expected: PASS.

- [ ] **Step 11: Type-check and leave uncommitted**

Run: `npx tsc --noEmit` — no errors.

---

### Task 7: Follow-ups stop on a human reply

**Files:**
- Modify: `lib/followups/eligibility.ts` (`LeadSignals`, `emptySignals`, `classifyLead`)
- Modify: `lib/followups/server.ts` (imports; end of `readSignals`)
- Test: `lib/followups/eligibility.test.ts` (add cases)
- Test: `lib/followups/server.test.ts` (add cases)

**Interfaces:**
- Consumes: `readHumanReplies(sb, leadIds)` (Task 5).
- Produces: `LeadSignals.repliedAt: string | null`; `classifyLead` returns stage `excluded`, reason `"Replied by email — answer them directly"` for a lead with `repliedAt`.

- [ ] **Step 1: Write the failing eligibility tests**

Append inside `describe("classifyLead — who is in the pipeline", …)` in `lib/followups/eligibility.test.ts`:
```ts
  it("excludes a lead that has replied by email, even with a draft waiting", () => {
    const item = classify({ s: { repliedAt: "2026-09-24T03:00:00Z" }, rows: [row({ touch: 1, status: "draft" })] });
    expect(item?.stage).toBe("excluded");
    expect(item?.reason).toBe("Replied by email — answer them directly");
    expect(item?.touch).toBeNull();
  });

  it("still reports an enquiry ahead of a reply", () => {
    expect(classify({ s: { inquiries: 1, repliedAt: "2026-09-24T03:00:00Z" } })?.reason).toMatch(/enquired/i);
  });
```

- [ ] **Step 2: Write the failing signal tests**

Append inside `describe("readSignals", …)` in `lib/followups/server.test.ts`:
```ts
  it("folds the lead's latest human reply into repliedAt", async () => {
    const fetchSpy = stubRest([
      [/portal_events\?select=lead_id,event,props,created_at/, [{ lead_id: LEAD, event: "email_sent", props: {}, created_at: "2026-09-20T00:00:00Z" }]],
      [/email_replies\?select=lead_id,received_at/, [{ lead_id: LEAD, received_at: "2026-09-23T04:00:00Z" }]],
    ]);
    const map = await readSignals(SB, [LEAD]);
    if (map === "error") throw new Error("read failed");
    expect(map.get(LEAD)?.repliedAt).toBe("2026-09-23T04:00:00Z");
    const repliesUrl = fetchSpy.mock.calls.map(([u]) => decodeURIComponent(String(u))).find((u) => u.includes("email_replies"));
    expect(repliesUrl).toContain("kind=eq.human");
  });

  it("reads no replies, not an error, before email_replies exists", async () => {
    stubRest([
      [/portal_events\?select=lead_id,event,props,created_at/, [{ lead_id: LEAD, event: "email_sent", props: {}, created_at: "2026-09-20T00:00:00Z" }]],
      [/email_replies/, 404],
    ]);
    const map = await readSignals(SB, [LEAD]);
    if (map === "error") throw new Error("read failed");
    expect(map.get(LEAD)?.repliedAt).toBeNull();
  });
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run lib/followups`
Expected: FAIL — the replied lead is still classified `ready`, and `repliedAt` reads `undefined` (Vitest doesn't type-check, so the missing field shows up as failed assertions, not a compile error).

- [ ] **Step 4: Implement in `lib/followups/eligibility.ts`**

In `interface LeadSignals`, after `archived: boolean;` add:
```ts
  /** ISO time of the lead's latest HUMAN reply to our outreach (email_replies), or null */
  repliedAt: string | null;
```

In `emptySignals`, after `archived: false,` add:
```ts
    repliedAt: null,
```

In `classifyLead`, directly after
```ts
  if (signals.inquiries > 0) return finish("excluded", "Enquired — Sales owns this lead");
```
add:
```ts
  // Someone who wrote back is a conversation now — a follow-up after "not
  // interested" (or after "yes, call me") is the worst email we could send.
  // The send route re-runs this, so a draft written before the reply is refused.
  if (signals.repliedAt) return finish("excluded", "Replied by email — answer them directly");
```

- [ ] **Step 5: Implement in `lib/followups/server.ts`**

Add to the imports:
```ts
import { readHumanReplies } from "@/lib/replies/server";
```

In `readSignals`, replace the final
```ts
  return map;
}
```
of that function (the one after the chunk loop) with:
```ts
  // Human replies (supabase/email-replies.sql). Before that migration the table
  // is missing and nobody has replied as far as the queue knows.
  const replies = await readHumanReplies(sb, leadIds);
  if (replies === "error") return "error";
  if (replies !== "missing") {
    for (const [leadId, at] of replies) {
      const s = map.get(leadId) ?? emptySignals(leadId);
      s.repliedAt = at;
      map.set(leadId, s);
    }
  }
  return map;
}
```

- [ ] **Step 6: Run the follow-up suites and the routes that use them**

Run: `npx vitest run lib/followups app/api/followups`
Expected: PASS — the existing tests' `stubRest` answers `[]` for the new `email_replies` read.

- [ ] **Step 7: Type-check and leave uncommitted**

Run: `npx tsc --noEmit` — no errors. If any other file builds a `LeadSignals` literal without `emptySignals`, add `repliedAt: null` there (tsc names it).

---

### Task 8: Cold sends skip leads who replied

**Files:**
- Modify: `lib/pipeline/deliver.ts` (imports; `SendResult`; the guard block; both result objects; a helper at the bottom)
- Test: `lib/pipeline/deliver.test.ts` (mock + cases)
- Modify: `app/api/pipeline/campaigns/send/route.test.ts` (mock only)
- Modify: `components/apmg/pipeline/SendCampaigns.tsx` (result type, parsing, banner)

**Interfaces:**
- Consumes: `readHumanReplies(sb, leadIds)` (Task 5).
- Produces: `SendResult.replied?: number`, `SendResult.repliedMatches?: Array<{ business: string; email: string }>`; drop reason `"Replied by email"`.

- [ ] **Step 1: Write the failing deliver tests**

In `lib/pipeline/deliver.test.ts`, after the `vi.mock("@/lib/pipeline/sectorStore", …)` line add:
```ts
const readHumanReplies = vi.fn(async (..._a: unknown[]): Promise<Map<string, string> | "missing" | "error"> => new Map());
vi.mock("@/lib/replies/server", () => ({ readHumanReplies: (...a: unknown[]) => readHumanReplies(...a) }));
```
In `beforeEach`, add:
```ts
  readHumanReplies.mockResolvedValue(new Map());
```
Append inside `describe("deliverCampaign", …)`:
```ts
  it("drops a lead who has already replied by email and says who", async () => {
    const B: CleanRecipient = { ...A, id: "22222222-2222-4222-8222-222222222222", email: "info@southside.example", business: "Southside" };
    readHumanReplies.mockResolvedValue(new Map([[A.id, "2026-09-27T00:00:00Z"]]));
    const out = await deliverCampaign({ campaign: "c", base: "https://x.test", recipients: [A, B] });
    expect(out.result).toMatchObject({ ok: true, sent: 1, replied: 1, repliedMatches: [{ business: "Northside", email: A.email }] });
    expect(out.drops).toContainEqual({ id: A.id, reason: "Replied by email" });
    expect(payload().messages.map((m) => m.to)).toEqual([B.email]);
  });

  it.each(["missing", "error"] as const)("sends to everyone when the reply lookup is %s (fails open)", async (state) => {
    readHumanReplies.mockResolvedValue(state);
    const out = await deliverCampaign({ campaign: "c", base: "https://x.test", recipients: [A] });
    expect(out.result).toMatchObject({ ok: true, sent: 1 });
    expect(out.result.replied).toBeUndefined();
  });

  it("sends nothing and says why when every recipient has replied", async () => {
    readHumanReplies.mockResolvedValue(new Map([[A.id, "2026-09-27T00:00:00Z"]]));
    const out = await deliverCampaign({ campaign: "c", base: "https://x.test", recipients: [A] });
    expect(out.status).toBe(400);
    expect(out.result).toMatchObject({ ok: false, sent: 0, replied: 1 });
    expect(out.result.error).toMatch(/already replied by email/);
  });
```

- [ ] **Step 2: Keep the send route's test off the network**

In `app/api/pipeline/campaigns/send/route.test.ts`, after the `vi.mock("@/lib/pipeline/sectorStore", …)` block add:
```ts
vi.mock("@/lib/replies/server", () => ({ readHumanReplies: async () => new Map<string, string>() }));
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run lib/pipeline/deliver.test.ts`
Expected: FAIL — the replied lead is still delivered; `replied` is undefined.

- [ ] **Step 4: Implement in `lib/pipeline/deliver.ts`**

Add to the imports:
```ts
import { readHumanReplies } from "@/lib/replies/server";
```

Update the header comment's first paragraph: replace
```ts
 * The ONE path an outreach email takes out of this app: client guard →
 * address opt-outs → organisation opt-outs → render with the tracked link →
```
with:
```ts
 * The ONE path an outreach email takes out of this app: client guard →
 * address opt-outs → organisation opt-outs → leads who replied → render with the tracked link →
```

In `interface SendResult`, after the `domainMatches?` member add:
```ts
  /** how many recipients were dropped because the lead has already replied by email */
  replied?: number;
  /** who they were (capped) */
  repliedMatches?: Array<{ business: string; email: string }>;
```

Directly after
```ts
  const domainMatches: Array<{ business: string; email: string; optedOut: string }> = [];
```
add:
```ts
  /** recipients dropped because their lead has already written back */
  const repliedMatches: Array<{ business: string; email: string }> = [];
```

Replace the end of the suppression block:
```ts
      if (domainMatches.length > 0) {
        domainMatches.reverse(); // restore the operator's send order
        console.warn(
          `[${label}] dropped ${domainMatches.length} recipient(s) whose organisation has unsubscribed:`,
          domainMatches.map((m) => `${m.email} (${m.optedOut} opted out)`).join("; ").slice(0, 1000),
        );
      }
    }
  }
```
with:
```ts
      if (domainMatches.length > 0) {
        domainMatches.reverse(); // restore the operator's send order
        console.warn(
          `[${label}] dropped ${domainMatches.length} recipient(s) whose organisation has unsubscribed:`,
          domainMatches.map((m) => `${m.email} (${m.optedOut} opted out)`).join("; ").slice(0, 1000),
        );
      }
    }

    // A lead who has written back is a conversation, not a prospect: another
    // cold email or follow-up to someone who just answered — "not interested",
    // or "yes, call me" — is exactly what must not go out. email_replies holds
    // every human reply the reply-capture workflow has seen. Fails OPEN like the
    // suppression lookups: a missing table or a failed read drops no one.
    const replied = await readHumanReplies(sb, recipients.map((r) => r.id));
    if (replied instanceof Map && replied.size > 0) {
      for (let i = recipients.length - 1; i >= 0; i--) {
        if (!replied.has(recipients[i].id)) continue;
        repliedMatches.push({ business: recipients[i].business ?? recipients[i].email, email: recipients[i].email });
        drops.push({ id: recipients[i].id, reason: "Replied by email" });
        recipients.splice(i, 1);
      }
      if (repliedMatches.length > 0) {
        repliedMatches.reverse(); // restore the operator's send order
        console.warn(
          `[${label}] dropped ${repliedMatches.length} recipient(s) who have already replied:`,
          repliedMatches.map((m) => m.email).join("; ").slice(0, 1000),
        );
      }
    }
  }
```

In the "everyone was dropped" result (indented 8 spaces), replace:
```ts
        suppressedDomains: domainMatches.length || undefined,
        domainMatches: domainMatches.length ? domainMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
        error:
          domainMatches.length > 0 && suppressedCount === 0
            ? "Every recipient's organisation has already unsubscribed, so nothing was sent."
            : "Every recipient has unsubscribed.",
```
with:
```ts
        suppressedDomains: domainMatches.length || undefined,
        domainMatches: domainMatches.length ? domainMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
        replied: repliedMatches.length || undefined,
        repliedMatches: repliedMatches.length ? repliedMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
        error: everyoneDroppedMessage(suppressedCount, domainMatches.length, repliedMatches.length),
```

In the success result at the end of `deliverCampaign` (indented 6 spaces), replace:
```ts
      domainMatches: domainMatches.length ? domainMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
    },
    200,
```
with:
```ts
      domainMatches: domainMatches.length ? domainMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
      replied: repliedMatches.length || undefined,
      repliedMatches: repliedMatches.length ? repliedMatches.slice(0, MAX_REPORTED_CLIENTS) : undefined,
    },
    200,
```

Append at the end of the file:
```ts
/** Why a send that dropped every recipient sent nothing. The wording without
 *  reply drops is unchanged — the send screen and its tests match on it. */
function everyoneDroppedMessage(suppressed: number, domains: number, replied: number): string {
  if (replied > 0 && suppressed === 0 && domains === 0) {
    return "Every recipient has already replied by email, so nothing was sent — answer them from the outreach@ inbox.";
  }
  if (replied > 0) return "Every recipient has unsubscribed or already replied by email, so nothing was sent.";
  return domains > 0 && suppressed === 0
    ? "Every recipient's organisation has already unsubscribed, so nothing was sent."
    : "Every recipient has unsubscribed.";
}
```

- [ ] **Step 5: Show the new drop on the send screen (`components/apmg/pipeline/SendCampaigns.tsx`)**

(a) The result state type — replace:
```tsx
    /** who they were, so the drop is legible rather than a number that doesn't add up */
    domainMatches: Array<{ business: string; email: string; optedOut: string }>;
  } | null>(null);
```
with:
```tsx
    /** who they were, so the drop is legible rather than a number that doesn't add up */
    domainMatches: Array<{ business: string; email: string; optedOut: string }>;
    /** recipients dropped because the lead has already replied by email — only
     *  the server knows (email_replies), so this arrives with the response */
    replied: number;
    repliedMatches: Array<{ business: string; email: string }>;
  } | null>(null);
```

(b) The parsed response type — replace:
```tsx
          suppressedDomains?: number;
          domainMatches?: Array<{ business: string; email: string; optedOut: string }>;
        }
      | null;
```
with:
```tsx
          suppressedDomains?: number;
          domainMatches?: Array<{ business: string; email: string; optedOut: string }>;
          replied?: number;
          repliedMatches?: Array<{ business: string; email: string }>;
        }
      | null;
```

(c) `setResult` — replace:
```tsx
      domainMatches: Array.isArray(data.domainMatches) ? data.domainMatches : [],
    });
```
with:
```tsx
      domainMatches: Array.isArray(data.domainMatches) ? data.domainMatches : [],
      replied: typeof data.replied === "number" ? data.replied : 0,
      repliedMatches: Array.isArray(data.repliedMatches) ? data.repliedMatches : [],
    });
```

(d) `SuccessBanner`'s prop type — replace:
```tsx
    suppressedDomains: number;
    domainMatches: Array<{ business: string; email: string; optedOut: string }>;
  };
  /** batching progress — set when this send was one batch of a larger selection */
```
with:
```tsx
    suppressedDomains: number;
    domainMatches: Array<{ business: string; email: string; optedOut: string }>;
    replied: number;
    repliedMatches: Array<{ business: string; email: string }>;
  };
  /** batching progress — set when this send was one batch of a larger selection */
```

(e) The drop panel's condition — replace:
```tsx
      {(result.suppressedDomains > 0 || result.clients > 0) && (
```
with:
```tsx
      {(result.suppressedDomains > 0 || result.clients > 0 || result.replied > 0) && (
```

(f) The drop panel's headline — replace:
```tsx
              result.clients > 0 ? `${result.clients} removed — already an APMG client` : null,
            ]
```
with:
```tsx
              result.clients > 0 ? `${result.clients} removed — already an APMG client` : null,
              result.replied > 0 ? `${result.replied} removed — already replied by email` : null,
            ]
```

(g) After the organisation list — replace:
```tsx
                  <span className="font-mono">{m.optedOut}</span> opted out
                </li>
              ))}
            </ul>
          )}
```
with:
```tsx
                  <span className="font-mono">{m.optedOut}</span> opted out
                </li>
              ))}
            </ul>
          )}
          {result.repliedMatches.length > 0 && (
            <ul className="mt-1.5 space-y-0.5 text-[11.5px] leading-relaxed text-muted-foreground">
              {result.repliedMatches.map((m) => (
                <li key={m.email} className="truncate">
                  <span className="text-foreground">{m.business}</span> — {m.email} has already replied; answer them from the outreach@ inbox
                </li>
              ))}
            </ul>
          )}
```

- [ ] **Step 6: Run the send-path suites**

Run: `npx vitest run lib/pipeline app/api/pipeline app/api/followups`
Expected: PASS — including the existing `organisation has already unsubscribed` assertion (wording unchanged when nobody replied).

- [ ] **Step 7: Type-check and leave uncommitted**

Run: `npx tsc --noEmit` — no errors.

---

### Task 9: Report data — replies, campaign replies, honest unsubscribes

**Files:**
- Create: `lib/replies/report.ts`
- Test: `lib/replies/report.test.ts`
- Modify: `app/api/portal/report/route.ts`
- Test: `app/api/portal/report/route.test.ts` (helper change, one updated expectation, new cases)

**Interfaces:**
- Consumes: `ReplyKind`, `BounceType`, `REASON_EMAILED_UNSUBSCRIBE` (Task 1); `isUuid`, `readAllRows`, `isMissingPortalTable` (existing).
- Produces:
  - `lib/replies/report.ts`: `interface ReplyReportRow`, `interface ReplyListItem { receivedAt; leadId; from; campaign; snippet }`, `interface RepliesSummary { human; uniqueLeads; autoReplies; bounces: { hard; policy; soft }; internal; unmatched; list: ReplyListItem[]; byCampaign: Map<string, number> }`, `LIST_LIMIT = 25`, `summarizeReplies(rows, listLimit?)`.
  - Report payload: `replies: { available; human; uniqueLeads; autoReplies; bounces; internal; unmatched; list: { receivedAt; business; from; campaign; snippet }[] }`; `outreach.unsubscribesByLink`, `outreach.unsubscribesByEmail`; `outreach.campaigns[].replies`.

- [ ] **Step 1: Write the failing tally tests**

`lib/replies/report.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { LIST_LIMIT, summarizeReplies, type ReplyReportRow } from "./report";

const L1 = "11111111-1111-4111-8111-111111111111";
const L2 = "22222222-2222-4222-8222-222222222222";

const row = (over: Partial<ReplyReportRow> = {}): ReplyReportRow => ({
  received_at: "2026-09-10T00:00:00.000Z",
  kind: "human",
  lead_id: null,
  campaign: null,
  from_email: "a@acme.test",
  snippet: null,
  bounce_type: null,
  ...over,
});

describe("summarizeReplies", () => {
  it("counts each kind, and human replies per lead and per campaign", () => {
    const s = summarizeReplies([
      row({ lead_id: L1, campaign: "vic-1" }),
      row({ lead_id: L1, campaign: "vic-1" }),
      row({ lead_id: L2, campaign: "old-aug" }),
      row({ kind: "auto_reply" }),
      row({ kind: "bounce", bounce_type: "hard" }),
      row({ kind: "bounce", bounce_type: "policy" }),
      row({ kind: "internal" }),
      row({ kind: "unmatched" }),
      row({ kind: "unsubscribe" }),
    ]);
    expect(s).toMatchObject({ human: 3, uniqueLeads: 2, autoReplies: 1, bounces: { hard: 1, policy: 1, soft: 0 }, internal: 1, unmatched: 1 });
    expect(s.byCampaign).toEqual(new Map([["vic-1", 2], ["old-aug", 1]]));
  });

  it("files a human reply with no campaign under (untagged)", () => {
    expect(summarizeReplies([row({ lead_id: L1 })]).byCampaign.get("(untagged)")).toBe(1);
  });

  it("counts an unknown bounce type as soft", () => {
    expect(summarizeReplies([row({ kind: "bounce", bounce_type: null })]).bounces.soft).toBe(1);
  });

  it("lists human replies newest first, capped", () => {
    const rows = Array.from({ length: 30 }, (_, i) =>
      row({ received_at: new Date(Date.UTC(2026, 8, 1, 0, i)).toISOString(), snippet: `r${i}` }),
    );
    const s = summarizeReplies(rows);
    expect(s.list).toHaveLength(LIST_LIMIT);
    expect(s.list[0].snippet).toBe("r29");
    expect(s.list[0]).toEqual({ receivedAt: rows[29].received_at, leadId: null, from: "a@acme.test", campaign: null, snippet: "r29" });
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run lib/replies/report.test.ts`
Expected: FAIL — `Failed to resolve import "./report"`.

- [ ] **Step 3: Implement `lib/replies/report.ts`**

```ts
import type { BounceType, ReplyKind } from "./types";

/**
 * Tallies one period's email_replies rows for the Telemetry PDF report
 * (/api/portal/report). Pure. Only `human` rows are replies; every other kind
 * is counted so the report can say what it left out. Emailed opt-outs are
 * reported through email_suppression (outreach.unsubscribesByEmail), not here.
 */

export interface ReplyReportRow {
  received_at: string;
  kind: ReplyKind | string;
  lead_id: string | null;
  campaign: string | null;
  from_email: string;
  snippet: string | null;
  bounce_type: BounceType | string | null;
}

export interface ReplyListItem {
  receivedAt: string;
  leadId: string | null;
  from: string;
  campaign: string | null;
  snippet: string;
}

export interface RepliesSummary {
  human: number;
  uniqueLeads: number;
  autoReplies: number;
  bounces: { hard: number; policy: number; soft: number };
  internal: number;
  unmatched: number;
  /** human replies, newest first, at most `listLimit` */
  list: ReplyListItem[];
  /** human replies per campaign tag ("(untagged)" when a reply has none) */
  byCampaign: Map<string, number>;
}

/** Rows the report's detail table shows — same size as its enquiry table. */
export const LIST_LIMIT = 25;

export function summarizeReplies(rows: ReplyReportRow[], listLimit = LIST_LIMIT): RepliesSummary {
  const s: RepliesSummary = {
    human: 0,
    uniqueLeads: 0,
    autoReplies: 0,
    bounces: { hard: 0, policy: 0, soft: 0 },
    internal: 0,
    unmatched: 0,
    list: [],
    byCampaign: new Map(),
  };
  const leads = new Set<string>();
  const humans: ReplyReportRow[] = [];
  for (const r of rows) {
    switch (r.kind) {
      case "human": {
        s.human += 1;
        humans.push(r);
        if (r.lead_id) leads.add(r.lead_id);
        const c = r.campaign || "(untagged)";
        s.byCampaign.set(c, (s.byCampaign.get(c) ?? 0) + 1);
        break;
      }
      case "auto_reply":
        s.autoReplies += 1;
        break;
      case "bounce":
        if (r.bounce_type === "hard" || r.bounce_type === "policy") s.bounces[r.bounce_type] += 1;
        else s.bounces.soft += 1;
        break;
      case "internal":
        s.internal += 1;
        break;
      case "unmatched":
        s.unmatched += 1;
        break;
    }
  }
  s.uniqueLeads = leads.size;
  s.list = humans
    .sort((a, b) => b.received_at.localeCompare(a.received_at))
    .slice(0, listLimit)
    .map((r) => ({ receivedAt: r.received_at, leadId: r.lead_id, from: r.from_email, campaign: r.campaign, snippet: r.snippet ?? "" }));
  return s;
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run lib/replies/report.test.ts`
Expected: PASS (4 tests).

- [ ] **Step 5: Write the failing report-route tests**

In `app/api/portal/report/route.test.ts`:

(a) Replace the `serve` helper:
```ts
function serve(events: Row[], inquiries: Row[] = []) {
  const pg = fakePostgrest({ leads: [], portal_events: events, portal_inquiries: inquiries, email_suppression: [] });
  vi.stubGlobal("fetch", vi.fn(pg.handler));
}
```
with:
```ts
/** `extra` adds or overrides tables — e.g. email_replies, which is absent
 *  (answering the missing-table 404) unless a test serves it. */
function serve(events: Row[], inquiries: Row[] = [], extra: Record<string, Row[]> = {}) {
  const pg = fakePostgrest({ leads: [], portal_events: events, portal_inquiries: inquiries, email_suppression: [], ...extra });
  vi.stubGlobal("fetch", vi.fn(pg.handler));
}
```

(b) In the first test, replace:
```ts
    expect(body.outreach.campaigns).toContainEqual({ campaign: "vic-1", sent: 1100, clicks: 1200 });
```
with:
```ts
    expect(body.outreach.campaigns).toContainEqual({ campaign: "vic-1", sent: 1100, clicks: 1200, replies: 0 });
```

(c) Append at the end of the file:
```ts
/** One email_replies row inside September; received_at rises with every call. */
function rep(kind: string, extra: Row = {}): Row {
  seq += 1;
  return {
    id: `r${String(seq).padStart(6, "0")}`,
    received_at: new Date(Date.parse(FROM) + seq * 1000).toISOString(),
    kind,
    lead_id: null,
    campaign: null,
    from_email: `p${seq}@acme.test`,
    snippet: null,
    bounce_type: null,
    ...extra,
  };
}

describe("GET /api/portal/report — replies", () => {
  it("counts human replies only, names the business, and tallies what it left out", async () => {
    serve(
      [ev("email_sent", { lead_id: lead(1), campaign: "vic-1" }), ev("email_sent", { lead_id: lead(2), campaign: "vic-1" })],
      [],
      {
        leads: [{ id: lead(1), name: "Acme Childcare" }],
        email_replies: [
          rep("human", { lead_id: lead(1), campaign: "vic-1", snippet: "Yes please" }),
          rep("human", { lead_id: lead(1), campaign: "vic-1" }),
          rep("human", { lead_id: lead(2), campaign: "old-aug" }),
          rep("auto_reply", { lead_id: lead(2) }),
          rep("bounce", { bounce_type: "hard" }),
          rep("bounce", { bounce_type: "policy" }),
          rep("internal"),
          rep("unmatched"),
          rep("unsubscribe", { lead_id: lead(2) }),
          // August — outside the window
          { ...rep("human", { lead_id: lead(3) }), received_at: "2026-08-31T23:00:00.000Z" },
        ],
      },
    );

    const body = await report();

    expect(body.replies).toMatchObject({
      available: true,
      human: 3,
      uniqueLeads: 2,
      autoReplies: 1,
      bounces: { hard: 1, policy: 1, soft: 0 },
      internal: 1,
      unmatched: 1,
    });
    expect(body.replies.list).toHaveLength(3);
    // newest first — the first reply served is the oldest
    expect(body.replies.list[2]).toMatchObject({ business: "Acme Childcare", snippet: "Yes please", campaign: "vic-1" });
    expect(body.replies.list[0]).toMatchObject({ business: null, campaign: "old-aug" });
    expect(body.outreach.campaigns).toContainEqual({ campaign: "vic-1", sent: 2, clicks: 0, replies: 2 });
    // a reply this month to a campaign with no sends or clicks this month still gets a row
    expect(body.outreach.campaigns).toContainEqual({ campaign: "old-aug", sent: 0, clicks: 0, replies: 1 });
  });

  it("splits unsubscribes by link and by email, and never counts a bounce as one", async () => {
    serve([], [], {
      email_suppression: [
        { id: "s1", reason: "unsubscribe", created_at: "2026-09-02T00:00:00.000Z" },
        { id: "s2", reason: "unsubscribe-email", created_at: "2026-09-03T00:00:00.000Z" },
        { id: "s3", reason: "unsubscribe-email", created_at: "2026-09-04T00:00:00.000Z" },
        { id: "s4", reason: "bounce-unknown", created_at: "2026-09-05T00:00:00.000Z" },
      ],
    });

    const body = await report();

    expect(body.outreach).toMatchObject({ unsubscribes: 3, unsubscribesByLink: 1, unsubscribesByEmail: 2 });
  });

  it("reports replies as unavailable, not zero-with-a-straight-face, before email_replies exists", async () => {
    serve([ev("email_sent", { lead_id: lead(1), campaign: "vic-1" })]);

    const body = await report();

    expect(body.ok).toBe(true);
    expect(body.replies).toMatchObject({ available: false, human: 0, list: [] });
  });
});
```

- [ ] **Step 6: Run to verify failure**

Run: `npx vitest run app/api/portal/report/route.test.ts`
Expected: FAIL — `replies` is undefined; campaigns lack `replies`.

- [ ] **Step 7: Implement in `app/api/portal/report/route.ts`**

(a) Imports — replace:
```ts
import { requireLiveSupabase, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
```
with:
```ts
import { isUuid, requireLiveSupabase, sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
```
and add below the existing imports:
```ts
import { summarizeReplies, type ReplyReportRow } from "@/lib/replies/report";
import { REASON_EMAILED_UNSUBSCRIBE } from "@/lib/replies/types";
```

(b) Header comment — after the `inquiries — …` bullet add:
```ts
//   replies    — human replies to outreach (email_replies, by received_at),
//                who sent them, per campaign, and a tally of the automatic
//                replies, bounces, internal and unlinked mail left out. The
//                table is optional: before supabase/email-replies.sql the
//                block answers available: false.
```
and in the `outreach` bullet replace `and unsubscribes recorded in the period` with `and unsubscribes recorded in the period (opt-outs only — by link and by email; bounces are never unsubscribes)`.

(c) Replace the `EMPTY` constant's `outreach` block and add a replies block. Replace:
```ts
  outreach: {
    emailsSent: 0,
    uniqueLeadsEmailed: 0,
    unsubscribes: 0,
    campaigns: [] as { campaign: string; sent: number; clicks: number }[],
  },
```
with:
```ts
  outreach: {
    emailsSent: 0,
    uniqueLeadsEmailed: 0,
    unsubscribes: 0,
    unsubscribesByLink: 0,
    unsubscribesByEmail: 0,
    campaigns: [] as { campaign: string; sent: number; clicks: number; replies: number }[],
  },
```
and directly above `const EMPTY = {` add:
```ts
const EMPTY_REPLIES = {
  available: false,
  human: 0,
  uniqueLeads: 0,
  autoReplies: 0,
  bounces: { hard: 0, policy: 0, soft: 0 },
  internal: 0,
  unmatched: 0,
  list: [] as { receivedAt: string; business: string | null; from: string; campaign: string | null; snippet: string }[],
};
```
then add `replies: EMPTY_REPLIES,` as the last member of `EMPTY` (after `inquiries: [] as …[],`).

(d) Add this helper below `const str = …`:
```ts
/** leads.name for the listed replies' leads — the report's Business column.
 *  Cosmetic: any failure just leaves the name blank (the sender still shows). */
async function leadNames(base: string, key: string, ids: (string | null)[]): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter(isUuid))];
  const out = new Map<string, string>();
  if (wanted.length === 0) return out;
  try {
    const res = await restGet(base, key, `leads?select=id,name&id=in.(${wanted.join(",")})`);
    if (!res.ok) return out;
    for (const r of (await res.json().catch(() => [])) as Array<{ id?: unknown; name?: unknown }>) {
      if (typeof r.id === "string" && typeof r.name === "string" && r.name.trim()) out.set(r.id, r.name.trim());
    }
  } catch {
    // names are cosmetic
  }
  return out;
}
```

(e) In `GET`, directly after the `const win = …` line add:
```ts
  /** The same window on email_replies, which is dated by when mail ARRIVED. */
  const rwin = `received_at=gte.${encodeURIComponent(from)}&received_at=lt.${encodeURIComponent(to)}`;
```

(f) Replace the declaration `let unsubRes: Response;` with:
```ts
  let unsubLinkRes: Response;
  let unsubEmailRes: Response;
  let repliesRead: RowsRead;
```
In the destructuring list replace `unsubRes,` with:
```ts
      unsubLinkRes,
      unsubEmailRes,
      repliesRead,
```
and in the `Promise.all` array replace:
```ts
      restGet(target.base, target.key, `email_suppression?select=id&${win}&limit=1`),
```
with:
```ts
      // Opt-outs only, split by how they arrived. A bounce row is a dead
      // address, never an unsubscribe.
      restGet(target.base, target.key, `email_suppression?select=id&${win}&reason=eq.unsubscribe&limit=1`),
      restGet(target.base, target.key, `email_suppression?select=id&${win}&reason=eq.${REASON_EMAILED_UNSUBSCRIBE}&limit=1`),
      readAllRows(
        target.base,
        target.key,
        `email_replies?select=id,received_at,kind,lead_id,campaign,from_email,snippet,bounce_type&${rwin}&order=received_at.asc,id.asc`,
      ),
```

(g) Directly above `const campaigns = [...sentByCampaign.entries()]` insert:
```ts
  // ── replies (optional table — supabase/email-replies.sql) ────────────────
  let replies = EMPTY_REPLIES;
  let repliesByCampaign = new Map<string, number>();
  if (repliesRead.ok) {
    const summary = summarizeReplies(repliesRead.rows as ReplyReportRow[]);
    repliesByCampaign = summary.byCampaign;
    const names = await leadNames(target.base, target.key, summary.list.map((r) => r.leadId));
    replies = {
      available: true,
      human: summary.human,
      uniqueLeads: summary.uniqueLeads,
      autoReplies: summary.autoReplies,
      bounces: summary.bounces,
      internal: summary.internal,
      unmatched: summary.unmatched,
      list: summary.list.map((r) => ({
        receivedAt: r.receivedAt,
        business: r.leadId ? (names.get(r.leadId) ?? null) : null,
        from: r.from,
        campaign: r.campaign,
        snippet: r.snippet,
      })),
    };
  } else if (!isMissingPortalTable(repliesRead.status, repliesRead.detail)) {
    console.error(`[portal/report] email_replies ${repliesRead.status}:`, repliesRead.detail.slice(0, 300));
  }
```

(h) Replace the campaigns block:
```ts
  const campaigns = [...sentByCampaign.entries()]
    .map(([campaign, sent]) => ({ campaign, sent, clicks: clicksByCampaign.get(campaign) ?? 0 }))
    .sort((a, b) => b.sent - a.sent);
  // Clicks on campaigns whose sends fall OUTSIDE the window (e.g. sent last
  // month, clicked this week) still belong in the report — list them too.
  for (const [campaign, clicks] of clicksByCampaign) {
    if (!sentByCampaign.has(campaign)) campaigns.push({ campaign, sent: 0, clicks });
  }
```
with:
```ts
  const campaigns = [...sentByCampaign.entries()]
    .map(([campaign, sent]) => ({
      campaign,
      sent,
      clicks: clicksByCampaign.get(campaign) ?? 0,
      replies: repliesByCampaign.get(campaign) ?? 0,
    }))
    .sort((a, b) => b.sent - a.sent);
  // Clicks on campaigns whose sends fall OUTSIDE the window (e.g. sent last
  // month, clicked this week) still belong in the report — list them too.
  for (const [campaign, clicks] of clicksByCampaign) {
    if (!sentByCampaign.has(campaign)) campaigns.push({ campaign, sent: 0, clicks, replies: repliesByCampaign.get(campaign) ?? 0 });
  }
  // And replies to campaigns with neither sends nor clicks in the window.
  for (const [campaign, n] of repliesByCampaign) {
    if (!sentByCampaign.has(campaign) && !clicksByCampaign.has(campaign)) campaigns.push({ campaign, sent: 0, clicks: 0, replies: n });
  }
```

(i) Replace:
```ts
  // Optional table — missing migration (or any error) just reads as zero.
  const unsubscribes = unsubRes.ok ? totalOf(unsubRes) : 0;
```
with:
```ts
  // Optional table — missing migration (or any error) just reads as zero.
  const unsubscribesByLink = unsubLinkRes.ok ? totalOf(unsubLinkRes) : 0;
  const unsubscribesByEmail = unsubEmailRes.ok ? totalOf(unsubEmailRes) : 0;
```

(j) In the final `Response.json`, replace:
```ts
      unsubscribes,
      campaigns,
    },
```
with:
```ts
      unsubscribes: unsubscribesByLink + unsubscribesByEmail,
      unsubscribesByLink,
      unsubscribesByEmail,
      campaigns,
    },
```
and add `replies,` after `inquiries,` at the end of that object.

- [ ] **Step 8: Run the report suites**

Run: `npx vitest run lib/replies/report.test.ts app/api/portal/report`
Expected: PASS — including the existing "storage not there yet" test.

- [ ] **Step 9: Type-check and leave uncommitted**

Run: `npx tsc --noEmit` — no errors.

---

### Task 10: The PDF — Replies card, section, campaign columns, unsubscribe split

**Files:**
- Create: `lib/html.ts`
- Create: `lib/replies/reportHtml.ts`
- Test: `lib/replies/reportHtml.test.ts`
- Modify: `components/apmg/TelemetryReportExport.tsx`

**Interfaces:**
- Consumes: the report payload from Task 9; `formatInt` (`lib/format.ts`).
- Produces:
  - `lib/html.ts`: `escapeHtml(s: string): string`.
  - `lib/replies/reportHtml.ts`: `interface RepliesPayload` (all fields optional, mirrors Task 9's `replies`), `SNIPPET_PREVIEW = 140`, `repliesSectionHtml(r: RepliesPayload | undefined, emailsSent: number): string`.

- [ ] **Step 1: Move the escaper into `lib/html.ts`** (the exact implementation the component uses today)

```ts
/** Escape text for interpolation into an HTML string. Used by the print
 *  documents the console builds as strings (the Telemetry PDF report). */
export function escapeHtml(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as const)[
      c as "&" | "<" | ">" | '"' | "'"
    ],
  );
}
```

- [ ] **Step 2: Write the failing section tests**

`lib/replies/reportHtml.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { repliesSectionHtml, type RepliesPayload } from "./reportHtml";

const BASE: RepliesPayload = {
  available: true,
  human: 0,
  uniqueLeads: 0,
  autoReplies: 0,
  bounces: { hard: 0, policy: 0, soft: 0 },
  internal: 0,
  unmatched: 0,
  list: [],
};
const item = (over: Record<string, unknown> = {}) => ({
  receivedAt: "2026-09-22T00:14:00.000Z",
  business: "Acme Childcare",
  from: "jane@acme.com.au",
  campaign: "vic-1",
  snippet: "Yes please",
  ...over,
});

describe("repliesSectionHtml", () => {
  it("says reply tracking isn't set up when the table is missing", () => {
    expect(repliesSectionHtml({ ...BASE, available: false }, 100)).toContain("Reply tracking isn't set up yet");
    expect(repliesSectionHtml(undefined, 100)).toContain("Reply tracking isn't set up yet");
  });

  it("says so when nobody replied", () => {
    expect(repliesSectionHtml(BASE, 100)).toContain("No human replies this period.");
  });

  it("lists replies with every field escaped", () => {
    const html = repliesSectionHtml(
      { ...BASE, human: 1, uniqueLeads: 1, list: [item({ business: "<b>Acme</b>", snippet: "Yes <script>alert(1)</script> please" })] },
      10,
    );
    expect(html).toContain("&lt;b&gt;Acme&lt;/b&gt;");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).toContain("jane@acme.com.au");
    expect(html).toContain("vic-1");
  });

  it("clips a long snippet to 140 characters", () => {
    const html = repliesSectionHtml({ ...BASE, human: 1, list: [item({ snippet: "a".repeat(300) })] }, 10);
    expect(html).toContain(`${"a".repeat(139)}…`);
    expect(html).not.toContain("a".repeat(141));
  });

  it("tallies what it left out and the bounce rate", () => {
    const html = repliesSectionHtml({ ...BASE, autoReplies: 14, bounces: { hard: 2, policy: 1, soft: 0 }, internal: 2, unmatched: 1 }, 100);
    expect(html).toContain("14 automatic replies");
    expect(html).toContain("3 bounces (2 hard — suppressed, 1 blocked, 0 soft)");
    expect(html).toContain("2 internal, 1 unlinked");
    expect(html).toContain("Bounce rate: 3% of emails sent");
  });

  it("uses the singular for one", () => {
    const html = repliesSectionHtml({ ...BASE, autoReplies: 1, bounces: { hard: 1, policy: 0, soft: 0 } }, 100);
    expect(html).toContain("1 automatic reply (");
    expect(html).toContain("1 bounce (");
  });

  it("shows a dash for the bounce rate when nothing was sent", () => {
    expect(repliesSectionHtml(BASE, 0)).toContain("Bounce rate: — of emails sent");
  });

  it("notes when the table is only the newest slice", () => {
    const list = Array.from({ length: 25 }, () => item());
    expect(repliesSectionHtml({ ...BASE, human: 30, list }, 100)).toContain("Showing the newest 25 of 30 human replies.");
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run lib/replies/reportHtml.test.ts`
Expected: FAIL — `Failed to resolve import "./reportHtml"`.

- [ ] **Step 4: Implement `lib/replies/reportHtml.ts`**

```ts
import { formatInt } from "@/lib/format";
import { escapeHtml as esc } from "@/lib/html";

/**
 * The Telemetry PDF's "Replies this period" section, as an HTML string for
 * TelemetryReportExport's print document (its CSS classes: section, h2, table,
 * .note, .empty, .num). Pure and client-safe. Every dynamic string is escaped:
 * a snippet is whatever a stranger typed into an email.
 */

/** The report route's `replies` block — every field optional, like the rest of
 *  the component's payload type, because it arrives as untyped JSON. */
export interface RepliesPayload {
  available?: boolean;
  human?: number;
  uniqueLeads?: number;
  autoReplies?: number;
  bounces?: { hard?: number; policy?: number; soft?: number };
  internal?: number;
  unmatched?: number;
  list?: {
    receivedAt?: string;
    business?: string | null;
    from?: string;
    campaign?: string | null;
    snippet?: string;
  }[];
}

export const SNIPPET_PREVIEW = 140;

const n = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : 0);
const pct = (part: number, total: number) => (total > 0 ? `${Math.round((part / total) * 100)}%` : "—");
const count = (k: number, one: string, many: string) => `${formatInt(k)} ${k === 1 ? one : many}`;

function clip(s: string): string {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length <= SNIPPET_PREVIEW ? t : `${t.slice(0, SNIPPET_PREVIEW - 1).trimEnd()}…`;
}

export function repliesSectionHtml(r: RepliesPayload | undefined, emailsSent: number): string {
  if (!r || r.available === false) {
    return `<section><h2>Replies this period</h2><div class="empty">Reply tracking isn't set up yet — run supabase/email-replies.sql in the Supabase SQL editor.</div></section>`;
  }
  const human = n(r.human);
  const list = (Array.isArray(r.list) ? r.list : []).filter((x) => typeof x?.receivedAt === "string");
  const hard = n(r.bounces?.hard);
  const policy = n(r.bounces?.policy);
  const soft = n(r.bounces?.soft);
  const bounces = hard + policy + soft;

  const rows = list
    .map((x) => {
      const when = new Date(x.receivedAt as string).toLocaleString("en-AU", {
        day: "numeric",
        month: "short",
        hour: "numeric",
        minute: "2-digit",
      });
      return `<tr><td class="num">${esc(when)}</td><td>${esc(x.business ?? "—")}</td><td>${esc(x.from ?? "—")}</td><td>${esc(
        x.campaign ?? "—",
      )}</td><td>${esc(clip(x.snippet ?? "")) || "—"}</td></tr>`;
    })
    .join("");
  const table =
    list.length > 0
      ? `<table><thead><tr><th>When</th><th>Business</th><th>From</th><th>Campaign</th><th>What they said</th></tr></thead><tbody>${rows}</tbody></table>`
      : `<div class="empty">No human replies this period.</div>`;
  const more =
    list.length > 0 && human > list.length
      ? `<div class="note">Showing the newest ${list.length} of ${esc(formatInt(human))} human replies.</div>`
      : "";
  const ignored = `<div class="note">Not counted: ${count(n(r.autoReplies), "automatic reply", "automatic replies")} (out-of-office, auto-acknowledgements), ${count(
    bounces,
    "bounce",
    "bounces",
  )} (${formatInt(hard)} hard — suppressed, ${formatInt(policy)} blocked, ${formatInt(soft)} soft), ${formatInt(n(r.internal))} internal, ${formatInt(
    n(r.unmatched),
  )} unlinked. Bounce rate: ${pct(bounces, emailsSent)} of emails sent.</div>`;

  return `<section><h2>Replies this period</h2>${table}${more}${ignored}</section>`;
}
```

- [ ] **Step 5: Run to verify pass**

Run: `npx vitest run lib/replies/reportHtml.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 6: Wire it into `components/apmg/TelemetryReportExport.tsx`**

(a) Imports — add below the existing imports:
```tsx
import { escapeHtml as esc } from "@/lib/html";
import { repliesSectionHtml, type RepliesPayload } from "@/lib/replies/reportHtml";
```
and delete the local escaper:
```tsx
function esc(s: string): string {
  return s.replace(
    /[&<>"']/g,
    (c) => (({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }) as const)[
      c as "&" | "<" | ">" | '"' | "'"
    ],
  );
}
```

(b) Doc comment — replace
```tsx
 * ledger), engagement funnel (clicks → portal → services → enquiries),
```
with:
```tsx
 * ledger), engagement funnel (clicks → portal → services → enquiries),
 * replies (human only — automatic replies and bounces are tallied, not counted),
```

(c) `ReportPayload.outreach` — replace:
```tsx
    unsubscribes?: number;
    campaigns?: { campaign?: string; sent?: number; clicks?: number }[];
  };
```
with:
```tsx
    unsubscribes?: number;
    unsubscribesByLink?: number;
    unsubscribesByEmail?: number;
    campaigns?: { campaign?: string; sent?: number; clicks?: number; replies?: number }[];
  };
```
and directly above `  inquiries?: {` in `ReportPayload` add:
```tsx
  /** human replies to outreach, plus what was left out (email_replies) */
  replies?: RepliesPayload;
```

(d) In `buildReportHtml`, after `const unsubscribes = n(out.unsubscribes);` add:
```tsx
  const unsubByLink = n(out.unsubscribesByLink);
  const unsubByEmail = n(out.unsubscribesByEmail);
  const humanReplies = n(data.replies?.human);
  const repliedLeads = n(data.replies?.uniqueLeads);
```

(e) KPI cards — replace:
```tsx
    { label: "Email clicks", value: clicks, note: `${formatInt(uniqueClicked)} leads engaged` },
```
with:
```tsx
    { label: "Email clicks", value: clicks, note: `${formatInt(uniqueClicked)} leads engaged` },
    {
      label: "Replies",
      value: humanReplies,
      note: `${formatInt(repliedLeads)} lead${repliedLeads === 1 ? "" : "s"} · ${pct(repliedLeads, uniqueEmailed)} of leads emailed`,
    },
```

(f) Campaign rows — replace:
```tsx
    .map((c) => ({ campaign: typeof c.campaign === "string" ? c.campaign : "(untagged)", sent: n(c.sent), clicks: n(c.clicks) }))
```
with:
```tsx
    .map((c) => ({
      campaign: typeof c.campaign === "string" ? c.campaign : "(untagged)",
      sent: n(c.sent),
      clicks: n(c.clicks),
      replies: n(c.replies),
    }))
```

(g) Campaign table — replace:
```tsx
            ? `<table><thead><tr><th>Campaign</th><th class="r">Sent</th><th class="r">Clicks</th><th class="r">CTR</th></tr></thead><tbody>${campaigns
                .map(
                  (c) => `<tr><td>${esc(c.campaign)}</td><td class="r num">${formatInt(c.sent)}</td>
                    <td class="r num">${formatInt(c.clicks)}</td><td class="r num">${pct(c.clicks, c.sent)}</td></tr>`,
                )
```
with:
```tsx
            ? `<table><thead><tr><th>Campaign</th><th class="r">Sent</th><th class="r">Clicks</th><th class="r">CTR</th><th class="r">Replies</th><th class="r">Reply rate</th></tr></thead><tbody>${campaigns
                .map(
                  (c) => `<tr><td>${esc(c.campaign)}</td><td class="r num">${formatInt(c.sent)}</td>
                    <td class="r num">${formatInt(c.clicks)}</td><td class="r num">${pct(c.clicks, c.sent)}</td>
                    <td class="r num">${formatInt(c.replies)}</td><td class="r num">${pct(c.replies, c.sent)}</td></tr>`,
                )
```

(h) Unsubscribe note — replace:
```tsx
    <div class="note">${esc(formatInt(unsubscribes))} unsubscribe${unsubscribes === 1 ? "" : "s"} recorded this period. Clicks are tracked outreach links (/t/…); enquiries are qualified — an email address was captured.</div>
```
with:
```tsx
    <div class="note">${esc(formatInt(unsubscribes))} unsubscribe${unsubscribes === 1 ? "" : "s"} recorded this period (${esc(formatInt(unsubByLink))} via link, ${esc(formatInt(unsubByEmail))} by email). Clicks are tracked outreach links (/t/…); enquiries are qualified — an email address was captured.</div>
```

(i) The section — replace:
```tsx
  <section>
    <h2>Facebook &amp; Google</h2>
```
with:
```tsx
  ${repliesSectionHtml(data.replies, emailsSent)}

  <section>
    <h2>Facebook &amp; Google</h2>
```

- [ ] **Step 7: Type-check and run everything touched so far**

Run: `npx tsc --noEmit` then `npx vitest run`
Expected: no type errors; the whole suite passes. Leave uncommitted.

---

### Task 11: The n8n workflow and the full verification gate

**Files:**
- Create: `references/APMG Reply Capture.json`

**Interfaces:**
- Consumes: `POST /api/inbound/replies` and its `IngestResponse` (Task 6); the body contract `InboundMessage` (Task 1).
- Produces: an importable n8n workflow. Kane imports it; nothing in the app reads this file.

- [ ] **Step 1: Write the workflow**

`references/APMG Reply Capture.json`:
```json
{
  "name": "APMG Reply Capture",
  "nodes": [
    {
      "parameters": {
        "content": "## APMG Reply Capture\n\nReads outreach@ (credential \"APMG - Official Lead Gen Mail\") and posts every new inbox message to the app, which sorts it (human / automatic / bounce / unsubscribe / internal / unlinked), matches it to a lead, stores it and acts. Spec: docs/superpowers/specs/2026-09-28-reply-detection-design.md\n\nLIVE: \"New Inbox Mail\" polls INBOX every 5 minutes.\n\nBACKFILL: run \"Backfill (run once)\" by hand ONCE after the app is deployed. It imports everything in the inbox since 17 Aug 2026. Backfilled mail never alerts; unsubscribes and hard bounces are still suppressed and follow-ups still stop. Re-running is safe: the app keeps one row per Gmail message.\n\n\"Post To App\" MUST target the ADMIN host (the customer host 404s every non-portal API) and use a Header Auth credential: name x-apmg-secret, value = the app's N8N_WEBHOOK_SECRET. Select that credential after importing.\n\nA human reply comes back with an `alert`; \"Send Reply Alert\" emails it to the enquiry notification list.\n\nBlind spot: mail Gmail files as spam is never read.",
        "height": 560,
        "width": 560
      },
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000001",
      "name": "Sticky Note",
      "type": "n8n-nodes-base.stickyNote",
      "typeVersion": 1,
      "position": [0, 0]
    },
    {
      "parameters": {
        "pollTimes": { "item": [{ "mode": "everyX", "value": 5, "unit": "minutes" }] },
        "simple": true,
        "filters": { "labelIds": ["INBOX"], "q": "-from:me", "readStatus": "both" },
        "options": {}
      },
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000002",
      "name": "New Inbox Mail",
      "type": "n8n-nodes-base.gmailTrigger",
      "typeVersion": 1.2,
      "position": [640, 200],
      "credentials": { "gmailOAuth2": { "id": "kskI74Hc193Yl8SU", "name": "APMG - Official Lead Gen Mail" } }
    },
    {
      "parameters": {},
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000003",
      "name": "Backfill (run once)",
      "type": "n8n-nodes-base.manualTrigger",
      "typeVersion": 1,
      "position": [640, 460]
    },
    {
      "parameters": {
        "operation": "getAll",
        "returnAll": true,
        "simple": true,
        "filters": { "q": "in:inbox after:2026/08/17 -from:me" },
        "options": {}
      },
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000004",
      "name": "List Inbox Since 17 Aug",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.1,
      "position": [860, 460],
      "credentials": { "gmailOAuth2": { "id": "kskI74Hc193Yl8SU", "name": "APMG - Official Lead Gen Mail" } }
    },
    {
      "parameters": {
        "url": "=https://gmail.googleapis.com/gmail/v1/users/me/messages/{{ $json.id }}?format=full",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "gmailOAuth2",
        "options": {}
      },
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000005",
      "name": "Get Message",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1100, 320],
      "credentials": { "gmailOAuth2": { "id": "kskI74Hc193Yl8SU", "name": "APMG - Official Lead Gen Mail" } }
    },
    {
      "parameters": {
        "url": "=https://gmail.googleapis.com/gmail/v1/users/me/threads/{{ $json.threadId }}?format=metadata&metadataHeaders=To&metadataHeaders=Date",
        "authentication": "predefinedCredentialType",
        "nodeCredentialType": "gmailOAuth2",
        "options": {}
      },
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000006",
      "name": "Get Thread",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1320, 320],
      "credentials": { "gmailOAuth2": { "id": "kskI74Hc193Yl8SU", "name": "APMG - Official Lead Gen Mail" } }
    },
    {
      "parameters": {
        "mode": "runOnceForEachItem",
        "jsCode": "// Turn one Gmail message + its thread into the body /api/inbound/replies\n// expects (lib/replies/payload.ts). This node only reshapes: every decision\n// (automated? which lead? suppress?) is the app's, under test.\nconst MAX_TEXT = 20000;\nconst MAX_HEADERS = 100;\nconst MAX_HEADER_VALUE = 2000;\n\nconst msg = $('Get Message').item.json;\nconst thread = $json;\n\nfunction decode(data) {\n  return Buffer.from(String(data).replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');\n}\nfunction walk(part, out) {\n  if (!part) return;\n  const type = String(part.mimeType || '').toLowerCase();\n  const data = part.body && part.body.data;\n  if (data) {\n    if (type === 'text/plain' && out.plain === undefined) out.plain = decode(data);\n    else if (type === 'text/html' && out.html === undefined) out.html = decode(data);\n    else if (type === 'message/delivery-status' && out.dsn === undefined) out.dsn = decode(data);\n  }\n  for (const p of part.parts || []) walk(p, out);\n}\nfunction htmlToText(html) {\n  return html\n    .replace(/<(style|script)[\\s\\S]*?<\\/\\1>/gi, '')\n    .replace(/<br\\s*\\/?>/gi, '\\n')\n    .replace(/<\\/(p|div|tr|li|h[1-6])>/gi, '\\n')\n    .replace(/<[^>]+>/g, '')\n    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '\"').replace(/&#39;/g, \"'\").replace(/&amp;/g, '&')\n    .replace(/\\n{3,}/g, '\\n\\n')\n    .trim();\n}\n\nconst parts = {};\nwalk(msg.payload, parts);\nlet text = parts.plain !== undefined ? parts.plain : parts.html !== undefined ? htmlToText(parts.html) : '';\n// A bounce's machine-readable part carries Final-Recipient and the status code.\nif (parts.dsn) text += '\\n\\n' + parts.dsn;\n\nconst headers = {};\nlet count = 0;\nfor (const h of (msg.payload && msg.payload.headers) || []) {\n  const name = String(h.name || '').toLowerCase();\n  if (!name || Object.prototype.hasOwnProperty.call(headers, name)) continue;\n  if (count >= MAX_HEADERS) break;\n  headers[name] = String(h.value || '').slice(0, MAX_HEADER_VALUE);\n  count++;\n}\n\n// The thread's first message WE sent: its To is the address we wrote to.\nconst sent = ((thread && thread.messages) || [])\n  .filter((m) => (m.labelIds || []).includes('SENT'))\n  .sort((a, b) => Number(a.internalDate) - Number(b.internalDate))[0];\nconst headerOf = (m, name) => {\n  const h = ((m && m.payload && m.payload.headers) || []).find((x) => String(x.name).toLowerCase() === name);\n  return h ? String(h.value) : null;\n};\n\nreturn {\n  json: {\n    gmailId: msg.id,\n    threadId: msg.threadId || null,\n    receivedAt: new Date(Number(msg.internalDate)).toISOString(),\n    from: headers.from || '',\n    subject: (headers.subject || '').slice(0, 1000),\n    headers,\n    text: text.slice(0, MAX_TEXT),\n    originalTo: sent ? headerOf(sent, 'to') : null,\n    originalSentAt: sent ? new Date(Number(sent.internalDate)).toISOString() : null,\n    backfill: $('Backfill (run once)').isExecuted,\n  },\n};\n"
      },
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000007",
      "name": "Build Payload",
      "type": "n8n-nodes-base.code",
      "typeVersion": 2,
      "position": [1540, 320]
    },
    {
      "parameters": {
        "method": "POST",
        "url": "https://admin.apmgservices.com.au/api/inbound/replies",
        "authentication": "genericCredentialType",
        "genericAuthType": "httpHeaderAuth",
        "sendBody": true,
        "specifyBody": "json",
        "jsonBody": "={{ JSON.stringify($json) }}",
        "options": {}
      },
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000008",
      "name": "Post To App",
      "type": "n8n-nodes-base.httpRequest",
      "typeVersion": 4.2,
      "position": [1760, 320],
      "retryOnFail": true,
      "maxTries": 3,
      "waitBetweenTries": 5000
    },
    {
      "parameters": {
        "conditions": {
          "options": { "caseSensitive": true, "leftValue": "", "typeValidation": "loose" },
          "conditions": [
            {
              "id": "alert-present",
              "leftValue": "={{ !!$json.alert }}",
              "rightValue": true,
              "operator": { "type": "boolean", "operation": "true", "singleValue": true }
            }
          ],
          "combinator": "and"
        },
        "options": {}
      },
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000009",
      "name": "Alert?",
      "type": "n8n-nodes-base.if",
      "typeVersion": 2,
      "position": [1980, 320]
    },
    {
      "parameters": {
        "sendTo": "={{ $json.alert.to }}",
        "subject": "={{ $json.alert.subject }}",
        "emailType": "text",
        "message": "={{ $json.alert.text }}",
        "options": { "appendAttribution": false }
      },
      "id": "5a0c3a52-1f0e-4a8a-9d7e-000000000010",
      "name": "Send Reply Alert",
      "type": "n8n-nodes-base.gmail",
      "typeVersion": 2.1,
      "position": [2200, 300],
      "credentials": { "gmailOAuth2": { "id": "kskI74Hc193Yl8SU", "name": "APMG - Official Lead Gen Mail" } }
    }
  ],
  "connections": {
    "New Inbox Mail": { "main": [[{ "node": "Get Message", "type": "main", "index": 0 }]] },
    "Backfill (run once)": { "main": [[{ "node": "List Inbox Since 17 Aug", "type": "main", "index": 0 }]] },
    "List Inbox Since 17 Aug": { "main": [[{ "node": "Get Message", "type": "main", "index": 0 }]] },
    "Get Message": { "main": [[{ "node": "Get Thread", "type": "main", "index": 0 }]] },
    "Get Thread": { "main": [[{ "node": "Build Payload", "type": "main", "index": 0 }]] },
    "Build Payload": { "main": [[{ "node": "Post To App", "type": "main", "index": 0 }]] },
    "Post To App": { "main": [[{ "node": "Alert?", "type": "main", "index": 0 }]] },
    "Alert?": { "main": [[{ "node": "Send Reply Alert", "type": "main", "index": 0 }], []] }
  },
  "settings": { "executionOrder": "v1" },
  "pinData": {}
}
```

- [ ] **Step 2: Prove the workflow file parses and its Code node compiles**

Run:
```bash
node -e "const w=JSON.parse(require('fs').readFileSync('references/APMG Reply Capture.json','utf8'));const code=w.nodes.find(n=>n.name==='Build Payload').parameters.jsCode;new Function('\$','\$json','Buffer',code);console.log('ok',w.nodes.length,'nodes')"
```
Expected: `ok 10 nodes`. (A `SyntaxError` means an escaping mistake in `jsCode` — fix the JSON string, not the logic.)

- [ ] **Step 3: Run the full gate**

Run, in order:
```bash
npx tsc --noEmit
npx vitest run
npx next build
```
Expected: tsc clean; every test file passes; `next build` succeeds and lists `ƒ /api/inbound/replies`. If `next build` fails on something unrelated that looks cached, `rm -rf .next` and rebuild once before investigating.

- [ ] **Step 4: Confirm nothing was committed**

Run: `git status --short`
Expected: the new and modified files from Tasks 1–11 listed as untracked/modified; `git log -1` unchanged from before the work started. Do not commit.

- [ ] **Step 5: Hand Kane the manual steps** (spec §14), in the final report:
1. Run `supabase/email-replies.sql` in the Supabase SQL editor.
2. In n8n, confirm `APMG - Official Lead Gen Mail` can read mail (a Gmail "Get many messages" test).
3. Import `references/APMG Reply Capture.json`; select a Header Auth credential on "Post To App" (`x-apmg-secret` = the app's `N8N_WEBHOOK_SECRET`); confirm the URL is the admin host.
4. Publish through GitHub Desktop and let Vercel deploy.
5. Run "Backfill (run once)" once; check the rows (`select kind, count(*) from email_replies group by kind`).
6. Activate the workflow; confirm empty polls don't consume n8n executions on the current plan.
7. Reply to an outreach email from an outside address; confirm the alert arrives and the reply shows on today's Telemetry PDF.
