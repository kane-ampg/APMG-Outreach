# LinkedIn as a third lead source — design

Date: 2026-09-28 · Status: approved by Kane in chat (data model section, then "go")

## Goal

A LinkedIn contact CSV dropped on the Pipeline page goes through the **same
pipeline** as the Google and Bing maps exports — same parse → confirm → save
flow, same `leads` table and import folders, same compose / send / stats —
and every LinkedIn lead stays **identifiable as LinkedIn** everywhere a source
is shown or counted.

Unlike a maps listing, a LinkedIn row is a *person* at a company. The person
(name + job title) is kept and the AI email greets them by first name.

## Input

The 12-column CSV produced from the prospecting tool's page:

`First Name, Last Name, Full Name, Job Title, Company, Contact Type, Email,
Secondary Email, Phone (Masked), Industry, Sub-Industry, Source`

Header matching is by normalised name (case/punctuation-insensitive) with
aliases, so reordered or lightly renamed columns still map. A file is treated
as LinkedIn when it has a person-name header (First/Last/Full Name) **and** a
company header. Maps exports never have a person-name header.

## Data model

`supabase/linkedin-source.sql` (manual, idempotent, like `follow-ups.sql`)
adds three nullable text columns to `leads`: `contact_name`, `contact_title`,
`source`.

- **`source` is written only for sources the maps URL cannot identify** —
  today, only `'linkedin'`. Google/Bing rows keep `source` null and are still
  derived from `bing_maps_url` (no backfill, no drift). The upload route
  whitelists the value.
- `leadSource(url, stored)` — a known stored value wins, else the URL rule.
- Deploy-safe before the SQL is run: Google/Bing uploads never send the new
  keys, so they keep working; a LinkedIn upload returns `needsMigration` with
  the LinkedIn SQL; the leads read retries without the new columns; the
  source-stats probe falls back to the legacy filters.

This reverses the earlier "never add a source column" note. That rule rested
on migration cost and retroactivity; this change runs a migration anyway and
the URL fallback keeps every legacy row correct.

## Row mapping (LinkedIn file)

| Lead column     | From                                                        |
|-----------------|-------------------------------------------------------------|
| `name`          | Company (required — a row without one is skipped)           |
| `contact_name`  | Full Name, else First + Last                                |
| `contact_title` | Job Title                                                   |
| `category`      | Sub-Industry, else Industry (drives sector KB + PDF)        |
| `emails`        | Email, if it is a whole valid address (lowercased)          |
|                 | + Secondary Email only when on the **same domain** as Email |
| `phone`         | Phone, only if it is a real number (masked `•••` dropped)   |
| `social_medias` | a LinkedIn profile URL column, if the file has one          |
| `source`        | `'linkedin'`                                                |
| everything else | null / empty (`address`, `bing_maps_url`, `rating`, …)      |

Rules and why:

- **Strict email validation.** The maps mapper extracts emails by regex from
  any cell, which would turn `co’brien@fairhaven.org.au` into the wrong live
  address `brien@fairhaven.org.au`. The LinkedIn mapper accepts a cell only
  if the whole cell is an address; otherwise the lead imports with no email
  and lands in the folder's "No email" list.
- **Secondary email only on the same domain.** Secondaries in the source data
  are mostly other employers (`health.nsw.gov.au`, `anglicarevic.org.au`);
  the send top-up would otherwise mail an unrelated organisation.
- **One lead per person.** Five Attendo contacts are five leads. In-file
  de-dup keys on the primary email, else full name + company.
- No website is invented from the email domain.

The existing-client guard already matches on the recipient's email domain and
the business name, so LinkedIn leads are covered by it unchanged.

## Pipeline surfaces

- **Upload preview**: source chip reads "LinkedIn · N"; the drop zone copy
  names all three sources.
- **Folders**: a LinkedIn import is auto-named `linkedin-000N-<timestamp>`
  (maps imports stay `leads-000N-…`); one running number across both.
- **Leads table**: LinkedIn source badge; contact name + title under the
  business name. Lead detail shows the contact.
- **Source comparison / `/api/pipeline/source-stats`**: LinkedIn is a row.
- **Migration card**: shows the LinkedIn SQL when that is what's missing.
- **Lead export**: Contact name, Contact title, Source columns.

## Compose

- The compose request carries `contact_name` / `contact_title`.
- `draftEmail` appends a recipient block to the **per-lead user message**
  (never the stored `compose_prompt` row, which has drifted and must not be
  overwritten): greet by first name, write to their role. It sits before the
  follow-up block, which still goes last.
- The template fallback greets `Hi <first name>,` instead of the business.
- Out of scope: the hot-lead Follow-Ups tab keeps its business greeting.

## Testing

Vitest: LinkedIn mapping (detection, email rules, masked phone, dedupe, BOM,
maps files unaffected), `leadSource` / `sourceFilter`, upload route key
handling + whitelist + migration detection, compose recipient block and
template greeting. Gate: `tsc` + `vitest` + `next build` (no working lint).
