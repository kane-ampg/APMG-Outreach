# Session 04 — Fixing Next.js Dev-Server ENOENT / Turbopack Cache Corruption

> **Session ID:** `1cf2c10f-c337-4655-810b-8f2bc1d6232f`
> **Date:** 2026-06-29, 02:53–02:56 local (~3 minutes)
> **Status:** Resolved ✅
> **Primary tools used:** PowerShell (9 calls), Read (4 calls)
> **Related sessions:** [01-ui-foundation-dashboard.md](01-ui-foundation-dashboard.md) · [02-integrations-tab-n8n.md](02-integrations-tab-n8n.md) · [03-api-search-integration.md](03-api-search-integration.md) · [05-session-documentation.md](05-session-documentation.md) · [10-eod-update-chunkload-fix.md](10-eod-update-chunkload-fix.md)

> 🔁 **Related recurrence:** a later session hit a *different* `.next` corruption — a `ChunkLoadError` from one `.next` directory holding **both** a production build and a dev session (vs. the three-servers-sharing-`.next` `ENOENT` here). See **[Session 10](10-eod-update-chunkload-fix.md)**.

## Objective

The user pasted a wall of Next.js dev-server errors — repeated `ENOENT` failures opening `.next/dev/routes-manifest.json` and `.next/dev/server/app/page/build-manifest.json`, plus `Cannot find module '../chunks/ssr/[turbopack]_runtime.js'` — with the home route returning `500`. They wanted it fixed so the dev server boots and serves the app again.

## TL;DR

The root cause was not a one-off corrupt file: **three separate Next.js servers were running against the same `leadgen` directory simultaneously** (two `next dev` plus one `next start`), all writing to the same `.next/dev` cache and continuously clobbering each other's Turbopack manifests and runtime chunks. The fix was to stop all three server process trees, delete the corrupted `.next` directory, and start a single clean dev server. After that, the home route compiled cleanly and returned `200`. The session changed no repository files — it was pure operational diagnosis and remediation.

## What happened

1. **Initial read of the symptoms.** The assistant recognized the error signature (missing manifests + missing `[turbopack]_runtime.js`) as a corrupted Turbopack dev cache, typically from a dev server interrupted mid-build. The working hypothesis was the standard "stop server, delete `.next`, restart" — but the assistant verified before acting.

2. **Inspected running processes and project setup.** A PowerShell query enumerated Node processes with their command lines, and [package.json](../../package.json) was read to confirm the scripts (`"dev": "next dev"`, `"start": "next start"`, etc.) and that this is `apmg-leadgen` on `next ^16.2.0` / React 19.

3. **Identified the real root cause.** The process list revealed **three** Next.js servers bound to the same project directory at once:

   | Process (parent) | Command | Port |
   |---|---|---|
   | PID 36740 | `npm run dev` | 3000 |
   | PID 28540 | `next dev -p 3217` (a *second* dev server) | 3217 |
   | PID 17948 | `next start -p 3210` (a production server) | 3210 |

   All three write to one `.next/dev` folder. Turbopack assumes exclusive ownership of that directory, so the servers kept overwriting and deleting each other's manifests and runtime chunks mid-build — exactly producing the `routes-manifest.json` / `build-manifest.json` ENOENT errors and the missing `[turbopack]_runtime.js`. No amount of cache-clearing fixes this while more than one server owns the directory.

4. **Stopped the conflicting server trees.** A PowerShell call killed the three server parents; most child processes cascaded down automatically when their parents were terminated. The `chrome-devtools-mcp` and Cursor/tsserver processes were deliberately left untouched.

5. **Verified nothing Next-related remained**, then **deleted the corrupted `.next` directory** (`Deleted .next`).

6. **Started a single clean dev server in the background** and waited for it to compile. The output confirmed `▲ Next.js 16.2.9 (Turbopack)` and `✓ Ready in 596ms` on port 3000.

7. **Confirmed the route actually serves.** An HTTP request to `http://localhost:3000/` returned `Status: 200`, and the server log showed `GET / 200 in 2.9s` — no manifest or Turbopack errors. The original `500` was gone.

8. **Handled a "failed" background-task notification.** The background dev-server task reported `failed` (exit code 1). The assistant re-read its output, saw the clean `✓ Ready` / `GET / 200` log ending in the `[?25h` cursor-restore escape sequence, and correctly diagnosed this as a benign process *termination* (not a build crash). A follow-up process check found exactly **one** healthy `next dev` running (PID 39404, listening on 3000 via child PID 9148) — the user's own freshly started server — with no duplicates and no `next start` conflict. A final HTTP check returned `200`.

## Files created / modified

This session changed **no repository files**. It was purely operational: process management, deleting the `.next` build cache (a generated directory, not source), and HTTP/process verification. The only file written this session is this documentation entry itself.

| File | Type | Purpose |
|---|---|---|
| `.next/` (deleted) | removed (generated artifact) | Corrupted Turbopack dev cache; deleted to force a clean rebuild — not source-controlled |

## Key decisions & rationale

- **Verify before clearing the cache.** Rather than blindly running the usual "delete `.next` and restart," the assistant first enumerated running processes — which is what surfaced the true root cause (three servers), something a plain cache wipe would not have permanently fixed.
- **Kill only the offending server trees; leave tooling alone.** `chrome-devtools-mcp` and Cursor/tsserver processes were intentionally preserved so the user's editor/MCP environment stayed intact.
- **Treat the background-task "failed" status skeptically.** Exit code 1 plus a clean `✓ Ready` / `200` log ending in `[?25h` was correctly read as a terminated (not crashed) process, avoiding a false regression alarm.
- **Recommend prevention via single-server discipline or per-instance `distDir`** rather than applying a config change unprompted (see Follow-ups).

## Problems encountered & resolutions

- **`ENOENT` on `routes-manifest.json` / `build-manifest.json` and missing `[turbopack]_runtime.js`** → caused by multiple servers sharing one `.next/dev`; resolved by stopping all but one server and deleting `.next`.
- **Background dev-server task reported `failed` (exit code 1).** This was a false alarm — the log showed a clean boot and a `200` response, and the exit was a normal termination (the `[?25h` cursor-restore sequence), not a build failure. No action needed; a subsequent process check confirmed a healthy single server was running.
- **Caveat — the surviving server is the user's, not the assistant's.** The assistant's temporary background dev server was terminated; the final healthy server on port 3000 (PID 39404) is one the user started independently. The end state is correct and verified, but the running process is owned outside this session.

## Outcome & final state

At session end, all of the following were verified:

- The corrupted `.next` directory was deleted and rebuilt fresh.
- The three conflicting servers were stopped; no duplicate `next dev` and no conflicting `next start` remained.
- Exactly **one** `next dev` server was running on **port 3000** (PID 39404 → child PID 9148).
- `http://localhost:3000/` returned **200** with no manifest or Turbopack runtime errors.

The original errors are resolved. No source or config files were modified, so there is nothing to commit from this session.

## Follow-ups / open items

- **Prevent recurrence — keep one dev server per folder.** The trigger is launching more than one server against this directory. If port 3000 is already taken, stop the existing server before starting another rather than spinning up a second port.
- **Optional config hardening (not applied this session).** If multiple instances are genuinely needed (e.g. `next dev` alongside a `next start`), give each its own `distDir` (e.g. `distDir: '.next-dev'`) in [next.config.mjs](../../next.config.mjs) so they don't share `.next`. As of this session `next.config.mjs` still contains only `reactStrictMode: true` — this suggestion was not implemented.

## Verbatim user requests

> fix this for me please - Error: ENOENT: no such file or directory, open 'C:\Users\Itachi\Desktop\APMG\leadgen\.next\dev\routes-manifest.json' … Error: Cannot find module '../chunks/ssr/[turbopack]_runtime.js' … GET / 500 in 235ms

(The only other inbound message was the automated `<task-notification>` reporting the background dev-server task as `failed` — diagnosed above as a benign termination, not a user request.)
