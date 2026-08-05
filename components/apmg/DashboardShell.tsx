"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { landingTab, TAB_LABEL, TAB_PERMISSION, tabTitle, type TabId } from "@/lib/nav";
import { useClickTelemetry } from "@/lib/telemetry";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { ViewAsBanner } from "@/components/rbac/ViewAsBanner";
import { type SessionUser } from "./Sidebar";
import { ClickPing } from "./ClickPing";
import { CommandBar } from "./CommandBar";
import { ClosedDealsPage } from "./ClosedDealsPage";
import { ComingSoon } from "./ComingSoon";
import { ComposerConfigPage } from "./ComposerConfigPage";
import { LegalDocsPage } from "./LegalDocsPage";
import { EnquiriesPage } from "./EnquiriesPage";
import { IntegrationsPage } from "./IntegrationsPage";
import { MobileHeader } from "./MobileHeader";
import { OverviewPage } from "./OverviewPage";
import { HotLeadsPage } from "./HotLeadsPage";
import { LeadsPage } from "./LeadsPage";
import { PipelinePage } from "./PipelinePage";
import { SalesArrivalsModal } from "./SalesArrivalsModal";
import { SalesPage } from "./SalesPage";
import { SectorPlaybooksPage } from "./SectorPlaybooksPage";
import { ServicesPortal } from "./ServicesPortal";
import { SettingsPage } from "./SettingsPage";
import { Sidebar } from "./Sidebar";
import { TelemetryInspector } from "./TelemetryInspector";
import { TelemetryPage } from "./TelemetryPage";

/**
 * Root shell (ui-standards §1.1): h-dvh overflow-hidden flex → sidebar + main.
 * Content scrolls inside the main area, never the page body.
 */
export function DashboardShell({ user }: { user?: SessionUser }) {
  const reduce = useReducedMotion();
  const { can, role } = useRbac();
  // Open on the signed-in role's home surface: admins get the console
  // Overview, sales reps their queue (lib/nav ROLE_LANDING_TAB).
  const [activeTab, setActiveTab] = useState<TabId>(() => landingTab(role, can));
  const [navOpen, setNavOpen] = useState(false);
  const [inspectorOpen, setInspectorOpen] = useState(false);
  const fallbackTab = useMemo(() => landingTab(role, can), [role, can]);

  // Keep the active tab within what the current role is permitted to open.
  useEffect(() => {
    if (!can(TAB_PERMISSION[activeTab])) setActiveTab(fallbackTab);
  }, [can, activeTab, fallbackTab]);

  // Name the browser tab after the surface that's open. The console is a
  // single route with client-side tabs, so Next's static `metadata` can't do
  // this — the title is set imperatively on each switch instead.
  useEffect(() => {
    document.title = tabTitle(activeTab);
  }, [activeTab]);

  // Attach the delegated click-telemetry listener for the active view.
  useClickTelemetry(activeTab);

  // Escape closes the drawer / inspector (a11y §16).
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape") return;
      setInspectorOpen(false);
      setNavOpen(false);
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  function navigate(tab: TabId) {
    setActiveTab(tab);
    setNavOpen(false);
  }

  return (
    <div className="flex h-dvh max-h-dvh w-full flex-col overflow-hidden">
      <ViewAsBanner />

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <Sidebar
          activeTab={activeTab}
          onNavigate={navigate}
          mobileOpen={navOpen}
          onClose={() => setNavOpen(false)}
          inert={inspectorOpen}
          user={user}
        />

        {/* mobile drawer backdrop */}
        {navOpen && (
          <div
            className="fixed inset-0 z-40 bg-black/50 backdrop-blur-[1px] md:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
        )}

        <main
          inert={navOpen || inspectorOpen || undefined}
          className="chassis-grain relative flex min-w-0 flex-1 flex-col overflow-hidden"
        >
          <div className="relative z-10 flex min-h-0 flex-1 flex-col">
            <MobileHeader
              label={TAB_LABEL[activeTab]}
              navOpen={navOpen}
              onOpenNav={() => setNavOpen(true)}
            />
            {/* The command bar is internal chrome ("Lead Desk", signal ticker,
                telemetry). The Our Services tab is the customer-facing portal —
                that operator identity reads wrong to a client, so it's hidden
                there for every role (the mobile header stays for navigation). */}
            {activeTab !== "services" && (
              <CommandBar activeTab={activeTab} onOpenTelemetry={() => setInspectorOpen(true)} />
            )}

            <div className="min-h-0 flex-1 overflow-y-auto">
              <AnimatePresence mode="wait" initial={false}>
                <motion.div
                  key={activeTab}
                  initial={reduce ? false : { opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6 }}
                  transition={{ duration: reduce ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
                  className="min-h-full"
                >
                  {activeTab === "services" ? (
                    <ServicesPortal />
                  ) : activeTab === "overview" ? (
                    <OverviewPage user={user} />
                  ) : activeTab === "pipeline" ? (
                    <PipelinePage />
                  ) : activeTab === "leads" ? (
                    <LeadsPage />
                  ) : activeTab === "hot" ? (
                    <HotLeadsPage />
                  ) : activeTab === "enquiries" ? (
                    <EnquiriesPage />
                  ) : activeTab === "sales" ? (
                    <SalesPage />
                  ) : activeTab === "closed" ? (
                    <ClosedDealsPage />
                  ) : activeTab === "integrations" ? (
                    <IntegrationsPage />
                  ) : activeTab === "playbooks" ? (
                    <SectorPlaybooksPage />
                  ) : activeTab === "composer" ? (
                    <ComposerConfigPage />
                  ) : activeTab === "legal" ? (
                    <LegalDocsPage />
                  ) : activeTab === "telemetry" ? (
                    <TelemetryPage />
                  ) : activeTab === "settings" ? (
                    <SettingsPage />
                  ) : (
                    <ComingSoon tab={activeTab} />
                  )}
                </motion.div>
              </AnimatePresence>
            </div>
          </div>
        </main>
      </div>

      {/* Shell-level so new work from admin announces itself on ANY surface —
          from Overview, Enquiries, wherever. Suppressed on the Sales tab, where
          the queue's own banner already says it and a modal would cover the
          list it points at. Gated on sales.view: a role that can't open the
          queue has no use for "3 new leads landed". */}
      {can("sales.view") && (
        <SalesArrivalsModal
          suppressed={activeTab === "sales"}
          onOpenSales={() => navigate("sales")}
        />
      )}

      <TelemetryInspector open={inspectorOpen} onClose={() => setInspectorOpen(false)} />
      <ClickPing />
    </div>
  );
}
