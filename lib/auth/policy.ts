import { roleCan, type Role } from "@/lib/rbac/roles";

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
 * The role enforcement should use. `trueRole` comes from the database; `viewAs`
 * comes from the (signed) session cookie. The roleCan check — NOT the signature
 * — is the real gate: a rep who forged viewAs:"admin" still resolves to their
 * own role, because their true role lacks roles.viewas.
 */
export function effectiveRole(trueRole: Role, viewAs: Role | null | undefined): Role {
  if (!viewAs || viewAs === trueRole) return trueRole;
  return roleCan(trueRole, "roles.viewas") ? viewAs : trueRole;
}

export type RoleChangeDenial = "main-admin" | "self" | "last-admin" | null;

/**
 * Three ways to lock everyone out of the console, all refused here rather than
 * in the UI — the UI merely mirrors these answers.
 */
export function denyRoleChange(args: {
  actorEmail: string;
  targetEmail: string;
  nextRole: Role;
  adminEmails: readonly string[];
}): RoleChangeDenial {
  const actor = args.actorEmail.trim().toLowerCase();
  const target = args.targetEmail.trim().toLowerCase();
  const admins = args.adminEmails.map((e) => e.trim().toLowerCase());

  if (target === MAIN_ADMIN_EMAIL && args.nextRole !== "admin") return "main-admin";
  if (actor === target) return "self";
  if (args.nextRole !== "admin" && admins.length === 1 && admins[0] === target) {
    return "last-admin";
  }
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
