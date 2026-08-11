import { ALL_PERMISSIONS, type Permission } from "./permissions";

/**
 * A role is a named bundle of permissions — nothing more. Enforcement checks
 * permissions, so new roles are pure data and need no logic changes.
 *
 * A USER HOLDS A SET OF ROLES, not one. Somebody can be Sales and Admin at
 * once, and their access is the UNION of both bundles (`rolesCan`). The empty
 * set is a real, meaningful state: it means revoked, and it grants nothing.
 *
 * There is deliberately no `pending` role. It used to be one, doing two jobs
 * at once — "hasn't been triaged yet" and "an admin took their access away" —
 * and as a member of a SET it would have been incoherent: holding
 * `{pending, admin}` would read as revoked while granting the whole console.
 * Revocation is now the absence of roles rather than the presence of a
 * special one, so it cannot be contradicted by anything held alongside it.
 */
export type Role = "admin" | "client" | "sales";

/**
 * Most capable first. This is the canonical order for storage and display, and
 * `primaryRole` reads it top-down — so a surface that can only pick one role
 * (the pre-paint theme, the landing tab) picks the one that grants the most,
 * never an incidental "first row in the array".
 */
export const ROLE_ORDER = ["admin", "sales", "client"] as const satisfies readonly Role[];

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
};

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

/**
 * The single entry point for turning stored or transmitted data into a role
 * set that enforcement may use.
 *
 * FAILS CLOSED, ALWAYS. A value that is not an array, an element that is not a
 * known role, the retired `"pending"` string left in an old row — every one of
 * them is dropped rather than guessed at, because the failure direction here
 * must be "no access", never "some access". Output is deduplicated and in
 * `ROLE_ORDER`, so two callers holding the same roles can never disagree about
 * what to display or store.
 */
export function parseRoles(value: unknown): Role[] {
  if (!Array.isArray(value)) return [];
  const held = new Set<Role>();
  for (const entry of value) if (isRole(entry)) held.add(entry);
  return ROLE_ORDER.filter((r) => held.has(r));
}

export function permissionsForRole(role: Role): readonly Permission[] {
  return ROLES[role]?.permissions ?? [];
}

/** Every permission any of these roles grants, deduplicated. */
export function permissionsForRoles(roles: readonly Role[]): Permission[] {
  const held = new Set<Permission>();
  for (const role of roles) for (const perm of permissionsForRole(role)) held.add(perm);
  return [...held];
}

/** One role's answer. Used where a single role is genuinely the subject — the
 *  permission matrix, and a view-as preview of one role. */
export function roleCan(role: Role, permission: Permission): boolean {
  return permissionsForRole(role).includes(permission);
}

/**
 * THE single source of truth for every access decision.
 *
 * A user may do something if ANY role they hold allows it. Note what this
 * means: adding a role can only ever widen access, never narrow it — so a
 * second role can never quietly take something away, and revoking must be done
 * by removing roles rather than by adding a restrictive one.
 */
export function rolesCan(roles: readonly Role[], permission: Permission): boolean {
  return roles.some((role) => roleCan(role, permission));
}

/**
 * The one role to show when only one will fit — the sidebar's label, the
 * pre-paint theme, the landing tab. `null` when they hold nothing.
 *
 * Resolved by capability (`ROLE_ORDER`), not by storage order, so an admin who
 * also holds Sales lands on the admin console rather than wherever their array
 * happened to start. It is a DISPLAY convenience: enforcement always reads the
 * whole set through `rolesCan`.
 */
export function primaryRole(roles: readonly Role[]): Role | null {
  return ROLE_ORDER.find((r) => roles.includes(r)) ?? null;
}

/** Roles a UI may currently assign — every role whose catalog entry has
 *  `enabled: true`. Nothing is disabled today, so this returns the whole
 *  catalog; the filter exists for the day a role is defined but not yet meant
 *  to be offered. */
export function assignableRoles(): Role[] {
  return ROLE_ORDER.filter((r) => ROLES[r].enabled);
}
