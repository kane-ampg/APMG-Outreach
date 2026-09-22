import type { Metadata } from "next";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { ApproachSection } from "@/components/apmg/portal/sections/Approach";

export const metadata: Metadata = {
  title: "How we work — APMG Services",
  description:
    "One contact for eight trades, work staged so the building keeps running, a site visit before every quote, and pricing itemised line by line. Trading since 2015 across Melbourne and regional Victoria.",
  alternates: { canonical: `${PORTAL_ORIGIN}/portal/approach` },
};

export default function ApproachPage() {
  return <ApproachSection fill />;
}
