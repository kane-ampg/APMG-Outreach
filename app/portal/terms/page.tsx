import type { Metadata } from "next";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { LegalDocPage } from "@/components/apmg/LegalDocPage";

/** Public, linkable Terms & Conditions — see components/apmg/LegalDocPage. */
export const metadata: Metadata = {
  title: "Terms & Conditions — APMG Services",
  alternates: { canonical: `${PORTAL_ORIGIN}/portal/terms` },
};

// The policy text lives in Supabase (operator-editable) — render per-request
// so a published update is live immediately, never a stale prerender.
export const dynamic = "force-dynamic";

export default function TermsPage() {
  return <LegalDocPage doc="terms" />;
}
