/**
 * Deliberately NOT a client module. The root layout is a Server Component and
 * cannot call into a `"use client"` file, so the pure bootstrap builder lives
 * here while the hooks that genuinely need the browser stay in lib/theme.ts.
 */

export type Theme = "dark" | "light";

/** localStorage key holding the user's explicit choice, which always wins. */
export const THEME_STORAGE_KEY = "apmg-theme";

/**
 * Inline script string injected before paint so the persisted theme (or the
 * given fallback) is applied with no flash of the wrong one.
 *
 * The operator console defaults to dark (ui-standards §4.2). The Sales desk
 * defaults to LIGHT — reps work it in daylight, often on a phone, and dark
 * chrome under glare is the first thing to cost legibility. Either way an
 * explicit choice from the toggle is stored and always wins from then on, so
 * the fallback only ever decides the very first visit.
 */
export function themeBootstrap(fallback: Theme = "dark"): string {
  return (
    `(function(){try{` +
    `var t=localStorage.getItem('${THEME_STORAGE_KEY}');` +
    `if(t!=='light'&&t!=='dark'){t='${fallback}';}` +
    `var r=document.documentElement;` +
    `r.classList.toggle('dark',t==='dark');r.style.colorScheme=t;` +
    `}catch(e){` +
    `document.documentElement.classList.toggle('dark','${fallback}'==='dark');` +
    `}})();`
  );
}
