import Link from "next/link";

export default function NotFound() {
  return (
    <div className="flex min-h-dvh flex-col items-center justify-center gap-3 px-6 text-center">
      <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
        Error · 404
      </div>
      <h1 className="text-base font-semibold text-foreground">No signal on that channel</h1>
      <p className="max-w-md text-xs text-muted-foreground">
        That page isn’t part of the dashboard.
      </p>
      <Link
        href="/"
        className="mt-1 rounded-lg border border-border bg-card px-3 py-1.5 text-sm text-foreground transition-colors hover:bg-muted"
      >
        Back to Overview
      </Link>
    </div>
  );
}
