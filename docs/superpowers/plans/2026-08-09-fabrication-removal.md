# Fabricated Data & False-Positive Removal Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** No console surface can render invented data, and no route can report an action it did not perform.

**Architecture:** Three moves. (1) Teach the infrastructure resolvers to distinguish *unconfigured* from *paused* from *live*, and add a single `requireLiveSupabase()` guard that turns a demo fallback into a 503 on production runtimes only. (2) Delete every preset array and replace its render path with an honest error state. (3) Close the remaining telemetry false-positive vector — scanners that spoof a browser User-Agent — with a timing and dedupe rule.

**Tech Stack:** Next.js App Router (route handlers return `Response`), TypeScript, Supabase via PostgREST `fetch`, Vitest (`environment: "node"`).

## Global Constraints

- Vitest only collects `lib/**/*.test.ts` and `app/**/*.test.ts` (`vitest.config.ts:10`). **There are no component tests.** Component changes in Tasks 5 and 6 are verified by hand against a running app, not by the suite.
- Run the suite with `npm test` (`vitest run`).
- Any test importing a module that does `import "server-only"` must add `vi.mock("server-only", () => ({}))` before the import. `lib/pipeline/server.ts` does **not** import it and needs no mock. `lib/portal/chatQuota.ts` and `lib/ai/*` do.
- Fail-closed applies to **production runtimes only** — `NODE_ENV === "production"` or any `VERCEL_ENV`. A developer with no Supabase configured must still be able to run the app.
- Never delete the `SalesLead`, `SalesStatus`, `PortalSummary`, `PortalInquiry`, `LeadActivity`, `AnonymousActivity` or `ActivityTotals` **types**. Only the preset *data* goes. Seven components import those types.
- Commit after every task. Conventional-commit prefixes (`feat:`, `fix:`, `refactor:`), matching recent history.
- **Out of scope, deliberately:** Sales lifecycle persistence (`markContacted` / `closeDeal` mutating React state only). That needs the `console_audit` table and belongs to the audit-trail plan. After this plan, sales *status* is still in-memory. Everything else stops lying.

## File Structure

| File | Responsibility after this plan |
|---|---|
| `lib/pipeline/server.ts` | Adds `isProductionRuntime()`, `requireLiveSupabase()`. `WebhookTarget` gains `paused` as a state distinct from `unconfigured`. |
| `lib/pipeline/server.test.ts` | **New.** Guards the fail-closed rule and the paused/unconfigured split. This is the regression test for the whole plan. |
| `app/api/pipeline/campaigns/send/route.ts` | 503s instead of reporting `sent: N` for a send that did not happen. |
| `app/api/pipeline/campaigns/send/route.test.ts` | **New.** |
| `app/api/pipeline/upload/route.ts` | 503s instead of reporting `inserted: N` for rows never stored. |
| `app/api/pipeline/upload/route.test.ts` | **New.** |
| 10 further route files | Fail closed in production. Three public carve-outs (`portal/events`, `portal/unsubscribe`, `t/[id]`) stay as they are. |
| `lib/data/leadActivity.ts` | Types + label mapping only. `DEMO_*` deleted. |
| `lib/data/enquiries.ts` | Types only. `DEMO_SUMMARY` / `DEMO_INQUIRIES` deleted. |
| `lib/data/sales.ts` | Types only. `SALES_LEADS` / `SALES_REP` deleted. File drops from 274 lines to ~48. |
| `components/apmg/TelemetryPage.tsx`, `EnquiriesPage.tsx`, `SalesProvider.tsx`, `SalesPage.tsx`, `useLeadBriefs.ts` | Render an honest "not connected" state where they previously rendered presets. |
| `lib/portal/server.ts` | Adds pure `classifyClick()` + its I/O wrapper for scanner suppression. |
| `lib/portal/clickFilter.test.ts` | **New.** Pure reducer tests. |
| `app/t/[id]/route.ts` | Consults the click classifier before recording. |

---

### Task 1: Split `demo` into `unconfigured` / `paused`, add the fail-closed guard

Everything else depends on this. `resolveWebhook` currently collapses "no webhook configured" and "operator paused the automation" into one `demo` state (`lib/pipeline/server.ts:133-135`), which is what lets a paused campaign report N delivered.

**Files:**
- Modify: `lib/pipeline/server.ts:44-46` (type), `:112-137` (resolver), and append the new guard
- Test: `lib/pipeline/server.test.ts` (create)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces:
  - `type WebhookTarget = { state: "unconfigured" } | { state: "paused"; url: string; source: WebhookSource } | { state: "ok"; url: string; source: WebhookSource }`
  - `isProductionRuntime(): boolean`
  - `requireLiveSupabase(label: string): Response | null` — a 503 `Response` to return immediately, or `null` meaning "carry on".

- [ ] **Step 1: Write the failing test**

Create `lib/pipeline/server.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { campaignWebhook, isProductionRuntime, requireLiveSupabase } from "./server";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.N8N_CAMPAIGN_WEBHOOK_URL;
  delete process.env.VERCEL_ENV;
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL_ENV };
});

/** readSetting() reads app_settings over PostgREST. Stub fetch so each key
 *  resolves to the supplied value (absent key -> no row -> null). */
function stubSettings(values: Record<string, string>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      const key = (url.searchParams.get("key") ?? "").replace(/^eq\./, "");
      const value = values[key];
      return new Response(JSON.stringify(value === undefined ? [] : [{ value }]), { status: 200 });
    }),
  );
}

function configureSupabase(): void {
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
}

describe("isProductionRuntime", () => {
  it("is false on a developer machine", () => {
    expect(isProductionRuntime()).toBe(false);
  });

  it("is true when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProductionRuntime()).toBe(true);
  });

  it("is true on any Vercel deployment, including preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isProductionRuntime()).toBe(true);
  });
});

describe("requireLiveSupabase", () => {
  it("returns null when Supabase is configured", () => {
    configureSupabase();
    vi.stubEnv("NODE_ENV", "production");
    expect(requireLiveSupabase("test")).toBeNull();
  });

  it("returns a 503 when Supabase is missing on a production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = requireLiveSupabase("test");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    await expect(res!.json()).resolves.toMatchObject({ ok: false });
  });

  it("returns null when Supabase is missing in development, so local work still runs", () => {
    expect(requireLiveSupabase("test")).toBeNull();
  });
});

describe("campaignWebhook — paused is not unconfigured", () => {
  it("is unconfigured when no URL is set anywhere", async () => {
    await expect(campaignWebhook()).resolves.toEqual({ state: "unconfigured" });
  });

  it("is ok when an env URL is set and no toggle has been written", async () => {
    vi.stubEnv("N8N_CAMPAIGN_WEBHOOK_URL", "https://n8n.example/hook");
    await expect(campaignWebhook()).resolves.toEqual({
      state: "ok",
      url: "https://n8n.example/hook",
      source: "env",
    });
  });

  it("is PAUSED — not unconfigured — when a configured webhook's toggle is off", async () => {
    configureSupabase();
    stubSettings({
      n8n_campaign_webhook_url: "https://n8n.example/hook",
      n8n_campaign_webhook_enabled: "false",
    });
    await expect(campaignWebhook()).resolves.toEqual({
      state: "paused",
      url: "https://n8n.example/hook",
      source: "setting",
    });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/pipeline/server.test.ts`
Expected: FAIL — `isProductionRuntime` and `requireLiveSupabase` are not exported, and the paused case currently resolves to `{ state: "demo" }`.

- [ ] **Step 3: Widen `WebhookTarget` and split the resolver**

In `lib/pipeline/server.ts`, replace the type at `:44-46`:

```ts
export type WebhookTarget =
  /** No URL configured in app_settings or the environment. */
  | { state: "unconfigured" }
  /** Configured, but the Integrations toggle is off. The operator switched
   *  this off deliberately — it is NOT the same as never having set it up,
   *  and callers must not treat it as a reason to simulate success. */
  | { state: "paused"; url: string; source: WebhookSource }
  | { state: "ok"; url: string; source: WebhookSource };
```

Replace the body of `resolveWebhook` at `:115-137`:

```ts
async function resolveWebhook(settingKey: string, enabledKey: string, envVar: string): Promise<WebhookTarget> {
  let url = "";
  let source: WebhookSource = "setting";

  const saved = await readSetting(settingKey);
  if (saved && isValidUrl(saved)) {
    url = saved;
    source = "setting";
  } else {
    const env = process.env[envVar];
    if (env && isValidUrl(env)) {
      url = env;
      source = "env";
    } else if (env) {
      console.error(`[pipeline] ${envVar} is not a valid URL — treating as unconfigured.`);
    }
  }

  if (!url) return { state: "unconfigured" };
  // toggle: absent/anything-but-"false" ⇒ enabled (default on)
  if ((await readSetting(enabledKey)) === "false") return { state: "paused", url, source };
  return { state: "ok", url, source };
}
```

Update the doc comment at `:112-114` to say the resolver reports *paused* separately, and the one at `:48-51` which currently states a paused toggle "returns demo".

- [ ] **Step 4: Add the fail-closed guard**

Append to `lib/pipeline/server.ts`, directly below `supabaseTarget`:

```ts
/** True on any deployed runtime. A production console must never substitute
 *  invented data for missing infrastructure; a developer machine still may. */
export function isProductionRuntime(): boolean {
  return process.env.NODE_ENV === "production" || Boolean(process.env.VERCEL_ENV);
}

/**
 * Fail-closed guard for routes that would otherwise degrade to demo data.
 * Returns a 503 Response to hand straight back to the caller when Supabase is
 * unusable on a deployed runtime, or null when the route may proceed — either
 * because Supabase is live, or because this is a developer machine where the
 * demo fallback is still wanted.
 *
 * `label` names the route in the server log, e.g. "portal/summary".
 */
export function requireLiveSupabase(label: string): Response | null {
  const target = supabaseTarget();
  if (target.state === "ok") return null;
  if (!isProductionRuntime()) return null;
  console.error(`[${label}] Supabase is ${target.state} on a deployed runtime — refusing to serve demo data.`);
  return Response.json(
    { ok: false, error: "This console is not connected to its database, so no data can be shown." },
    { status: 503 },
  );
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- lib/pipeline/server.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 6: Fix the now-broken callers so the project compiles**

`state === "demo"` no longer exists on `WebhookTarget`, so TypeScript will reject three call sites. Give each a temporary total check — Tasks 2 and 4 replace them with real handling:

- `app/api/pipeline/campaigns/send/route.ts:252` → `if (target.state !== "ok") {`
- `app/api/pipeline/campaigns/find-emails/route.ts:172` → `if (target.state !== "ok") {`
- `app/api/portal/inquiries/route.ts:342` → `if (target.state !== "ok") {`

Run: `npx tsc --noEmit`
Expected: no errors.

- [ ] **Step 7: Commit**

```bash
git add lib/pipeline/server.ts lib/pipeline/server.test.ts app/api/pipeline/campaigns/send/route.ts app/api/pipeline/campaigns/find-emails/route.ts app/api/portal/inquiries/route.ts
git commit -m "feat: distinguish paused from unconfigured webhooks, add requireLiveSupabase"
```

---

### Task 2: The campaign send stops reporting sends that never happened

`send/route.ts:252-256` returns `{ok: true, sent: messages.length}` when the webhook is not live. Combined with Task 1's split, a paused automation is now distinguishable and gets its own message.

**Files:**
- Modify: `app/api/pipeline/campaigns/send/route.ts:61` (type), `:251-256` (the branch)
- Modify: `components/apmg/pipeline/SendCampaigns.tsx:73` (mirror type), `:891`, `:967`
- Test: `app/api/pipeline/campaigns/send/route.test.ts` (create)

**Interfaces:**
- Consumes: `WebhookTarget` from Task 1.
- Produces: `SendMode = "live" | "unconfigured" | "paused" | "noop"`.

- [ ] **Step 1: Write the failing test**

Create `app/api/pipeline/campaigns/send/route.test.ts`:

The route guards on `campaigns.send` and reaches Supabase before the webhook branch, so both are mocked. `sectorStore` pulls in `server-only`, hence the first mock. This follows the house pattern at `app/api/admin/users/route.test.ts:3-25`.

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requirePermission = vi.fn();
const campaignWebhook = vi.fn();

vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac/server")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});

vi.mock("@/lib/pipeline/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/pipeline/server")>();
  return { ...actual, campaignWebhook: () => campaignWebhook() };
});

// Keep the test off the network: neither helper is what we're exercising.
vi.mock("@/lib/portal/server", () => ({
  fetchSuppressedEmails: async () => new Set<string>(),
  insertPortalEvents: async () => true,
}));
vi.mock("@/lib/pipeline/sectorStore", () => ({
  loadPlaybooks: async () => [],
  playbookPdfUrl: () => null,
}));

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "kane@apmgservices.com.au" });
});

function sendReq(body: unknown): Request {
  return new Request("http://local/api/pipeline/campaigns/send", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

const BODY = {
  campaign: "test-campaign",
  subject: "Hello {{business}}",
  bodyHtml: "<p>Hi {{business}} — {{link}}</p>",
  recipients: [{ id: "11111111-1111-4111-8111-111111111111", business: "Acme", email: "a@acme.test" }],
};

describe("POST /api/pipeline/campaigns/send — never reports an unsent campaign as sent", () => {
  it("503s with sent: 0 when the automation is PAUSED", async () => {
    campaignWebhook.mockResolvedValue({ state: "paused", url: "https://n8n.example/h", source: "setting" });
    const res = await POST(sendReq(BODY));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.sent).toBe(0);
    expect(data.mode).toBe("paused");
    expect(data.error).toMatch(/paused/i);
  });

  it("503s with sent: 0 when no automation is configured", async () => {
    campaignWebhook.mockResolvedValue({ state: "unconfigured" });
    const res = await POST(sendReq(BODY));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.sent).toBe(0);
    expect(data.mode).toBe("unconfigured");
  });

  it("never answers ok: true with a non-zero sent count unless the webhook was live", async () => {
    for (const state of [{ state: "paused", url: "u", source: "env" }, { state: "unconfigured" }]) {
      campaignWebhook.mockResolvedValue(state);
      const data = await (await POST(sendReq(BODY))).json();
      expect(data.ok && data.sent > 0).toBe(false);
    }
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/api/pipeline/campaigns/send/route.test.ts`
Expected: FAIL — the route answers 200 with `ok: true`, `sent: 1`.

- [ ] **Step 3: Make the route fail closed**

Widen the type at `send/route.ts:61`:

```ts
type SendMode = "live" | "unconfigured" | "paused" | "noop";
```

Replace the branch at `:251-256`:

```ts
  const target = await campaignWebhook();
  if (target.state !== "ok") {
    // NEVER report a send that did not happen. "paused" is called out
    // separately from "unconfigured" because it is the dangerous one: the
    // operator configured n8n, later switched the Integrations toggle off,
    // and would otherwise be told the whole campaign went out.
    const error =
      target.state === "paused"
        ? "The campaign automation is paused. Switch it back on under Integrations to send."
        : "No campaign automation is configured, so nothing can be sent.";
    console.error(`[pipeline/campaigns] refusing to send: webhook is ${target.state}.`);
    return json({ ok: false, sent: 0, mode: target.state, campaign, error }, 503);
  }
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/api/pipeline/campaigns/send/route.test.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Update the send UI to match**

In `components/apmg/pipeline/SendCampaigns.tsx`:

- `:73` → `type SendMode = "live" | "unconfigured" | "paused" | "noop";`
- `:891` — the fallback mode on a malformed response must not claim success:
  ```ts
  setResult({ sent, mode: data.mode ?? "unconfigured", campaign: data.campaign ?? tag });
  ```
- `:967` — replace the `(demo mode)` suffix, which read as a harmless note, with a real failure line:
  ```tsx
  result.mode === "live"
    ? `Done. Sent ${result.sent} email${result.sent === 1 ? "" : "s"}.`
    : result.mode === "paused"
      ? "Nothing was sent — the campaign automation is paused. Switch it on under Integrations."
      : "Nothing was sent — no campaign automation is configured."
  ```
  Keep the surrounding element's existing classes; only the text expression changes. Check the success/failure styling branch around `:960-990` renders the non-live case in the error tone rather than the success tone.

- [ ] **Step 6: Verify the whole suite and types**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add app/api/pipeline/campaigns/send/route.ts app/api/pipeline/campaigns/send/route.test.ts components/apmg/pipeline/SendCampaigns.tsx
git commit -m "fix: never report a paused or unconfigured campaign as sent"
```

---

### Task 3: The lead importer stops reporting rows it never stored

Same defect class as Task 2, at `app/api/pipeline/upload/route.ts:107-108`: `{ok: true, inserted: rows.length, mode: "demo"}` for rows that were never written.

**Files:**
- Modify: `app/api/pipeline/upload/route.ts:18` (type), `:104-109` (the branch)
- Test: `app/api/pipeline/upload/route.test.ts` (create)

**Interfaces:**
- Consumes: `requireLiveSupabase` from Task 1.
- Produces: `UploadMode = "live" | "unconfigured" | "noop"`.

- [ ] **Step 1: Write the failing test**

Create `app/api/pipeline/upload/route.test.ts`:

The route guards on `pipeline.import`, and `@/lib/rbac/server` does `import "server-only"` — both mocks are required or the file will not even load.

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));

const requirePermission = vi.fn();
vi.mock("@/lib/rbac/server", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rbac/server")>();
  return { ...actual, requirePermission: (...a: unknown[]) => requirePermission(...a) };
});

import { POST } from "./route";

beforeEach(() => {
  vi.clearAllMocks();
  requirePermission.mockResolvedValue({ ok: true, role: "admin", email: "kane@apmgservices.com.au" });
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  vi.stubEnv("NODE_ENV", "production");
});

afterEach(() => {
  vi.unstubAllEnvs();
});

function uploadReq(rows: unknown[]): Request {
  return new Request("http://local/api/pipeline/upload", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ rows, batch: "test-batch" }),
  });
}

const ROW = { name: "Acme Childcare", email: "a@acme.test", category: "childcare" };

describe("POST /api/pipeline/upload — never reports an import that did not happen", () => {
  it("503s with inserted: 0 when Supabase is unconfigured on a deployed runtime", async () => {
    const res = await POST(uploadReq([ROW, ROW]));
    const data = await res.json();
    expect(res.status).toBe(503);
    expect(data.ok).toBe(false);
    expect(data.inserted).toBe(0);
  });

  it("still allows the local demo path off a deployed runtime", async () => {
    vi.stubEnv("NODE_ENV", "development");
    const res = await POST(uploadReq([ROW]));
    expect(res.status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- app/api/pipeline/upload/route.test.ts`
Expected: FAIL — the first case answers 200 with `inserted: 2`.

- [ ] **Step 3: Make the route fail closed**

At `upload/route.ts:18`:

```ts
type UploadMode = "live" | "unconfigured" | "noop";
```

Replace `:104-109`:

```ts
  const target = supabaseTarget();
  // Never claim an import that did not land. On a deployed runtime an
  // unconfigured database is an outage, not a demo.
  const blocked = requireLiveSupabase("pipeline/upload");
  if (blocked) return blocked;
  if (target.state === "demo") {
    // Developer machine only (requireLiveSupabase let us through) — the
    // importer UI stays exercisable without Supabase, and says so.
    return json({ ok: true, inserted: rows.length, mode: "unconfigured", batch });
  }
```

Add `requireLiveSupabase` to the existing `@/lib/pipeline/server` import at the top of the file.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- app/api/pipeline/upload/route.test.ts`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add app/api/pipeline/upload/route.ts app/api/pipeline/upload/route.test.ts
git commit -m "fix: 503 the lead importer rather than reporting phantom inserts"
```

---

### Task 4: Fail-closed sweep across the remaining routes

Ten further route files degrade to demo. Apply `requireLiveSupabase()` as the first thing after the existing auth/permission checks in each — **except three public carve-outs**. Together with Tasks 2 and 3 this accounts for all 15 route files that carry a demo path.

**Files (apply the guard):**
- Modify: `app/api/portal/inquiries/route.ts:147, 342, 365, 441, 498`
- Modify: `app/api/portal/lead-summary/route.ts:294`
- Modify: `app/api/portal/lead-activity/route.ts:147, 374`
- Modify: `app/api/portal/report/route.ts:102`
- Modify: `app/api/portal/summary/route.ts:86`
- Modify: `app/api/pipeline/batches/route.ts:31`
- Modify: `app/api/pipeline/leads/route.ts:58, 203, 300`
- Modify: `app/api/pipeline/campaigns/find-emails/route.ts:172`
- Modify: `app/api/sales/queue/route.ts:160`
- Modify: `app/api/sales/handoff/route.ts:188`

**Files (carve-outs — leave the demo branch, add the comment):**
- `app/api/portal/events/route.ts:112`
- `app/t/[id]/route.ts:81`
- `app/api/portal/unsubscribe/route.ts`

**Interfaces:**
- Consumes: `requireLiveSupabase(label)` from Task 1.
- Produces: nothing new.

- [ ] **Step 1: Apply the guard to each non-carve-out route**

For each file and line above, insert immediately before the existing `if (target.state === "demo")` branch, using the route's own path as the label:

```ts
  const blocked = requireLiveSupabase("portal/summary");
  if (blocked) return blocked;
```

Add `requireLiveSupabase` to that file's existing `@/lib/pipeline/server` import. Leave the `demo` branch below it in place — it is now reachable only on a developer machine, which is exactly the intent. Where a file has several demo branches (`inquiries`, `leads`, `lead-activity`), guard each one; they are separate HTTP methods.

For `find-emails/route.ts:172`, the target is a `WebhookTarget`, not Supabase — replace Task 1's temporary check with a real message:

```ts
  const target = await emailFinderWebhook();
  if (target.state !== "ok") {
    const error =
      target.state === "paused"
        ? "The email-finder automation is paused. Switch it on under Integrations."
        : "No email-finder automation is configured.";
    return json({ ok: false, mode: target.state, results: [], found: 0, saved: 0, error }, 503);
  }
```
Widen `FindMode` at `:32` to `"live" | "unconfigured" | "paused" | "noop"` and mirror it at `SendCampaigns.tsx:79` (`FindInfo`), whose `mode` field is currently `"live" | "demo"`. `SendCampaigns.tsx:450` (`data.mode === "demo" ? "demo" : "live"`) becomes `data.mode === "live" ? "live" : "unconfigured"`, and the `findInfo` render should surface a paused finder as an error rather than silence.

For `portal/inquiries/route.ts:342` (the enquiry-notify webhook), a paused notifier must **not** fail the visitor's enquiry submission — the enquiry itself is already stored. Log and continue:

```ts
    const target = await enquiryNotifyWebhook();
    if (target.state !== "ok") {
      // The enquiry is already persisted; the operator just won't get an email.
      // Failing the visitor's submission over a paused notifier would be worse.
      console.error(`[portal/inquiries] enquiry notification skipped: webhook is ${target.state}.`);
    } else {
      // ...existing POST to target.url
    }
```

- [ ] **Step 2: Comment the three carve-outs in place**

These are reached by real leads from real emails. A 503 here breaks the product for the exact people it is meant to serve. Add above each existing demo branch:

```ts
  // FAIL-CLOSED CARVE-OUT. This is a public visitor endpoint reached from an
  // outreach email, not a console surface. 503-ing it when Supabase is
  // unconfigured would break the link for a real lead, so it degrades quietly
  // instead. It renders no data into the console, so it cannot fabricate.
```

For `app/api/portal/unsubscribe/route.ts` extend that comment — this one is not merely a UX carve-out:

```ts
  // Additionally: an unsubscribe link that errors is a compliance problem, not
  // just a broken page (Spam Act 2003 (Cth) requires a functional opt-out on
  // commercial electronic messages). This endpoint must answer even when the
  // database behind it does not.
```

- [ ] **Step 3: Verify no non-carve-out demo branch is left unguarded**

Run:
```bash
grep -rn 'state === "demo"' app/ --include=*.ts
```
Expected: every hit is either preceded by a `requireLiveSupabase` call within the preceding 3 lines, or is in one of `app/api/portal/events/route.ts`, `app/t/[id]/route.ts`, `app/api/portal/unsubscribe/route.ts`.

- [ ] **Step 4: Verify the suite and types**

Run: `npm test && npx tsc --noEmit`
Expected: all green. `lib/pipeline/server.test.ts` from Task 1 is the regression guard for this rule.

- [ ] **Step 5: Commit**

```bash
git add app/
git commit -m "feat: fail closed on unconfigured infrastructure across console routes"
```

---

### Task 5: Delete the telemetry and enquiry presets

`DEMO_LEAD_ACTIVITY` and friends are five invented Melbourne lead trails with tuned totals. The amber banner discloses them, but the data is deliberately believable and any screenshot below the fold reads as production.

**No automated test covers this task** — the suite has no component tests, so the presets are deleted outright rather than guarded. Verify by hand in Step 5.

**Files:**
- Modify: `lib/data/leadActivity.ts:211-345` (delete `DEMO_PORTAL_URL`, `DEMO_PACK_URL`, `hoursAgo`, `DEMO_LEAD_ACTIVITY`, `DEMO_ANONYMOUS`, `DEMO_ACTIVITY_TOTALS`)
- Modify: `lib/data/enquiries.ts:172-…` (delete `DEMO_SUMMARY`, `DEMO_INQUIRIES`)
- Modify: `components/apmg/TelemetryPage.tsx:22-24, 752-762, 1091-1103`
- Modify: `components/apmg/EnquiriesPage.tsx:23-24, 36, 979, 1018`
- Modify: `components/apmg/useLeadBriefs.ts:5, 127-133`

**Interfaces:**
- Consumes: nothing.
- Produces: nothing. Pure deletion plus honest empty states.

- [ ] **Step 1: Delete the preset data, keep every type**

From `lib/data/leadActivity.ts`, delete everything from the `/* ─── demo dataset ─── */` banner at `:211` to the end of `DEMO_ACTIVITY_TOTALS`. Keep `LeadActivity`, `AnonymousActivity`, `ActivityTotals`, `isHiddenEvent`, `serviceName` and the label mapping — components import all of them.

From `lib/data/enquiries.ts`, delete `DEMO_SUMMARY` (`:172`) and `DEMO_INQUIRIES` (`:234`). Keep `PortalSummary`, `PortalInquiry` and the rest of the module.

Update each file's header comment — both currently explain when the `DEMO_*` constants render.

- [ ] **Step 2: Replace the Telemetry demo branch with an honest state**

In `components/apmg/TelemetryPage.tsx`, drop the three `DEMO_*` imports at `:22-24`. Replace the branch at `:752-762`:

```tsx
      // Not connected: show nothing and say why. Previously this swapped in a
      // believable preset, which is indistinguishable from real telemetry in a
      // screenshot — the reason this page had to stop doing it.
      if (act?.mode === "demo" || sum?.mode === "demo") {
        settle({
          status: "ready",
          mode: "demo",
          needsMigration: act?.needsMigration === true || sum?.needsMigration === true,
          leads: [],
          anonymous: { visitors: 0, events: 0, topServices: [] },
          totals: { attributionClicks: 0, portalViews: 0, serviceOpens: 0, inquiries: 0 },
        });
        return;
      }
```

Those literals are the zero value of every field in `AnonymousActivity` (`lib/data/leadActivity.ts:63-68`) and `ActivityTotals` (`:82-87`).

Reword the banner at `:1097-1099` so it no longer says "Demo data":

```tsx
              {ready.needsMigration
                ? "Not connected — the portal telemetry tables are missing. Run supabase/portal-telemetry.sql in the Supabase SQL editor to see real click activity."
                : "Not connected — configure Supabase and run supabase/portal-telemetry.sql to see real click activity."}
```

- [ ] **Step 3: Do the same for Enquiries**

In `components/apmg/EnquiriesPage.tsx`, drop the `DEMO_INQUIRIES`, `DEMO_SUMMARY` (`:23-24`) and `DEMO_LEAD_ACTIVITY` (`:36`) imports.

- `:979` → `setActivity({ status: "ready", byLead: indexTrails([]) });`
- `:1018` → `setLoad({ status: "ready", mode: "demo", summary: emptySummary(), inquiries: [] });`

Add this helper beside the component — it is the zero value of every field in `PortalSummary` (`lib/data/enquiries.ts:57-89`):

```ts
/** All-zero summary for the not-connected state — the page renders its real
 *  structure with no numbers rather than invented ones. */
function emptySummary(): PortalSummary {
  return {
    mode: "demo",
    totals: {
      attributionClicks: 0,
      portalViews: 0,
      serviceOpens: 0,
      inquiries: 0,
      uniqueVisitors: 0,
    },
    byService: [],
    byCategory: [],
    bySource: [],
    recentEvents: [],
  };
}
```

The page already has the amber banner at `:1296-1302`. Reword its text so it no longer announces demo data:

```tsx
              Not connected — configure Supabase and run supabase/portal-telemetry.sql to see real enquiries.
```

- [ ] **Step 4: Do the same for `useLeadBriefs`**

In `components/apmg/useLeadBriefs.ts`, drop the `DEMO_INQUIRIES` import at `:5`, and at `:127-133` replace the demo branch with `setEnquiries(indexEnquiries([]))`.

- [ ] **Step 5: Verify by hand — there is no test for this**

Run: `npx tsc --noEmit` (expect no errors — a missed import site fails here), then:

```bash
# unset Supabase so the app takes the not-connected path
SUPABASE_URL= SUPABASE_SERVICE_ROLE_KEY= npm run dev
```

Open the console and check System → Telemetry and the Enquiries tab. Expected: empty states and a "Not connected" banner. **No invented business names, no non-zero counts.** Confirm neither page crashes.

Then confirm nothing references the deleted constants:
```bash
grep -rn "DEMO_LEAD_ACTIVITY\|DEMO_ANONYMOUS\|DEMO_ACTIVITY_TOTALS\|DEMO_SUMMARY\|DEMO_INQUIRIES" --include=*.ts --include=*.tsx .
```
Expected: no output.

- [ ] **Step 6: Commit**

```bash
git add lib/data/leadActivity.ts lib/data/enquiries.ts components/apmg/TelemetryPage.tsx components/apmg/EnquiriesPage.tsx components/apmg/useLeadBriefs.ts
git commit -m "feat: remove fabricated telemetry and enquiry datasets"
```

---

### Task 6: Delete the sales preset and the invented rep name

`SALES_REP = "Dana Okafor"` (`lib/data/sales.ts:274`) renders unguarded on the live Sales header at `SalesPage.tsx:1030` — an invented human name printed over real data. `SALES_LEADS` is an eight-record preset that reads as a real queue.

**No automated test covers this task.** Verify by hand in Step 5.

**Files:**
- Modify: `lib/data/sales.ts` — delete `:50-272` (`SALES_LEADS`) and `:274` (`SALES_REP`); keep `:13-48` (the types)
- Modify: `components/apmg/SalesProvider.tsx:20, 294-312`
- Modify: `components/apmg/SalesPage.tsx:23, 860, 1030`
- Modify: `components/apmg/DashboardShell.tsx:141`

**Interfaces:**
- Consumes: `SessionUser` from `components/apmg/Sidebar.tsx` — already used this way by `OverviewPage` (`OverviewPage.tsx:294`).
- Produces: `SalesPage({ user }: { user?: SessionUser })`.

- [ ] **Step 1: Delete the preset data, keep the types**

In `lib/data/sales.ts`, delete `SALES_LEADS` and `SALES_REP`. Keep `SalesStatus` (`:13`) and `SalesLead` (`:15-48`) — `SalesProvider`, `SalesPage` and five other components import them. The file should end up around 48 lines. Update the header comment, which describes the preset.

- [ ] **Step 2: Replace the SalesProvider demo seeding with an error state**

In `components/apmg/SalesProvider.tsx`, change the import at `:20` to types only:

```ts
import { type SalesLead, type SalesStatus } from "@/lib/data/sales";
```

Replace the demo branch at `:294-312`:

```ts
      if (data.mode === "demo") {
        // No database configured. Show an empty queue and an explicit error
        // rather than a preset — an invented queue of plausible businesses is
        // indistinguishable from a real one.
        setMode("demo");
        setRows([]);
        setRecentRows([]);
        setHandoffs([]);
        setTotal(0);
        setEngagedTotal(0);
        setNeedsMigration(false);
        setClosedDeals([]);
        setError("Not connected to the database — no leads can be shown.");
      } else {
```

Delete the now-unused `demoSeeded` ref (search the file for `demoSeeded` and remove its declaration).

- [ ] **Step 3: Take the rep name from the session**

In `components/apmg/SalesPage.tsx`:

- `:23` → `import { type SalesLead, type SalesStatus } from "@/lib/data/sales";`
- add `import { type SessionUser } from "./Sidebar";` alongside the existing imports
- `:860` → `export function SalesPage({ user }: { user?: SessionUser }) {`
- `:1030` → render the real signed-in person, and render nothing rather than a placeholder when unknown:

```tsx
              Leads admin has reviewed and handed over land here, newest first — ready to call.
              {user?.name ? <> · <span className="text-foreground/80">{user.name}</span></> : null}
```

In `components/apmg/DashboardShell.tsx:141` → `<SalesPage user={user} />` (the component already holds `user`; `OverviewPage.tsx:131` does exactly this).

- [ ] **Step 4: Confirm nothing still imports the presets**

Run:
```bash
grep -rn "SALES_LEADS\|SALES_REP" --include=*.ts --include=*.tsx .
npx tsc --noEmit
```
Expected: no grep output, no type errors.

- [ ] **Step 5: Verify by hand — there is no test for this**

Start the app with Supabase unset as in Task 5 Step 5. Open the Sales tab. Expected: an empty queue with "Not connected to the database", **no eight preset businesses**. Then start it with real Supabase credentials and confirm the header shows your own signed-in name — not "Dana Okafor", and not a blank artefact.

- [ ] **Step 6: Commit**

```bash
git add lib/data/sales.ts components/apmg/SalesProvider.tsx components/apmg/SalesPage.tsx components/apmg/DashboardShell.tsx
git commit -m "feat: remove the sales preset queue and the invented rep name"
```

---

### Task 7: Suppress scanner clicks that spoof a browser User-Agent

Beyond the spec. `isBotRequest` (`lib/portal/server.ts:241-245`) matches on User-Agent only. A scanner presenting a normal Chrome string still writes an `attribution_click`, flips `leads.engaged`, and lights the Telemetry trail — a false positive that reads as a hot lead. Two signals catch what the UA misses: a click landing seconds after the email was sent is not a human, and the same lead re-hitting the same link within a minute is one visit.

The decision logic is a pure function so the suite can cover it; the route does the I/O.

**Files:**
- Modify: `lib/portal/server.ts` — append `classifyClick` and `readClickHistory`
- Create: `lib/portal/clickFilter.test.ts`
- Modify: `app/t/[id]/route.ts:80-88`

**Interfaces:**
- Consumes: `lookupLead`, `insertPortalEvents` (existing, unchanged).
- Produces:
  - `SCANNER_WINDOW_MS = 10_000`, `CLICK_DEDUPE_MS = 60_000`
  - `classifyClick(opts: { nowMs: number; lastSentMs: number | null; lastClickMs: number | null }): "record" | "too-fast" | "duplicate"`
  - `readClickHistory(base: string, key: string, leadId: string): Promise<{ lastSentMs: number | null; lastClickMs: number | null }>`

- [ ] **Step 1: Write the failing test**

Create `lib/portal/clickFilter.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { CLICK_DEDUPE_MS, SCANNER_WINDOW_MS, classifyClick } from "./server";

const NOW = 1_754_700_000_000; // fixed instant; the function must never read the clock

describe("classifyClick", () => {
  it("records a click from a lead with no send on file", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: null, lastClickMs: null })).toBe("record");
  });

  it("records a click a plausible interval after the send", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW - 4 * 60_000, lastClickMs: null })).toBe("record");
  });

  it("rejects a click landing within the scanner window of the send", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW - 2_000, lastClickMs: null })).toBe("too-fast");
  });

  it("treats the scanner window as exclusive at its boundary", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW - SCANNER_WINDOW_MS, lastClickMs: null })).toBe("record");
  });

  it("rejects a repeat click inside the dedupe window", () => {
    expect(
      classifyClick({ nowMs: NOW, lastSentMs: NOW - 3_600_000, lastClickMs: NOW - 5_000 }),
    ).toBe("duplicate");
  });

  it("records a genuine second visit after the dedupe window", () => {
    expect(
      classifyClick({ nowMs: NOW, lastSentMs: NOW - 3_600_000, lastClickMs: NOW - CLICK_DEDUPE_MS - 1 }),
    ).toBe("record");
  });

  it("reports too-fast ahead of duplicate when both apply", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW - 1_000, lastClickMs: NOW - 1_000 })).toBe("too-fast");
  });

  it("ignores a send timestamp in the future rather than rejecting the click", () => {
    expect(classifyClick({ nowMs: NOW, lastSentMs: NOW + 60_000, lastClickMs: null })).toBe("record");
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm test -- lib/portal/clickFilter.test.ts`
Expected: FAIL — `classifyClick` is not exported.

- [ ] **Step 3: Implement the classifier**

Append to `lib/portal/server.ts`:

```ts
/**
 * A human cannot receive an email, open it, read it and click inside this
 * window. A hit that fast is an automated scanner that got past the
 * User-Agent filter by presenting a browser string.
 */
export const SCANNER_WINDOW_MS = 10_000;

/** Repeat hits on the same tracked link inside this window are one visit —
 *  a preloading browser, a double tap, a client that retries the redirect. */
export const CLICK_DEDUPE_MS = 60_000;

/**
 * Decide whether a tracked-link hit is real lead activity. Pure: the caller
 * supplies the clock and the two timestamps, so this is fully testable and
 * the redirect path stays the only place that does I/O.
 *
 * A future-dated send is ignored rather than treated as suspicious — clock
 * skew between the automation and this app must not silently drop real clicks.
 */
export function classifyClick(opts: {
  nowMs: number;
  lastSentMs: number | null;
  lastClickMs: number | null;
}): "record" | "too-fast" | "duplicate" {
  const { nowMs, lastSentMs, lastClickMs } = opts;
  if (lastSentMs !== null && lastSentMs <= nowMs && nowMs - lastSentMs < SCANNER_WINDOW_MS) {
    return "too-fast";
  }
  if (lastClickMs !== null && lastClickMs <= nowMs && nowMs - lastClickMs < CLICK_DEDUPE_MS) {
    return "duplicate";
  }
  return "record";
}

/** Most recent email_sent and attribution_click timestamps for one lead.
 *  Both null on any failure — an unreadable history must never cost a real
 *  lead their recorded click. */
export async function readClickHistory(
  base: string,
  key: string,
  leadId: string,
): Promise<{ lastSentMs: number | null; lastClickMs: number | null }> {
  if (!isUuid(leadId)) return { lastSentMs: null, lastClickMs: null };
  const latest = async (event: string): Promise<number | null> => {
    try {
      const res = await fetch(
        `${base}/rest/v1/portal_events?select=created_at&lead_id=eq.${encodeURIComponent(leadId)}` +
          `&event=eq.${event}&order=created_at.desc&limit=1`,
        { headers: { apikey: key, Authorization: `Bearer ${key}` }, cache: "no-store" },
      );
      if (!res.ok) return null;
      const rows = (await res.json().catch(() => [])) as Array<{ created_at?: string }>;
      const ts = Array.isArray(rows) && rows[0]?.created_at ? Date.parse(rows[0].created_at) : NaN;
      return Number.isFinite(ts) ? ts : null;
    } catch {
      return null;
    }
  };
  const [lastSentMs, lastClickMs] = await Promise.all([latest("email_sent"), latest("attribution_click")]);
  return { lastSentMs, lastClickMs };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm test -- lib/portal/clickFilter.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 5: Consult the classifier on the redirect path**

In `app/t/[id]/route.ts`, add `classifyClick`, `readClickHistory` to the existing `@/lib/portal/server` import, then replace `:80-88`:

```ts
  const target = supabaseTarget();
  let verdict: "record" | "too-fast" | "duplicate" | "skipped" = skip ? "skipped" : "record";

  if (!skip && target.state === "ok" && isUuid(id)) {
    // The UA filter above catches scanners that announce themselves. This
    // catches the ones that don't: nobody reads an email and clicks inside
    // SCANNER_WINDOW_MS, and a repeat hit inside CLICK_DEDUPE_MS is one visit.
    const history = await readClickHistory(target.base, target.key, id);
    verdict = classifyClick({ nowMs: Date.now(), ...history });

    if (verdict === "record") {
      // Persist before redirecting — serverless runtimes can kill work left
      // pending after the response, and a click is a one-shot signal.
      await Promise.allSettled([
        recordAttributionClick(target.base, target.key, req, id, campaign, destination),
        markLeadEngaged(target.base, target.key, id),
      ]);
    }
  }
```

Extend the operator trace at `:71-78` with `verdict` so a dropped click is still visible in the log. Move that `console.info` below the block above so `verdict` is populated when it runs — it currently sits at `:71`, before the write.

A `too-fast` or `duplicate` hit still redirects normally and still sets the attribution cookie (unlike `skip`) — the visitor may well be the real lead, and a suppressed *first* click must not cost us attribution on their later pageviews. Leave the cookie logic at `:99-111` untouched.

- [ ] **Step 6: Verify the whole suite and types**

Run: `npm test && npx tsc --noEmit`
Expected: all green.

- [ ] **Step 7: Commit**

```bash
git add lib/portal/server.ts lib/portal/clickFilter.test.ts app/t/[id]/route.ts
git commit -m "feat: suppress scanner clicks that spoof a browser User-Agent"
```

---

## Verification after all tasks

- [ ] `npm test` — full suite green
- [ ] `npx tsc --noEmit` — no type errors
- [ ] `npm run lint`
- [ ] `npm run build` — the production build is what enforces `isProductionRuntime`
- [ ] `grep -rn "DEMO_\|SALES_LEADS\|SALES_REP" --include=*.ts --include=*.tsx lib/ components/` returns nothing outside test files
- [ ] With Supabase unset and `NODE_ENV=production`, every console tab shows an error or an empty state — no plausible-looking rows anywhere
- [ ] With Supabase live and the campaign toggle switched **off** under Integrations, a send attempt reports "Nothing was sent — the campaign automation is paused", not a count

## Known gaps after this plan

- **Sales status is still in-memory.** `markContacted`, `markLost`, `closeDeal` and `revertStatus` still mutate React state only, and a reload still resets every lead to `new`. That is the audit-trail plan's job; it is the one piece of fabrication deletion cannot fix.
- **`lib/data/hotLeads.ts`** carries `mode: "demo"` branches (`:248, 344, 378`) that derive from the guarded routes rather than holding presets of their own. They go quiet once the routes 503, but re-read the file after Task 4 to confirm none of them synthesises figures.
- **`compose/route.ts:165`** returns `demoDraft(...)` AI drafts. These are visibly placeholder copy rather than fake *data*, and an operator reviews every draft before sending, so they are left alone deliberately.
