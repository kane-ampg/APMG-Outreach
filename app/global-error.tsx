"use client";

import { AlertTriangle } from "lucide-react";
import "./globals.css";

/**
 * Root error boundary (replaces the layout when an error escapes it).
 * Renders its own <html>/<body>. Shows the real error message (§12.4).
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="en" className="dark">
      <body className="font-sans antialiased">
        <div className="flex min-h-dvh flex-col items-center justify-center gap-3 bg-background px-6 text-center text-foreground">
          <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-primary-foreground shadow-lg shadow-signal-900/40">
            <AlertTriangle className="h-6 w-6" aria-hidden />
          </div>
          <h1 className="text-base font-semibold">Signal lost</h1>
          <p className="max-w-md font-mono text-xs text-muted-foreground">
            {error?.message || "An unexpected error occurred."}
          </p>
          <button
            type="button"
            onClick={reset}
            className="mt-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
