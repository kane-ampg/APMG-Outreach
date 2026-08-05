import type { Metadata } from "next";
import { Inter, Plus_Jakarta_Sans } from "next/font/google";
import { cookies } from "next/headers";
import { themeBootstrap } from "@/lib/themeBootstrap";
import { THEME_SEED_COOKIE } from "@/lib/auth/session";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  variable: "--font-sans",
  display: "swap",
});

// Two readable typefaces only (ui-standards §13). Inter carries body, UI, and
// numbers; Plus Jakarta Sans gives headings a distinct but friendly voice.
// No monospace — numbers stay aligned via `tabular-nums`, not a terminal font.
const heading = Plus_Jakarta_Sans({
  subsets: ["latin"],
  variable: "--font-heading",
  display: "swap",
});

export const metadata: Metadata = {
  title: "APMG — Lead Gen",
  description:
    "Live lead-generation telemetry for APMG Services: volume, conversion, and cost per lead at a glance.",
};

export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  // Set by the OAuth callback from the signed-in user's role — reps get light,
  // everyone else dark. localStorage still wins once the toggle has been used.
  const seed = (await cookies()).get(THEME_SEED_COOKIE)?.value === "light" ? "light" : "dark";

  return (
    <html
      lang="en"
      className={`${sans.variable} ${heading.variable} ${seed === "dark" ? "dark" : ""}`}
      suppressHydrationWarning
    >
      <head>
        {/*
          Apply the persisted (or default-dark) theme BEFORE first paint, so the
          page never flashes the wrong one.

          This must stay a BARE inline <script>: the browser runs it while
          parsing <head>, which is the only thing early enough. next/script with
          strategy="beforeInteractive" looks like the right tool but isn't — it
          emits `self.__next_s.push(...)`, deferring the code to Next's runtime,
          which boots after the first paint. That trades a dev-only console
          warning ("scripts inside React components are never executed when
          rendering on the client" — true, and irrelevant here: this one runs
          from the SSR'd HTML, and only needs to run once) for a real,
          user-visible flash of the wrong theme. Not a good trade.
        */}
        <script dangerouslySetInnerHTML={{ __html: themeBootstrap(seed) }} />
      </head>
      <body className="font-sans antialiased">{children}</body>
    </html>
  );
}
