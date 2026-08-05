import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import {
  readSetting,
  writeSetting,
  publicObjectUrl,
  SECTOR_ASSETS_BUCKET,
  SETTING_SECTOR_PLAYBOOKS,
} from "./server";
import { kbFileName, parsePlaybooks, resolveSectorForCategory, type SectorPlaybook } from "./sectors";

// Server-side accessor for the Sector Playbooks config (app_settings JSON).
// Shared by the API routes (read/write from the tab) and the compose route
// (read, to ground the email in the sector KB). Pure model + matching logic
// live in sectors.ts; this module is the DB/filesystem boundary.

/** Load the merged playbooks (defaults overlaid with saved config). */
export async function loadPlaybooks(): Promise<SectorPlaybook[]> {
  return parsePlaybooks(await readSetting(SETTING_SECTOR_PLAYBOOKS));
}

/** Persist the full playbook array as JSON. Mirrors writeSetting's result. */
export async function savePlaybooks(
  playbooks: SectorPlaybook[],
): Promise<"ok" | "demo" | "missing-table" | "error"> {
  return writeSetting(SETTING_SECTOR_PLAYBOOKS, JSON.stringify(playbooks));
}

/** Public attachment URL for a sector's PDF, or null when none / demo mode. The
 *  send route passes this to n8n so the Gmail node downloads and attaches it. */
export function playbookPdfUrl(pb: SectorPlaybook): string | null {
  if (!pb.pdf) return null;
  const url = publicObjectUrl(SECTOR_ASSETS_BUCKET, pb.pdf.path);
  if (!url) return null;
  // The object path is fixed (<slug>.pdf) and served with a 1h CDN max-age, so
  // a re-upload reuses the same URL. Cache-bust by upload time so a replaced PDF
  // is never emailed (or previewed) stale.
  return pb.pdf.uploadedAt ? `${url}?v=${encodeURIComponent(pb.pdf.uploadedAt)}` : url;
}

const KB_MAX_CHARS = 40000;

/** Read a knowledge-base markdown file shipped in the repo. */
async function readRepoKb(file: string): Promise<string> {
  try {
    return await readFile(join(process.cwd(), "components", "knowledgebase", file), "utf8");
  } catch {
    return "";
  }
}

/** The KB markdown in effect for a sector: an uploaded file (kb.content) wins
 *  over the repo file; with neither, source is "none". Used both for the tab
 *  preview and for grounding the outreach email. */
export async function effectiveSectorKb(
  pb: SectorPlaybook,
): Promise<{ content: string; source: "uploaded" | "repo" | "none" }> {
  if (pb.kb?.content?.trim()) return { content: pb.kb.content, source: "uploaded" };
  const repo = (await readRepoKb(kbFileName(pb.slug))).trim();
  return repo ? { content: repo, source: "repo" } : { content: "", source: "none" };
}

/**
 * Build the KB context passed to the composer for a lead: the general company
 * file (business.md, repo) + the file for the sector its Category resolves to
 * (uploaded override, else the repo file). Grounds the draft in APMG's real
 * services so it never writes a generic lead-generation pitch. Empty string
 * only if no KB is available at all.
 */
export async function buildComposeKb(
  category: string | null | undefined,
  playbooks: SectorPlaybook[],
): Promise<string> {
  const general = (await readRepoKb("business.md")).trim();
  const sector = resolveSectorForCategory(category, playbooks);
  const sectorMd = sector ? (await effectiveSectorKb(sector)).content.trim() : "";
  return [general, sectorMd].filter(Boolean).join("\n\n---\n\n").slice(0, KB_MAX_CHARS);
}
