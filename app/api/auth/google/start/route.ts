import { NextResponse } from "next/server";
import {
  OAUTH_COOKIE_MAX_AGE,
  OAUTH_NEXT_COOKIE,
  OAUTH_STATE_COOKIE,
  OAUTH_VERIFIER_COOKIE,
  authorizeUrl,
  pkceChallenge,
  randomToken,
  redirectUri,
} from "@/lib/auth/google";
import { isSafeNextPath } from "@/lib/auth/policy";

export const runtime = "nodejs";

/** Begin the Google sign-in. Stashes the CSRF state, the PKCE verifier and the
 *  post-login destination in short-lived HttpOnly cookies. */
export async function GET(req: Request): Promise<Response> {
  const state = randomToken();
  const verifier = randomToken();
  const challenge = await pkceChallenge(verifier);

  const requested = new URL(req.url).searchParams.get("next");
  const next = isSafeNextPath(requested) ? (requested as string) : "/";

  const res = NextResponse.redirect(
    authorizeUrl({ redirectUri: redirectUri(req), state, challenge }),
  );
  const opts = {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: OAUTH_COOKIE_MAX_AGE,
  } as const;
  res.cookies.set(OAUTH_STATE_COOKIE, state, opts);
  res.cookies.set(OAUTH_VERIFIER_COOKIE, verifier, opts);
  res.cookies.set(OAUTH_NEXT_COOKIE, next, opts);
  return res;
}
