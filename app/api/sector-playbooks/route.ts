import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { effectiveSectorKb, loadPlaybooks, playbookPdfUrl, savePlaybooks } from "@/lib/pipeline/sectorStore";
import { isSectorSlug, mergePlaybooks, type SectorPlaybook } from "@/lib/pipeline/sectors";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Sector Playbooks config API (Sector Playbooks tab). GET returns each sector's
// category keywords and its knowledge-base status (uploaded markdown, or the
// repo file it falls back to); POST patches one sector's name/category keywords.
// The KB markdown itself is uploaded via the sibling /kb route. Server-side.
// Mapping persists in app_settings["sector_playbooks"].
export const runtime = "nodejs";

const KB_PREVIEW_CHARS = 600;
const MAX_CATEGORIES = 40;
const MAX_KEYWORD_LEN = 60;
const MAX_NAME_LEN = 80;

async function enrich(playbooks: SectorPlaybook[]) {
  return Promise.all(
    playbooks.map(async (pb) => {
      const eff = await effectiveSectorKb(pb);
      return {
        slug: pb.slug,
        name: pb.name,
        categories: pb.categories,
        kb: {
          source: eff.source, // "uploaded" | "repo" | "none"
          present: eff.source !== "none",
          fileName: pb.kb?.name ?? `${pb.slug}.md`,
          size: pb.kb?.size ?? eff.content.length,
          uploadedAt: pb.kb?.uploadedAt ?? "",
          chars: eff.content.length,
          preview: eff.content.slice(0, KB_PREVIEW_CHARS),
        },
        // Attachment PDF (separate from the KB markdown): the email attachment.
        pdf: pb.pdf
          ? { name: pb.pdf.name, size: pb.pdf.size, uploadedAt: pb.pdf.uploadedAt, url: playbookPdfUrl(pb) }
          : null,
      };
    }),
  );
}

async function state() {
  const supa = supabaseTarget();
  const playbooks = await loadPlaybooks();
  return {
    ok: true as const,
    mode: supa.state === "ok" ? "live" : "demo",
    canPersist: supa.state === "ok",
    playbooks: await enrich(playbooks),
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "demo", playbooks: [], error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "playbooks.view");
  if (!guard.ok) return guardResponse(guard);

  return Response.json(await state());
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "playbooks.manage");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  const slug = typeof b.slug === "string" ? b.slug : "";
  if (!isSectorSlug(slug)) {
    return Response.json({ ok: false, error: "Unknown sector." }, { status: 400 });
  }

  const playbooks = await loadPlaybooks();
  const target = playbooks.find((p) => p.slug === slug);
  if (!target) {
    return Response.json({ ok: false, error: "Unknown sector." }, { status: 400 });
  }

  // Patch name / categories (both optional). Validation is belt-and-suspenders;
  // mergePlaybooks re-sanitizes before persisting.
  if (typeof b.name === "string") {
    const name = b.name.trim().slice(0, MAX_NAME_LEN);
    if (!name) return Response.json({ ok: false, error: "Name can't be empty." }, { status: 400 });
    target.name = name;
  }
  if (Array.isArray(b.categories)) {
    const categories = [
      ...new Set(
        b.categories
          .filter((x): x is string => typeof x === "string")
          .map((x) => x.toLowerCase().trim())
          .filter((x) => x.length > 0 && x.length <= MAX_KEYWORD_LEN),
      ),
    ].slice(0, MAX_CATEGORIES);
    if (categories.length === 0) {
      return Response.json({ ok: false, error: "Add at least one category keyword." }, { status: 400 });
    }
    target.categories = categories;
  }

  const result = await savePlaybooks(mergePlaybooks(playbooks));
  if (result === "demo") {
    return Response.json({ ok: false, error: "Connect Supabase to save sector config here." }, { status: 409 });
  }
  if (result === "missing-table") {
    return Response.json(
      { ok: false, needsMigration: true, error: "Run supabase/schema.sql to create the app_settings table." },
      { status: 422 },
    );
  }
  if (result !== "ok") {
    return Response.json({ ok: false, error: "Couldn't save the sector config." }, { status: 502 });
  }

  return Response.json(await state());
}
