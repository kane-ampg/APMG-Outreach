import type { Config } from "tailwindcss";

const config: Config = {
  darkMode: "class",
  content: [
    "./app/**/*.{ts,tsx}",
    "./components/**/*.{ts,tsx}",
    "./lib/**/*.{ts,tsx}",
  ],
  theme: {
    extend: {
      fontFamily: {
        sans: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        // The `font-mono` class is used app-wide for numbers, IDs and emails.
        // It now resolves to Inter (not a monospace) so figures read cleanly and
        // stay aligned via `tabular-nums` — no more terminal look.
        mono: ["var(--font-sans)", "ui-sans-serif", "system-ui", "sans-serif"],
        heading: [
          "var(--font-heading)",
          "ui-sans-serif",
          "system-ui",
          "sans-serif",
        ],
        // Customer-portal display face (Fraunces). The internal console keeps
        // `heading` (Plus Jakarta Sans) — this serif is scoped to /portal, where
        // the surface is marketing rather than telemetry.
        display: ["var(--font-display)", "Georgia", "Times New Roman", "serif"],
      },
      // A little bigger than Tailwind's defaults (~1 step up): body 14→15,
      // base 16→17, etc. Keeps the layout tight while improving readability.
      fontSize: {
        xs: ["0.8125rem", { lineHeight: "1.125rem" }], // 13px
        sm: ["0.9375rem", { lineHeight: "1.375rem" }], // 15px
        base: ["1.0625rem", { lineHeight: "1.625rem" }], // 17px
        lg: ["1.1875rem", { lineHeight: "1.875rem" }], // 19px
        xl: ["1.375rem", { lineHeight: "1.875rem" }], // 22px
        "2xl": ["1.625rem", { lineHeight: "2.125rem" }], // 26px
        "3xl": ["2rem", { lineHeight: "2.375rem" }], // 32px
        "4xl": ["2.375rem", { lineHeight: "2.625rem" }], // 38px
        "5xl": ["3.25rem", { lineHeight: "1" }], // 52px
        "6xl": ["4rem", { lineHeight: "1" }], // 64px
      },
      colors: {
        // Semantic tokens (shadcn-style) driven by CSS vars in globals.css so
        // the ui-standards class hooks (bg-card, text-foreground, bg-muted/50,
        // ring-foreground/10 …) resolve and flip with the theme automatically.
        border: "hsl(var(--border) / <alpha-value>)",
        input: "hsl(var(--input) / <alpha-value>)",
        ring: "hsl(var(--ring) / <alpha-value>)",
        background: "hsl(var(--background) / <alpha-value>)",
        foreground: "hsl(var(--foreground) / <alpha-value>)",
        primary: {
          DEFAULT: "hsl(var(--primary) / <alpha-value>)",
          foreground: "hsl(var(--primary-foreground) / <alpha-value>)",
        },
        // darker red fill that carries white text at AA (buttons, solid chips)
        "primary-solid": "hsl(var(--primary-solid) / <alpha-value>)",
        secondary: {
          DEFAULT: "hsl(var(--secondary) / <alpha-value>)",
          foreground: "hsl(var(--secondary-foreground) / <alpha-value>)",
        },
        muted: {
          DEFAULT: "hsl(var(--muted) / <alpha-value>)",
          foreground: "hsl(var(--muted-foreground) / <alpha-value>)",
        },
        accent: {
          DEFAULT: "hsl(var(--accent) / <alpha-value>)",
          foreground: "hsl(var(--accent-foreground) / <alpha-value>)",
        },
        card: {
          DEFAULT: "hsl(var(--card) / <alpha-value>)",
          foreground: "hsl(var(--card-foreground) / <alpha-value>)",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive) / <alpha-value>)",
          foreground: "hsl(var(--destructive-foreground) / <alpha-value>)",
        },
        // APMG "signal red" brand scale — the surface accent (replaces orange
        // for this dashboard; registered in ui-standards.md §1.2 / §15).
        signal: {
          50: "#fff1ef",
          100: "#ffdcd8",
          200: "#ffbab2",
          300: "#ff8a7d",
          400: "#ff5a47",
          500: "#ff2e1f", // Signal Red — live / LED / active
          600: "#c8102e", // Incandescent — data fills only
          700: "#a50f26",
          800: "#7e0c1d",
          900: "#5a1a1f", // Standby — idle / wrong-direction ground
          950: "#360a0c",
        },
        // Near-black canvas/surfaces for the dark default (true-black leaning).
        chassis: {
          DEFAULT: "#0a0a0b",
          900: "#0a0a0b",
          800: "#101012",
          700: "#161618",
          600: "#1c1c1f",
        },

        /* ── Customer-portal palette ───────────────────────────────────────
         * Ported from the APMG Painting site so the two customer-facing
         * surfaces read as one business. Scoped by USE, not by CSS: only
         * /portal composes these, and they are literal hex rather than theme
         * vars ON PURPOSE — the portal is pinned light (app/portal/layout.tsx)
         * and a marketing page must not flip with an operator's console theme.
         *
         * `signal` is NOT ported: this project already owns that key as its red
         * data scale. Nothing here needs the painting site's amber.
         */

        // APMG black — the dominant dark surface AND the body text colour, so
        // it stays a true neutral with no cast to fight the red.
        ink: {
          DEFAULT: "#0F1113",
          raised: "#1B1E21",
          soft: "#3A3E42",
          muted: "#6B7075",
        },
        paper: {
          DEFAULT: "#FFFFFF",
          sunken: "#F5F5F5",
          edge: "#E3E3E4",
        },
        // APMG red, the portal's only accent. 600 is the lightest step that
        // still clears 4.5:1 on white, so it is the floor for red text.
        brand: {
          50: "#FDF2F3",
          100: "#FADDE1",
          400: "#E24356",
          500: "#D8172F",
          600: "#C8102E",
          700: "#A50C25",
          900: "#6B0718",
        },
      },
      letterSpacing: {
        // The portal's one uppercase micro-label tracking. Everything that sets
        // small caps composes this; nothing hand-rolls a second value.
        label: "0.14em",
      },
      maxWidth: {
        prose: "68ch",
      },
      screens: {
        // Height-keyed, not width-keyed: the portal fold has to hold its whole
        // offer in one viewport, and a 1366x768 laptop gives it less room than
        // a phone. `short:` is where the fold tightens instead of overflowing.
        short: { raw: "(max-height: 760px)" },
        // Short AND narrow — a small phone. Declared after `short` so it wins
        // where both match.
        tight: { raw: "(max-height: 760px) and (max-width: 639px)" },
        // Wider than 2xl. Where a six-column table and a side panel BOTH fit
        // without squeezing the widest column (Telemetry's lead-activity list).
        wide: "1700px",
      },
      borderRadius: {
        "4xl": "1.75rem",
      },
      keyframes: {
        "signal-ping": {
          "0%": { transform: "scale(1)", opacity: "0.55" },
          "100%": { transform: "scale(2.1)", opacity: "0" },
        },
        "bar-rise": {
          "0%": { transform: "scaleY(0)" },
          "100%": { transform: "scaleY(1)" },
        },
        "notify-blink": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.15" },
        },
        // A row/card that just arrived from admin announces itself once and
        // settles — a finite wash, not a loop, so a queue full of new leads
        // doesn't end up strobing at the rep.
        arrival: {
          "0%": { transform: "translateY(-4px)", opacity: "0.35" },
          "60%": { transform: "translateY(0)", opacity: "1" },
          "100%": { transform: "translateY(0)", opacity: "1" },
        },
      },
      animation: {
        "signal-ping": "signal-ping 1.8s cubic-bezier(0.16, 1, 0.3, 1) infinite",
        "bar-rise": "bar-rise 0.5s cubic-bezier(0.16, 1, 0.3, 1) both",
        "notify-blink": "notify-blink 1.1s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        arrival: "arrival 0.7s cubic-bezier(0.16, 1, 0.3, 1) both",
      },
    },
  },
  plugins: [require("tailwindcss-animate")],
};

export default config;
