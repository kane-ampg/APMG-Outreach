/**
 * Turning `app_users.last_seen_at` and `last_login_at` into something the
 * console can say out loud.
 *
 * TWO DIFFERENT FACTS, NEVER CONFLATED:
 *
 *   last_seen_at  — a heartbeat from an OPEN, VISIBLE console tab, refreshed
 *                   every PRESENCE_BEAT_MS. Fresh means they are there now.
 *   last_login_at — the moment a Google sign-in completed, hours or days ago.
 *                   It says nothing whatever about right now.
 *
 * Only the first can turn a row green. `online` is the sole status that claims
 * presence, and it is reachable only from a heartbeat inside
 * PRESENCE_WINDOW_MS — no amount of recent signing-in produces it.
 *
 * EVERY function here takes `now` explicitly rather than calling `Date.now()`.
 * The stamps are written by the server's clock, so they must be compared
 * against the server's clock: the browser passes a skew-corrected `now` (see
 * `useServerClock`), and a laptop with a wrong clock therefore cannot hold a
 * row green after the person has gone. It also makes every case below testable
 * without faking timers.
 */

/** How often an open tab reports in. */
export const PRESENCE_BEAT_MS = 30_000;

/**
 * How stale a heartbeat may be and still count as online — three beats.
 *
 * Not one: a single dropped request, a laggy network or a browser throttling a
 * background timer would otherwise flicker somebody offline while they sit
 * there working. Not ten: this is the window in which the console can be
 * WRONG about someone being present, so it is deliberately close to the beat.
 * The cost of the slack is bounded and stated — a row can stay green for up to
 * PRESENCE_WINDOW_MS after a tab closes, and no longer.
 */
export const PRESENCE_WINDOW_MS = 3 * PRESENCE_BEAT_MS;

/**
 * How long without a sign-in before the console calls an account dormant.
 *
 * A reporting threshold, not a rule — nothing about anyone's access changes on
 * day 30. It exists so an admin can spot a role nobody is using.
 */
export const DORMANT_AFTER_DAYS = 30;

/**
 * `online`  — heartbeat within PRESENCE_WINDOW_MS. The only green state, and
 *             the only one that asserts anything about the present.
 * `recent`  — signed in (or last seen) within DORMANT_AFTER_DAYS, but not now.
 * `dormant` — no sign of them for DORMANT_AFTER_DAYS or more.
 * `never`   — no sign-in has ever been recorded.
 * `unknown` — a stamp exists but could not be parsed. Deliberately NOT folded
 *             into `never`, which would report an account that has been used
 *             as one that never has.
 */
export type SignInStatus = "online" | "recent" | "dormant" | "never" | "unknown";

export interface SignInFacts {
  /** completed Google sign-in */
  lastLoginAt: string | null;
  /** heartbeat from an open console tab */
  lastSeenAt: string | null;
}

/** Milliseconds, or null when the stamp is absent or unparseable. */
function stamp(iso: string | null): number | null {
  if (!iso) return null;
  const ms = new Date(iso).getTime();
  return Number.isNaN(ms) ? null : ms;
}

/**
 * Is this person on the console right now?
 *
 * The single question that may light a row green, and it consults ONLY the
 * heartbeat. A future-dated stamp still counts — that is clock skew on a
 * genuinely live session, not a stale one.
 */
export function isOnline(facts: SignInFacts, now: number): boolean {
  const seen = stamp(facts.lastSeenAt);
  return seen !== null && now - seen < PRESENCE_WINDOW_MS;
}

export function signInStatus(facts: SignInFacts, now: number): SignInStatus {
  if (isOnline(facts, now)) return "online";
  // Beyond the presence window the heartbeat stops meaning "now" and becomes
  // just another sighting, so the freshest of the two drives the rest.
  const latest = lastSeenMs(facts);
  if (latest === null) {
    // A stamp that exists but won't parse must not read as "never signed in".
    return facts.lastLoginAt || facts.lastSeenAt ? "unknown" : "never";
  }
  return now - latest < DORMANT_AFTER_DAYS * 86_400_000 ? "recent" : "dormant";
}

/** The most recent moment we have any evidence of this person, in ms. */
export function lastSeenMs(facts: SignInFacts): number | null {
  const login = stamp(facts.lastLoginAt);
  const seen = stamp(facts.lastSeenAt);
  if (login === null) return seen;
  if (seen === null) return login;
  return Math.max(login, seen);
}

/** The ISO stamp behind `lastSeenMs`, for display. */
export function lastSeenIso(facts: SignInFacts): string | null {
  const ms = lastSeenMs(facts);
  if (ms === null) return null;
  return stamp(facts.lastSeenAt) === ms ? facts.lastSeenAt : facts.lastLoginAt;
}

export const SIGN_IN_LABEL: Record<SignInStatus, string> = {
  online: "Online now",
  recent: "Signed in",
  dormant: "Dormant",
  never: "Never signed in",
  // No adjective: a sign-in happened, and the stamp that would qualify it is
  // the part we couldn't read.
  unknown: "Signed in",
};

/**
 * Relative "how long ago" while that is still something a person can picture,
 * an absolute date once it isn't. "213d ago" is true and unreadable.
 */
export function agoText(iso: string | null, now: number): string {
  const then = stamp(iso);
  if (then === null) return iso ? "at an unreadable time" : "never";
  const mins = Math.round((now - then) / 60_000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < DORMANT_AFTER_DAYS) return `${days}d ago`;
  return exactDate(iso as string);
}

/** Day only — for a stamp old enough that the minute stopped mattering. */
export function exactDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleDateString("en-AU", { day: "numeric", month: "short", year: "numeric" });
}

/**
 * Full local timestamp, for tooltips and the detail pane. The relative forms
 * are the readable ones, but an admin deciding whether to revoke somebody's
 * access needs the actual moment, not "47d ago".
 */
export function exactTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "unknown";
  return d.toLocaleString("en-AU", { dateStyle: "medium", timeStyle: "short" });
}
