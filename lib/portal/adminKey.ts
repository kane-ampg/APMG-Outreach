// Client-side handling of the portal admin access key (PORTAL_ADMIN_KEY on the
// server). The key-gated admin reads — the enquiry listing (visitor PII) and
// the lead-activity trails (per-lead identifiers) — live on the same origin the
// public portal invites strangers to, so they must not ship behind the
// sameOrigin (CSRF-only) floor. The key is entered once on whichever admin tab
// asks first and parked in localStorage — never baked into the client bundle.
// Shared by EnquiriesPage and TelemetryPage so one unlock covers both tabs.

const ADMIN_KEY_STORAGE = "apmg-portal-admin-key";
/** Must match PORTAL_ADMIN_KEY_HEADER in lib/portal/server.ts (duplicated here
 *  so client bundles never import the server-only module). */
const ADMIN_KEY_HEADER = "x-portal-admin-key";

export function getAdminKey(): string {
  if (typeof window === "undefined") return "";
  try {
    return localStorage.getItem(ADMIN_KEY_STORAGE) ?? "";
  } catch {
    return "";
  }
}

export function saveAdminKey(key: string) {
  try {
    localStorage.setItem(ADMIN_KEY_STORAGE, key);
  } catch {
    /* storage unavailable — the key just won't persist across reloads */
  }
}

/** Auth header for the key-gated admin endpoints (empty when no key yet). */
export function adminHeaders(): Record<string, string> {
  const key = getAdminKey();
  return key ? { [ADMIN_KEY_HEADER]: key } : {};
}
