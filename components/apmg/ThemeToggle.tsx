"use client";

import { Moon, Sun } from "lucide-react";
import { cn } from "@/lib/cn";
import { useTheme, withViewTransition } from "@/lib/theme";

/** Theme toggle per ui-standards §4.2. Dark is the default. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { isDark, toggle } = useTheme();
  return (
    <button
      type="button"
      data-track="theme_toggle"
      data-track-to={isDark ? "light" : "dark"}
      onClick={() => withViewTransition(toggle)}
      title={compact ? "Toggle dark mode" : undefined}
      className={cn(
        "flex w-full items-center rounded-md border border-border bg-card/60 py-2 text-[13px] text-foreground transition-colors hover:bg-muted",
        compact ? "justify-center px-2" : "justify-between px-3",
      )}
      aria-label="Toggle dark mode"
    >
      <span className="flex items-center gap-2">
        {isDark ? <Moon className="h-4 w-4 text-muted-foreground" /> : <Sun className="h-4 w-4 text-muted-foreground" />}
        {!compact && <span>{isDark ? "Dark" : "Light"}</span>}
      </span>
      {/* "next state" glyph — what tapping switches TO (§4.2) */}
      {!compact && (
        <span aria-hidden className="font-mono text-muted-foreground">
          {isDark ? "☀" : "☾"}
        </span>
      )}
    </button>
  );
}
