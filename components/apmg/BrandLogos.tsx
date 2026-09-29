/**
 * Traffic-source brand marks, drawn inline so neither the console nor the PDF
 * report ever fetches a third-party asset. Full colour on purpose: they label
 * WHERE visitors came from, and a monochrome "f" or "G" in the console's red
 * would read as just another icon. Sized by the caller, like a lucide icon.
 */

/** Facebook's round "f" (2023 mark, #0866FF). The white disc behind it is what
 *  shows through the letter, so the "f" stays white on a dark card. */
const FACEBOOK_PATH =
  "M9.101 23.691v-7.98H6.627v-3.667h2.474v-1.58c0-4.085 1.848-5.978 5.858-5.978.401 0 .955.042 1.468.103a8.68 8.68 0 0 1 1.141.195v3.325a8.623 8.623 0 0 0-.653-.036 26.805 26.805 0 0 0-.733-.009c-.707 0-1.259.096-1.675.309a1.686 1.686 0 0 0-.679.622c-.258.42-.374.995-.374 1.752v1.297h3.919l-.386 2.103-.287 1.564h-3.246v8.245C19.396 23.238 24 18.179 24 12.044c0-6.627-5.373-12-12-12s-12 5.373-12 12c0 5.628 3.874 10.35 9.101 11.647Z";

/** Google's four-colour "G", one path per colour. */
const GOOGLE_PATHS: ReadonlyArray<readonly [fill: string, d: string]> = [
  ["#EA4335", "M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"],
  ["#4285F4", "M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"],
  ["#FBBC05", "M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"],
  ["#34A853", "M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"],
];

/** LinkedIn's "in" bug (#0A66C2). The path is the square with the letters cut
 *  out; the white square behind it is what shows through them, so the "in"
 *  stays white on a dark card — the same trick as the Facebook disc. */
const LINKEDIN_PATH =
  "M20.447 20.452h-3.554v-5.569c0-1.328-.027-3.037-1.852-3.037-1.853 0-2.136 1.445-2.136 2.939v5.667H9.351V9h3.414v1.561h.046c.477-.9 1.637-1.85 3.37-1.85 3.601 0 4.267 2.37 4.267 5.455v6.286zM5.337 7.433c-1.144 0-2.063-.926-2.063-2.065 0-1.138.92-2.063 2.063-2.063 1.14 0 2.064.925 2.064 2.063 0 1.139-.925 2.065-2.064 2.065zm1.782 13.019H3.555V9h3.564v11.452zM22.225 0H1.771C.792 0 0 .774 0 1.729v20.542C0 23.227.792 24 1.771 24h20.451C23.2 24 24 23.227 24 22.271V1.729C24 .774 23.2 0 22.222 0h.003z";

/** The traffic sources that have a brand mark. */
export type Brand = "facebook" | "google" | "linkedin";

export function isBrand(v: string): v is Brand {
  return v === "facebook" || v === "google" || v === "linkedin";
}

export function FacebookLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <circle cx="12" cy="12" r="11.5" fill="#fff" />
      <path fill="#0866FF" d={FACEBOOK_PATH} />
    </svg>
  );
}

export function GoogleLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 48 48" className={className} aria-hidden focusable="false">
      {GOOGLE_PATHS.map(([fill, d]) => (
        <path key={fill} fill={fill} d={d} />
      ))}
    </svg>
  );
}

export function LinkedInLogo({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} aria-hidden focusable="false">
      <rect x="1.5" y="1.5" width="21" height="21" rx="2" fill="#fff" />
      <path fill="#0A66C2" d={LINKEDIN_PATH} />
    </svg>
  );
}

/** Brand → its React mark, for callers that pick the logo by source slug. */
export const BRAND_LOGO: Record<Brand, typeof FacebookLogo> = {
  facebook: FacebookLogo,
  google: GoogleLogo,
  linkedin: LinkedInLogo,
};

/** The same marks as SVG markup, for documents built as HTML strings (the
 *  Telemetry PDF report renders in a bare window, with no React). */
export function brandLogoSvg(brand: Brand, size: number): string {
  const attrs = `width="${size}" height="${size}" aria-hidden="true" style="vertical-align:-2px"`;
  if (brand === "facebook") {
    return `<svg viewBox="0 0 24 24" ${attrs}><circle cx="12" cy="12" r="11.5" fill="#fff"/><path fill="#0866FF" d="${FACEBOOK_PATH}"/></svg>`;
  }
  if (brand === "linkedin") {
    return `<svg viewBox="0 0 24 24" ${attrs}><rect x="1.5" y="1.5" width="21" height="21" rx="2" fill="#fff"/><path fill="#0A66C2" d="${LINKEDIN_PATH}"/></svg>`;
  }
  return `<svg viewBox="0 0 48 48" ${attrs}>${GOOGLE_PATHS.map(([fill, d]) => `<path fill="${fill}" d="${d}"/>`).join("")}</svg>`;
}
