"use client";

import { Inbox, Star } from "lucide-react";
import type { LeadView } from "./pipeline/LeadsTable";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

function Dash() {
  return <span className="text-muted-foreground/50">—</span>;
}

function prettyUrl(url: string): string {
  return url.replace(/^https?:\/\//, "").replace(/\/$/, "");
}

function ratingText(rating: LeadView["rating"]): string | null {
  if (rating == null || rating === "") return null;
  const n = typeof rating === "number" ? rating : Number.parseFloat(rating);
  return Number.isFinite(n) ? n.toFixed(1) : null;
}

/**
 * Most-recent leads, straight from the pipeline (`public.leads`). Columns are
 * the real scraped fields — business, rating, email count, phone — not the
 * fabricated score/value of the old preset.
 */
export function RecentLeadsTable({
  rows,
  title = "Recent leads",
  meta = "latest",
  emptyHint = "No leads imported yet.",
}: {
  rows: LeadView[];
  title?: string;
  meta?: string;
  emptyHint?: string;
}) {
  return (
    <section
      className="flex h-full min-w-0 flex-col rounded-xl bg-card ring-1 ring-foreground/10"
      aria-label={title}
    >
      <div className="flex items-center justify-between border-b border-border px-4 py-3">
        <h2 className="font-heading text-sm font-semibold text-foreground">{title}</h2>
        <span className="font-mono text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
          {meta}
        </span>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 px-6 py-10 text-center">
          <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-border bg-background text-muted-foreground">
            <Inbox className="h-5 w-5" aria-hidden />
          </span>
          <p className="max-w-[14rem] font-mono text-[10.5px] leading-relaxed text-muted-foreground">
            {emptyHint}
          </p>
        </div>
      ) : (
        <div className="min-w-0 px-2 pb-1">
          <Table>
            <TableHeader>
              <TableRow className="hover:bg-transparent">
                <TableHead>Business</TableHead>
                <TableHead className="text-right">Rating</TableHead>
                <TableHead className="text-right">Emails</TableHead>
                <TableHead className="text-right">Phone</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((r, i) => {
                const rt = ratingText(r.rating);
                const sub = r.website ? prettyUrl(r.website) : r.address ?? null;
                return (
                  <TableRow
                    key={r.id ?? i}
                    data-track="lead_row"
                    data-track-lead={r.id}
                    className="hover:bg-muted/40"
                  >
                    <TableCell className="max-w-[220px] py-2.5">
                      <div className="truncate text-[13px] font-medium text-foreground">{r.name}</div>
                      {sub && (
                        <div className="mt-px truncate font-mono text-[10.5px] text-muted-foreground">
                          {sub}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-right">
                      {rt ? (
                        <span className="tnum inline-flex items-center justify-end gap-1 font-mono text-[13px] text-foreground">
                          <Star className="h-3 w-3 text-muted-foreground" aria-hidden />
                          {rt}
                        </span>
                      ) : (
                        <Dash />
                      )}
                    </TableCell>
                    <TableCell className="tnum text-right font-mono text-[13px] text-foreground">
                      {r.emails?.length || <Dash />}
                    </TableCell>
                    <TableCell className="tnum text-right font-mono text-[12px] text-foreground">
                      {r.phone ?? <Dash />}
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      )}
    </section>
  );
}
