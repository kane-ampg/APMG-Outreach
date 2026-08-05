# Sector Playbooks — per-category knowledge base

Routes each lead to a **sector** by its CSV `Category`, then **grounds** the
AI-written outreach email in that sector's **knowledge base** (a Markdown file).
Configured from the **Sector Playbooks** tab (Automate group, admin-only —
`playbooks.view` / `playbooks.manage`). There is no email attachment — the KB
shapes the email copy at compose time.

## Sectors (defaults)

| slug | name | example Category matches | KB file |
|---|---|---|---|
| `aged-care` | Aged Care & Health | aged care, nursing home, retirement, health, ndis | `aged-care.md` |
| `early-childhood` | Early Childhood / Early Learning | childcare, early learning, kindergarten, daycare | `early-childhood.md` |
| `education` | Education / Schools | school, college, university, tafe | `education.md` |

Category keywords are editable per sector in the tab. Matching is case-insensitive
substring, **longest keyword wins**. No match → the email is grounded by the
general company file only.

## Knowledge base per sector

Each sector's KB is a Markdown file. The **built-in** file ships in the repo at
`components/knowledgebase/<slug>.md`. From the tab you can **upload a `.md`** to
override it (stored in Supabase, used instead of the repo file) or **revert** to
the built-in. The general company file **`components/knowledgebase/business.md`**
is always prepended — it carries the critical framing (APMG does *property
maintenance for* these facilities; it is **not** a lead-gen agency).

Effective KB for a lead = `business.md` (repo) + the matched sector's KB
(uploaded override, else repo file).

## Where things live

- **Config mapping + uploaded KB** → `app_settings["sector_playbooks"]` (JSON:
  `{ slug, name, categories[], kb }`, where `kb` holds the uploaded markdown
  `content` + metadata, or is null to use the repo file). Defaults from
  `lib/pipeline/sectors.ts` fill any unset field.
- **Built-in KB markdown** → `components/knowledgebase/<slug>.md` + `business.md`.
- **No storage bucket, no attachment** — the KB is text stored in `app_settings`.

## Code map

- `lib/pipeline/sectors.ts` — pure model + `resolveSectorForCategory()` + defaults + `SectorKb`.
- `lib/pipeline/sectorStore.ts` — `loadPlaybooks`/`savePlaybooks`, `effectiveSectorKb` (uploaded→repo), `buildComposeKb`.
- `app/api/sector-playbooks/route.ts` — GET config (+ effective KB status) / POST (name, categories).
- `app/api/sector-playbooks/kb/route.ts` — POST upload `.md` / DELETE revert.
- `components/apmg/SectorPlaybooksPage.tsx` — the tab.
- `app/api/pipeline/campaigns/compose/route.ts` — drafts each lead's email in-app with Claude, grounded in the KB.

## The email path

1. **Compose** — the compose route resolves each lead's Category → sector, builds
   the KB (`business.md` + sector KB), and has Claude draft a grounded,
   property-maintenance email per lead (in-app; no n8n hop).
2. **Send** — the campaign-send workflow (`APMG Campaign Send (clean).json`) just
   delivers each email via Gmail.

## Setup

1. **Run `supabase/schema.sql`** — creates `app_settings` (used to persist config
   and any uploaded KB). No storage bucket needed.
2. That's it — sectors ground emails from the built-in `components/knowledgebase/*.md`
   out of the box. To customize a sector's copy without touching the repo, open the
   Sector Playbooks tab and **Upload .md**.

Max uploaded KB is ~200k characters per sector.
