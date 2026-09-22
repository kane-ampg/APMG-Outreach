import { PortalShell } from "@/components/apmg/portal/PortalShell";

/**
 * Chrome for the portal's five content pages — Services, Process, Approach,
 * Reviews and Team.
 *
 * WHY A ROUTE GROUP. `(site)` does not appear in any URL; `(site)/page.tsx` is
 * still `/portal`. It exists so this layout can wrap the five pages WITHOUT
 * wrapping /portal/terms and /portal/privacy, which live one level up. Those
 * two render whatever policy text is published in Supabase — arbitrary length,
 * and their whole job is to be readable end to end — and PortalShell clips its
 * content row at one viewport from `lg` up. Putting a legal document inside a
 * surface that cannot scroll would truncate the terms a visitor is being asked
 * to accept, which is the one page on this site where that is unacceptable.
 *
 * The pre-paint light-mode script stays in the parent layout, so it still
 * covers the legal pages too.
 */
export default function PortalSiteLayout({ children }: { children: React.ReactNode }) {
  return <PortalShell>{children}</PortalShell>;
}
