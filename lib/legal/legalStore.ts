import "server-only";
import { readSetting, writeSetting, SETTING_LEGAL_DOCS } from "@/lib/pipeline/server";
import { parseLegalDocs, type LegalDocs } from "./legalDocs";

// Server-side accessor for the versioned legal documents (app_settings JSON).
// Mirrors lib/pipeline/sectorStore.ts: the DB boundary; pure types + parsing
// live in legalDocs.ts (client-safe). Read by:
//   - the public portal GET (show the customer the exact current text/version),
//   - the enquiry route (pin/validate the accepted version server-side),
//   - the admin Legal Documents tab (load/save).

/** Load the current legal docs (defaults when unset / demo / malformed). */
export async function loadLegalDocs(): Promise<LegalDocs> {
  return parseLegalDocs(await readSetting(SETTING_LEGAL_DOCS));
}

/** Persist the legal docs as JSON. Mirrors writeSetting's result union. */
export async function saveLegalDocs(
  docs: LegalDocs,
): Promise<"ok" | "demo" | "missing-table" | "error"> {
  return writeSetting(SETTING_LEGAL_DOCS, JSON.stringify(docs));
}
