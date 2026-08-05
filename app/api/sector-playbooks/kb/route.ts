import { sameOrigin } from "@/lib/pipeline/server";
import { loadPlaybooks, savePlaybooks } from "@/lib/pipeline/sectorStore";
import { isSectorSlug, MAX_KB_CONTENT, mergePlaybooks } from "@/lib/pipeline/sectors";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Upload / remove the knowledge-base markdown for one sector (Sector Playbooks
// tab). The uploaded .md text is stored inline in the
// app_settings["sector_playbooks"] mapping and overrides the repo file
// (components/knowledgebase/<slug>.md) as the KB that grounds the outreach
// email. Server-side (keeps the service role key off the browser).
export const runtime = "nodejs";

function persistError(result: "demo" | "missing-table" | "error"): Response {
  if (result === "demo") {
    return Response.json({ ok: false, error: "Connect Supabase to manage sector knowledge bases." }, { status: 409 });
  }
  if (result === "missing-table") {
    return Response.json(
      { ok: false, needsMigration: true, error: "Run supabase/schema.sql to create the app_settings table." },
      { status: 422 },
    );
  }
  return Response.json({ ok: false, error: "Couldn't update the sector config." }, { status: 502 });
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "playbooks.manage");
  if (!guard.ok) return guardResponse(guard);

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ ok: false, error: "Expected a multipart upload." }, { status: 400 });
  }

  const slug = form.get("slug");
  if (typeof slug !== "string" || !isSectorSlug(slug)) {
    return Response.json({ ok: false, error: "Unknown sector." }, { status: 400 });
  }

  const file = form.get("file");
  if (!(file instanceof File)) {
    return Response.json({ ok: false, error: "No file provided." }, { status: 400 });
  }
  // Accept markdown by extension or common text mime types (browsers label .md
  // inconsistently — text/markdown, text/plain, or "").
  const isMd = /\.(md|markdown)$/i.test(file.name) || /^text\//.test(file.type) || file.type === "";
  if (!isMd) {
    return Response.json({ ok: false, error: "Only Markdown (.md) files are accepted." }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ ok: false, error: "That file is empty." }, { status: 400 });
  }
  if (file.size > MAX_KB_CONTENT) {
    return Response.json(
      { ok: false, error: `Markdown is too large (max ${(MAX_KB_CONTENT / 1000).toFixed(0)}k characters).` },
      { status: 413 },
    );
  }

  const content = (await file.text()).slice(0, MAX_KB_CONTENT);
  if (!content.trim()) {
    return Response.json({ ok: false, error: "That Markdown file has no text." }, { status: 400 });
  }

  const playbooks = await loadPlaybooks();
  const target = playbooks.find((p) => p.slug === slug);
  if (!target) {
    return Response.json({ ok: false, error: "Unknown sector." }, { status: 400 });
  }

  target.kb = {
    name: file.name.slice(0, 200),
    size: content.length,
    uploadedAt: new Date().toISOString(),
    content,
  };

  const result = await savePlaybooks(mergePlaybooks(playbooks));
  if (result !== "ok") return persistError(result);

  return Response.json({ ok: true });
}

export async function DELETE(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "playbooks.manage");
  if (!guard.ok) return guardResponse(guard);

  const slug = new URL(req.url).searchParams.get("slug") ?? "";
  if (!isSectorSlug(slug)) {
    return Response.json({ ok: false, error: "Unknown sector." }, { status: 400 });
  }

  const playbooks = await loadPlaybooks();
  const target = playbooks.find((p) => p.slug === slug);
  if (!target) {
    return Response.json({ ok: false, error: "Unknown sector." }, { status: 400 });
  }
  if (!target.kb) {
    return Response.json({ ok: true }); // already none → repo file is used
  }

  target.kb = null;

  const result = await savePlaybooks(mergePlaybooks(playbooks));
  if (result !== "ok") return persistError(result);

  return Response.json({ ok: true });
}
