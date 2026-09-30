import { Archivo, Bitter } from "next/font/google";

/**
 * The customer portal's two faces, from the 2026-09-29 reference
 * (docs/superpowers/specs/index.html): Bitter for display, Archivo for
 * everything else.
 *
 * Self-hosted by next/font rather than linked from Google Fonts as the
 * reference does, so there is no runtime request to a font CDN and no late
 * swap on the one page that has to land instantly.
 *
 * Both hosts of the portal apply `portalFontClass` — the customer route
 * (PortalShell) and the console's "Our Services" preview (ServicesPortal) — so
 * the preview cannot drift typographically from what a customer sees.
 */
const serif = Bitter({
  subsets: ["latin"],
  weight: ["600", "700"],
  variable: "--font-portal-serif",
  display: "swap",
});

const sans = Archivo({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-portal-sans",
  display: "swap",
});

/**
 * The two variable classes plus `portal-fonts`, which (portal-world.css) points
 * the app-wide `--font-sans` / `--font-display` at these faces. That remap is
 * what carries the portal's type into the shared pieces rendered beside it —
 * the enquiry modal, the chat, the legal modals — which are styled with
 * Tailwind's `font-sans` / `font-display` and would otherwise stay Inter and
 * Fraunces.
 */
export const portalFontClass = `${serif.variable} ${sans.variable} portal-fonts`;
