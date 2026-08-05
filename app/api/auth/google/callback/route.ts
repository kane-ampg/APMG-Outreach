import { NextResponse, type NextRequest } from "next/server";
import {
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  allowedDomain,
  exchangeCode,
  redirectUri,
  verifyIdToken,
} from "@/lib/auth/google";
import { assertWorkspaceIdentity, isSafeNextPath } from "@/lib/auth/policy";
import {
  SESSION_COOKIE,
  THEME_SEED_COOKIE,
  sessionCookieOptions,
  signSession,
} from "@/lib/auth/session";
import { upsertOnLogin } from "@/lib/auth/userStore";

export const runtime = "nodejs";

/**
 * Everything that must not outlive a sign-in attempt: the three handshake
 * cookies, plus the two pre-migration cookies the old browser-set session used.
 * Cleared on EVERY exit path — success and failure alike. A failed attempt that
 * leaves `apmg-role` in place is exactly the authorization bypass this migration
 * exists to close, and a denied consent should not strand handshake state in the
 * browser of a shared machine.
 */
const STALE_COOKIES = [
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  OAUTH_NEXT_COOKIE,
  "apmg-role",
  "apmg-user",
] as const;

function clearStale(res: NextResponse): NextResponse {
  for (const name of STALE_COOKIES) res.cookies.set(name, "", { path: "/", maxAge: 0 });
  return res;
}

function fail(req: NextRequest, reason: string): Response {
  return clearStale(
    NextResponse.redirect(new URL(`/login?error=${encodeURIComponent(reason)}`, req.url)),
  );
}

export async function GET(req: NextRequest): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");

  // Read through NextRequest's cookie jar, NOT a hand-rolled Cookie-header
  // regex. `ResponseCookies.set()` percent-encodes on the way out and only
  // `RequestCookies.get()` decodes on the way back, so hand-parsing returns
  // "%2Fleads" for a stored next of "/leads" — which then fails isSafeNextPath
  // and silently kills return-to-page for every destination except "/". Letting
  // the framework own both sides removes the mismatch entirely.
  const expectedState = req.cookies.get(OAUTH_STATE_COOKIE)?.value;
  const verifier = req.cookies.get(OAUTH_VERIFIER_COOKIE)?.value;
  const storedNext = req.cookies.get(OAUTH_NEXT_COOKIE)?.value;

  if (url.searchParams.get("error")) return fail(req, "google-denied");
  if (!code || !state || !expectedState || state !== expectedState) return fail(req, "bad-state");
  if (!verifier) return fail(req, "bad-state");

  const tokens = await exchangeCode({ code, verifier, redirectUri: redirectUri(req) });
  if (!tokens?.id_token) return fail(req, "exchange-failed");

  const claims = await verifyIdToken(tokens.id_token);
  if (!claims) return fail(req, "invalid-token");

  const identity = assertWorkspaceIdentity(claims, allowedDomain());
  if (!identity.ok) return fail(req, identity.reason);

  const role = await upsertOnLogin({
    email: identity.email,
    name: claims.name,
    picture: claims.picture,
  });

  const next = isSafeNextPath(storedNext) ? (storedNext as string) : "/";
  const res = NextResponse.redirect(new URL(next, req.url));

  res.cookies.set(
    SESSION_COOKIE,
    await signSession({ email: identity.email, name: claims.name, picture: claims.picture }),
    sessionCookieOptions(),
  );
  // Pre-paint theme for this role — reps work in daylight and get light.
  res.cookies.set(THEME_SEED_COOKIE, role === "sales" ? "light" : "dark", {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  // Same clearing as every failure path — handshake cookies plus the old
  // client-set ones, which are an authorization bypass while any browser holds
  // them and any code still reads them.
  return clearStale(res);
}
