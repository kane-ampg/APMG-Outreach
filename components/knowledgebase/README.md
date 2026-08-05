# Knowledge Base — APMG sector portfolios

Reference material the email-composer gives Claude so outreach drafts are grounded in
**APMG's real services**, per sector, instead of generic filler. One markdown file per
sector, structured for LLM consumption (overview → services → sector pain points →
differentiators → proof points → brand-voice phrases → contact → guardrails).

## Files

| File | Sector | Use for leads whose Category is… |
|---|---|---|
| `business.md` | **General** (always included) | — company-wide: who APMG is, all services, "what APMG is NOT" |
| `aged-care.md` | Aged Care & Health | aged care, nursing home, retirement/aged living, health |
| `early-childhood.md` | Early Childhood / Early Learning | childcare, early learning, kindergarten, daycare |
| `education.md` | Education / Schools | school, college, education |

The composer always sends **`business.md` + the one matching sector file** (see
`buildComposeKb` in `lib/pipeline/sectorStore.ts`). `business.md` carries the
critical framing — APMG does **property maintenance for** these facilities, it is
**not** a lead-generation agency — so drafts never revert to a "more customers"
pitch. The sector file adds the specifics for that Category.

**Overriding a sector file at runtime:** the **Sector Playbooks** tab lets an admin
upload a `.md` to override any sector file (stored in `app_settings`, used instead
of the repo copy); "Revert to built-in" removes it. `business.md` is edited only
here in the repo. See `references/SECTOR-PLAYBOOKS.md`.

Select the **one** file that matches the lead's CSV `Category`, not all three. Each doc is
scoped to its sector (there's a "Sector focus note" at the top telling the model to stay in
lane). If a lead's category doesn't map to any of these, fall back to no KB rather than
forcing an unrelated sector.

## How the composer should use these

The email draft is written in the Next.js compose call (the agreed path — mirror
`lib/ai/leadSummary.ts`, not the n8n node). To attach the KB:

1. Load the matching sector `.md` as text.
2. Put it in a **stable prefix** — a `system` block, or a leading `user` content block —
   and mark it with `cache_control: { type: "ephemeral" }`. The KB is identical across every
   lead of that sector, so it caches: the first email in a batch pays to process it, the rest
   read it at ~10% cost.
3. Put the **per-lead** content (business name, category, website, extracted emails) *after*
   the cached KB block — volatile content must come last or it invalidates the cache.

Because the KB differs per sector, you get up to three distinct cached prefixes (one per
sector) — expected and fine; each caches on first use and is reused across leads of that
sector within the cache window.

## Guardrails (already baked into each file)

Every doc ends with a **"Guardrails for the email writer"** section: it tells the model to
pitch only services APMG actually offers, never invent stats/response-times/coverage, and
tailor to the recipient. Keep that section — it's what stops the draft from hallucinating
capabilities.

## Provenance & maintenance

- **Source:** APMG's scanned "Company Portfolio" PDFs (`references/*.pdf`) — image-only, no
  text layer. Rendered to page images, transcribed by vision, synthesized, and
  **audited for faithfulness** against the transcriptions (all three passed: no unsupported
  claims, no material omissions).
- **These are the source of truth going forward** — hand-edit the markdown directly to
  refine copy; don't re-derive from the PDFs unless the portfolios change.
- **Known gaps in the source material** (not extraction errors — the brochures simply don't
  contain them): no geographic service area, no quantitative proof (years/sites/response
  times), no named sender/booking link, no per-lead intelligence. If you want richer emails,
  add those facts here and the composer will use them.
