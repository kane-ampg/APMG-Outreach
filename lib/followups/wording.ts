/**
 * A last-look check on a follow-up draft's wording. Email copy must never
 * mention, hint at or imply that we saw what the lead viewed or clicked (the
 * prompt carries NO_TRACKING_RULE, and the trail is bot-inflated anyway), but a
 * model can still slip. This flags the usual giveaways so the card can warn
 * before a human approves it. A warning only: the human decides.
 *
 * Pure and client-safe (the DraftCard runs it on every edit).
 */

const TRACKING_PHRASES =
  /\b(?:i\s+(?:saw|noticed)\s+you|you\s+(?:had\s+a\s+look|looked|were\s+looking|were\s+browsing|viewed|visited|clicked|opened|downloaded)|since\s+you\s+(?:visited|viewed|were\s+browsing)|browsing\s+our|you(?:'|’|\s+ha)ve\s+been\s+(?:looking|browsing))\b/i;

/** True when plain-text copy reads like it mentions the lead's tracked activity. */
export function mentionsTracking(text: string): boolean {
  return TRACKING_PHRASES.test(text);
}
