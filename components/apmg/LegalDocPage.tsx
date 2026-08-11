import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { loadLegalDocs } from "@/lib/legal/legalStore";
import { isPlaceholderLegal } from "@/lib/legal/legalDocs";
import { COMPANY } from "@/lib/legal/company";

/**
 * Shared server-rendered body for the public /portal/terms and /portal/privacy
 * pages. These exist so the customer footer can link to the policies as plain,
 * shareable URLs (a procurement officer can bookmark or forward them) instead
 * of trapping the text inside modals. Nested under app/portal, so the portal
 * layout's light-theme bootstrap applies.
 *
 * Renders the SAME operator-authored HTML the enquiry consent pins (single
 * source: loadLegalDocs), so the linked text can never drift from the text
 * consented to. While the store still holds placeholder wording we say so
 * honestly and point at the contact email rather than presenting boilerplate
 * as a real policy.
 */
export async function LegalDocPage({ doc }: { doc: "terms" | "privacy" }) {
  const docs = await loadLegalDocs();
  const placeholder = isPlaceholderLegal(docs);
  const title = doc === "terms" ? "Terms & Conditions" : "Privacy Policy";
  const html = doc === "terms" ? docs.termsHtml : docs.privacyHtml;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      {/* SC 1.3.1: these two routes render standalone — the portal layout only
          bootstraps the light theme and supplies no shell — so until this element
          became a landmark the whole document body was unlandmarked content and
          axe flagged every heading and paragraph on it. The content column IS the
          entire page, so it is the <main>, and that deliberately includes the
          "Back to APMG" link below: it is one link rather than a nav block, and
          hoisting it outside the landmark would orphan it and simply trade this
          violation for another. */}
      <main className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
        <Link
          href="/portal"
          className="inline-flex items-center gap-1.5 text-xs font-medium text-muted-foreground transition-colors hover:text-primary"
        >
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
          Back to {COMPANY.tradingName}
        </Link>

        <h1 className="mt-6 font-heading text-2xl font-bold tracking-tight text-foreground">
          {title}
        </h1>
        <p className="mt-1 text-xs text-muted-foreground">
          {COMPANY.tradingName}
          {docs.version && !placeholder ? ` · Version ${docs.version}` : ""}
          {docs.updatedAt && !placeholder ? ` · Updated ${docs.updatedAt}` : ""}
        </p>

        {placeholder ? (
          <p className="mt-6 max-w-prose text-sm leading-relaxed text-muted-foreground">
            This document is being finalised. If you have any questions about
            how we handle your information in the meantime, contact us at{" "}
            <a
              href={`mailto:${COMPANY.contactEmail}`}
              className="font-medium text-primary underline underline-offset-2"
            >
              {COMPANY.contactEmail}
            </a>{" "}
            or call{" "}
            <a href={COMPANY.phoneHref} className="font-medium text-primary underline underline-offset-2">
              {COMPANY.phone}
            </a>
            .
          </p>
        ) : (
          <div
            className="mt-6 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_h1]:mb-1.5 [&_h1]:mt-5 [&_h1]:font-heading [&_h1]:text-base [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mb-1 [&_p]:mb-3 [&_strong]:text-foreground [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
            // Operator-authored, lawyer-reviewed policy text from the Legal
            // Documents store (trusted source — same as the enquiry modal).
            //
            // CONTENT GOVERNANCE (SC 1.3.1 + SC 2.4.6) — the stored document must
            // NOT repeat the page title and should start at <h2>, because the
            // <h1> above is the page's one and only top-level heading. The seeded
            // documents currently break that: they open with their own "Terms &
            // Conditions" / "Privacy Policy" heading, so the outline read H1
            // "Terms & Conditions" -> H1/H2 "Terms & Conditions" -> H2 "1. Who we
            // are" — the title announced twice with an empty section between.
            //
            // We deliberately do not parse or rewrite the injected HTML to strip
            // it. This is lawyer-reviewed text pinned to a consent version, and
            // silently mutating it in the render path is a far worse defect than
            // a duplicated heading; a leading-h1 CSS selector could hide it, but
            // it would also hide a legitimate first heading the day an operator
            // writes one, and hiding legal copy is never an acceptable trade. The
            // real enforcement point is the operator-facing Legal Documents
            // editor ("start at h2, no title line"), which is out of this
            // component's control.
            //
            // What this component CAN do is stop competing with the document, so
            // [&_h1] is now styled identically to [&_h2]: an injected h1 renders
            // as an ordinary section heading, not as a second page title beneath
            // the real one. Do not restore the old larger text-lg/mt-6 treatment.
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </main>
    </div>
  );
}
