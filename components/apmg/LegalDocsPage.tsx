"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Check, Eye, Loader2, ScrollText, Save, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { PLACEHOLDER_VERSION } from "@/lib/legal/legalDocs";
import { COMPANY } from "@/lib/legal/company";

/**
 * Legal Documents (config) — publish the portal's Terms & Conditions and
 * Privacy Policy and pin a version. Reads/writes /api/legal (app_settings
 * SETTING_LEGAL_DOCS). The public portal shows this exact text before an
 * enquiry, and the enquiry route refuses to store PII unless the customer
 * agreed to the CURRENT version — so until a real (non-placeholder) version is
 * published here, enquiries are intentionally blocked.
 *
 * NOTE: the wording is operator-supplied and rendered as HTML in the portal —
 * it must be lawyer-reviewed. This tab is the mechanism, not legal advice.
 */

interface Config {
  version: string;
  termsHtml: string;
  privacyHtml: string;
  updatedAt: string;
}
interface ApiState {
  mode: "live" | "demo";
  canPersist: boolean;
  config: Config;
  defaults: Config;
}
type Load =
  | { status: "loading" }
  | { status: "error"; error: string }
  | ({ status: "ready" } & ApiState);

export function LegalDocsPage() {
  const [load, setLoad] = useState<Load>({ status: "loading" });
  const [version, setVersion] = useState("");
  const [termsHtml, setTermsHtml] = useState("");
  const [privacyHtml, setPrivacyHtml] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [justSaved, setJustSaved] = useState(false);
  /** Which doc the PREVIEW has expanded (mirrors the customer modal), or null. */
  const [previewDoc, setPreviewDoc] = useState<"terms" | "privacy" | null>(null);
  /** Preview checkbox state — purely cosmetic, lets you see the ticked look. */
  const [previewChecked, setPreviewChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/legal");
        const j = (await res.json()) as (ApiState & { ok: boolean }) | { ok: false; error?: string };
        if (cancelled) return;
        if (!("config" in j) || !j.ok) {
          setLoad({ status: "error", error: ("error" in j && j.error) || "Couldn't load legal documents." });
          return;
        }
        setLoad({ status: "ready", ...j });
        setVersion(j.config.version === PLACEHOLDER_VERSION ? "" : j.config.version);
        setTermsHtml(j.config.termsHtml);
        setPrivacyHtml(j.config.privacyHtml);
      } catch {
        if (!cancelled) setLoad({ status: "error", error: "Couldn't reach the server." });
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const ready = load.status === "ready" ? load : null;
  const isPlaceholder =
    !ready || ready.config.version === PLACEHOLDER_VERSION;

  const dirty = useMemo(() => {
    if (!ready) return false;
    const c = ready.config;
    const curVersion = c.version === PLACEHOLDER_VERSION ? "" : c.version;
    return version.trim() !== curVersion || termsHtml !== c.termsHtml || privacyHtml !== c.privacyHtml;
  }, [ready, version, termsHtml, privacyHtml]);

  const valid =
    /^[\w.-]{1,60}$/.test(version.trim()) &&
    version.trim() !== PLACEHOLDER_VERSION &&
    termsHtml.trim().length > 0 &&
    privacyHtml.trim().length > 0;

  const canSave = !!ready && ready.canPersist && dirty && valid && !saving;

  async function save() {
    if (!canSave) return;
    setSaving(true);
    setSaveError(null);
    setJustSaved(false);
    try {
      const res = await fetch("/api/legal", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ version: version.trim(), termsHtml, privacyHtml }),
      });
      const j = (await res.json()) as (ApiState & { ok: boolean }) | { ok: false; error?: string };
      if (!res.ok || !("config" in j) || !j.ok) {
        setSaveError(("error" in j && j.error) || "Couldn't publish.");
        return;
      }
      setLoad({ status: "ready", ...j });
      setVersion(j.config.version);
      setTermsHtml(j.config.termsHtml);
      setPrivacyHtml(j.config.privacyHtml);
      setJustSaved(true);
    } catch {
      setSaveError("Couldn't reach the server.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <Reveal y={6}>
        <div className="flex items-start gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
            <ScrollText className="h-5 w-5" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
              Legal Documents
            </h1>
            <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">
              The Terms &amp; Conditions and Privacy Policy shown on the customer portal before an
              enquiry. Every enquiry records the version agreed to. Have this wording reviewed by a
              solicitor, it is rendered to customers as written.
            </p>
          </div>
        </div>
      </Reveal>

      {load.status === "loading" && (
        <div className="mt-8 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> Loading…
        </div>
      )}

      {load.status === "error" && (
        <div
          role="alert"
          className="mt-6 flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-background p-3 text-xs text-foreground"
        >
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
          <span>{load.error}</span>
        </div>
      )}

      {ready && (
        <div className="mt-6 space-y-4">
          {/* Demo-mode banner (no Supabase) */}
          {!ready.canPersist && (
            <div className="flex items-start gap-2.5 rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-xs text-foreground">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-500" aria-hidden />
              <span>
                Demo mode, no Supabase connected. You can draft here, but publishing needs the
                service-role credentials set on the server.
              </span>
            </div>
          )}

          {/* The load-bearing warning: placeholder = portal refuses enquiries. */}
          {isPlaceholder && (
            <div className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-background p-3 text-xs text-foreground">
              <ShieldAlert className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>
                No reviewed policy is published yet, so the portal is <strong>refusing all
                enquiries</strong> (it will not collect personal information without valid consent).
                Publish a real version below to enable the enquiry form.
              </span>
            </div>
          )}

          <div className="space-y-1.5">
            <label
              htmlFor="legal-version"
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
            >
              Version <span className="text-primary">*</span>
            </label>
            <input
              id="legal-version"
              type="text"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              placeholder="e.g. 2026-07-12"
              className="h-9 w-full max-w-xs rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
            <p className="text-[11px] text-muted-foreground">
              Bump this whenever you change the wording. Customers who agreed to an older version are
              re-prompted, and each enquiry stores the exact version accepted.
            </p>
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="legal-terms"
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
            >
              Terms &amp; Conditions (HTML) <span className="text-primary">*</span>
            </label>
            <textarea
              id="legal-terms"
              value={termsHtml}
              onChange={(e) => setTermsHtml(e.target.value)}
              rows={10}
              placeholder="<p>Paste your lawyer-reviewed Terms &amp; Conditions here…</p>"
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          <div className="space-y-1.5">
            <label
              htmlFor="legal-privacy"
              className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground"
            >
              Privacy Policy (HTML) <span className="text-primary">*</span>
            </label>
            <textarea
              id="legal-privacy"
              value={privacyHtml}
              onChange={(e) => setPrivacyHtml(e.target.value)}
              rows={10}
              placeholder="<p>Paste your lawyer-reviewed Privacy Policy here…</p>"
              className="w-full resize-y rounded-lg border border-input bg-background px-3 py-2 font-mono text-xs leading-relaxed text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring"
            />
          </div>

          {/* LIVE PREVIEW — how the consent step looks to a customer in the
              enquiry modal, using the text CURRENTLY in the editor above (not
              just the saved version), so you can eyeball wording before you
              publish. Faithful to ServiceInquiryModal's consent block. */}
          <div className="space-y-2 pt-2">
            <div className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
              <Eye className="h-3.5 w-3.5" aria-hidden /> Customer preview
            </div>
            <p className="text-[11px] text-muted-foreground">
              This is the consent step shown in the enquiry modal on the portal. The links expand the
              exact text you&rsquo;ve typed above.
            </p>
            {/* Mock modal card */}
            <div className="mx-auto w-[min(100%,460px)] overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
              <div className="flex items-center gap-2 border-b border-border px-5 py-3">
                <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground">
                  <ScrollText className="h-4 w-4" aria-hidden />
                </div>
                <span className="font-heading text-sm font-semibold text-foreground">
                  Enquire — Electrical Services
                </span>
              </div>
              <div className="space-y-3 px-5 py-4">
                <div className="text-[11px] text-muted-foreground">
                  (name / email / phone / message fields above this)
                </div>
                {/* The consent block — mirrors ServiceInquiryModal exactly */}
                <div className="space-y-2 rounded-lg border border-border bg-muted/30 p-3">
                  <label className="flex cursor-pointer items-start gap-2.5">
                    <input
                      type="checkbox"
                      checked={previewChecked}
                      onChange={(e) => setPreviewChecked(e.target.checked)}
                      className="mt-0.5 h-4 w-4 shrink-0 rounded border-input text-primary focus-visible:ring-2 focus-visible:ring-ring"
                    />
                    <span className="text-[12px] leading-relaxed text-foreground">
                      I agree to {COMPANY.tradingName}&rsquo;{" "}
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(previewDoc === "terms" ? null : "terms")}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Terms &amp; Conditions
                      </button>{" "}
                      and{" "}
                      <button
                        type="button"
                        onClick={() => setPreviewDoc(previewDoc === "privacy" ? null : "privacy")}
                        className="font-medium text-primary underline underline-offset-2"
                      >
                        Privacy Policy
                      </button>
                      , and to APMG contacting me about my enquiry. Please don&rsquo;t include
                      sensitive personal information in your message.
                    </span>
                  </label>
                  {previewDoc && (
                    <div
                      className="max-h-[36rem] overflow-y-auto rounded-md border border-border bg-background p-4 text-[12px] leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_h2]:mb-1.5 [&_h2]:mt-3 [&_h2]:text-[13px] [&_h2]:font-semibold [&_h2]:text-foreground [&_h2:first-child]:mt-0 [&_p]:mb-2.5 [&_strong]:text-foreground"
                      dangerouslySetInnerHTML={{
                        __html: (previewDoc === "terms" ? termsHtml : privacyHtml) || "<p><em>(empty — type some wording above)</em></p>",
                      }}
                    />
                  )}
                </div>
                <div className="flex justify-end">
                  <span
                    className={`inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold ${
                      previewChecked
                        ? "bg-primary-solid text-primary-foreground"
                        : "cursor-not-allowed bg-muted text-muted-foreground"
                    }`}
                  >
                    Send enquiry
                  </span>
                </div>
                {!previewChecked && (
                  <p className="text-right text-[11px] text-muted-foreground">
                    Send stays disabled until the box is ticked.
                  </p>
                )}
              </div>
            </div>
          </div>

          {saveError && (
            <div
              role="alert"
              className="flex items-start gap-2.5 rounded-lg border border-destructive/40 bg-background p-3 text-xs text-foreground"
            >
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden />
              <span>{saveError}</span>
            </div>
          )}

          <div className="flex items-center gap-3">
            <Button
              size="sm"
              onClick={save}
              disabled={!canSave}
              className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
            >
              {saving ? (
                <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Save className="h-4 w-4" aria-hidden />
              )}
              {saving ? "Publishing…" : "Publish"}
            </Button>
            {justSaved && !dirty && (
              <span className="flex items-center gap-1 text-xs text-muted-foreground">
                <Check className="h-3.5 w-3.5 text-primary" aria-hidden /> Published
                {ready.config.updatedAt ? ` — v${ready.config.version}` : ""}
              </span>
            )}
            {ready.config.updatedAt && !justSaved && (
              <span className="text-[11px] text-muted-foreground">
                Live version: <span className="font-mono">{ready.config.version}</span>
              </span>
            )}
          </div>
        </div>
      )}

      <div className="mt-auto pt-8">
        <Footer />
      </div>
    </div>
  );
}
