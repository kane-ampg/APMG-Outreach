"use client";

import { useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ShieldCheck, Settings as SettingsIcon } from "lucide-react";
import { cn } from "@/lib/cn";
import { useRbac } from "@/lib/rbac/RbacProvider";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { RolesPermissionsTab } from "./settings/RolesPermissionsTab";

/**
 * Settings. One sub-tab today (Roles and Permissions); the tablist exists so
 * adding the next one is a data change rather than a restructure.
 *
 * The tab is gated on `users.manage`, so a non-admin who somehow reaches
 * Settings sees an explanation rather than an empty frame. Enforcement is on
 * the API route — this is presentation.
 */

const EASE = [0.22, 1, 0.36, 1] as const;

type SubTab = "roles";

export function SettingsPage() {
  const { can } = useRbac();
  const [tab, setTab] = useState<SubTab>("roles");
  const reduce = useReducedMotion() ?? false;
  const [pendingCount, setPendingCount] = useState(0);

  if (!can("users.manage")) {
    return (
      <div className="flex flex-col gap-6 p-4 sm:p-6">
        <Reveal>
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <ShieldCheck className="mx-auto mb-3 h-6 w-6 text-muted-foreground" aria-hidden />
            <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
              Settings
            </h1>
            <p className="mx-auto mt-2 max-w-sm text-sm leading-relaxed text-muted-foreground">
              Managing users and roles needs administrator access. Ask an admin if
              you need something changed here.
            </p>
          </div>
        </Reveal>
        <Footer />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6 p-4 sm:p-6">
      <Reveal>
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-primary/10">
            <SettingsIcon className="h-4 w-4 text-primary" aria-hidden />
          </div>
          <div className="min-w-0 flex-1">
            <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
              Settings
            </h1>
            <p className="text-xs text-muted-foreground">
              Who can sign in to this console, and what each role may do.
            </p>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.04}>
        <div
          role="tablist"
          aria-label="Settings sections"
          className="inline-flex gap-1 rounded-lg bg-background/60 p-1 ring-1 ring-foreground/10"
        >
          <SubTabPill
            active={tab === "roles"}
            reduce={reduce}
            label="Roles and Permissions"
            count={pendingCount}
            onSelect={() => setTab("roles")}
          />
        </div>
      </Reveal>

      {tab === "roles" && <RolesPermissionsTab onPendingCountChange={setPendingCount} />}

      <Footer />
    </div>
  );
}

/**
 * Same animated pill as the Hot Leads lane tabs (HotLeadsPage's `LanePill`),
 * with the count shown only when there is something to act on — a permanent
 * "0" reads as a tally rather than a to-do.
 */
function SubTabPill({
  active,
  reduce,
  label,
  count,
  onSelect,
}: {
  active: boolean;
  reduce: boolean;
  label: string;
  count: number;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onSelect}
      data-track="settings_subtab"
      className={cn(
        "relative inline-flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs font-semibold transition-colors",
        active ? "text-white" : "text-muted-foreground hover:text-foreground",
      )}
    >
      {active && (
        <motion.span
          layoutId="settings-subtab-pill"
          className="absolute inset-0 rounded-md bg-gradient-to-r from-primary to-primary-solid shadow-sm shadow-primary/25"
          transition={{ duration: reduce ? 0 : 0.28, ease: EASE }}
        />
      )}
      <span className="relative z-10">{label}</span>
      {count > 0 && (
        <span
          className={cn(
            "tnum relative z-10 rounded-full px-1.5 py-px font-mono text-[10px] font-semibold",
            active ? "bg-white/20 text-white" : "bg-amber-500/20 text-amber-600 dark:text-amber-400",
          )}
        >
          {count}
        </span>
      )}
    </button>
  );
}
