import { type Permission } from "./permissions";
import { permissionsForRole, type Role } from "./roles";

/**
 * Presentation grouping for the Settings → Roles and permissions screen.
 *
 * This is the ONLY thing in lib/rbac that exists for display. Enforcement never
 * reads it: `permissions.ts` remains the security catalog and `roles.ts` the
 * bundles. Splitting it out keeps a copy-tweak from ever looking like a
 * permission change.
 *
 * Section captions deliberately mirror the sidebar's own section captions in
 * `lib/nav.ts` — an admin reading "Sell" here is looking at the same band of
 * the app they click in the sidebar. `sections.test.ts` asserts the two lists
 * stay identical, so renaming a nav caption fails the suite rather than
 * quietly desynchronising the two vocabularies. The captions are duplicated
 * rather than imported because `nav.ts` pulls in lucide icon components, and
 * nothing in lib/rbac should drag a React icon set into its import graph.
 *
 * `short` is a chip-length label. The full sentence stays in `permissions.ts`
 * and is what the exhaustive matrix renders — these are for the role cards,
 * where "View the overview dashboard" is four times too long to fit.
 */

export interface SectionPermission {
  readonly perm: Permission;
  readonly short: string;
}

export interface PermissionSection {
  readonly key: string;
  /** Matches a `caption` in lib/nav.ts's NAV. */
  readonly label: string;
  readonly permissions: readonly SectionPermission[];
}

export const PERMISSION_SECTIONS = [
  {
    key: "portal",
    label: "Portal",
    permissions: [{ perm: "services.view", short: "Our Services" }],
  },
  {
    key: "monitor",
    label: "Monitor",
    permissions: [
      { perm: "overview.view", short: "Overview" },
      { perm: "pipeline.view", short: "Pipeline" },
      { perm: "pipeline.import", short: "Import CSV" },
      { perm: "sources.view", short: "Lead sources" },
      { perm: "leads.view", short: "Leads" },
      { perm: "leads.export", short: "Export leads" },
      { perm: "hotleads.view", short: "Hot Leads" },
      { perm: "hotleads.handoff", short: "Hand off to Sales" },
      { perm: "enquiries.view", short: "Enquiries" },
      { perm: "enquiries.manage", short: "Update enquiries" },
      { perm: "telemetry.view", short: "Telemetry" },
    ],
  },
  {
    key: "sell",
    label: "Sell",
    permissions: [
      { perm: "sales.view", short: "Sales queue" },
      { perm: "leads.contact", short: "Contact a lead" },
      { perm: "leads.close", short: "Close won / lost" },
    ],
  },
  {
    key: "automate",
    label: "Automate",
    permissions: [
      { perm: "integrations.view", short: "Integrations" },
      { perm: "integrations.manage", short: "Manage automations" },
      { perm: "playbooks.view", short: "Sector Playbooks" },
      { perm: "playbooks.manage", short: "Configure playbooks" },
      { perm: "composer.view", short: "Email Composer" },
      { perm: "campaigns.view", short: "Campaigns" },
      { perm: "campaigns.send", short: "Send campaigns" },
    ],
  },
  {
    key: "system",
    label: "System",
    permissions: [
      { perm: "legal.view", short: "Legal Documents" },
      { perm: "legal.manage", short: "Publish legal docs" },
      { perm: "settings.view", short: "Settings" },
      { perm: "settings.manage", short: "Change settings" },
      { perm: "users.manage", short: "Manage users and roles" },
      { perm: "roles.viewas", short: "View as another role" },
    ],
  },
] as const satisfies readonly PermissionSection[];

type SectionedPermission = (typeof PERMISSION_SECTIONS)[number]["permissions"][number]["perm"];

/**
 * Compile-time exhaustiveness. Adding a permission to `permissions.ts` without
 * placing it in a section above makes this line a type error that names the
 * offenders, so a new capability can never be invisible on the screen whose
 * whole job is showing what each role can do.
 *
 * The runtime companion — "no permission appears in TWO sections" — is a test,
 * since duplicates are not expressible as a type error here.
 */
type UnsectionedPermissions = Exclude<Permission, SectionedPermission>;
const _assertEverythingIsSectioned: [UnsectionedPermissions] extends [never]
  ? true
  : ["Add these permissions to PERMISSION_SECTIONS:", UnsectionedPermissions] = true;
void _assertEverythingIsSectioned;

export interface SectionGrant {
  readonly section: PermissionSection;
  /** Permissions in this section the role holds, in catalog order. */
  readonly granted: readonly SectionPermission[];
  /** True when the role holds nothing at all in this section. */
  readonly empty: boolean;
}

/**
 * What a role unlocks, grouped for display. Derived from `permissionsForRole`
 * on every call rather than precomputed, so it cannot drift from enforcement —
 * the same reason PermissionMatrix generates its grid instead of listing it.
 */
export function sectionGrantsForRole(role: Role): SectionGrant[] {
  const held = new Set<Permission>(permissionsForRole(role));
  return PERMISSION_SECTIONS.map((section) => {
    const granted = section.permissions.filter((p) => held.has(p.perm));
    return { section, granted, empty: granted.length === 0 };
  });
}
