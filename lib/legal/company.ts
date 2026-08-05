// Single source of truth for the company's identity on legal / customer-facing
// surfaces (unsubscribe page, email footer, consent copy, Terms & Privacy).
// Centralised so the name, contact, address and ABN never drift between places.
//
// Values here are the ones ALREADY used across the app; the only field not yet
// supplied is the ABN — left as null so surfaces render an explicit "(ABN: TBC)"
// marker rather than a fabricated number. Fill `abn` (and, if the entity is a
// company, its registered "... Pty Ltd" legalEntity + acn) before going live on
// anything a solicitor would review.

export interface CompanyIdentity {
  /** Public trading name shown everywhere. */
  tradingName: string;
  /** Registered legal entity, e.g. "APMG Services Pty Ltd". Null until supplied
   *  — the Terms/Privacy copy should use this once known; other surfaces are
   *  fine with the trading name. */
  legalEntity: string | null;
  /** Australian Business Number (11 digits, spaced for display). Null = TBC. */
  abn: string | null;
  /** Australian Company Number (companies only). Null when N/A or TBC. */
  acn: string | null;
  /** Registered / place-of-business address. */
  address: string;
  /** Contact + privacy/data-request email. */
  contactEmail: string;
  /** Public phone number, display-formatted ("1300 97 97 40"). */
  phone: string;
  /** Same number as a tel: href target (digits only). */
  phoneHref: string;
  /** WhatsApp deep link (wa.me requires full international format, digits
   *  only). The pre-filled text is added where the link is rendered. */
  whatsappHref: string;
  /** Google reviews panel for the business (the #lrd deep link that opens the
   *  reviews overlay on the Google listing). */
  googleReviewsUrl: string;
  /** Public website. */
  website: string;
  /** Public social profiles, in display order. Live pages only — a dead social
   *  link on a trust surface reads worse than no link at all. */
  socials: { network: "facebook" | "instagram" | "tiktok"; label: string; url: string }[];
}

export const COMPANY: CompanyIdentity = {
  tradingName: "APMG Services",
  legalEntity: null, // TODO: set the registered entity (e.g. "APMG Services Pty Ltd") for the legal docs
  abn: null, // TODO: set the ABN before going live; null renders "(ABN: TBC)"
  acn: null,
  address: "1 Tesmar Cct, Chirnside Park, VIC, Australia",
  contactEmail: "kane@apmgservices.com.au",
  // The one verified public number (knowledgebase/business.md — "1300 97 97 40"
  // and "1300 979 740" are the same digits). Display in the site's grouping.
  phone: "1300 97 97 40",
  phoneHref: "tel:1300979740",
  // NOTE: assumes the 1300 number has a WhatsApp Business account registered
  // against it (+61 1300 979 740). If APMG's WhatsApp lives on a different
  // number (e.g. a mobile), swap the digits here — nothing else to change.
  whatsappHref: "https://wa.me/611300979740",
  // The business's Google listing with the reviews overlay open (#lrd=<feature
  // id>,1). Reviews stay on Google on purpose — third-party, checkable proof.
  googleReviewsUrl:
    "https://www.google.com/search?q=APMG+Services#lrd=0x6ad6319e6f7bafcf:0xca054939c7c38206,1,,,,",
  website: "https://www.apmgservices.com.au/",
  socials: [
    {
      network: "facebook",
      label: "Facebook",
      url: "https://www.facebook.com/p/APMG-Services-100072630217180/",
    },
    {
      network: "instagram",
      label: "Instagram",
      url: "https://www.instagram.com/apmg.services/",
    },
    {
      network: "tiktok",
      label: "TikTok",
      url: "https://www.tiktok.com/@apmgservices",
    },
  ],
};

/** Name to use where a legal entity is expected (Terms/Privacy): the registered
 *  entity if known, otherwise the trading name with a clear "trading as" note so
 *  we never pass a trading name off as the registered entity. */
export function legalName(): string {
  return COMPANY.legalEntity ?? `${COMPANY.tradingName} (trading name)`;
}

/** ABN line for display, or an explicit TBC marker so a missing ABN is obvious
 *  (and never silently absent) on the surfaces that show it. */
export function abnLine(): string {
  return COMPANY.abn ? `ABN ${COMPANY.abn}` : "ABN: TBC";
}

/** One-line sender identifier for email footers / unsubscribe (Spam Act sender
 *  identification): "APMG Services · 1 Tesmar Cct, Chirnside Park, VIC · ABN …".
 *  The ABN segment is shown only once a real ABN is set. */
export function senderIdentityLine(): string {
  const parts = [COMPANY.tradingName, COMPANY.address];
  if (COMPANY.abn) parts.push(`ABN ${COMPANY.abn}`);
  return parts.join(" · ");
}
