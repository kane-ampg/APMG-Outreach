import { createRemoteJWKSet, jwtVerify } from "jose";

/** Google OAuth 2.0 / OpenID Connect wiring. Sign-in only — we request no
 *  offline access and store no refresh token. */

const AUTH_ENDPOINT = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const JWKS = createRemoteJWKSet(new URL("https://www.googleapis.com/oauth2/v3/certs"));

export const OAUTH_STATE_COOKIE = "apmg_oauth_state";
export const OAUTH_VERIFIER_COOKIE = "apmg_oauth_verifier";
export const OAUTH_NEXT_COOKIE = "apmg_oauth_next";
/** The OAuth handshake is a single round trip; 10 minutes is generous. */
export const OAUTH_COOKIE_MAX_AGE = 600;

export function clientId(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_ID;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_ID is not set");
  return v;
}

function clientSecret(): string {
  const v = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  if (!v) throw new Error("GOOGLE_OAUTH_CLIENT_SECRET is not set");
  return v;
}

export function allowedDomain(): string {
  return (process.env.GOOGLE_ALLOWED_DOMAIN || "apmgservices.com.au").trim().toLowerCase();
}

/** Derived from the request so dev, preview and production each work — every
 *  origin must be registered as an Authorized redirect URI in Google Cloud. */
export function redirectUri(req: Request): string {
  return new URL("/api/auth/google/callback", req.url).toString();
}

function base64url(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function randomToken(): string {
  return base64url(crypto.getRandomValues(new Uint8Array(32)));
}

export async function pkceChallenge(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  return base64url(new Uint8Array(digest));
}

export function authorizeUrl(args: {
  redirectUri: string;
  state: string;
  challenge: string;
}): string {
  const url = new URL(AUTH_ENDPOINT);
  url.searchParams.set("client_id", clientId());
  url.searchParams.set("redirect_uri", args.redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", "openid email profile");
  // Sign-in only: no refresh token is wanted, so nothing long-lived to leak.
  url.searchParams.set("access_type", "online");
  url.searchParams.set("state", args.state);
  url.searchParams.set("code_challenge", args.challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account");
  // Hints Google to the right domain; our own check is what enforces it.
  url.searchParams.set("hd", allowedDomain());
  return url.toString();
}

export async function exchangeCode(args: {
  code: string;
  verifier: string;
  redirectUri: string;
}): Promise<{ id_token?: string } | null> {
  try {
    const res = await fetch(TOKEN_ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code: args.code,
        client_id: clientId(),
        client_secret: clientSecret(),
        redirect_uri: args.redirectUri,
        grant_type: "authorization_code",
        code_verifier: args.verifier,
      }),
    });
    if (!res.ok) {
      console.error("[auth] token exchange failed:", res.status, (await res.text()).slice(0, 300));
      return null;
    }
    return (await res.json()) as { id_token?: string };
  } catch (e) {
    console.error("[auth] token exchange threw:", e);
    return null;
  }
}

export interface GoogleClaims {
  email?: string;
  email_verified?: boolean;
  hd?: string;
  name?: string;
  picture?: string;
}

/** Verify the id_token's signature, issuer and audience against Google's JWKS. */
export async function verifyIdToken(idToken: string): Promise<GoogleClaims | null> {
  try {
    const { payload } = await jwtVerify(idToken, JWKS, {
      issuer: ["https://accounts.google.com", "accounts.google.com"],
      audience: clientId(),
    });
    return payload as GoogleClaims;
  } catch (e) {
    console.error("[auth] id_token verification failed:", e);
    return null;
  }
}
