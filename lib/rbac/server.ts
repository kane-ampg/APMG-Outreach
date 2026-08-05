import "server-only";
import { SESSION_COOKIE, verifySession } from "@/lib/auth/session";
import { effectiveRole } from "@/lib/auth/policy";
import { getUserRole } from "@/lib/auth/userStore";
import { type Permission } from "./permissions";
import { roleCan, type Role } from "./roles";

/**
 * Server-side permission guard for Route Handlers.
 *
 * The role is read from app_users on every call rather than trusted from the
 * cookie, so an admin's role change takes effect on the very next request.
 * The previous implementation read a CLIENT-SET `apmg-role` cookie, which was
 * a complete authorization bypass — that cookie is now ignored entirely.
 */

export interface ResolvedSession {
  email: string;
  /** What the database says they are. */
  trueRole: Role;
  /** What enforcement should use — differs only during an authorised view-as. */
  role: Role;
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

  const trueRole = await getUserRole(claims.email);
  return {
    email: claims.email,
    trueRole,
    role: effectiveRole(trueRole, claims.viewAs ?? null),
    name: claims.name,
  };
}

export type GuardResult =
  | { ok: true; role: Role; email: string }
  | { ok: false; status: 401 | 403; error: string };

export async function requirePermission(
  req: Request,
  perm: Permission,
): Promise<GuardResult> {
  const session = await resolveSession(req);
  if (!session) return { ok: false, status: 401, error: "Not authenticated" };
  if (!roleCan(session.role, perm)) {
    return { ok: false, status: 403, error: `Forbidden — missing permission: ${perm}` };
  }
  return { ok: true, role: session.role, email: session.email };
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
