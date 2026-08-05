import { NextResponse } from "next/server";
import { sameOrigin } from "@/lib/pipeline/server";
import {
  SESSION_COOKIE,
  sessionCookieOptions,
  signSession,
  verifySession,
} from "@/lib/auth/session";
import { getUserRole } from "@/lib/auth/userStore";
import { isRole, roleCan, type Role } from "@/lib/rbac/roles";

/**
 * Lets an admin preview the console as another role.
 *
 * Deliberately does NOT use requirePermission (lib/rbac/server.ts): that
 * checks the EFFECTIVE role, which is whatever is currently being previewed.
 * An admin previewing "sales" would then be gated on
 * roleCan("sales", "roles.viewas") — false — and could never switch again or
 * exit. Authorization here always reads trueRole straight from app_users,
 * never the active viewAs claim.
 */
export const runtime = "nodejs";

function json(body: unknown, status = 200): Response {
  return Response.json(body, { status });
}

/**
 * Mirrors lib/rbac/server.ts's resolveSession — see its comment for why the
 * decode must never throw. Not shared: that file's tests mock verifySession
 * at the module-export boundary, and a shared helper's internal call to it
 * would silently bypass those mocks (a same-module reference is a closure,
 * not a re-import — vi.mock only intercepts the latter).
 */
async function claimsFromCookie(req: Request) {
  const cookie = req.headers.get("cookie") ?? "";
  const raw = cookie.match(new RegExp(`(?:^|;\\s*)${SESSION_COOKIE}=([^;]+)`))?.[1];
  let token: string | undefined;
  try {
    token = raw ? decodeURIComponent(raw) : undefined;
  } catch {
    token = undefined;
  }
  return verifySession(token);
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return json({ error: "Bad origin" }, 403);

  const claims = await claimsFromCookie(req);
  if (!claims) return json({ error: "Not authenticated" }, 401);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return json({ error: "Invalid JSON body." }, 400);
  }
  const raw = (body ?? {}) as { role?: unknown };
  if (raw.role !== null && !isRole(raw.role)) {
    return json({ error: "Role must be a known role name or null." }, 400);
  }
  const requested: Role | null = raw.role;

  // Straight from app_users, never the active viewAs on the incoming
  // cookie — see the file comment.
  const trueRole = await getUserRole(claims.email);
  if (!roleCan(trueRole, "roles.viewas")) {
    return json({ error: "Forbidden — missing permission: roles.viewas" }, 403);
  }

  const res = NextResponse.json({ ok: true, role: requested });
  res.cookies.set(
    SESSION_COOKIE,
    await signSession({
      email: claims.email,
      name: claims.name,
      picture: claims.picture,
      viewAs: requested,
    }),
    sessionCookieOptions(),
  );
  return res;
}
