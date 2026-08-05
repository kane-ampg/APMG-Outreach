import { ALL_PERMISSIONS, type Permission } from "./permissions";

/**
 * A role is a named bundle of permissions — nothing more. Enforcement checks
 * permissions, so new roles are pure data and need no logic changes.
 */
export type Role = "admin" | "client" | "sales" | "pending";

export interface RoleDef {
  label: string;
  description: string;
  /** reserved roles are defined but not yet assignable in the UI */
  enabled: boolean;
  permissions: readonly Permission[];
}

export const ROLES: Record<Role, RoleDef> = {
  admin: {
    label: "Admin",
    description: "Full access to the internal lead-gen console.",
    enabled: true,
    permissions: ALL_PERMISSIONS,
  },
  client: {
    label: "Client",
    description: "Customer portal — browse services, view and export delivered leads.",
    enabled: true,
    permissions: ["services.view", "overview.view", "leads.view", "leads.export"],
  },
  sales: {
    label: "Sales",
    description: "Sales reps work the qualified-lead queue: call, email, and close.",
    enabled: true,
    permissions: [
      "overview.view",
      "sales.view",
      // Deliberately NO `leads.view`: reps work the handed-over queue, not the
      // whole lead database, so the Leads tab stays off their dashboard.
      // `leads.contact`/`leads.close` are the actions they take on queue rows.
      "leads.contact",
      "leads.close",
      "leads.export",
      // Portal enquiries are inbound qualified leads — reps triage them too.
      "enquiries.view",
      "enquiries.manage",
    ],
  },
  pending: {
    label: "Pending",
    description:
      "Signed in, but no access yet — an admin must grant a role. This is where every auto-admitted Workspace account lands.",
    enabled: true,
    permissions: [],
  },
};

/** Fallback role when no session is present. Deliberately powerless: a code
 *  path that cannot resolve a role must grant nothing, not everything. */
export const DEFAULT_ROLE: Role = "pending";

/**
 * Runtime type guard for `Role`. Deliberately an own-property check
 * (`Object.hasOwn`), NOT the `in` operator — `in` walks the prototype chain,
 * so inherited `Object.prototype` members like `"constructor"`, `"toString"`,
 * `"__proto__"`, `"hasOwnProperty"`, and `"valueOf"` would all satisfy
 * `value in ROLES` despite never being assigned as roles. This guard
 * validates the `viewAs` claim out of a signed-but-attacker-influenced JWT
 * payload (see lib/auth/session.ts), so the distinction is a security
 * boundary, not a style preference — do not "simplify" this back to `in`.
 */
export function isRole(value: unknown): value is Role {
  return typeof value === "string" && Object.hasOwn(ROLES, value);
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLES[role]?.permissions ?? [];
}

/** The single source of truth for every access decision. */
export function roleCan(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/** Roles a UI may currently assign — every role whose catalog entry has
 *  `enabled: true`. Nothing is disabled today (including `sales`, despite
 *  earlier phases treating it as reserved), so this currently returns the
 *  whole catalog; the filter exists for the day a role is defined but not
 *  yet meant to be offered. */
export function assignableRoles(): Role[] {
  return (Object.keys(ROLES) as Role[]).filter((r) => ROLES[r].enabled);
}
