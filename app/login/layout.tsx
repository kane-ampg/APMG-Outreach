import type { Metadata } from "next";
import { APP_NAME } from "@/lib/nav";

/**
 * The sign-in page is a "use client" file, so it can't export `metadata`
 * itself — this layout exists purely to name its browser tab, matching the
 * "<page> — APMG Lead Gen" pattern the console tabs use (lib/nav tabTitle).
 */
export const metadata: Metadata = {
  title: `Sign in — ${APP_NAME}`,
};

export default function LoginLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
