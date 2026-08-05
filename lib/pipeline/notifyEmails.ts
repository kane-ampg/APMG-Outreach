// Parsing for the enquiry-notification recipient list (Integrations tab →
// app_settings key `enquiry_notify_email`).
//
// The setting holds ONE OR MORE addresses as a canonical comma+space joined
// string ("a@b.com, c@d.com"). A single stored address is byte-identical to what
// the single-address version wrote, so existing rows keep working with no
// migration.
//
// Client-safe on purpose: both the Integrations panel and the API route import
// this, so the validation the operator sees and the validation the server
// enforces can never drift. Do NOT put this in lib/pipeline/server.ts — that
// module reads the service-role key and must stay off the browser.

/** Recipient cap. Deliberately far below every transport ceiling rather than
 *  tuned to one of them: the real per-message limit is a property of the
 *  transport, not the account — 500 via the Gmail API (what the n8n Gmail node
 *  uses), 100 via SMTP, 100 per transaction via smtp-relay — and a Workspace
 *  admin can lower it invisibly with a max-recipients compliance rule. 10 is
 *  valid under all of them, so re-pointing the n8n node can never break this. */
export const MAX_NOTIFY_EMAILS = 10;
/** RFC 5321 maximum address length. */
export const MAX_NOTIFY_EMAIL_LEN = 254;
/** Raw-input ceiling, checked before splitting so a huge paste can't fan out
 *  into a giant array. Derived from the other two caps (+2 chars per address for
 *  a ", " separator) so it can never reject input the count and per-address
 *  checks would have accepted — it only ever catches a genuine over-paste. */
export const MAX_NOTIFY_RAW_LEN = MAX_NOTIFY_EMAILS * (MAX_NOTIFY_EMAIL_LEN + 2);

/** Same `?&=#` ban as the enquiry validators (mailto header-injection defence)
 *  plus `,` and `;`, which are list separators here. */
const EMAIL_RE = /^[^\s@?&=#,;]+@[^\s@?&=#,;]+\.[^\s@?&=#,;]+$/;

/** Commas, semicolons and newlines all separate — operators paste from Outlook
 *  (semicolons) and from spreadsheet columns (newlines). */
const SEPARATORS = /[,;\r\n]+/;

export type NotifyEmailsParse =
  /** `value` is the canonical string to store; `""` means "clear the setting". */
  | { ok: true; emails: string[]; value: string }
  | { ok: false; error: string };

/** Join addresses the one canonical way. */
export function serializeNotifyEmails(emails: string[]): string {
  return emails.join(", ");
}

/** Parse an operator-entered address list. Total — never throws. Rejects the
 *  whole list rather than silently dropping a bad or surplus entry, so a save
 *  never quietly notifies fewer people than the operator listed. */
export function parseNotifyEmails(raw: string): NotifyEmailsParse {
  // Length first: a megabyte paste must not become 100k array entries.
  if (raw.length > MAX_NOTIFY_RAW_LEN) {
    return { ok: false, error: `That's too long — enter up to ${MAX_NOTIFY_EMAILS} addresses, separated by commas.` };
  }

  const seen = new Set<string>();
  const emails: string[] = [];
  for (const part of raw.split(SEPARATORS)) {
    // Lowercase the whole address, not just the domain: it makes case-differing
    // duplicates collapse, and Gmail — the only transport here — is
    // case-insensitive on the local part too (RFC technically allows a
    // case-sensitive local part; no real-world provider does).
    const addr = part.trim().toLowerCase();
    if (!addr || seen.has(addr)) continue; // drops blanks from `,,` / trailing `,`
    seen.add(addr);
    emails.push(addr);
  }

  // Count before per-address shape: with a big paste, "the 37th address is
  // invalid" isn't actionable until the list has been trimmed anyway.
  if (emails.length > MAX_NOTIFY_EMAILS) {
    return {
      ok: false,
      error: `Too many addresses — ${MAX_NOTIFY_EMAILS} max (you entered ${emails.length}).`,
    };
  }

  for (const addr of emails) {
    if (addr.length > MAX_NOTIFY_EMAIL_LEN || !EMAIL_RE.test(addr)) {
      // Truncate the echo so a 2000-char junk "address" can't blow out the
      // layout or the JSON error body.
      return { ok: false, error: `"${addr.slice(0, 60)}" isn't a valid email address.` };
    }
  }

  // Empty is valid and means "clear" — the caller decides what to do with it.
  return { ok: true, emails, value: serializeNotifyEmails(emails) };
}
