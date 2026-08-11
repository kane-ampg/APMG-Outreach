import { rolesCan, type Role } from "@/lib/rbac/roles";

/**
 * Pure security decisions, deliberately free of Next, cookies and the network
 * so they can be exhaustively unit-tested. Everything here is the difference
 * between "looks secure" and "is secure" — change nothing without a test.
 */

/** The protected main admin. Cannot be demoted or deleted by anyone. */
export const MAIN_ADMIN_EMAIL = "kane@apmgservices.com.au";

export type IdentityResult =
  | { ok: true; email: string }
  | { ok: false; reason: "no-email" | "unverified-email" | "wrong-domain" };

/**
 * Gate Google's id_token claims down to "a real, verified account on OUR
 * Workspace domain". The `hd` claim is checked when present but is never
 * sufficient alone — the address itself is what we key identity on.
 */
export function assertWorkspaceIdentity(
  claims: { email?: string; email_verified?: boolean; hd?: string },
  allowedDomain: string,
): IdentityResult {
  const email = claims.email?.trim().toLowerCase();
  if (!email) return { ok: false, reason: "no-email" };
  if (claims.email_verified !== true) return { ok: false, reason: "unverified-email" };

  const domain = allowedDomain.trim().toLowerCase();
  if (!email.endsWith(`@${domain}`)) return { ok: false, reason: "wrong-domain" };
  if (claims.hd && claims.hd.trim().toLowerCase() !== domain) {
    return { ok: false, reason: "wrong-domain" };
  }
  return { ok: true, email };
}

/**
 * The role set enforcement should use. `trueRoles` comes from the database;
 * `viewAs` comes from the (signed) session cookie. The `rolesCan` check — NOT
 * the signature — is the real gate: a rep who forged viewAs:"admin" still
 * resolves to their own roles, because nothing they hold grants roles.viewas.
 *
 * An authorised preview COLLAPSES to the single previewed role rather than
 * adding to what they hold. That is the whole point — an admin previewing
 * Sales must see what a rep sees, not a rep's console with their own admin
 * powers still quietly attached. It also caps the blast radius: the result of
 * a preview can never be a larger set than one role grants.
 */
export function effectiveRoles(
  trueRoles: readonly Role[],
  viewAs: Role | null | undefined,
): Role[] {
  if (!viewAs) return [...trueRoles];
  return rolesCan(trueRoles, "roles.viewas") ? [viewAs] : [...trueRoles];
}

export type RoleChangeDenial = "main-admin" | "self" | "last-admin" | null;

/**
 * Three ways to lock everyone out of the console, all refused here rather than
 * in the UI — the UI merely mirrors these answers.
 *
 * Every rule is now phrased as "does the NEW SET still contain admin?", which
 * is what actually matters once roles are a set. Adding Sales to the only
 * admin is a widening and must be allowed; taking admin away from them — by
 * swapping it for another role or by clearing the set entirely — is the
 * lockout, and both spellings are caught by the same check.
 */
export function denyRoleChange(args: {
  actorEmail: string;
  targetEmail: string;
  nextRoles: readonly Role[];
  adminEmails: readonly string[];
}): RoleChangeDenial {
  const actor = args.actorEmail.trim().toLowerCase();
  const target = args.targetEmail.trim().toLowerCase();
  const admins = args.adminEmails.map((e) => e.trim().toLowerCase());
  const keepsAdmin = args.nextRoles.includes("admin");

  if (target === MAIN_ADMIN_EMAIL && !keepsAdmin) return "main-admin";
  if (actor === target) return "self";
  if (!keepsAdmin && admins.length === 1 && admins[0] === target) return "last-admin";
  return null;
}

/**
 * Open-redirect guard for the post-login `next` path.
 *
 * Unvalidated, `next` lets an attacker send a staff member a link that
 * completes a GENUINE Google sign-in and then bounces them to a look-alike
 * host — arriving with all the credibility of a real login. Only same-origin
 * relative paths are allowed.
 */
export function isSafeNextPath(next: string | null | undefined): boolean {
  if (!next) return false;
  // Reject control characters outright instead of trying to emulate them.
  // WHATWG URL parsers — every browser, and Node's URL — strip TAB, CR and LF
  // from ANYWHERE in a string before reading its structure. So "/\t/evil.host"
  // survives a naive leading-"//" check and then parses as //evil.host, which
  // is a working open redirect off the back of a genuine sign-in. Refusing the
  // whole character class is safer than matching each parser's strip-list,
  // because a quirk we failed to anticipate cannot reopen the hole.
  if (/[\u0000-\u001f\u007f]/.test(next)) return false;
  if (!next.startsWith("/")) return false;
  // "//host" is protocol-relative; "/\host" is normalised to it by some browsers.
  if (next.startsWith("//") || next.startsWith("/\\")) return false;
  return true;
}
