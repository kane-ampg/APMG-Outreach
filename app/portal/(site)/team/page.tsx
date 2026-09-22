import type { Metadata } from "next";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { TeamPageSection } from "@/components/apmg/portal/sections/Team";

export const metadata: Metadata = {
  title: "Who'll actually turn up — APMG Services",
  description:
    "The APMG Services team: the same people from the first call to the job done, working across Melbourne and regional Victoria from Chirnside Park.",
  alternates: { canonical: `${PORTAL_ORIGIN}/portal/team` },
};

export default function TeamPage() {
  return <TeamPageSection fill />;
}
