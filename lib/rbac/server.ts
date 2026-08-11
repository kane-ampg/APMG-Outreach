import "server-only";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { effectiveRoles } from "@/lib/auth/policy";
import { getUserRoles } from "@/lib/auth/userStore";
import { type Permission } from "./permissions";
import { primaryRole, rolesCan, type Role } from "./roles";

/**
 * Server-side permission guard for Route Handlers.
 *
 * Roles are read from app_users on every call rather than trusted from the
 * cookie, so an admin's role change takes effect on the very next request.
 * The previous implementation read a CLIENT-SET `apmg-role` cookie, which was
 * a complete authorization bypass — that cookie is now ignored entirely.
 *
 * A user holds a SET of roles and may act on the union of what they grant, so
 * every enforcement decision here goes through `rolesCan` over `roles`. The
 * singular `role` fields alongside them are DISPLAY derivations (`primaryRole`)
 * for surfaces that can only show one — a label, an audit line — and are never
 * what a permission check consults.
 */

export interface ResolvedSession {
  email: string;
  /** Every role the database says they hold. Empty means revoked. */
  trueRoles: Role[];
  /** What enforcement should use — differs only during an authorised view-as. */
  roles: Role[];
  /** Most capable held role, or null when they hold none. Display only. */
  trueRole: Role | null;
  /** Most capable effective role, or null. Display only. */
  role: Role | null;
  /** Display name from the Google profile, carried in the session cookie.
   *  Display-only — never used for authorization. Absent for sessions minted
   *  before this field existed, or a Google account with no name claim. */
  name?: string;
}

export async function resolveSession(req: Request): Promise<ResolvedSession | null> {
  const cookie = req.headers.get("cookie") ?? "";
  const raw = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  // Decode defensively. Next's ResponseCookies.set() percent-encodes on write
  // and only RequestCookies.get() decodes on read, and hand-parsing the raw
  // header is exactly what silently broke the OAuth `next` cookie earlier in
  // this plan. It happens to be a no-op today — a compact JWT is base64url plus
  // dots, every character of which encodeURIComponent leaves alone — but that
  // is a property of the payload, not of the parsing, and it would stop holding
  // the moment the cookie carries anything else.
  // The decode must not be able to throw. decodeURIComponent raises URIError on
  // a malformed percent-sequence ("%", "%zz", a truncated "%E0"), any of which
  // an attacker can set from devtools. Unhandled, that rejects out through
  // requirePermission and 500s the authorization primitive — a denial of
  // service strictly worse than the encoding bug the decode exists to prevent.
  // A cookie we cannot decode is a cookie we cannot verify, so fall through to
  // "no session" and let the existing path answer 401.
  let token: string | undefined;
  try {
    token = raw ? decodeURIComponent(raw) : undefined;
  } catch {
    token = undefined;
  }
  const claims = await verifySession(token);
  if (!claims) return null;

  const trueRoles = await getUserRoles(claims.email);
  const roles = effectiveRoles(trueRoles, claims.viewAs ?? null);
  return {
    email: claims.email,
    trueRoles,
    roles,
    trueRole: primaryRole(trueRoles),
    role: primaryRole(roles),
    name: claims.name,
  };
}

export type GuardResult =
  | {
      ok: true;
      /**
       * Effective roles — the set enforcement actually used. THIS is what a
       * caller should consult to decide anything further.
       */
      roles: Role[];
      /**
       * Most capable effective role. Display and attribution only (an audit
       * line reads better as "sales" than as a set), and non-null by
       * construction: passing the guard requires holding a permission, which
       * requires holding at least one role.
       */
      role: Role;
      email: string;
      /** what app_users says they hold, regardless of any view-as */
      trueRoles: Role[];
      /** most capable true role — display only, non-null for the same reason */
      trueRole: Role;
      /**
       * The role being previewed, or null when they are simply themselves.
       *
       * Carried so the audit trail can say "kane@ (as sales)". Without it, an
       * admin acting while impersonating is indistinguishable in the record
       * from the rep whose seat they borrowed — which would make the trail
       * quietly misattribute exactly the actions it exists to attribute.
       */
      actingAs: Role | null;
    }
  | { ok: false; status: 401 | 403; error: string };

export async function requirePermission(
  req: Request,
  perm: Permission,
): Promise<GuardResult> {
  const session = await resolveSession(req);
  if (!session) return { ok: false, status: 401, error: "Not authenticated" };
  if (!rolesCan(session.roles, perm)) {
    return { ok: false, status: 403, error: `Forbidden — missing permission: ${perm}` };
  }
  // Holding a permission means holding a role that grants it, so both primaries
  // are non-null here. Narrowed rather than asserted, so that if that ever
  // stops being true the guard refuses instead of shipping a null role into
  // the audit trail.
  const role = primaryRole(session.roles);
  const trueRole = primaryRole(session.trueRoles);
  if (!role || !trueRole) {
    return { ok: false, status: 403, error: `Forbidden — missing permission: ${perm}` };
  }
  return {
    ok: true,
    roles: session.roles,
    role,
    email: session.email,
    trueRoles: session.trueRoles,
    trueRole,
    // A preview is the only way the effective set differs from what they hold,
    // and it is always exactly one role — so naming it is unambiguous.
    actingAs: sameRoles(session.roles, session.trueRoles) ? null : role,
  };
}

/** Set equality. Both sides come from `parseRoles`/`effectiveRoles`, so both
 *  are already deduplicated and in canonical order — but comparing by content
 *  rather than by reference keeps that an optimisation, not a requirement. */
function sameRoles(a: readonly Role[], b: readonly Role[]): boolean {
  return a.length === b.length && a.every((r) => b.includes(r));
}

/**
 * Convenience for Route Handlers:
 *
 *   const guard = await requirePermission(req, "pipeline.import");
 *   if (!guard.ok) return guardResponse(guard);
 */
export function guardResponse(guard: Extract<GuardResult, { ok: false }>): Response {
  return Response.json({ error: guard.error }, { status: guard.status });
}
