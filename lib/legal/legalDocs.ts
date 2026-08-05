// Shared, framework-free types + parsing for the portal's legal documents
// (Terms & Conditions + Privacy Policy). Kept free of `server-only` so both the
// server accessor (legalStore.ts) and the client portal (the consent checkbox /
// public GET) import the SAME shape and version rules — the recorded consent
// version must mean exactly one thing on both sides.
//
// The `version` string is the linchpin of the whole consent record: every
// acceptance is stamped with the version that was live, so a past acceptance
// can always be resolved back to the precise wording, and publishing new
// wording (a new version) makes prior acceptances no longer "cover" it (the
// portal re-prompts). See supabase + the inquiries route for how it is stored.

export interface LegalDocs {
  /** Opaque version tag, bumped whenever terms/privacy text changes. Pinned
   *  onto every consent record. Keep it short and monotonic-ish, e.g. a date
   *  like "2026-07-12" or "v1". */
  version: string;
  /** Terms & Conditions body. HTML is rendered as-is in the portal, so this is
   *  operator-authored trusted content (the Legal Documents tab). */
  termsHtml: string;
  /** Privacy Policy body (same trust model as termsHtml). */
  privacyHtml: string;
  /** When this version took effect / was last edited (ISO). Display only. */
  updatedAt: string;
}

/** Longest version tag we accept — anything longer is malformed, not a version. */
export const MAX_VERSION_LEN = 60;
const MAX_DOC_CHARS = 60_000;

/**
 * Placeholder documents shipped in code. These are NOT legal advice and MUST be
 * replaced with lawyer-reviewed wording via the Legal Documents tab before real
 * use — the portal shows an "unreviewed placeholder" state while version is
 * this sentinel so no one mistakes them for approved policy.
 */
export const PLACEHOLDER_VERSION = "unset";

export const DEFAULT_LEGAL_DOCS: LegalDocs = {
  version: PLACEHOLDER_VERSION,
  termsHtml:
    "<p><strong>Placeholder terms &mdash; not yet reviewed.</strong> Replace this with your lawyer-reviewed Terms &amp; Conditions on the Legal Documents tab before collecting enquiries. Include the registered legal entity and ABN (currently TBC) and reference APMG Services.</p>",
  privacyHtml:
    "<p><strong>Placeholder privacy policy &mdash; not yet reviewed.</strong> Replace this with your lawyer-reviewed Privacy Policy on the Legal Documents tab before collecting enquiries. It should name APMG Services (and its registered entity + ABN once available), state what personal information is collected and why, that data is stored with Supabase (possibly offshore &mdash; APP 8), retention, and how to contact us at kane@apmgservices.com.au to access, correct, or delete your information.</p>",
  updatedAt: "",
};

/** True when the docs are still the shipped placeholder (no real wording set). */
export function isPlaceholderLegal(d: Pick<LegalDocs, "version">): boolean {
  return !d.version || d.version === PLACEHOLDER_VERSION;
}

/** Validate a version tag: word chars, dashes, dots, within the length cap. The
 *  same rule the consent record and the portal re-consent check rely on. */
export function isValidVersion(v: unknown): v is string {
  return typeof v === "string" && /^[\w.-]{1,60}$/.test(v.trim());
}

/**
 * Parse the app_settings JSON blob into LegalDocs, falling back field-by-field
 * to the placeholder on any miss (bad JSON, missing keys, wrong types, oversize
 * strings). Never throws — the portal must always have SOMETHING to show, and a
 * malformed blob must not take the customer surface down.
 */
export function parseLegalDocs(raw: string | null | undefined): LegalDocs {
  if (!raw) return { ...DEFAULT_LEGAL_DOCS };
  let obj: unknown;
  try {
    obj = JSON.parse(raw);
  } catch {
    return { ...DEFAULT_LEGAL_DOCS };
  }
  if (!obj || typeof obj !== "object") return { ...DEFAULT_LEGAL_DOCS };
  const o = obj as Record<string, unknown>;

  const version = isValidVersion(o.version) ? (o.version as string).trim() : PLACEHOLDER_VERSION;
  const termsHtml =
    typeof o.termsHtml === "string" && o.termsHtml.trim()
      ? o.termsHtml.slice(0, MAX_DOC_CHARS)
      : DEFAULT_LEGAL_DOCS.termsHtml;
  const privacyHtml =
    typeof o.privacyHtml === "string" && o.privacyHtml.trim()
      ? o.privacyHtml.slice(0, MAX_DOC_CHARS)
      : DEFAULT_LEGAL_DOCS.privacyHtml;
  const updatedAt = typeof o.updatedAt === "string" ? o.updatedAt.slice(0, 40) : "";

  return { version, termsHtml, privacyHtml, updatedAt };
}
