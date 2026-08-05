"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  AlertTriangle,
  BookOpen,
  Check,
  ChevronDown,
  FileCheck2,
  FileText,
  Paperclip,
  Pencil,
  Plus,
  RefreshCw,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { Button } from "@/components/ui/button";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";

// Sector Playbooks tab — per-sector config that routes a lead's CSV Category to
// a sector and its knowledge-base markdown. The KB grounds the AI outreach
// email. An uploaded .md overrides the repo file (components/knowledgebase/
// <slug>.md); remove it to fall back to the repo. Reads/writes
// /api/sector-playbooks (config) and /api/sector-playbooks/kb (the .md upload).

type KbSource = "uploaded" | "repo" | "none";
interface KbView {
  source: KbSource;
  present: boolean;
  fileName: string;
  size: number;
  uploadedAt: string;
  chars: number;
  preview: string;
}
interface PdfView {
  name: string;
  size: number;
  uploadedAt: string;
  url: string | null;
}
interface PlaybookView {
  slug: string;
  name: string;
  categories: string[];
  kb: KbView;
  pdf: PdfView | null;
}

type LoadState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; mode: string; canPersist: boolean; playbooks: PlaybookView[] };

const POLL_MS = 20000;

export function SectorPlaybooksPage() {
  const [load, setLoad] = useState<LoadState>({ status: "loading" });
  const mountedRef = useRef(true);
  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const fetchState = useCallback(async (opts?: { quiet?: boolean }) => {
    if (!opts?.quiet) setLoad((prev) => (prev.status === "ready" ? prev : { status: "loading" }));
    try {
      const res = await fetch("/api/sector-playbooks", { cache: "no-store" });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; mode?: string; canPersist?: boolean; playbooks?: PlaybookView[]; error?: string }
        | null;
      if (!mountedRef.current) return;
      if (!res.ok || !data?.ok) {
        setLoad({ status: "error", error: data?.error ?? `Couldn't load sector playbooks (${res.status}).` });
        return;
      }
      setLoad({
        status: "ready",
        mode: data.mode ?? "live",
        canPersist: data.canPersist ?? false,
        playbooks: data.playbooks ?? [],
      });
    } catch {
      if (mountedRef.current) setLoad({ status: "error", error: "Network error loading sector playbooks." });
    }
  }, []);

  useEffect(() => {
    fetchState();
    const id = setInterval(() => fetchState({ quiet: true }), POLL_MS);
    const onFocus = () => fetchState({ quiet: true });
    window.addEventListener("focus", onFocus);
    return () => {
      clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, [fetchState]);

  const ready = load.status === "ready" ? load : null;
  const uploaded = ready ? ready.playbooks.filter((p) => p.kb.source === "uploaded").length : 0;
  const withPdf = ready ? ready.playbooks.filter((p) => p.pdf).length : 0;

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <Reveal className="mb-5" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Automation layer
            </div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">
              Sector Playbooks
            </h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-muted-foreground">
              Each lead is routed to a sector by its <span className="text-foreground/80">Category</span>. That
              sector&apos;s knowledge base (a Markdown file) grounds the AI-written outreach email; its{" "}
              <span className="text-foreground/80">attachment PDF</span> is attached to every matching email by the
              n8n Gmail node. Upload a <span className="text-foreground/80">.md</span> to override the built-in KB, and
              a <span className="text-foreground/80">.pdf</span> to attach.
            </p>
          </div>
          <button
            type="button"
            onClick={() => fetchState()}
            data-track="playbooks_refresh"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", load.status === "loading" && "animate-spin")} aria-hidden />
            Refresh
          </button>
        </div>
      </Reveal>

      {ready && ready.mode === "demo" && (
        <Reveal delay={0.03}>
          <div className="mb-3 flex items-start gap-2.5 rounded-xl border border-border bg-card px-4 py-3 ring-1 ring-foreground/10">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <p className="text-[11.5px] leading-relaxed text-muted-foreground">
              Supabase isn&apos;t connected, so changes here won&apos;t persist and you can&apos;t upload a KB. The
              built-in repo files are still used to ground emails. Run{" "}
              <span className="font-mono text-foreground/80">supabase/schema.sql</span> and set the Supabase env vars to
              enable saving.
            </p>
          </div>
        </Reveal>
      )}

      {ready && (
        <Reveal delay={0.04}>
          <div className="mb-3 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-xl bg-card px-4 py-3 ring-1 ring-foreground/10">
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
              <BookOpen className="h-[18px] w-[18px]" aria-hidden />
            </div>
            <div className="text-[12.5px] text-muted-foreground">
              <span className="font-semibold text-foreground">{ready.playbooks.length}</span> sectors ·{" "}
              <span className="font-semibold text-foreground">{uploaded}</span> with an uploaded KB ·{" "}
              <span className="font-semibold text-foreground">{withPdf}</span> with an attachment PDF
            </div>
            <div className="ml-auto font-mono text-[10.5px] text-muted-foreground/80">
              general company file{" "}
              <span className="text-foreground/70">components/knowledgebase/business.md</span> is always included
            </div>
          </div>
        </Reveal>
      )}

      {load.status === "loading" && (
        <div className="mt-1 grid grid-cols-1 gap-3 lg:grid-cols-2">
          <div className="h-72 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
          <div className="h-72 animate-pulse rounded-xl bg-card ring-1 ring-foreground/10" />
        </div>
      )}

      {load.status === "error" && (
        <div className="mt-1 flex flex-col items-center gap-3 rounded-xl border border-destructive/30 bg-card px-6 py-10 text-center ring-1 ring-foreground/10">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-destructive/10 text-destructive">
            <AlertTriangle className="h-5 w-5" aria-hidden />
          </span>
          <p role="alert" className="max-w-sm font-mono text-[11px] leading-relaxed text-muted-foreground">
            {load.error}
          </p>
          <Button variant="outline" size="sm" onClick={() => fetchState()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden />
            Retry
          </Button>
        </div>
      )}

      {ready && (
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
          {ready.playbooks.map((pb, i) => (
            <Reveal key={pb.slug} delay={0.06 + 0.04 * i} className="h-full">
              <PlaybookCard playbook={pb} canPersist={ready.canPersist} onChanged={() => fetchState({ quiet: true })} />
            </Reveal>
          ))}
        </div>
      )}

      <Footer />
    </div>
  );
}

function PlaybookCard({
  playbook,
  canPersist,
  onChanged,
}: {
  playbook: PlaybookView;
  canPersist: boolean;
  onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(playbook.name);
  const [cats, setCats] = useState<string[]>(playbook.categories);
  const [newCat, setNewCat] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Post-upload note on PDF compression (green = shrunk & Gmail-ready, amber = warn).
  const [notice, setNotice] = useState<{ text: string; warn: boolean } | null>(null);
  const [showKb, setShowKb] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const pdfRef = useRef<HTMLInputElement>(null);

  // Reset local edit buffers if the upstream data changes while not editing.
  useEffect(() => {
    if (!editing) {
      setName(playbook.name);
      setCats(playbook.categories);
    }
  }, [playbook.name, playbook.categories, editing]);

  function addCat() {
    const c = newCat.toLowerCase().trim();
    if (!c) return;
    setCats((prev) => (prev.includes(c) ? prev : [...prev, c]));
    setNewCat("");
  }

  async function saveConfig() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch("/api/sector-playbooks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ slug: playbook.slug, name: name.trim(), categories: cats }),
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Save failed (${res.status}).`);
        return;
      }
      setEditing(false);
      onChanged();
    } catch {
      setError("Network error saving the sector.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadKb(file: File) {
    setError(null);
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("slug", playbook.slug);
      fd.append("file", file);
      const res = await fetch("/api/sector-playbooks/kb", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Upload failed (${res.status}).`);
        return;
      }
      onChanged();
    } catch {
      setError("Network error uploading the Markdown.");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function removeKb() {
    setError(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/sector-playbooks/kb?slug=${encodeURIComponent(playbook.slug)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Remove failed (${res.status}).`);
        return;
      }
      onChanged();
    } catch {
      setError("Network error removing the Markdown.");
    } finally {
      setBusy(false);
    }
  }

  async function uploadPdf(file: File) {
    setError(null);
    setNotice(null);
    // Reject oversized files instantly (mirrors the server's 50 MB cap) rather
    // than streaming a large portfolio only to get a 413 — or an opaque
    // platform body-size error — at the end.
    if (file.size > 50 * 1000 * 1000) {
      setError("PDF is too large (max 50 MB — compress it first).");
      if (pdfRef.current) pdfRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append("slug", playbook.slug);
      fd.append("file", file);
      const res = await fetch("/api/sector-playbooks/pdf", { method: "POST", body: fd });
      const data = (await res.json().catch(() => null)) as {
        ok?: boolean;
        error?: string;
        originalSize?: number;
        storedSize?: number;
        compression?: "compressed" | "unchanged" | "unavailable" | "failed";
        quality?: string | null;
        underGmailLimit?: boolean;
      } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Upload failed (${res.status}).`);
        return;
      }
      // Tell the operator whether the PDF was shrunk under Gmail's cap — the
      // whole reason large uploads are allowed (n8n's Gmail node tops out ~25 MB).
      const mb = (b?: number) => (typeof b === "number" ? (b / 1024 / 1024).toFixed(1) : "?");
      if (data.compression === "compressed") {
        const tier = data.quality === "/screen" ? "maximum" : "standard";
        let text = `Compressed ${mb(data.originalSize)} MB → ${mb(data.storedSize)} MB (${tier} compression) for Gmail.`;
        if (data.underGmailLimit === false) {
          text += " Still over Gmail's ~25 MB limit — compress it further before sending.";
        }
        setNotice({ text, warn: data.underGmailLimit === false });
      } else if (data.underGmailLimit === false) {
        setNotice({
          text:
            data.compression === "unavailable"
              ? `Stored uncompressed at ${mb(data.storedSize)} MB — Ghostscript isn't installed on the server, so this may exceed Gmail's ~25 MB attachment limit.`
              : `Stored at ${mb(data.storedSize)} MB — couldn't get it under Gmail's ~25 MB limit; compress it before sending.`,
          warn: true,
        });
      }
      onChanged();
    } catch {
      setError("Network error uploading the PDF.");
    } finally {
      setBusy(false);
      if (pdfRef.current) pdfRef.current.value = "";
    }
  }

  async function removePdf() {
    setError(null);
    setNotice(null);
    setBusy(true);
    try {
      const res = await fetch(`/api/sector-playbooks/pdf?slug=${encodeURIComponent(playbook.slug)}`, {
        method: "DELETE",
      });
      const data = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
      if (!res.ok || !data?.ok) {
        setError(data?.error ?? `Remove failed (${res.status}).`);
        return;
      }
      onChanged();
    } catch {
      setError("Network error removing the PDF.");
    } finally {
      setBusy(false);
    }
  }

  const kb = playbook.kb;
  const uploaded = kb.source === "uploaded";
  const pdf = playbook.pdf;

  return (
    <div className="flex h-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10 transition-shadow hover:ring-foreground/20">
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          {editing ? (
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-border bg-background px-2 py-1 text-[14px] font-semibold text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              aria-label="Sector name"
            />
          ) : (
            <h3 className="truncate text-[14px] font-semibold text-foreground">{playbook.name}</h3>
          )}
          <div className="mt-0.5 font-mono text-[10.5px] uppercase tracking-[0.1em] text-muted-foreground">
            {playbook.slug}
          </div>
        </div>
        {!editing && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              setEditing(true);
              setError(null);
            }}
            data-track="playbook_edit"
            className="shrink-0 gap-1.5"
          >
            <Pencil className="h-3.5 w-3.5" aria-hidden />
            Edit
          </Button>
        )}
      </div>

      {/* category keywords */}
      <div className="mt-3">
        <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
          Matches Categories
        </div>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {(editing ? cats : playbook.categories).map((c) => (
            <span
              key={c}
              className="inline-flex items-center gap-1 rounded-full border border-border bg-background px-2 py-0.5 text-[11px] text-foreground"
            >
              {c}
              {editing && (
                <button
                  type="button"
                  onClick={() => setCats((prev) => prev.filter((x) => x !== c))}
                  aria-label={`Remove ${c}`}
                  className="text-muted-foreground hover:text-destructive"
                >
                  <X className="h-3 w-3" aria-hidden />
                </button>
              )}
            </span>
          ))}
          {(editing ? cats : playbook.categories).length === 0 && (
            <span className="text-[11px] text-muted-foreground">No category keywords yet.</span>
          )}
        </div>
        {editing && (
          <div className="mt-2 flex items-center gap-2">
            <input
              value={newCat}
              onChange={(e) => setNewCat(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  addCat();
                }
              }}
              placeholder="add keyword (e.g. nursing home)"
              className="h-8 flex-1 rounded-lg border border-border bg-background px-2.5 text-[11px] text-foreground placeholder:text-muted-foreground/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <Button size="sm" variant="outline" onClick={addCat} disabled={!newCat.trim()} className="gap-1">
              <Plus className="h-3.5 w-3.5" aria-hidden />
              Add
            </Button>
          </div>
        )}
      </div>

      {/* knowledge base (uploaded .md overrides the repo file) */}
      <div className="mt-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Knowledge base
          </span>
          <KbSourceBadge source={kb.source} />
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          {kb.source === "none" ? (
            <FileText className="h-4 w-4 shrink-0 text-destructive" aria-hidden />
          ) : (
            <FileCheck2 className={cn("h-4 w-4 shrink-0", uploaded ? "text-primary" : "text-muted-foreground")} aria-hidden />
          )}
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
            {uploaded ? kb.fileName : kb.source === "repo" ? `${playbook.slug}.md (built-in)` : "No knowledge base"}
          </span>
          <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/70">
            {kb.present ? `${(kb.chars / 1000).toFixed(1)}k chars` : "missing"}
          </span>
        </div>

        {kb.present && (
          <>
            <button
              type="button"
              onClick={() => setShowKb((s) => !s)}
              className="mt-1.5 inline-flex items-center gap-1 font-mono text-[10px] text-muted-foreground hover:text-foreground"
              aria-expanded={showKb}
              data-track="playbook_kb_toggle"
            >
              <ChevronDown className={cn("h-3.5 w-3.5 transition-transform", showKb && "rotate-180")} aria-hidden />
              {showKb ? "Hide" : "Preview"}
            </button>
            {showKb && (
              <pre className="mt-1.5 max-h-48 overflow-auto whitespace-pre-wrap rounded-md border border-border bg-background px-2.5 py-2 font-mono text-[10.5px] leading-relaxed text-muted-foreground">
                {kb.preview}
                {kb.chars > kb.preview.length ? "\n…" : ""}
              </pre>
            )}
          </>
        )}

        <input
          ref={fileRef}
          type="file"
          accept=".md,.markdown,text/markdown,text/plain"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadKb(f);
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={uploaded ? "outline" : "default"}
            disabled={busy || !canPersist}
            onClick={() => fileRef.current?.click()}
            data-track="playbook_kb_upload"
            className="gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            {uploaded ? "Replace .md" : "Upload .md"}
          </Button>
          {uploaded && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || !canPersist}
              onClick={removeKb}
              data-track="playbook_kb_remove"
              className="gap-1.5 text-muted-foreground"
            >
              <Trash2 className="h-3.5 w-3.5" aria-hidden />
              Revert to built-in
            </Button>
          )}
        </div>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          {uploaded
            ? "Uploaded Markdown overrides the built-in file. Revert to use components/knowledgebase/" +
              playbook.slug +
              ".md again."
            : "Using the built-in components/knowledgebase/" +
              playbook.slug +
              ".md. Upload a .md to override it without touching the repo."}
        </p>
      </div>

      {/* attachment PDF — emailed via n8n's Gmail node, matched by Category */}
      <div className="mt-3 rounded-lg border border-border bg-background/40 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            Attachment PDF
          </span>
          <span
            className={cn(
              "inline-flex items-center rounded-full border bg-transparent px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em]",
              pdf ? "border-primary/40 text-primary" : "border-border text-muted-foreground",
            )}
          >
            {pdf ? "Attached" : "None"}
          </span>
        </div>

        <div className="mt-1.5 flex items-center gap-2">
          <Paperclip className={cn("h-4 w-4 shrink-0", pdf ? "text-primary" : "text-muted-foreground")} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-foreground">
            {pdf ? pdf.name : "No attachment — matching emails send without one"}
          </span>
          {pdf && (
            <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.1em] text-muted-foreground/70">
              {(pdf.size / 1024 / 1024).toFixed(1)} MB
            </span>
          )}
        </div>

        <input
          ref={pdfRef}
          type="file"
          accept="application/pdf,.pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) uploadPdf(f);
          }}
        />
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant={pdf ? "outline" : "default"}
            disabled={busy || !canPersist}
            onClick={() => pdfRef.current?.click()}
            data-track="playbook_pdf_upload"
            className="gap-1.5"
          >
            <Upload className="h-3.5 w-3.5" aria-hidden />
            {pdf ? "Replace PDF" : "Upload PDF"}
          </Button>
          {pdf && (
            <>
              {pdf.url && (
                <a
                  href={pdf.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  data-track="playbook_pdf_view"
                  className="inline-flex h-8 items-center gap-1.5 rounded-md border border-border bg-background px-2.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <FileText className="h-3.5 w-3.5" aria-hidden />
                  View
                </a>
              )}
              <Button
                size="sm"
                variant="outline"
                disabled={busy || !canPersist}
                onClick={removePdf}
                data-track="playbook_pdf_remove"
                className="gap-1.5 text-muted-foreground"
              >
                <Trash2 className="h-3.5 w-3.5" aria-hidden />
                Remove
              </Button>
            </>
          )}
        </div>
        <p className="mt-2 font-mono text-[10px] leading-relaxed text-muted-foreground">
          Attached to every outreach email whose Category matches this sector. PDF only, max 50 MB — large files are
          auto-compressed on upload to clear Gmail&apos;s ~25 MB attachment limit. Optional.
        </p>
      </div>

      {error && (
        <p role="alert" className="mt-2 font-mono text-[10px] leading-relaxed text-destructive">
          {error}
        </p>
      )}

      {notice && (
        <p
          className={`mt-2 font-mono text-[10px] leading-relaxed ${
            notice.warn ? "text-amber-700 dark:text-amber-300" : "text-emerald-700 dark:text-emerald-300"
          }`}
        >
          {notice.text}
        </p>
      )}

      {editing && (
        <div className="mt-3 flex items-center gap-2">
          <Button
            size="sm"
            onClick={saveConfig}
            disabled={busy || !canPersist || name.trim().length === 0 || cats.length === 0}
            data-track="playbook_save"
            className="gap-1.5"
          >
            <Check className="h-3.5 w-3.5" aria-hidden />
            Save
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => {
              setEditing(false);
              setName(playbook.name);
              setCats(playbook.categories);
              setNewCat("");
              setError(null);
            }}
          >
            Cancel
          </Button>
          {!canPersist && (
            <span className="font-mono text-[10px] text-muted-foreground">Supabase required to save</span>
          )}
        </div>
      )}
    </div>
  );
}

function KbSourceBadge({ source }: { source: KbSource }) {
  const map = {
    uploaded: { label: "Uploaded", cls: "border-primary/40 text-primary" },
    repo: { label: "Built-in", cls: "border-border text-muted-foreground" },
    none: { label: "Missing", cls: "border-destructive/40 text-destructive" },
  } as const;
  const s = map[source];
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border bg-transparent px-2 py-0.5 text-[9.5px] font-semibold uppercase tracking-[0.08em]",
        s.cls,
      )}
    >
      {s.label}
    </span>
  );
}
