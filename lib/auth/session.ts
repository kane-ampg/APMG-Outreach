import { SignJWT, jwtVerify } from "jose";
import { isRole, type Role } from "@/lib/rbac/roles";

/**
 * The session cookie: a signed JWT carrying IDENTITY ONLY.
 *
 * The role is deliberately NOT in here — it is read from app_users per request
 * so that changing someone's role in the admin UI takes effect immediately
 * rather than whenever their cookie happens to expire.
 *
 * EDGE-SAFE BY CONTRACT: middleware.ts imports this module, so it must never
 * import `server-only`, Node built-ins, or anything that touches the database.
 */

export const SESSION_COOKIE = "apmg_session";
/** Read by the root layout to pick the pre-paint theme for a role. */
export const THEME_SEED_COOKIE = "apmg-theme-seed";
export const SESSION_TTL_SECONDS = 60 * 60 * 12; // 12 hours

export interface SessionClaims {
  email: string;
  name?: string;
  picture?: string;
  /** Role being previewed. Authority still comes from the DB — see policy.ts. */
  viewAs?: Role | null;
}

const encoder = new TextEncoder();

function secret(): Uint8Array {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not set — cannot sign or verify sessions");
  return encoder.encode(value);
}

export async function signSession(claims: SessionClaims): Promise<string> {
  return new SignJWT({
    name: claims.name,
    picture: claims.picture,
    viewAs: claims.viewAs ?? undefined,
  })
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(claims.email.trim().toLowerCase())
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL_SECONDS}s`)
    .sign(secret());
}

/** Verify signature and expiry. Any failure is a null session — never a throw,
 *  so callers can treat "no session" and "bad session" identically. */
export async function verifySession(
  token: string | undefined,
): Promise<SessionClaims | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secret(), { algorithms: ["HS256"] });
    const email = typeof payload.sub === "string" ? payload.sub : null;
    if (!email) return null;
    return {
      email,
      name: typeof payload.name === "string" ? payload.name : undefined,
      picture: typeof payload.picture === "string" ? payload.picture : undefined,
      viewAs: isRole(payload.viewAs) ? payload.viewAs : null,
    };
  } catch {
    return null;
  }
}

export function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    // Lax, NOT Strict: the OAuth callback is a top-level cross-site navigation
    // and Strict would strip the cookie from it.
    sameSite: "lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  } as const;
}
