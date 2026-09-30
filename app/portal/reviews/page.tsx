import { permanentRedirect } from "next/navigation";

/**
 * /portal/reviews was one of five one-screen pages until 2026-09-29, when the
 * portal became one long page. It now 308s to its section there, so links
 * already out in the world (old emails, shares, search results) still land on
 * the right content, and search engines fold the old URL into /portal.
 */
export default function Page() {
  permanentRedirect("/portal#reviews");
}
