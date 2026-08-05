import { guardResponse, requirePermission } from "@/lib/rbac/server";
import { MAIN_ADMIN_EMAIL, denyRoleChange, type RoleChangeDenial } from "@/lib/auth/policy";
import { listUsers, setUserRole } from "@/lib/auth/userStore";
import { assignableRoles, isRole } from "@/lib/rbac/roles";
import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";

/**
 * Console user administration for the Settings → Roles and Permissions tab.
 *
 *   GET   → every user, plus the facts the UI needs to disable the right
 *           controls (who is acting, who the protected main admin is).
 *   PATCH → change one user's role.
 *
 * Both require `users.manage` (admin only). The three lockout protections are
 * applied by `denyRoleChange` — the single tested implementation — and are NOT
 * re-derived here or in the UI. The UI disables controls purely as a courtesy;
 * this route is the enforcement point.
 */
export const runtime = "nodejs";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/** Operator-facing copy for each refusal. Keyed so the UI can style by reason. */
const DENIAL: Record<Exclude<RoleChangeDenial, null>, string> = {
  "main-admin": `${MAIN_ADMIN_EMAIL} is the protected main admin and cannot be changed. This is deliberate — it is the account that can always recover access.`,
  self: "You can't change your own role. Ask another admin, so nobody can lock themselves out.",
  "last-admin": "This is the only admin left. Promote someone else to admin first, or there would be no way back in.",
};

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);

  const guard = await requirePermission(req, "users.manage");
  if (!guard.ok) return guardResponse(guard);

  const result = await listUsers();
  // "error" and [] are both possible here, and they must not be conflated:
  // [] can mean a genuinely empty table OR (via listUsers()'s demo-mode branch)
  // "Supabase not configured" -- `mode`/`canPersist` already cover that case.
  // "error" means the query itself failed against a *configured* Supabase --
  // wrong schema, missing table, transient outage -- which `mode`/`canPersist`
  // cannot detect since they only look at configuration, not query health.
  // That gets its own flag so the UI can tell the two apart rather than
  // rendering "nobody has signed in yet" over a broken backend.
  const usersError = result === "error";
  const users = usersError ? [] : result;
  const configured = supabaseTarget().state === "ok";
  return json({
    // Mirrors the convention in LegalDocsPage: say plainly when nothing can be
    // saved, rather than showing an empty table that looks like "no users".
    mode: configured ? "live" : "demo",
    canPersist: configured,
    actorEmail: guard.email,
    mainAdminEmail: MAIN_ADMIN_EMAIL,
    assignableRoles: assignableRoles(),
    users,
    usersError,
  });
}

export async function PATCH(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);

  const guard = await requirePermission(req, "users.manage");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const raw = (body ?? {}) as { email?: unknown; role?: unknown };

  if (typeof raw.email !== "string" || !raw.email.trim()) {
    return json({ error: "An email address is required." }, 400);
  }
  // isRole is an own-property check, so inherited names like "constructor"
  // cannot slip through as a role here.
  if (!isRole(raw.role)) {
    return json({ error: "Unknown role." }, 400);
  }
  // isRole only proves the value is a real role in the catalog; assignableRoles()
  // is the separate business rule for which of those roles a UI may currently
  // hand out. Every role is enabled today, so this can't yet reject anything --
  // but this route claims to be the enforcement point, and must not defer that
  // rule to the UI even while the rule is dormant.
  if (!assignableRoles().includes(raw.role)) {
    return json({ error: "That role is not currently assignable." }, 400);
  }
  const email = raw.email.trim().toLowerCase();
  const nextRole = raw.role;

  // One read serves both the existence check and the admin census that
  // denyRoleChange needs, so the two can never disagree with each other.
  const users = await listUsers();
  // Checked before the existence check, deliberately: if the read itself
  // failed, `users` carries no information about who exists. Falling through
  // to the 404 below would misreport a broken backend as "not a console user
  // yet" -- the exact false diagnosis this route exists to avoid.
  if (users === "error") {
    return json(
      { error: "The user list couldn't be read, so this change wasn't attempted. Try again shortly." },
      503,
    );
  }
  if (!users.some((u) => u.email === email)) {
    return json({ error: "That address is not a console user yet. They must sign in once first." }, 404);
  }

  // Read-then-act snapshot, not a transaction: two admins racing to demote
  // each other could both read an admin count of 2 and both pass this check.
  // Accepted rather than adding a transaction, because the invariant this
  // guards -- "at least one admin exists" -- doesn't actually depend on it:
  // MAIN_ADMIN_EMAIL can never be demoted by any path (the main-admin rule
  // above), and supabase/app-users.sql reseeds it to admin on every run. So
  // there is always at least one admin regardless of what this check does --
  // it's a courtesy that produces a clear message in the common case, not the
  // guarantee.
  const denial = denyRoleChange({
    actorEmail: guard.email,
    targetEmail: email,
    nextRole,
    adminEmails: users.filter((u) => u.role === "admin").map((u) => u.email),
  });
  if (denial) return json({ error: DENIAL[denial], reason: denial }, 409);

  const result = await setUserRole(email, nextRole);
  if (result === "demo") {
    return json({ error: "Supabase isn't configured, so this can't be saved." }, 503);
  }
  if (result === "missing") {
    return json({ error: "That user no longer exists." }, 404);
  }
  if (result === "error") {
    return json({ error: "Couldn't save the change. Please try again." }, 500);
  }
  return json({ ok: true, email, role: nextRole });
}
