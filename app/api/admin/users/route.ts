import { guardResponse, requirePermission } from "@/lib/rbac/server";
import { MAIN_ADMIN_EMAIL, denyRoleChange, type RoleChangeDenial } from "@/lib/auth/policy";
import { allowedDomain } from "@/lib/auth/google";
import {
  DEFAULT_SIGNUP_ROLES,
  createUserWithRoles,
  listUsers,
  setUserRoles,
} from "@/lib/auth/userStore";
import { assignableRoles, parseRoles, type Role } from "@/lib/rbac/roles";
import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { fetchWorkspaceDirectory } from "@/lib/google/directory";

/**
 * Console user administration for the Settings → Roles and Permissions tab.
 *
 *   GET   → every user, plus the facts the UI needs to disable the right
 *           controls (who is acting, who the protected main admin is).
 *   PATCH → replace one user's whole role set.
 *
 * PATCH takes the FINAL set, not a delta. The Settings screen shows every role
 * with a tick, so what it submits is the intended end state — and a
 * replace-the-set write is idempotent, whereas "add this one / remove that one"
 * from two admins at once can interleave into a set neither of them chose.
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
  "main-admin": `${MAIN_ADMIN_EMAIL} is the protected main admin and must keep the Admin role. This is deliberate — it is the account that can always recover access. Other roles can still be added.`,
  self: "You can't change your own roles. Ask another admin, so nobody can lock themselves out.",
  "last-admin": "This is the only admin left, so Admin can't be removed. Make someone else an admin first, or there would be no way back in.",
};

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);

  const guard = await requirePermission(req, "users.manage");
  if (!guard.ok) return guardResponse(guard);

  // Concurrent, and independent by design: the roster must still render when
  // Google is unreachable, and the directory is still worth showing when the
  // app_users query fails. `fetchWorkspaceDirectory` never rejects — it returns
  // its failure as a state — so this cannot take the whole route down.
  // ?refresh=1 comes from the Refresh button and bypasses the directory's
  // 5-minute cache. Safe to take from the query string: this route already
  // required users.manage above, and the only thing it can cost is one extra
  // call to Google.
  const force = new URL(req.url).searchParams.get("refresh") === "1";
  const [result, directory] = await Promise.all([
    listUsers(),
    fetchWorkspaceDirectory({ force }),
  ]);
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
    // The clock that WROTE every last_seen_at in this payload. The browser
    // measures its own offset from it, so a laptop with a wrong clock cannot
    // decide somebody is online when the server can see they are not — see
    // useServerClock. Sent on every response so the offset re-derives rather
    // than drifting.
    serverNow: new Date().toISOString(),
    // Mirrors the convention in LegalDocsPage: say plainly when nothing can be
    // saved, rather than showing an empty table that looks like "no users".
    mode: configured ? "live" : "demo",
    canPersist: configured,
    actorEmail: guard.email,
    mainAdminEmail: MAIN_ADMIN_EMAIL,
    // Mirrored so "Add by email" can reject a typo'd domain inline instead of
    // making the round trip to be told no. The PATCH check above is what
    // enforces it -- this is the same courtesy as the disabled dropdowns.
    allowedDomain: allowedDomain(),
    // So the UI can say "Sales on first sign-in" for someone with no row,
    // rather than the flat "no roles" that would imply they arrive with no
    // access at all.
    defaultRolesOnSignIn: DEFAULT_SIGNUP_ROLES,
    assignableRoles: assignableRoles(),
    users,
    usersError,
    directory,
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
  const raw = (body ?? {}) as { email?: unknown; roles?: unknown };

  if (typeof raw.email !== "string" || !raw.email.trim()) {
    return json({ error: "An email address is required." }, 400);
  }
  if (!Array.isArray(raw.roles)) {
    return json({ error: "A list of roles is required." }, 400);
  }
  // parseRoles drops anything the catalog doesn't know — including inherited
  // names like "constructor" — so `nextRoles` can only ever contain real
  // roles. A body carrying junk alongside real roles is REJECTED rather than
  // quietly narrowed: silently saving a smaller set than the admin submitted
  // is how somebody ends up with access nobody meant to leave them.
  const nextRoles: Role[] = parseRoles(raw.roles);
  if (nextRoles.length !== new Set(raw.roles).size) {
    return json({ error: "That request contained a role this console doesn't recognise." }, 400);
  }
  // The catalog says a role EXISTS; assignableRoles() is the separate business
  // rule for which of them a UI may currently hand out. Every role is enabled
  // today, so this can't yet reject anything — but this route claims to be the
  // enforcement point, and must not defer that rule to the UI even while the
  // rule is dormant.
  const assignable = assignableRoles();
  const refused = nextRoles.filter((r) => !assignable.includes(r));
  if (refused.length > 0) {
    return json({ error: `Not currently assignable: ${refused.join(", ")}.` }, 400);
  }
  const email = raw.email.trim().toLowerCase();

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
  // Pre-assignment. Settings lists the whole Workspace domain, not just people
  // who have signed in, so "give Maria the Sales role before her first login"
  // has to work -- the old flat refusal here would have made most of that list
  // unassignable.
  //
  // The domain check is the boundary. `assertWorkspaceIdentity` means only a
  // verified @<allowedDomain> account can ever hold a session, so a row for any
  // other address is unreachable by definition: dead state that reads like
  // access. Refusing it here keeps the table honest rather than adding a
  // security guarantee -- the sign-in gate is what actually stops them.
  const exists = users.some((u) => u.email === email);
  if (!exists) {
    const domain = allowedDomain();
    if (!email.endsWith(`@${domain}`)) {
      return json(
        {
          error: `Only @${domain} addresses can be given roles. Anyone else is refused at sign-in, so the grant would never take effect.`,
        },
        400,
      );
    }
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
    nextRoles,
    adminEmails: users.filter((u) => u.roles.includes("admin")).map((u) => u.email),
  });
  if (denial) return json({ error: DENIAL[denial], reason: denial }, 409);

  // Runs AFTER denyRoleChange even though none of its three rules can fire on
  // an address with no row (it is not the main admin, not the actor, and not
  // the last admin). Ordering the create before the guard would make that a
  // load-bearing coincidence: the day a fourth rule is added, a brand-new user
  // would silently skip it.
  if (!exists) {
    const created = await createUserWithRoles({ email, roles: nextRoles, invitedBy: guard.email });
    if (created === "demo") {
      return json({ error: "Supabase isn't configured, so this can't be saved." }, 503);
    }
    if (created === "error") {
      return json({ error: "Couldn't add that person. Please try again." }, 500);
    }
    if (created === "ok") return json({ ok: true, email, roles: nextRoles, created: true });
    // "conflict": another admin created the row between our read and our
    // insert. The row exists now, so setting the roles below is exactly right.
  }

  const result = await setUserRoles(email, nextRoles);
  if (result === "demo") {
    return json({ error: "Supabase isn't configured, so this can't be saved." }, 503);
  }
  if (result === "missing") {
    return json({ error: "That user no longer exists." }, 404);
  }
  if (result === "error") {
    return json({ error: "Couldn't save the change. Please try again." }, 500);
  }
  return json({ ok: true, email, roles: nextRoles });
}
