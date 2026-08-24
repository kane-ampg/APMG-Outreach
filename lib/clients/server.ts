/**
 * Server-side access to the Master Client List.
 *
 * SERVER ONLY. The export it reads is ~220 KB of CSV and the folded list is
 * bigger again — neither belongs in a browser bundle, and the send flow doesn't
 * need them: it downloads the compact guard index from /api/clients/guard
 * instead. Import this from route handlers, never from a "use client" module.
 *
 * Both values are built once per server instance and then reused. The input is
 * a constant, so there is nothing to invalidate: the fold is deterministic, and
 * a new export means a new deployment. On Fluid Compute a warm instance answers
 * every later request from these two objects without re-parsing anything.
 */

import { buildClientGuard, type ClientGuardData } from "./guard";
import { buildMasterClientList, type MasterClientList } from "./normalize";
import { SITE_EXPORT_CSV } from "./siteExport";

let listCache: MasterClientList | null = null;
let guardCache: ClientGuardData | null = null;
let etagCache: string | null = null;

/** The folded client list — one row per real customer, branches underneath. */
export function masterClientList(): MasterClientList {
  listCache ??= buildMasterClientList(SITE_EXPORT_CSV);
  return listCache;
}

/** The compact lookup index the outreach guard matches prospects against. */
export function clientGuardData(): ClientGuardData {
  guardCache ??= buildClientGuard(masterClientList());
  return guardCache;
}

/**
 * A weak ETag over the shape of the built list, so a client that already holds
 * it takes a 304 instead of the body. Derived from the totals rather than from
 * the CSV text: it changes exactly when the answer changes.
 */
export function clientListEtag(): string {
  if (!etagCache) {
    const s = masterClientList().stats;
    etagCache = `W/"clients-${s.rows}-${s.rawCustomers}-${s.clients}-${s.emails}-${s.domains}"`;
  }
  return etagCache;
}

/** Test seam: drop the memoised build between cases. */
export function __resetClientCaches() {
  listCache = null;
  guardCache = null;
  etagCache = null;
}
