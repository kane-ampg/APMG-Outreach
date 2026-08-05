import type { Role } from "./roles";

/**
 * POSTs the requested preview role (or null to exit a preview) and reloads
 * the page on success so server components re-render under the new
 * effective role. The server re-checks roleCan(trueRole, "roles.viewas")
 * itself (app/api/auth/view-as/route.ts) — this is a UI convenience, never
 * the enforcement. Returns whether the request succeeded, so a caller can
 * clear its own pending/loading state on failure without reloading.
 */
export async function requestViewAs(role: Role | null): Promise<boolean> {
  const res = await fetch("/api/auth/view-as", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ role }),
  });
  if (res.ok) window.location.reload();
  return res.ok;
}
