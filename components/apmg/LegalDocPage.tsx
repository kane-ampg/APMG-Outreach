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
      <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6 sm:py-12">
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
            className="mt-6 text-sm leading-relaxed text-muted-foreground [&_a]:text-primary [&_a]:underline [&_h1]:mb-2 [&_h1]:mt-6 [&_h1]:font-heading [&_h1]:text-lg [&_h1]:font-semibold [&_h1]:text-foreground [&_h2]:mb-1.5 [&_h2]:mt-5 [&_h2]:font-heading [&_h2]:text-base [&_h2]:font-semibold [&_h2]:text-foreground [&_li]:mb-1 [&_p]:mb-3 [&_strong]:text-foreground [&_ul]:mb-3 [&_ul]:list-disc [&_ul]:pl-5"
            // Operator-authored, lawyer-reviewed policy text from the Legal
            // Documents store (trusted source — same as the enquiry modal).
            dangerouslySetInnerHTML={{ __html: html }}
          />
        )}
      </div>
    </div>
  );
}
