"use client";

import { Activity } from "lucide-react";
import { TAB_LABEL, type TabId } from "@/lib/nav";
import { Can } from "@/components/rbac/Can";
import { SignalTicker } from "./SignalTicker";

/** Editorial command bar (ui-standards §3.2.1): breadcrumb + live signal + actions. */
export function CommandBar({
  activeTab,
  onOpenTelemetry,
}: {
  activeTab: TabId;
  onOpenTelemetry: () => void;
}) {
  return (
    <header className="z-20 flex flex-wrap items-center gap-x-3 gap-y-2 border-b border-border bg-background/70 px-4 py-2.5 backdrop-blur-md lg:px-6">
      <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em]">
        <span aria-hidden className="text-primary">
          ▍
        </span>
        <span className="text-muted-foreground">Lead Desk</span>
        <span aria-hidden className="text-border">
          /
        </span>
        <span className="text-foreground">{TAB_LABEL[activeTab]}</span>
      </nav>

      <div className="ml-auto flex items-center gap-3">
        <SignalTicker />
        <Can perm="telemetry.view">
          <button
            type="button"
            data-track="open_telemetry"
            onClick={onOpenTelemetry}
            aria-label="Open telemetry inspector"
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 font-mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
          >
            <Activity className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden sm:inline">Telemetry</span>
          </button>
        </Can>
      </div>
    </header>
  );
}
