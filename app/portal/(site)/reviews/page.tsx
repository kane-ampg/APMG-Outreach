import type { Metadata } from "next";
import { PORTAL_ORIGIN } from "@/lib/hosts";
import { ReviewsSection } from "@/components/apmg/portal/sections/Reviews";

export const metadata: Metadata = {
  title: "What clients say — APMG Services",
  description:
    "Google reviews for APMG Services, unedited — from the facility managers, schools, aged care homes and property owners we maintain across Melbourne.",
  alternates: { canonical: `${PORTAL_ORIGIN}/portal/reviews` },
};

export default function ReviewsPage() {
  return <ReviewsSection fill />;
}
