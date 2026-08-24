// Regenerates lib/clients/siteExport.ts from documentation/site_export.csv.
//
// The Master Client List reads its rows from a bundled TS module rather than
// from disk (see the header it writes below). This script is the only thing
// that should ever write that module — run it after dropping a fresh export
// over documentation/site_export.csv:
//
//   node scripts/build-site-export.mjs
import { readFileSync, writeFileSync, statSync } from "node:fs";

const SRC = "documentation/site_export.csv";
const OUT = "lib/clients/siteExport.ts";

const csv = readFileSync(SRC, "utf8").replace(/^﻿/, "").replace(/\r\n/g, "\n");

// String.raw survives backslashes, but a backtick or a `${` in the data would
// still close/interpolate the literal. Refuse rather than emit a broken module.
const hazard = csv.match(/`|\$\{/);
if (hazard) {
  console.error(`${SRC} contains ${JSON.stringify(hazard[0])} — not safe to embed in a template literal.`);
  process.exit(1);
}

const header = `/**
 * The client-site export APMG runs its jobs out of, verbatim.
 *
 * SOURCE OF TRUTH for the Master Client List tab and for the outreach guard
 * that keeps existing customers out of cold campaigns. Kept as a bundled
 * module rather than read from disk so it behaves identically in the API
 * route, in tests, and on Vercel — no filesystem tracing, no Supabase
 * migration to run, and no per-view egress against the free-tier allowance.
 *
 * TO REFRESH when Zac sends a new export:
 *   1. drop the new CSV over ${SRC} (the received file, kept
 *      unedited so it can still be diffed against what was sent), then
 *   2. node scripts/build-site-export.mjs
 *
 * Nothing here is normalized — the same 17 raw columns, the same duplicate
 * spellings ("MBCM - Mitcham" / "MBCM Mordialloc"), the same test rows.
 * lib/clients/normalize.ts owns all of that, so a re-export never needs
 * hand-editing.
 *
 * GENERATED FILE — do not hand-edit. Regenerate it instead.
 */

export const SITE_EXPORT_CSV = String.raw\``;

writeFileSync(OUT, `${header}${csv}\`;\n`, "utf8");
const rows = csv.trim().split("\n").length - 1;
console.log(`${OUT}: ${rows} data rows, ${statSync(OUT).size} bytes`);
