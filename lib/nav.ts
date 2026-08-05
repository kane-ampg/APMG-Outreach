import {
  Activity,
  BookOpen,
  Filter,
  Flame,
  Handshake,
  HardHat,
  Inbox,
  LayoutDashboard,
  PhoneCall,
  ScrollText,
  Settings,
  Sparkles,
  Users,
  Workflow,
  type LucideIcon,
} from "lucide-react";
import { type Permission } from "@/lib/rbac/permissions";
import { type Role } from "@/lib/rbac/roles";

export type TabId =
  | "services"
  | "overview"
  | "pipeline"
  | "leads"
  | "hot"
  | "enquiries"
  | "sales"
  | "closed"
  | "integrations"
  | "playbooks"
  | "composer"
  | "legal"
  | "telemetry"
  | "settings";

export interface NavItem {
  id: TabId;
  label: string;
  icon: LucideIcon;
  badge?: string;
  /** permission required to see/enter this surface */
  perm: Permission;
}

export interface NavSection {
  caption: string;
  items: NavItem[];
}

export const NAV: NavSection[] = [
  {
    caption: "Portal",
    items: [
      { id: "services", label: "Our Services", icon: HardHat, perm: "services.view" },
    ],
  },
  {
    caption: "Monitor",
    items: [
      { id: "overview", label: "Overview", icon: LayoutDashboard, perm: "overview.view" },
      { id: "pipeline", label: "Pipeline", icon: Filter, perm: "pipeline.view" },
      { id: "leads", label: "Leads", icon: Users, perm: "leads.view" },
      // Sits directly under Leads: same lead database, filtered to the ones
      // whose behaviour earned an intent score above the hot cut-off. The
      // badge (live, injected by the Sidebar) counts those still awaiting
      // hand-off to Sales.
      { id: "hot", label: "Hot Leads", icon: Flame, perm: "hotleads.view" },
      { id: "enquiries", label: "Enquiries", icon: Inbox, perm: "enquiries.view" },
      { id: "telemetry", label: "Telemetry", icon: Activity, perm: "telemetry.view" },
    ],
  },
  {
    caption: "Sell",
    items: [
      // Sales badge is injected live by the Sidebar (real queue size from useSales)
      { id: "sales", label: "Sales", icon: PhoneCall, perm: "sales.view" },
      { id: "closed", label: "Closed deals", icon: Handshake, perm: "sales.view" },
    ],
  },
  {
    caption: "Automate",
    items: [
      { id: "integrations", label: "Integrations", icon: Workflow, perm: "integrations.view" },
      { id: "playbooks", label: "Sector Playbooks", icon: BookOpen, perm: "playbooks.view" },
      { id: "composer", label: "Email Composer", icon: Sparkles, perm: "composer.view" },
    ],
  },
  {
    caption: "System",
    items: [
      { id: "legal", label: "Legal Documents", icon: ScrollText, perm: "legal.view" },
      { id: "settings", label: "Settings", icon: Settings, perm: "settings.view" },
    ],
  },
];

/** Permission gating each tab (derived from NAV). */
export const TAB_PERMISSION: Record<TabId, Permission> = Object.fromEntries(
  NAV.flatMap((section) => section.items.map((item) => [item.id, item.perm])),
) as Record<TabId, Permission>;

/** First tab (in nav order) the given checker is allowed to open. */
export function firstAllowedTab(can: (perm: Permission) => boolean): TabId {
  for (const section of NAV) {
    for (const item of section.items) {
      if (can(item.perm)) return item.id;
    }
  }
  return "overview";
}

/**
 * Where each role lands after sign-in. Admins (and clients) open the console
 * Overview; sales reps go straight to their queue instead of a dashboard they
 * don't work out of.
 */
export const ROLE_LANDING_TAB: Record<Role, TabId> = {
  admin: "overview",
  client: "overview",
  sales: "sales",
  pending: "overview",
};

/** The role's home tab, falling back to the first tab it may open. */
export function landingTab(role: Role, can: (perm: Permission) => boolean): TabId {
  const home = ROLE_LANDING_TAB[role];
  return home && can(TAB_PERMISSION[home]) ? home : firstAllowedTab(can);
}

export const TAB_LABEL: Record<TabId, string> = {
  services: "Our Services",
  overview: "Overview",
  pipeline: "Pipeline",
  leads: "Leads",
  hot: "Hot Leads",
  enquiries: "Enquiries",
  sales: "Sales",
  closed: "Closed deals",
  integrations: "Integrations",
  playbooks: "Sector Playbooks",
  composer: "Email Composer",
  legal: "Legal Documents",
  telemetry: "Telemetry",
  settings: "Settings",
};

/** Brand suffix for browser tab titles. */
export const APP_NAME = "APMG Lead Gen";

/**
 * Browser tab title for a surface. The page name leads so it survives the
 * truncation a narrow browser tab applies to the end of the string.
 */
export function tabTitle(tab: TabId): string {
  return `${TAB_LABEL[tab]} — ${APP_NAME}`;
}
