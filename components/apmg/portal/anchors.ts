/**
 * The portal's in-page sections, in reading order: what the header nav links
 * to, and what the four retired sub-routes (/portal/process, /approach,
 * /reviews, /team) now redirect into.
 *
 * A plain module, no "use client": the redirect pages are server components,
 * and a value exported from a client module reaches server code as a
 * client-reference proxy rather than as itself.
 */
export const PORTAL_SECTIONS = [
  { id: "services", label: "Services" },
  { id: "process", label: "How we work" },
  { id: "reviews", label: "Reviews" },
  { id: "team", label: "Team" },
] as const;

export type PortalSectionId = (typeof PORTAL_SECTIONS)[number]["id"];

/**
 * Scrolls to an in-page section and moves focus there, in place of the
 * browser's own hash jump.
 *
 * WHY NOT A PLAIN HASH LINK. The console previews this page inside its own
 * scrolling pane, where writing `#services` onto the dashboard's URL would be
 * wrong. So the jump is done here on both hosts, and only the customer host
 * (`updateUrl`) records the hash, which keeps a section shareable there.
 *
 * Focus moves to the section too: `preventDefault` also cancels the browser's
 * move of the sequential-focus starting point, and without this a keyboard
 * user's next Tab would land back in the header. The targets carry
 * `tabIndex={-1}` for exactly this.
 */
export function goToSection(event: { preventDefault(): void }, id: string, updateUrl: boolean) {
  const target = document.getElementById(id);
  if (!target) return;
  event.preventDefault();
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
  target.focus({ preventScroll: true });
  if (updateUrl) history.replaceState(null, "", `#${id}`);
}
