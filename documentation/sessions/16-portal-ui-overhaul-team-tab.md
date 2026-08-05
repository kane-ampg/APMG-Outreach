# Session 16 — Image-driven portal UI overhaul (Our Team tab + hero)

> **Session ID:** `bed77724-e804-402e-a66c-41ffec59bd19`
> **Date:** 2026-07-12
> **Status:** Shipped (with one unresolved 404 reported at the very end)

## Objective
Build a customer-facing "Our Team" surface for the public `/portal`, driven by screenshots the user pasted in, then iterate on the portal's layout and hero based on live visual feedback — width, hero image fit, light-mode default, per-tab hero image/copy, and edge-clipping fixes. Midway through, apply the `frontend-design` skill to give the team surface a distinctive, in-system identity.

## TL;DR
- Scraped the 9-person APMG team roster from the live WordPress site, **self-hosted** the headshots in `app/team/` (28 MB of camera originals → 478 KB of uniform 640×640 crops via Pillow).
- Built `TeamSection.tsx`, first as a centred avatar grid, then — under the `frontend-design` skill — **reframed it as a "crew roster"** borrowing the app's telemetry-console vernacular (`SignalLed`, `09 ACTIVE` tally, mono roster indices `01/09`, hover-ignite hairlines).
- Added an **in-page sliding-pill tab bar** to `ServicesPortal` (§11.1 grammar): "Our Services" | "Our Team", with `AnimatePresence` panel crossfade; hero and footer stay persistent.
- Iterated the portal **container width** repeatedly on user feedback (5xl → 3xl → 4xl → 75rem → 90rem → 135rem → 105rem).
- Made the **hero image swap per tab** (depot photo ↔ team lineup photo) with a 500ms crossfade, and later made the **hero title/subtitle swap** with it too.
- Flipped the public `/portal` to **light mode only** (new `app/portal/layout.tsx` pre-paint script + on-mount enforcement in `PortalStandalone`), leaving the internal dark console untouched.
- Fixed hard **edge cut-lines** on the service cards (bleed room inside the `overflow-x-clip` tab-panel wrapper).
- **Honesty call:** removed an invented `FIELD/OFFICE` status from the roster (fabricated facts about named real people) in favour of a truthful `● ACTIVE`.
- Every step verified with a Playwright screenshot and a clean `next build`. **The session ended with the user reporting an "Error · 404 — No signal on that channel" on some page, then interrupting — that 404 was not diagnosed before the session closed.**

## Narrative
The user opened with pasted screenshots of the APMG team page and portal and asked for a team section. Before building, the assistant made a deliberate call on images: **self-host, not hotlink**, so a customer-facing trust page never shows a broken avatar if APMG's WordPress CDN rotates a URL. It web-fetched the full 9-person roster, downloaded the headshots into `app/team/`, found several were 4000px+ / 16 MB camera originals, and normalised all nine to square 640×640 crops with Pillow (`centering=0.42` to bias faces above centre) — 28 MB down to 478 KB. It read `ui-standards.md` (§17.8 APMG surface, §6.2 hairline panel, §11.1 tabs, §14.3 stagger) so the component matched house grammar, then wrote `TeamSection.tsx` grouped into Leadership / Management / Account Managers.

Initially the section was inserted **inline** into `ServicesPortal`. The user's next screenshot made clear they wanted it on a **separate tab**. The assistant reverted the inline insertion and refactored `ServicesPortal` into a hero + a §11.1 sliding-pill tab bar ("Our Services" | "Our Team") with `AnimatePresence` panels, extracting the services content into a `ServicesPanel` sub-component. A follow-up asked to "align the cards from the middle" — the assistant switched the team grid from CSS grid to centred flex-wrap so short tiers (Leadership 2, Account Managers 2) centre while full rows still pack tight, and the orphan 5th Management card centres on its own line.

The `frontend-design` skill then loaded. Rather than redesign the whole portal (which has a deliberate, pinned §17.8 identity), the assistant scoped it — via `AskUserQuestion` — to **just the "Our Team" tab, staying in-system**. It studied `SignalLed` and `SignalTicker` (the app's identity signatures) and rewrote `TeamSection` as an operator-grade **crew roster**: a `● OUR CREW` pulsing-LED header with a `09 ACTIVE` tabular tally, register labels (`LEAD · LEADERSHIP —— 02`), per-node mono roster indices, and hover-ignite red hairlines. It had added a `FIELD/OFFICE` status glyph but flagged that it had **invented** which staff were field vs office — and on a trust page, per the user's call, dropped it for a truthful `● ACTIVE`.

The rest of the session was rapid visual iteration on live screenshots: container width tuned back and forth ("widen it about 75%", "20% more", "50% more"… landing at `max-w-[105rem]`); hero fit switched `object-contain` → `object-cover` → back to `object-contain` with a black bar; the in-hero APMG logo un-cropped by making the hero taller and clamping the content stack with `inset-0 justify-end`; the portal defaulted to **light mode** (scoped to `/portal` only, verified even with `apmg-theme=dark` in localStorage); service-card **edge cut-lines** fixed with `-mx-2 px-2 pb-2` bleed room; and finally the hero **image and copy** made to swap per tab with a crossfade.

The last two user messages were a report of an **"Error · 404 — No signal on that channel"** page and then an interrupt. The digest shows no diagnosis of that 404 — it arrived after the described work and the session closed on it.

## Files touched
| File | Change | Why |
| --- | --- | --- |
| `components/apmg/TeamSection.tsx` | Created, then rewritten as the "crew roster"; centred flex-wrap grid; `field` status added then removed for `● ACTIVE` | The team surface: avatar grid → distinctive in-system roster |
| `components/apmg/ServicesPortal.tsx` | Reverted inline team insert; added sliding-pill tab bar + `AnimatePresence` panels; `ServicesPanel`/`TabPill`; container width iterations; hero `object-fit` changes; hero logo clamp; per-tab hero image crossfade + `HERO_COPY` title/subtitle swap; edge bleed-room fix | Host of the tabbed portal and all layout/hero iteration |
| `components/apmg/PortalStandalone.tsx` | On-mount `useEffect` re-asserting light theme | Bulletproof light-mode enforcement complementing the pre-paint script |
| `app/portal/layout.tsx` | Created — pre-paint inline script stripping `dark` for the `/portal` route | Flash-free light mode on the public portal without touching the global dark default |
| `.shot.mjs` (repo root) | Temp Playwright screenshot script, written/edited/deleted many times | Visual verification; placed in repo root so `playwright` resolves; removed after each use |
| `scratchpad/shot.mjs` (temp dir) | First screenshot-script attempt | Failed to resolve `playwright` from outside the project; abandoned for the repo-root `.shot.mjs` |

Note: the 9 headshot JPEGs in `app/team/` and `app/apmgteam.jpg` (the team lineup hero, from `Downloads/1-e1757895049361.webp`) were created via Bash/Pillow, not the Edit/Write tools, so they are not in the digest's FILES TOUCHED list — but they are part of what shipped.

## Key decisions
- **Self-host images, don't hotlink** — a broken avatar on a trust page is the worst-case; WordPress media URLs rotate.
- **Normalise headshots to 640×640** via Pillow (Windows `convert.exe` is the disk tool, not ImageMagick; no ffmpeg — Pillow 12.2 was available).
- **Team on a separate in-page tab**, not inline scroll — used the existing §11.1 sliding-pill tab grammar so it belongs to the product.
- **`frontend-design` scoped to the Team tab, in-system** — kept the §17.8 signal identity (dark-first console) rather than breaking from it; the one aesthetic risk was the telemetry-console "crew roster" framing.
- **Removed invented FIELD/OFFICE data** — refused to ship fabricated facts about named real people on a trust surface; replaced with a truthful `● ACTIVE`.
- **Light mode scoped to `/portal` only** — the internal dashboard stays dark; achieved via a route-level pre-paint script plus an on-mount effect, without mutating the shared `apmg-theme` preference.
- **Container width `max-w-[105rem]`** as the practical ceiling for a 4-up grid; flagged that going wider should mean a 5-column grid, not a wider box.

## Problems hit
- **Playwright resolution** — a screenshot script in the scratchpad couldn't resolve `playwright` (outside the project's `node_modules`); solved by writing `.shot.mjs` into the repo root and deleting it after each run.
- **Dev server collision** — the assistant's own `next dev -p 3111` exited because the user already had a dev server on port 3000; it used the running server instead.
- **Consent-gate modal** blocked Playwright clicks — the user was live-editing a `standalone` consent feature on `ServiceInquiryModal`; the script was updated to dismiss it first.
- **Perceived stale theme** — the user reported the portal still dark; a fresh headless browser resolved light correctly, so the assistant diagnosed a cached page and added on-mount enforcement plus advising a hard refresh (`Ctrl+Shift+R`).
- **Unresolved 404** — the final user message was "Error · 404 — No signal on that channel / That page isn't part of the dashboard." followed by an interrupt. **This was not investigated before the session ended**; it is the main open item.

## Outcome
The public `/portal` shipped with a working two-tab layout (Our Services / Our Team), a self-hosted, optimised 9-person crew roster in the telemetry-console identity, per-tab hero image and copy crossfades, light-mode default scoped to the portal, and clean card edges. Each step passed a clean `next build` (exit 0, `/portal` prerenders static) and was verified with Playwright screenshots at desktop and mobile breakpoints. The one thing left hanging is the 404 the user reported at the end.

> **Superseded — read this before trusting the description above** (added 2026-07-30, verified against git):
> - The **9-person roster is now 8**. `TeamSection.tsx` at this session's commit `7f3cf50` lists nine people; at `08f162a` (2026-07-25) it lists eight — **Aiicha Robertson** was removed and "Ashley Rankin" became "Ash Rankin". No session doc records who made that edit or why; see the flag in [doc 19](19-portal-trust-cro-overhaul.md).
> - The **telemetry-console identity built here was deliberately undone**. [Doc 19](19-portal-trust-cro-overhaul.md) (2026-07-25) rewrote `TeamSection.tsx` to strip the crew tally, the mono roster indices and the `SignalLed` "ACTIVE" lamps, on the reasoning that console instrument chrome reads as surveillance on a customer trust page. The self-hosted headshots, the roster structure and the sliding-pill tab bar this session built all survive.
> - The **two-tab bar is now three tabs** — Our Services · Google Reviews · Our Team, per doc 19.
> - The `standalone` consent gate mentioned in Follow-ups was completed in [doc 18](18-legal-consent-unsubscribe-enquiry-notify.md) and then **unmounted** in doc 19 (`PortalConsentGate` is kept in the repo, unreferenced). The `[COMPANY LEGAL NAME]` / `[ABN]` placeholders it flagged are still unresolved: `COMPANY.legalEntity` and `COMPANY.abn` in `lib/legal/company.ts` are both still `null`.
> - The hero heights this doc's sibling [doc 14](14-portal-hero-polish.md) set have also been superseded — see that doc's own note.

## Follow-ups
- **Diagnose the reported 404** ("No signal on that channel — that page isn't part of the dashboard") — likely the user's actual blocker; not investigated in-session.
- Confirm the light-mode fix resolves on the user's real browser after a hard refresh (headless verified light; the user's machine had a stored dark pref / cached page).
- The `standalone` consent gate on `ServiceInquiryModal` still shows placeholder `[COMPANY LEGAL NAME]` / `[ABN]` — flagged as the user's in-progress legal work.
- Optional: whether to keep `max-w-[105rem]` or move to a 5-column grid if the user wants the portal wider.

## Verbatim user requests
Most of the requests came as pasted screenshots (annotated in the digest as `[Image: …]`). The text messages were:

- "widen it a bit more please about 75%"
- "letss add 20% more"
- "now the logo inside the big image please adjust it so it fits propery nad isnt cropped"
- "widen it a bit more please about 50%"
- "lets default it to light mode please"
- "make sure to fit the image even though it doesnt cover the whole background just add a black bar or something"
- "Improve the edges of the page I can see clear cut lines it cuts the edges of the services please fix it"
- "the portal isnt light mode yet lets make it light mode first please"
- "also when we switch the our team also change the our services to Our team and its text below"
- "I only see this - Error · 404 / No signal on that channel / That page isn't part of the dashboard."
- *[Request interrupted by user]*
