import { COMPANY } from "@/lib/legal/company";
import { LegalLink } from "./LegalDocModal";
import { SocialLinks } from "./SocialLinks";

/** Page footer, host-aware (ui-standards §17.8).
 *
 *  INTERNAL (consoleTag=true, the default): unchanged — the client-requested
 *  "Developed by APMG AI Team" credit plus the Signal Console build identity.
 *
 *  CUSTOMER (consoleTag=false, the public /portal host): a legitimate-business
 *  footer instead. A cold outreach recipient scans the footer for exactly four
 *  things — who you are, where you are, how to call you, and your privacy
 *  terms — so that's what it carries: trading name + address + phone + email,
 *  social profiles (checkable third-party proof the business is real), and
 *  links to the public Terms/Privacy pages. The "AI Team" credit is
 *  deliberately NOT shown here: on a page reached from unsolicited email,
 *  volunteering "AI" confirms the visitor's exact suspicion. (ABN joins the
 *  identity line automatically once lib/legal/company.ts has it — we never
 *  print a "TBC" placeholder to a customer.) */
export function Footer({ consoleTag = true }: { consoleTag?: boolean }) {
  const year = new Date().getFullYear();

  if (consoleTag) {
    return (
      <footer className="mt-auto flex flex-wrap items-center justify-between gap-2 border-t border-border px-1 pt-4 font-mono text-[11px] text-muted-foreground">
        <span>Developed by APMG AI Team © {year}</span>
        <span className="hidden uppercase tracking-[0.16em] sm:inline">
          Signal Console · build 1.0
        </span>
      </footer>
    );
  }

  return (
    <footer className="mt-auto border-t border-border px-1 pb-5 pt-4 text-[11px] leading-relaxed text-muted-foreground">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <span>
          <span className="font-semibold text-foreground">{COMPANY.tradingName}</span>
          {" · "}
          {COMPANY.address}
          {COMPANY.abn ? ` · ABN ${COMPANY.abn}` : ""}
        </span>
        <span className="flex flex-wrap items-center gap-x-4 gap-y-1">
          <a href={COMPANY.phoneHref} className="font-medium transition-colors hover:text-primary">
            {COMPANY.phone}
          </a>
          <a
            href={`mailto:${COMPANY.contactEmail}`}
            className="font-medium transition-colors hover:text-primary"
          >
            {COMPANY.contactEmail}
          </a>
          {/* Social profiles ride the same "is this business real?" scan as
              the phone + address — third-party pages the visitor can check. */}
          <SocialLinks
            className="gap-3"
            linkClassName="transition-colors hover:text-primary"
            iconClassName="h-3.5 w-3.5"
          />
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center justify-between gap-x-4 gap-y-1.5">
        <span>© {year} {COMPANY.tradingName}. All rights reserved.</span>
        {/* Modal, not navigation: checking the fine print shouldn't cost the
            visitor their place on the page. The shareable /portal/terms +
            /portal/privacy URLs stay live (linked from inside the modal). */}
        <span className="flex items-center gap-4">
          <LegalLink doc="terms" className="transition-colors hover:text-primary">
            Terms &amp; Conditions
          </LegalLink>
          <LegalLink doc="privacy" className="transition-colors hover:text-primary">
            Privacy Policy
          </LegalLink>
        </span>
      </div>
    </footer>
  );
}
