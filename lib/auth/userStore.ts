import { supabaseTarget } from "@/lib/pipeline/server";
import { MAIN_ADMIN_EMAIL } from "@/lib/auth/policy";
import { isRole, type Role } from "@/lib/rbac/roles";

/**
 * All app_users access. Server-only (uses the service-role key).
 *
 * DEMO MODE: local development frequently runs without Supabase configured
 * (supabaseTarget() -> "demo"), and auth must not hard-fail there or the app
 * becomes undevelopable. In demo mode the main admin resolves to admin and
 * every other authenticated address to pending, with no persistence.
 */

const TABLE = "app_users";

/**
 * The role a first-time Google sign-in lands on.
 *
 * A MIRROR of `app_users.role`'s column default in supabase/app-users.sql —
 * the database is what actually applies it, since `upsertOnLogin` deliberately
 * never writes the column. Kept here so the Settings screen can say "Sales on
 * first sign-in" out loud instead of rendering somebody who has never signed in
 * as though they had no access coming. Change the SQL and this together.
 */
export const DEFAULT_SIGNUP_ROLE: Role = "sales";

function authHeaders(key: string): Record<string, string> {
  return { apikey: key, Authorization: `Bearer ${key}` };
}

function demoRole(email: string): Role {
  return email.trim().toLowerCase() === MAIN_ADMIN_EMAIL ? "admin" : "pending";
}

/** The user's stored role. Unknown or unreadable resolves to `pending` — the
 *  failure direction must be "no access", never "admin". */
export async function getUserRole(email: string): Promise<Role> {
  const key = email.trim().toLowerCase();
  const target = supabaseTarget();
  if (target.state !== "ok") return demoRole(key);
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?email=eq.${encodeURIComponent(key)}&select=role&limit=1`,
      { headers: authHeaders(target.key), cache: "no-store" },
    );
    if (!res.ok) return "pending";
    const rows = (await res.json().catch(() => [])) as Array<{ role: string }>;
    const role = rows[0]?.role;
    return isRole(role) ? role : "pending";
  } catch {
    return "pending";
  }
}

/**
 * Record a sign-in: create the row on first sight (at the column's `pending`
 * default), refresh the profile fields, stamp `last_login_at`.
 *
 * `role` is NEVER written here, and that is structural, not incidental.
 * `getUserRole` collapses every failure — 5xx, rate limit, schema-cache reload,
 * a dropped connection — into `"pending"`, which is indistinguishable from a
 * genuinely pending user. Reading the role and writing it back through an
 * upsert would therefore demote a real admin to `pending` on a transient blip
 * during their own sign-in, locking out the very account that must never be
 * lockable. Splitting this into an insert that ignores conflicts plus a PATCH
 * that omits `role` makes that class of bug impossible rather than guarded
 * against: no code path here can write the column at all. Roles change only by
 * explicit admin action.
 */
export async function upsertOnLogin(u: {
  email: string;
  name?: string;
  picture?: string;
}): Promise<Role> {
  const email = u.email.trim().toLowerCase();
  const target = supabaseTarget();
  if (target.state !== "ok") return demoRole(email);

  // First sight only. `ignore-duplicates` leaves an existing row untouched, so
  // a returning user's stored role is never in the write path.
  try {
    const res = await fetch(`${target.base}/rest/v1/${TABLE}?on_conflict=email`, {
      method: "POST",
      headers: {
        ...authHeaders(target.key),
        "Content-Type": "application/json",
        Prefer: "resolution=ignore-duplicates,return=minimal",
      },
      body: JSON.stringify([{ email }]),
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[auth] app_users insert ${res.status}:`, detail.slice(0, 500));
    }
  } catch (e) {
    console.error("[auth] app_users insert failed:", e);
  }

  // Profile refresh — deliberately no `role` key in this body.
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?email=eq.${encodeURIComponent(email)}`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(target.key),
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        body: JSON.stringify({
          name: u.name ?? null,
          picture_url: u.picture ?? null,
          last_login_at: new Date().toISOString(),
        }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[auth] app_users profile refresh ${res.status}:`, detail.slice(0, 500));
    }
  } catch (e) {
    console.error("[auth] app_users profile refresh failed:", e);
  }

  // Read the role back rather than assuming it. A failure here returns
  // "pending", which is only used to seed the starting theme — never persisted
  // — so a blip costs a dark theme, not an account.
  return getUserRole(email);
}

export interface AppUserRow {
  email: string;
  name: string | null;
  picture_url: string | null;
  role: Role;
  created_at: string;
  last_login_at: string | null;
  /**
   * Last heartbeat from an open console tab — presence, not sign-in.
   *
   * `null` means "never observed online", which includes every row written
   * before the column existed. It is NEVER derived from `last_login_at`:
   * treating an old sign-in as presence is the precise thing this column was
   * added to stop.
   */
  last_seen_at: string | null;
  /** Set when an admin pre-assigned this role before the person ever signed
   *  in. Display-only: `last_login_at === null` is what "never signed in"
   *  actually means. */
  invited_by: string | null;
}

/**
 * Pre-assign a role to somebody who has never signed in ("Add by email").
 *
 * A plain INSERT, not an upsert, and that matters: `Prefer:
 * resolution=merge-duplicates` would stamp `invited_by` onto an EXISTING row,
 * relabelling a colleague who signed in normally months ago as though an admin
 * had invited them. Callers establish non-existence first and treat the
 * duplicate-key case as the race it is — see the PATCH handler, which falls
 * back to `setUserRole`.
 *
 * Writing `role` here is safe in a way it is not in `upsertOnLogin`: this runs
 * only from an explicit admin action that names the role, never from a read
 * that could have failed closed to "pending".
 */
export async function createUserWithRole(args: {
  email: string;
  role: Role;
  invitedBy: string;
}): Promise<"ok" | "demo" | "conflict" | "error"> {
  const target = supabaseTarget();
  if (target.state !== "ok") return "demo";
  const email = args.email.trim().toLowerCase();
  try {
    const res = await fetch(`${target.base}/rest/v1/${TABLE}`, {
      method: "POST",
      headers: {
        ...authHeaders(target.key),
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify([
        { email, role: args.role, invited_by: args.invitedBy.trim().toLowerCase() },
      ]),
    });
    if (res.ok) return "ok";
    // 23505 = unique_violation. Two admins adding the same address at once:
    // the row now exists, so the caller can simply set the role on it.
    const detail = await res.text().catch(() => "");
    if (res.status === 409 || detail.includes("23505")) return "conflict";
    console.error(`[auth] app_users invite ${res.status}:`, detail.slice(0, 500));
    return "error";
  } catch (e) {
    console.error("[auth] app_users invite failed:", e);
    return "error";
  }
}

/**
 * Whether `app_users.last_seen_at` exists, learned from the first read that
 * touches it: `null` = not yet known, `false` = the migration hasn't been run.
 *
 * Cached per process purely to avoid paying for the failed request on every
 * subsequent load. It only ever moves from unknown to known, and a deploy or a
 * cold start re-checks — so running the migration takes effect without anyone
 * having to clear anything.
 */
let presenceColumn: boolean | null = null;

const LIST_COLUMNS = "email,name,picture_url,role,created_at,last_login_at,invited_by";

function listUrl(base: string, withPresence: boolean): string {
  const select = withPresence ? `${LIST_COLUMNS},last_seen_at` : LIST_COLUMNS;
  return `${base}/rest/v1/${TABLE}?select=${select}&order=last_login_at.desc.nullslast`;
}

/** PostgREST surfaces an unknown column as 42703 / "does not exist". Matched on
 *  the column name too, so an unrelated 42703 is never mistaken for this. */
function isMissingPresenceColumn(detail: string): boolean {
  return detail.includes("last_seen_at") && (detail.includes("42703") || detail.includes("does not exist"));
}

/**
 * Stamp presence for one person: "this account had a console tab open just
 * now."
 *
 * Best-effort by design, and the ONLY writer of `last_seen_at`. A failed
 * heartbeat must never break the page the user is looking at — the cost of
 * losing one is that they appear to go offline for half a minute, which is a
 * far better failure than an error toast on an idle tab. This is the inverse
 * of the audit-write rule: presence is telemetry, not a record of authority.
 */
export async function touchLastSeen(email: string): Promise<"ok" | "demo" | "missing_column" | "error"> {
  const target = supabaseTarget();
  if (target.state !== "ok") return "demo";
  if (presenceColumn === false) return "missing_column";
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?email=eq.${encodeURIComponent(email.trim().toLowerCase())}`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(target.key),
          "Content-Type": "application/json",
          Prefer: "return=minimal",
        },
        // Written with the SERVER's clock, and compared against the server's
        // clock too — /api/admin/users returns `serverNow` and the browser
        // measures its own skew from it. A browser clock running five minutes
        // slow would otherwise hold everyone green forever.
        body: JSON.stringify({ last_seen_at: new Date().toISOString() }),
      },
    );
    if (res.ok) {
      presenceColumn = true;
      return "ok";
    }
    const detail = await res.text().catch(() => "");
    if (isMissingPresenceColumn(detail)) {
      presenceColumn = false;
      return "missing_column";
    }
    console.error(`[auth] app_users heartbeat ${res.status}:`, detail.slice(0, 500));
    return "error";
  } catch (e) {
    console.error("[auth] app_users heartbeat failed:", e);
    return "error";
  }
}

/**
 * Every console user, most-recent sign-in first. Rows whose stored role is not
 * in the catalog are coerced to `pending` rather than dropped — an operator
 * needs to SEE a row with a bad role in order to fix it, and hiding it would
 * make the account invisible while it still exists.
 *
 * Returns the literal `"error"` — never `[]` — when the query itself fails
 * (non-2xx response or a thrown error). `[]` is reserved for the demo/
 * unconfigured case and for a genuinely empty table. An empty roster and a
 * failed query demand opposite responses from an operator: "nobody has signed
 * in yet" versus "go check the backend" (wrong schema, missing table,
 * transient outage, a migration that never ran). Collapsing both into `[]`
 * means every caller sees only the empty-roster message and chases the wrong
 * problem, so the distinction is carried all the way out to the API and the UI.
 */
export async function listUsers(): Promise<AppUserRow[] | "error"> {
  const target = supabaseTarget();
  if (target.state !== "ok") return [];
  try {
    let res = await fetch(listUrl(target.base, presenceColumn !== false), {
      headers: authHeaders(target.key),
      cache: "no-store",
    });
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      // The presence column is newer than this code's first deployment, so a
      // console pointed at a database that hasn't run the migration must still
      // render its roster. Falling through to "error" here would black out the
      // whole Roles and Permissions screen over one optional column.
      if (presenceColumn !== false && isMissingPresenceColumn(detail)) {
        console.warn(
          "[auth] app_users.last_seen_at is missing — run supabase/app-users.sql. " +
            "Presence will read as 'never observed online' until then.",
        );
        presenceColumn = false;
        res = await fetch(listUrl(target.base, false), {
          headers: authHeaders(target.key),
          cache: "no-store",
        });
      }
      if (!res.ok) {
        const retryDetail = await res.text().catch(() => "");
        console.error(`[auth] app_users list ${res.status}:`, (retryDetail || detail).slice(0, 500));
        return "error";
      }
    } else if (presenceColumn === null) {
      presenceColumn = true;
    }
    const rows = (await res.json().catch(() => [])) as unknown;
    if (!Array.isArray(rows)) return [];
    return rows.map((r) => {
      const row = r as Record<string, unknown>;
      return {
        email: typeof row.email === "string" ? row.email : "",
        name: typeof row.name === "string" ? row.name : null,
        picture_url: typeof row.picture_url === "string" ? row.picture_url : null,
        role: isRole(row.role) ? row.role : "pending",
        created_at: typeof row.created_at === "string" ? row.created_at : "",
        last_login_at: typeof row.last_login_at === "string" ? row.last_login_at : null,
        last_seen_at: typeof row.last_seen_at === "string" ? row.last_seen_at : null,
        invited_by: typeof row.invited_by === "string" ? row.invited_by : null,
      };
    }).filter((r) => r.email !== "");
  } catch (e) {
    console.error("[auth] app_users list failed:", e);
    return "error";
  }
}

/**
 * Change one user's role.
 *
 * Callers MUST have run `denyRoleChange` first — this function deliberately
 * enforces nothing, so that every lockout rule lives in exactly one tested
 * place instead of being half-checked in two.
 *
 * Returns "missing" when the filter matched no row, which is why the PATCH uses
 * `return=representation`: a silent no-op on a typo'd address would otherwise
 * look identical to success.
 */
export async function setUserRole(
  email: string,
  role: Role,
): Promise<"ok" | "demo" | "missing" | "error"> {
  const target = supabaseTarget();
  if (target.state !== "ok") return "demo";
  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?email=eq.${encodeURIComponent(email.trim().toLowerCase())}`,
      {
        method: "PATCH",
        headers: {
          ...authHeaders(target.key),
          "Content-Type": "application/json",
          Prefer: "return=representation",
        },
        body: JSON.stringify({ role }),
      },
    );
    if (!res.ok) {
      const detail = await res.text().catch(() => "");
      console.error(`[auth] app_users role update ${res.status}:`, detail.slice(0, 500));
      return "error";
    }
    const rows = (await res.json().catch(() => [])) as unknown;
    return Array.isArray(rows) && rows.length > 0 ? "ok" : "missing";
  } catch (e) {
    console.error("[auth] app_users role update failed:", e);
    return "error";
  }
}
