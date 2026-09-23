import { PageTransition } from "@/components/apmg/portal/PageTransition";

/**
 * A template, not a layout, on purpose: Next remounts a template on every
 * navigation between the five pages (a layout persists), which is what gives
 * the incoming page an entrance. The shell — header, nav pill, footer strip —
 * lives in the layout above and stays put, so only the content moves.
 *
 * `lg:h-full` keeps the one-viewport lock intact: the pages below stretch to
 * this wrapper, and it has to be as tall as <main> for them to do so.
 */
export default function PortalTemplate({ children }: { children: React.ReactNode }) {
  return <PageTransition className="lg:h-full">{children}</PageTransition>;
}
