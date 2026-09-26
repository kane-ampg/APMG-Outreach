import type { FollowUpQueueItem } from "./types";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09-28" → "28 Sep" (the date is already a Melbourne calendar date). */
function shortDate(ymd: string): string {
  const [, m, d] = ymd.split("-").map(Number);
  return `${d} ${MONTHS[m - 1] ?? ""}`.trim();
}

/** The one-line follow-up state a Hot Leads row shows, or null for none. */
export function followUpChip(item: FollowUpQueueItem | undefined): string | null {
  if (!item) return null;
  switch (item.stage) {
    case "ready":
      return item.touch === 2 ? "Follow-up 2 due" : "Follow-up ready to draft";
    case "awaiting":
      return `Follow-up ${item.touch ?? 1} drafted`;
    case "sending":
      return "Follow-up sending";
    case "waiting":
      return item.touch2DueOn ? `Follow-up 1 sent · #2 due ${shortDate(item.touch2DueOn)}` : "Follow-up 1 sent";
    case "done":
      return "Ready for Sales";
    default:
      return null;
  }
}
