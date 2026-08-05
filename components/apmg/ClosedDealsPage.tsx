"use client";

import { Globe, Mail, NotebookPen, Phone, Star, Undo2 } from "lucide-react";
import { formatUsd } from "@/lib/format";
import { Can } from "@/components/rbac/Can";
import { useSales } from "./SalesProvider";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex-1 px-4 py-3">
      <div
        className={
          accent
            ? "tnum font-mono text-lg font-semibold text-primary sm:text-xl"
            : "tnum font-mono text-lg font-semibold text-foreground sm:text-xl"
        }
      >
        {value}
      </div>
      <div className="mt-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

export function ClosedDealsPage() {
  const { closedDeals, revertStatus } = useSales();
  const total = closedDeals.reduce((sum, l) => sum + (l.closedValue ?? l.dealValue ?? 0), 0);
  const avg = closedDeals.length ? Math.round(total / closedDeals.length) : 0;

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <Reveal className="mb-5" y={6}>
        <div>
          <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            Sales desk
          </div>
          <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">
            Closed deals
          </h1>
          <p className="mt-1 text-xs text-muted-foreground">
            Deals you closed, with the lead profile and the note you left for the team.
          </p>
        </div>
      </Reveal>

      <Reveal delay={0.04}>
        <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10">
          <Stat label="Deals closed" value={String(closedDeals.length)} />
          <Stat label="Total value" value={formatUsd(total)} accent />
          <Stat label="Avg deal" value={formatUsd(avg)} />
        </div>
      </Reveal>

      {closedDeals.length === 0 ? (
        <div className="mt-3 flex flex-1 items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <div className="max-w-sm">
            <p className="text-sm font-medium text-foreground">No closed deals yet</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Close a deal from your sales queue and it lands here with your note.
            </p>
          </div>
        </div>
      ) : (
        <div className="mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2">
          {closedDeals.map((lead, i) => (
            <Reveal key={lead.id} delay={0.06 + 0.03 * i} className="h-full">
              <div className="flex h-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10">
                {/* header */}
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="truncate text-[14px] font-semibold text-foreground">
                      {lead.business}
                    </h3>
                    <div className="mt-0.5 truncate font-mono text-[10.5px] uppercase tracking-[0.08em] text-muted-foreground">
                      {[lead.category, lead.location].filter(Boolean).join(" · ") || "—"}
                    </div>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="tnum font-mono text-base font-semibold text-foreground">
                      {formatUsd(lead.closedValue ?? lead.dealValue ?? 0)}
                    </div>
                    <span className="mt-0.5 inline-flex items-center rounded-full border border-transparent bg-primary-solid px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-foreground">
                      Closed
                    </span>
                  </div>
                </div>

                {/* profile / contact */}
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 font-mono text-[11.5px] text-muted-foreground">
                  {lead.rating != null && (
                    <span className="inline-flex items-center gap-1.5">
                      <Star className="h-3 w-3" aria-hidden />
                      {lead.rating.toFixed(1)}
                      {lead.reviews != null && <> · {lead.reviews}</>}
                    </span>
                  )}
                  {lead.phone && (
                    <a
                      href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`}
                      data-track="closed_call"
                      data-track-lead={lead.id}
                      className="tnum inline-flex items-center gap-2 text-[15px] font-semibold text-foreground transition-colors hover:text-primary"
                    >
                      <Phone className="h-4 w-4 text-primary" aria-hidden />
                      {lead.phone}
                    </a>
                  )}
                  {lead.email && (
                    <a
                      href={`mailto:${lead.email}`}
                      data-track="closed_email"
                      data-track-lead={lead.id}
                      className="inline-flex items-center gap-1.5 truncate transition-colors hover:text-primary"
                    >
                      <Mail className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{lead.email}</span>
                    </a>
                  )}
                  {lead.website && (
                    <a
                      href={`https://${lead.website}`}
                      target="_blank"
                      rel="noreferrer"
                      data-track="closed_website"
                      data-track-lead={lead.id}
                      className="inline-flex items-center gap-1.5 truncate transition-colors hover:text-primary"
                    >
                      <Globe className="h-3 w-3 shrink-0" aria-hidden />
                      <span className="truncate">{lead.website}</span>
                    </a>
                  )}
                </div>

                {/* closing note */}
                <div className="mt-3 flex-1 rounded-lg border border-primary/20 bg-primary/5 p-3">
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <NotebookPen className="h-3 w-3 text-primary" aria-hidden />
                    <span className="font-mono text-[9.5px] font-semibold uppercase tracking-[0.16em] text-primary">
                      Closing note
                    </span>
                  </div>
                  <p className="text-[12.5px] leading-relaxed text-foreground/90">
                    {lead.closedNote ?? "No note recorded."}
                  </p>
                </div>

                {/* footer */}
                <div className="mt-3 flex items-center gap-2 border-t border-border pt-3 font-mono text-[11px] text-muted-foreground">
                  <span>Closed {lead.closedAt ?? "recently"}</span>
                  {lead.assignedRep && (
                    <>
                      <span aria-hidden className="text-border">
                        ·
                      </span>
                      <span className="text-foreground/80">{lead.assignedRep}</span>
                    </>
                  )}
                  {/* closed by mistake — hand it back to the sales queue */}
                  <Can perm="leads.close">
                    <button
                      type="button"
                      onClick={() => revertStatus(lead.id)}
                      aria-label={`Reopen ${lead.business}`}
                      data-track="closed_reopen"
                      data-track-lead={lead.id}
                      className="ml-auto inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                    >
                      <Undo2 className="h-3.5 w-3.5" aria-hidden />
                      Reopen
                    </button>
                  </Can>
                </div>
              </div>
            </Reveal>
          ))}
        </div>
      )}

      <Footer />
    </div>
  );
}
