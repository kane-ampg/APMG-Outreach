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
          {/* SC 2.5.8 (Target Size Minimum): at 11px on this leading-relaxed
              body the text alone gives these two anchors a 17.9px line box —
              the phone measured 74.8x17.9 at a 320px viewport with 16.8px of
              safe space, so it failed the 24px rule AND the spacing exception.
              py-1 buys 4px above and below for a 25.9px-tall target without
              touching the type size, so the footer's visual weight is intact.
              The row grows 8px taller, which carries the ©/legal row 8px down
              with it — the still-undersized legal links therefore keep exactly
              the same 4.95px clearance between their 24px circles and these
              boxes as they had before, so nothing regresses down there. */}
          <a
            href={COMPANY.phoneHref}
            className="py-1 font-medium transition-colors hover:text-primary"
          >
            {COMPANY.phone}
          </a>
          <a
            href={`mailto:${COMPANY.contactEmail}`}
            className="py-1 font-medium transition-colors hover:text-primary"
          >
            {COMPANY.contactEmail}
          </a>
          {/* Social profiles ride the same "is this business real?" scan as
              the phone + address — third-party pages the visitor can check.
              SC 2.5.8: these were bare 14x14 anchors (Tailwind's preflight
              makes the glyph a block, so the box was the icon) with 16.8-22px
              of safe space — under both the 24px rule and the 24px-circle
              exception. p-1.5 pads each anchor out to a 26x26 target (6 + 14 +
              6) with the glyph left at h-3.5, so only the hit area grows. That
              padding now supplies the separation gap-3 used to, so the gap
              drops to 0.5: glyph-to-glyph reads 14px against 12px before, and
              adjacent 26px targets sit 2px apart (28px centre-to-centre, no
              overlap) — the size rule is met outright and the spacing exception
              no longer has to carry these at all. -mx-1.5 cancels the outer
              two anchors' padding so the row's margin box still starts and
              ends on the glyphs (70px wide against 66px): this row wraps onto
              its own line at 320px, where a 6px indent off the footer's text
              edge would be plainly visible. Margin doesn't shrink the boxes,
              and the only neighbour it lets closer is the email anchor at
              10px — itself a 24px-plus target, so no circle rule applies.
              Measured after the change at both 320px and 1280px: 26x26 boxes,
              2px apart, no pair overlapping, and no horizontal page overflow
              from the negative margin (the last anchor's padding stops 2px
              inside the footer's own px-1). One knock-on worth knowing: these
              taller boxes leave the ©-row legal links' 24px circles 4.94px of
              clearance instead of 6.88px. They still don't intersect, but
              those links remain undersized at 17.9px and are passing on the
              spacing exception alone — they want a real fix of their own. */}
          <SocialLinks
            className="-mx-1.5 gap-0.5"
            linkClassName="p-1.5 transition-colors hover:text-primary"
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
