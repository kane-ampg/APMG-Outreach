"use client";

import { useCallback, useEffect, useState } from "react";
import { THEME_STORAGE_KEY, type Theme } from "@/lib/themeBootstrap";

export type { Theme };

/**
 * Wrap a state mutation so browsers that support the View Transitions API
 * cross-fade the change (theme swap, view switch). Degrades to a plain call.
 * Mirrors ui-standards §4.2 / §14.6 (`@/lib/theme/with-view-transition`).
 */
export function withViewTransition(cb: () => void) {
  const doc =
    typeof document !== "undefined"
      ? (document as Document & {
          startViewTransition?: (cb: () => void) => unknown;
        })
      : null;
  if (
    doc?.startViewTransition &&
    !window.matchMedia("(prefers-reduced-motion: reduce)").matches
  ) {
    doc.startViewTransition(cb);
  } else {
    cb();
  }
}

function readTheme(): Theme {
  if (typeof document === "undefined") return "dark";
  return document.documentElement.classList.contains("dark") ? "dark" : "light";
}

/** Dark is the default theme; a light toggle is first-class (brief + §4.2). */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("dark");

  useEffect(() => {
    setThemeState(readTheme());
  }, []);

  const setTheme = useCallback((next: Theme) => {
    const root = document.documentElement;
    root.classList.toggle("dark", next === "dark");
    root.style.colorScheme = next;
    try {
      localStorage.setItem(THEME_STORAGE_KEY, next);
    } catch {
      /* private mode / storage disabled — non-fatal */
    }
    setThemeState(next);
  }, []);

  const toggle = useCallback(() => {
    setTheme(readTheme() === "dark" ? "light" : "dark");
  }, [setTheme]);

  return { theme, setTheme, toggle, isDark: theme === "dark" };
}

/**
 * Seed the theme a role should START in, at sign-in — before the console is
 * ever rendered, so there is nothing to flash.
 *
 * Only ever writes when NOTHING is stored yet: someone who has used the toggle
 * keeps their choice, whatever they sign in as. Doing it here rather than with
 * a second bootstrap script keeps the whole app on ONE inline script (the root
 * layout's) and leaves /login and /portal statically rendered.
 */
export function seedThemeForRole(role: string): void {
  try {
    const stored = localStorage.getItem(THEME_STORAGE_KEY);
    if (stored === "light" || stored === "dark") return;
    // Reps work the desk in daylight, often on a phone — dark chrome under
    // glare is the first thing to cost legibility.
    localStorage.setItem(THEME_STORAGE_KEY, role === "sales" ? "light" : "dark");
  } catch {
    /* private mode / storage disabled — the layout default applies */
  }
}
