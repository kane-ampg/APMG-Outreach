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
