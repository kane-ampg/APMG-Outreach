"use client";

import { Radar } from "lucide-react";
import { TAB_LABEL, type TabId } from "@/lib/nav";
import { Footer } from "./Footer";

/** Honest placeholder for surfaces outside the Overview preset (§12 voice). */
export function ComingSoon({ tab }: { tab: TabId }) {
  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <div className="flex flex-1 items-center justify-center px-6 py-16 text-center">
        <div className="max-w-sm">
          <div className="mx-auto mb-3 flex h-12 w-12 items-center justify-center rounded-2xl border border-border bg-card text-primary">
            <Radar className="h-6 w-6" aria-hidden />
          </div>
          <h2 className="text-sm font-semibold text-foreground">
            {TAB_LABEL[tab]} isn’t wired up yet
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            This surface ships after the Overview preset. Overview is fully populated — head
            back there to read the live signal.
          </p>
        </div>
      </div>
      <Footer />
    </div>
  );
}
