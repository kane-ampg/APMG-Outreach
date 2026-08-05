/**
 * Permission catalog — the atomic capabilities in the system. Roles are just
 * named bundles of these (see roles.ts), so adding a role never touches
 * enforcement code, and enforcement always checks a PERMISSION, never a role.
 *
 * Naming: `resource.action`.
 */
export const PERMISSIONS = {
  "overview.view": "View the overview dashboard",
  "services.view": "View the customer services portal",
  "pipeline.view": "View the lead pipeline",
  "pipeline.import": "Import leads from a CSV",
  "sources.view": "View lead sources",
  "campaigns.view": "View campaigns",
  "campaigns.send": "Send an outreach email campaign to leads",
  "integrations.view": "View integrations",
  "integrations.manage": "Create, pause, and reconnect automations",
  "playbooks.view": "View sector playbooks",
  "playbooks.manage": "Configure sector playbooks (category mapping + attachment PDF)",
  "composer.view": "View the AI email composer configuration",
  "legal.view": "View the portal legal documents (terms & privacy)",
  "legal.manage": "Publish the portal terms & conditions and privacy policy",
  "telemetry.view": "View click telemetry",
  "settings.view": "View settings",
  "settings.manage": "Change settings",
  "leads.view": "View leads",
  // Admin staging surface: high-intent leads are reviewed here BEFORE they're
  // handed to Sales, so reps deliberately don't get it (they see the result).
  "hotleads.view": "View hot leads awaiting hand-off to Sales",
  "hotleads.handoff": "Hand a hot lead over to the Sales queue",
  "leads.export": "Export leads",
  "leads.contact": "Contact a lead (call / email / mark contacted)",
  "leads.close": "Close a lead (won / lost)",
  "sales.view": "View the sales queue of qualified, emailed leads",
  "enquiries.view": "View portal enquiries and service-interest analytics",
  "enquiries.manage": "Update the status of portal enquiries",
  "users.manage": "Manage users and roles",
  "roles.viewas": "View the console as another role",
} as const;

export type Permission = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as Permission[];

export function permissionLabel(perm: Permission): string {
  return PERMISSIONS[perm];
}
