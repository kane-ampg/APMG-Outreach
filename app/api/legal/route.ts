import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { loadLegalDocs, saveLegalDocs } from "@/lib/legal/legalStore";
import {
  DEFAULT_LEGAL_DOCS,
  isValidVersion,
  MAX_VERSION_LEN,
  type LegalDocs,
} from "@/lib/legal/legalDocs";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Legal Documents config API (Legal Documents tab). GET returns the current
// published terms/privacy + version (or in-code placeholder); PUT saves the
// edited docs to app_settings (SETTING_LEGAL_DOCS). The public portal reads the
// same value via /api/portal/legal to show customers the exact text they agree
// to, and the enquiry route pins/validates the version before storing PII.
export const runtime = "nodejs";

const MAX_DOC_CHARS = 60_000;

interface StatePayload {
  ok: true;
  mode: "live" | "demo";
  canPersist: boolean;
  config: LegalDocs;
  defaults: LegalDocs;
}

async function state(): Promise<StatePayload> {
  const supa = supabaseTarget();
  return {
    ok: true,
    mode: supa.state === "ok" ? "live" : "demo",
    canPersist: supa.state === "ok",
    config: await loadLegalDocs(),
    defaults: { ...DEFAULT_LEGAL_DOCS },
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "legal.view");
  if (!guard.ok) return guardResponse(guard);

  return Response.json(await state());
}

export async function PUT(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "legal.manage");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // Version: the pin every consent record carries. Must be a well-formed tag,
  // and NOT the reserved placeholder sentinel (publishing must set a real one,
  // or the portal keeps refusing enquiries by design).
  const version = typeof b.version === "string" ? b.version.trim() : "";
  if (!isValidVersion(version)) {
    return Response.json(
      { ok: false, error: `Version must be letters, numbers, dots or dashes (max ${MAX_VERSION_LEN}), e.g. a date like 2026-07-12.` },
      { status: 400 },
    );
  }
  if (version === DEFAULT_LEGAL_DOCS.version) {
    return Response.json(
      { ok: false, error: `"${DEFAULT_LEGAL_DOCS.version}" is reserved — choose a real version tag (e.g. a date) so consent records are meaningful.` },
      { status: 400 },
    );
  }

  const termsHtml = typeof b.termsHtml === "string" ? b.termsHtml.trim() : "";
  if (!termsHtml) {
    return Response.json({ ok: false, error: "Terms & Conditions can't be empty." }, { status: 400 });
  }
  if (termsHtml.length > MAX_DOC_CHARS) {
    return Response.json(
      { ok: false, error: `Terms are too long (max ${MAX_DOC_CHARS.toLocaleString("en-US")} chars).` },
      { status: 400 },
    );
  }

  const privacyHtml = typeof b.privacyHtml === "string" ? b.privacyHtml.trim() : "";
  if (!privacyHtml) {
    return Response.json({ ok: false, error: "The Privacy Policy can't be empty." }, { status: 400 });
  }
  if (privacyHtml.length > MAX_DOC_CHARS) {
    return Response.json(
      { ok: false, error: `The Privacy Policy is too long (max ${MAX_DOC_CHARS.toLocaleString("en-US")} chars).` },
      { status: 400 },
    );
  }

  // updatedAt is stamped server-side (the client clock isn't authoritative) —
  // display-only "last published" marker.
  const updatedAt = new Date().toISOString();

  const result = await saveLegalDocs({ version, termsHtml, privacyHtml, updatedAt });
  if (result === "demo") {
    return Response.json(
      { ok: false, error: "Connect Supabase (service role) to publish legal documents." },
      { status: 409 },
    );
  }
  if (result === "missing-table") {
    return Response.json(
      { ok: false, needsMigration: true, error: "app_settings is unavailable — run the base schema migration." },
      { status: 422 },
    );
  }
  if (result !== "ok") {
    return Response.json({ ok: false, error: "Couldn't publish the documents." }, { status: 502 });
  }

  return Response.json(await state());
}
