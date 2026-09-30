"use client";

import { PortalShell } from "./portal/PortalShell";
import { PortalHome } from "./portal/PortalHome";

/**
 * The "Our Services" tab inside the internal dashboard: the operator's preview
 * of the customer portal, and since 2026-09-23 it IS the portal rather than a
 * digest of it. Same shell, same page, same sections, rendered with
 * `host="preview"` inside the dashboard's scrolling pane.
 *
 * HOST DISCRIMINATION, unchanged. Every enquiry open from this tab is tagged
 * `services_card_open`, never the `portal_service_open` contract name, and
 * `portal_view` is not emitted at all. Letting an admin demoing this tab fire
 * the contract names would inflate every Enquiries-tab conversion ratio with
 * visits no customer made. The footer's one-click unsubscribe is customer-host
 * only for the same reason. PortalShell derives all of that from `host`.
 *
 * The featured trade is fixed at the first one here. The customer route rolls
 * it on the server per request; this tab renders on the client, where a roll
 * would reflow the card after hydration.
 */
export function ServicesPortal() {
  return (
    <PortalShell host="preview">
      <PortalHome spotlight={0} />
    </PortalShell>
  );
}
