import type { Metadata } from "next";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { ProcessSection } from "@/components/apmg/portal/sections/Process";

export const metadata: Metadata = {
  title: "What happens after you enquire — APMG Services",
  description:
    "The five stages every APMG Services job runs through: you tell us what's wrong, we attend before quoting, an itemised quote, work staged around your operations, and each area handed back clean.",
  alternates: { canonical: `${PORTAL_ORIGIN}/portal/process` },
};

export default function ProcessPage() {
  return <ProcessSection fill />;
}
