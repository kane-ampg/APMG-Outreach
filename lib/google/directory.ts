import "server-only";
import crypto from "node:crypto";
import { allowedDomain } from "@/lib/auth/google";

/**
 * Every account on the Workspace domain, via the Admin SDK Directory API.
 *
 * This is what lets Settings show colleagues who have never signed in. It is a
 * READ of Google's roster, not a source of authority: nothing here grants
 * anything, and a person appearing in this list still holds no role until an
 * admin assigns one. The failure mode is therefore "show fewer people", never
 * "show more access" — every path below degrades to a reason string that the
 * UI renders as a banner, and the roster falls back to `app_users` alone.
 *
 * Setup, which cannot be done from code:
 *   1. Create a service account in Google Cloud and download its JSON key.
 *   2. Enable the Admin SDK API on that project.
 *   3. In Workspace Admin console → Security → Access and data control →
 *      API controls → Domain-wide delegation, authorize the service account's
 *      CLIENT ID (the numeric one, not the email) for exactly the scope below.
 *   4. Set the env vars in `readConfig`.
 *
 * Domain-wide delegation is why `sub` (impersonation) is mandatory: the
 * Directory API has no concept of a service account acting as itself, so the
 * token must act AS a real super admin. Missing step 3 surfaces as
 * `unauthorized_client` from the token exchange.
 *
 * https://developers.google.com/admin-sdk/directory/reference/rest/v1/users/list
 */

const DIRECTORY_SCOPE = "https://www.googleapis.com/auth/admin.directory.user.readonly";
const TOKEN_ENDPOINT = "https://oauth2.googleapis.com/token";
const USERS_ENDPOINT = "https://admin.googleapis.com/admin/directory/v1/users";

/** Long enough that clicking around Settings doesn't re-hit Google on every
 *  render; short enough that a new hire shows up the same morning. */
const CACHE_TTL_MS = 5 * 60 * 1000;

export interface DirectoryPerson {
  email: string;
  name: string | null;
  department: string | null;
}

export type DirectoryResult =
  | { state: "unconfigured"; reason: string }
  | { state: "error"; reason: string }
  | {
      state: "synced";
      people: DirectoryPerson[];
      /** Accounts on the domain that exist but cannot sign in. */
      suspendedHidden: number;
      fetchedAt: string;
    };

interface Config {
  clientEmail: string;
  privateKey: string;
  adminEmail: string;
  customerId: string;
}

function readConfig(): { ok: true; cfg: Config } | { ok: false; reason: string } {
  const clientEmail = process.env.GOOGLE_WORKSPACE_SA_EMAIL?.trim();
  // Vercel and most CI stores keep PEM newlines as literal backslash-n.
  const privateKey = (process.env.GOOGLE_WORKSPACE_SA_PRIVATE_KEY ?? "")
    .replace(/\\n/g, "\n")
    .trim();
  const adminEmail = process.env.GOOGLE_WORKSPACE_ADMIN_EMAIL?.trim();

  const missing = [
    !clientEmail && "GOOGLE_WORKSPACE_SA_EMAIL",
    !privateKey && "GOOGLE_WORKSPACE_SA_PRIVATE_KEY",
    !adminEmail && "GOOGLE_WORKSPACE_ADMIN_EMAIL",
  ].filter(Boolean);

  if (missing.length > 0) {
    return { ok: false, reason: `Not configured — missing ${missing.join(", ")}.` };
  }
  return {
    ok: true,
    cfg: {
      clientEmail: clientEmail as string,
      privateKey,
      adminEmail: adminEmail as string,
      // "my_customer" resolves to the customer owning the impersonated admin,
      // which is right for every single-tenant setup. Overridable for resellers.
      customerId: process.env.GOOGLE_WORKSPACE_CUSTOMER_ID?.trim() || "my_customer",
    },
  };
}

export function isDirectoryConfigured(): boolean {
  return readConfig().ok;
}

function base64Url(input: string | Buffer): string {
  const buf = typeof input === "string" ? Buffer.from(input) : input;
  return buf.toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
}

let tokenCache: { token: string; expiresAt: number } | null = null;

/** Service-account access token via the JWT-bearer flow, impersonating an
 *  admin. Hand-rolled rather than pulling in `googleapis` for one endpoint. */
async function accessToken(cfg: Config): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (tokenCache && tokenCache.expiresAt - 30 > now) return tokenCache.token;

  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = base64Url(
    JSON.stringify({
      iss: cfg.clientEmail,
      sub: cfg.adminEmail,
      scope: DIRECTORY_SCOPE,
      aud: TOKEN_ENDPOINT,
      iat: now,
      exp: now + 3600,
    }),
  );
  const signingInput = `${header}.${claim}`;

  let signature: string;
  try {
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(signingInput);
    signature = base64Url(signer.sign(cfg.privateKey));
  } catch (e) {
    throw new Error(
      `Could not sign the service-account JWT. Check GOOGLE_WORKSPACE_SA_PRIVATE_KEY is the full PEM block including the BEGIN/END lines. ${
        e instanceof Error ? e.message : String(e)
      }`,
    );
  }

  const res = await fetch(TOKEN_ENDPOINT, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion: `${signingInput}.${signature}`,
    }),
    cache: "no-store",
  });
  const body = (await res.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
    error_description?: string;
  };
  if (!res.ok || !body.access_token) {
    const detail = body.error_description ?? body.error ?? res.statusText;
    // The single most likely misconfiguration, called out by name because the
    // raw message ("unauthorized_client") does not hint at the fix.
    const hint =
      body.error === "unauthorized_client"
        ? " This usually means the service account's client ID has not been authorized for the admin.directory.user.readonly scope in Admin console → Domain-wide delegation."
        : "";
    throw new Error(`Google token exchange failed (${res.status}): ${detail}.${hint}`);
  }

  tokenCache = {
    token: body.access_token,
    expiresAt: now + (body.expires_in ?? 3600),
  };
  return body.access_token;
}

interface ApiUser {
  primaryEmail?: string;
  name?: { fullName?: string };
  suspended?: boolean;
  archived?: boolean;
  orgUnitPath?: string;
  organizations?: Array<{ department?: string; primary?: boolean }>;
}

function departmentOf(u: ApiUser): string | null {
  const orgs = u.organizations ?? [];
  const dept = (orgs.find((o) => o.primary) ?? orgs[0])?.department?.trim();
  if (dept) return dept;
  // Org unit is the usual fallback in Workspaces that never fill in the
  // organizations field. "/" is the root unit and says nothing worth showing.
  const unit = u.orgUnitPath?.trim();
  if (!unit || unit === "/") return null;
  return unit.replace(/^\//, "").replace(/\//g, " · ");
}

let listCache: { at: number; result: DirectoryResult } | null = null;

/**
 * The domain roster, cached in-process.
 *
 * Only successes are cached: an outage must not pin an error banner in front of
 * an admin for five minutes after Google recovers.
 */
export async function fetchWorkspaceDirectory(
  opts: { force?: boolean } = {},
): Promise<DirectoryResult> {
  const config = readConfig();
  if (!config.ok) return { state: "unconfigured", reason: config.reason };

  // `force` is what the Refresh button sends. Without it, an admin who has just
  // fixed their delegation setup would keep seeing the stale failure for up to
  // five minutes and reasonably conclude the fix did not work.
  if (!opts.force && listCache && Date.now() - listCache.at < CACHE_TTL_MS) {
    return listCache.result;
  }

  try {
    const token = await accessToken(config.cfg);
    const domain = allowedDomain();
    const people: DirectoryPerson[] = [];
    let suspendedHidden = 0;
    let pageToken: string | undefined;

    // Bounded so a malformed nextPageToken cannot spin forever. 200 pages at
    // 500 per page is 100k accounts — far past any plausible roster.
    for (let page = 0; page < 200; page++) {
      const url = new URL(USERS_ENDPOINT);
      url.searchParams.set("customer", config.cfg.customerId);
      url.searchParams.set("maxResults", "500");
      url.searchParams.set("orderBy", "email");
      // `full` is what carries organizations[].department; the default
      // projection omits it and every department would read as null.
      url.searchParams.set("projection", "full");
      if (pageToken) url.searchParams.set("pageToken", pageToken);

      const res = await fetch(url.toString(), {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (!res.ok) {
        const detail = await res.text().catch(() => "");
        throw new Error(`Directory list failed (${res.status}): ${detail.slice(0, 300)}`);
      }
      const body = (await res.json()) as { users?: ApiUser[]; nextPageToken?: string };

      for (const u of body.users ?? []) {
        const email = u.primaryEmail?.trim().toLowerCase();
        if (!email) continue;
        // A multi-domain Workspace can return addresses that our OAuth gate
        // would refuse at sign-in. Listing them as assignable would be a lie.
        if (!email.endsWith(`@${domain}`)) continue;
        if (u.suspended || u.archived) {
          suspendedHidden++;
          continue;
        }
        people.push({
          email,
          name: u.name?.fullName?.trim() || null,
          department: departmentOf(u),
        });
      }

      pageToken = body.nextPageToken;
      if (!pageToken) break;
    }

    const result: DirectoryResult = {
      state: "synced",
      people,
      suspendedHidden,
      fetchedAt: new Date().toISOString(),
    };
    listCache = { at: Date.now(), result };
    return result;
  } catch (e) {
    const reason = e instanceof Error ? e.message : String(e);
    console.error("[directory] Workspace user list failed:", reason);
    return { state: "error", reason };
  }
}
