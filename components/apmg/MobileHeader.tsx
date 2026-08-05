"use client";

import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Mobile-only top bar (ui-standards §3.1). Rendered below md via md:hidden. */
export function MobileHeader({
  label,
  navOpen,
  onOpenNav,
}: {
  label: string;
  navOpen: boolean;
  onOpenNav: () => void;
}) {
  return (
    <header className="flex shrink-0 items-center gap-3 border-b border-border bg-background/95 px-3 py-2.5 backdrop-blur-md supports-[padding:max(0px)]:pt-[max(0.625rem,env(safe-area-inset-top))] md:hidden">
      <Button
        variant="outline"
        size="icon"
        onClick={onOpenNav}
        aria-expanded={navOpen}
        aria-controls="apmg-sidebar-nav"
        aria-label="Open navigation"
      >
        <Menu className="h-5 w-5" />
      </Button>
      <span className="min-w-0 truncate text-sm font-semibold text-foreground">{label}</span>
    </header>
  );
}
