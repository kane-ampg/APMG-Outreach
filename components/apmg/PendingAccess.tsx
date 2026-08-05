"use client";

import { ShieldQuestion } from "lucide-react";
import { Button } from "@/components/ui/button";

/** Where every auto-admitted Workspace account lands until an admin grants a
 *  role. Signing in succeeded; authorisation simply hasn't happened yet. */
export function PendingAccess({ email }: { email: string }) {
  return (
    <main className="flex min-h-dvh items-center justify-center bg-background px-4">
      <div className="w-full max-w-md rounded-xl border border-border bg-card p-8 text-center shadow-sm">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-muted">
          <ShieldQuestion className="h-6 w-6 text-muted-foreground" aria-hidden />
        </div>
        <h1 className="font-heading text-lg font-semibold tracking-tight text-foreground">
          Access pending
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          You&rsquo;re signed in as{" "}
          <span className="font-mono text-[13px] text-foreground">{email}</span>, but an
          administrator needs to grant you a role before you can use the console.
        </p>
        <Button
          variant="outline"
          className="mt-6 w-full"
          onClick={async () => {
            await fetch("/api/auth/signout", { method: "POST" });
            window.location.assign("/login");
          }}
        >
          Sign out
        </Button>
      </div>
    </main>
  );
}
