import { PRESENCE_BEAT_MS } from "@/lib/auth/signIn";
import { touchLastSeen } from "@/lib/auth/userStore";
import { sameOrigin } from "@/lib/pipeline/server";
import { resolveSession } from "@/lib/rbac/server";

/**
 * "I still have the console open."
 *
 * Called by `usePresenceHeartbeat` every PRESENCE_BEAT_MS while a tab is open
 * AND visible, and by nothing else. It stamps `app_users.last_seen_at`, which
 * is the only fact allowed to show somebody as online in Settings.
 *
 * IDENTITY COMES FROM THE SESSION COOKIE, never the body — this endpoint takes
 * no body at all. Otherwise anybody with a session could keep a colleague's row
 * lit up green, which is precisely the false claim the presence column was
 * added to prevent.
 *
 * A view-as preview stamps the ADMIN's real address, because `resolveSession`
 * reports the true identity in `email` regardless of the role being previewed.
 * The person at the keyboard is the one who is present.
 *
 * `pending` and every other role may beat. Presence is not a permission: a
 * revoked colleague staring at the access-pending screen is genuinely there,
 * and an admin looking at the roster benefits from seeing that.
 */
export const runtime = "nodejs";

/**
 * Last write per address, to absorb duplicate beats — several open tabs, or a
 * remount — without a database round trip each time.
 *
 * Per-process and therefore best-effort: serverless instances each keep their
 * own copy and cold starts forget. That is fine, because it is an optimisation
 * and not a limit. Nothing downstream depends on the throttle holding.
 */
const lastWrite = new Map<string, number>();

/** Below a full beat, so a slightly early request is never dropped. */
const MIN_WRITE_GAP_MS = PRESENCE_BEAT_MS * 0.8;

/** Bounds the map on a long-lived instance. Far above any real head count for
 *  this console, so it only ever fires as a leak guard. */
const MAX_TRACKED = 500;

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) return Response.json({ ok: false }, { status: 403 });

  const session = await resolveSession(req);
  if (!session) return Response.json({ ok: false }, { status: 401 });

  const now = Date.now();
  const previous = lastWrite.get(session.email);
  if (previous !== undefined && now - previous < MIN_WRITE_GAP_MS) {
    // Already stamped a moment ago by another tab. Reported honestly as a
    // skip rather than as a write that happened.
    return Response.json({ ok: true, wrote: false });
  }

  const result = await touchLastSeen(session.email);
  if (result === "ok") {
    if (lastWrite.size >= MAX_TRACKED) lastWrite.clear();
    lastWrite.set(session.email, now);
    return Response.json({ ok: true, wrote: true });
  }

  // 200 on every failure below, deliberately. A heartbeat is telemetry about
  // an idle tab; failing it loudly would put an error in front of somebody who
  // did nothing wrong and cannot fix it. The client is told to stop beating
  // only when beating is genuinely pointless.
  return Response.json({
    ok: false,
    wrote: false,
    // `stop` means "this will never succeed on this deployment": no database
    // configured, or the migration hasn't been run. A transient error is not
    // included — those should keep retrying.
    stop: result === "demo" || result === "missing_column",
    reason: result,
  });
}
