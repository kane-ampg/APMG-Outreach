"use client";

import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { StoredLeadsPanel } from "./pipeline/StoredLeads";

/** Leads tab: browse stored leads by import folder (select a folder → multi-select
 *  / delete / view full details). Falls back to a flat list before the migration. */
export function LeadsPage() {
  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <Reveal className="mb-5" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Lead database
            </div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">
              All leads
            </h1>
          </div>
        </div>
      </Reveal>

      <Reveal delay={0.04}>
        <div className="rounded-xl bg-card p-4 ring-1 ring-foreground/10 sm:p-5">
          <StoredLeadsPanel refreshSignal={0} enableGlobalSearch />
        </div>
      </Reveal>

      <Footer />
    </div>
  );
}
