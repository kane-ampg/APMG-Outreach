import { deleteObject, sameOrigin, SECTOR_ASSETS_BUCKET, uploadObject } from "@/lib/pipeline/server";
import { compressPdfForGmail } from "@/lib/pipeline/pdfCompress";
import { loadPlaybooks, savePlaybooks } from "@/lib/pipeline/sectorStore";
import { isSectorSlug, mergePlaybooks } from "@/lib/pipeline/sectors";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Upload / remove the attachment PDF for one sector (Sector Playbooks tab). The
// bytes go to the public `sector-assets` Storage bucket at "<slug>.pdf" (upsert,
// so re-uploading replaces); the object metadata is recorded in the
// app_settings["sector_playbooks"] mapping alongside the sector's KB markdown.
// The send flow resolves a lead's Category → this sector → the PDF's public URL
// and passes it to n8n, whose Gmail node downloads + attaches it. Server-side;
// keeps the service role key off the browser.
export const runtime = "nodejs";

// Accept uploads up to 50 MB *decimal* (50,000,000 B) — the Storage bucket's
// file_size_limit (supabase/schema.sql). Anything over Gmail's ~18 MB raw
// ceiling (≈25 MB once base64-encoded for the n8n Gmail node) is auto-compressed
// with Ghostscript before it's stored (see compressPdfForGmail), so the object
// that n8n attaches stays under Gmail's cap. The 50 MB gate is just the upper
// bound on what we'll accept to compress.
const MAX_PDF_BYTES = 50 * 1000 * 1000;

function persistError(result: "demo" | "missing-table" | "error"): Response {
  if (result === "demo") {
    return Response.json({ ok: false, error: "Connect Supabase to manage attachment PDFs." }, { status: 409 });
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
  const isPdf = file.type === "application/pdf" || /\.pdf$/i.test(file.name);
  if (!isPdf) {
    return Response.json({ ok: false, error: "Only PDF files can be attached." }, { status: 400 });
  }
  if (file.size === 0) {
    return Response.json({ ok: false, error: "That PDF is empty." }, { status: 400 });
  }
  if (file.size > MAX_PDF_BYTES) {
    return Response.json(
      {
        ok: false,
        error: `PDF is too large (max ${(MAX_PDF_BYTES / 1000 / 1000).toFixed(0)} MB — Gmail can't attach more once base64-encoded; compress it first).`,
      },
      { status: 413 },
    );
  }

  const playbooks = await loadPlaybooks();
  const target = playbooks.find((p) => p.slug === slug);
  if (!target) {
    return Response.json({ ok: false, error: "Unknown sector." }, { status: 400 });
  }

  // Shrink oversized PDFs under Gmail's cap before storing (Ghostscript). Small
  // files pass through untouched; if Ghostscript is missing the original is kept
  // and `underGmailLimit` is false so we can warn the operator.
  const raw = await file.arrayBuffer();
  const compressed = await compressPdfForGmail(raw);

  const objectPath = `${slug}.pdf`;
  const uploaded = await uploadObject(SECTOR_ASSETS_BUCKET, objectPath, compressed.bytes, "application/pdf");
  if (uploaded === "demo") {
    return Response.json({ ok: false, error: "Connect Supabase to upload attachment PDFs." }, { status: 409 });
  }
  if (uploaded !== "ok") {
    return Response.json(
      { ok: false, error: "Upload failed. Make sure the sector-assets storage bucket exists (run supabase/schema.sql)." },
      { status: 502 },
    );
  }

  target.pdf = {
    path: objectPath,
    name: file.name.slice(0, 200),
    // Store the size we actually uploaded (post-compression) — that's what n8n
    // attaches and what the UI shows.
    size: compressed.size,
    uploadedAt: new Date().toISOString(),
  };

  const result = await savePlaybooks(mergePlaybooks(playbooks));
  if (result !== "ok") return persistError(result);

  return Response.json({
    ok: true,
    originalSize: compressed.originalSize,
    storedSize: compressed.size,
    compression: compressed.status,
    quality: compressed.quality ?? null,
    underGmailLimit: compressed.underGmailLimit,
  });
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
  if (!target.pdf) {
    return Response.json({ ok: true }); // already none
  }

  // Clear the mapping and persist FIRST, so a failed save never strands
  // app_settings pointing at a file we already deleted. Only once the metadata
  // is gone do we best-effort delete the Storage object (a failed delete just
  // leaves an orphaned object, not a broken reference).
  const path = target.pdf.path;
  target.pdf = null;

  const result = await savePlaybooks(mergePlaybooks(playbooks));
  if (result !== "ok") return persistError(result);

  await deleteObject(SECTOR_ASSETS_BUCKET, path);

  return Response.json({ ok: true });
}
