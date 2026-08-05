import { headers } from "next/headers";
import { DashboardShell } from "@/components/apmg/DashboardShell";
import { PendingAccess } from "@/components/apmg/PendingAccess";
import { RbacProvider } from "@/lib/rbac/RbacProvider";
import { SalesProvider } from "@/components/apmg/SalesProvider";
import { resolveSession } from "@/lib/rbac/server";

function initialsFor(name: string, email: string): string {
  const source = name.trim() || email;
  const parts = source.split(/[\s.@]+/).filter(Boolean);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export default async function Page() {
  // Middleware guarantees a valid session before this renders, so a null here
  // means the cookie expired between the two — send them back to the door.
  const session = await resolveSession(new Request("http://local/", { headers: await headers() }));
  if (!session) return <PendingAccess email="unknown" />;
  if (session.role === "pending") return <PendingAccess email={session.email} />;

  // Prefer the Google-provided display name carried in the session cookie;
  // fall back to an email-derived name for a session minted before this
  // field existed, or a Google account with no name claim.
  const emailLocal = session.email.split("@")[0].replace(/[._]/g, " ");
  const fallbackName = emailLocal.charAt(0).toUpperCase() + emailLocal.slice(1);
  const name = session.name?.trim() || fallbackName;
  const user = {
    email: session.email,
    name,
    initials: initialsFor(name, session.email),
  };

  return (
    <RbacProvider role={session.role} trueRole={session.trueRole}>
      <SalesProvider>
        <DashboardShell user={user} />
      </SalesProvider>
    </RbacProvider>
  );
}
