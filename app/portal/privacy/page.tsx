import type { Metadata } from "next";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { LegalDocPage } from "@/components/apmg/LegalDocPage";

/** Public, linkable Privacy Policy — see components/apmg/LegalDocPage. */
export const metadata: Metadata = {
  title: "Privacy Policy — APMG Services",
  alternates: { canonical: `${PORTAL_ORIGIN}/portal/privacy` },
};

// The policy text lives in Supabase (operator-editable) — render per-request
// so a published update is live immediately, never a stale prerender.
export const dynamic = "force-dynamic";

export default function PrivacyPage() {
  return <LegalDocPage doc="privacy" />;
}
