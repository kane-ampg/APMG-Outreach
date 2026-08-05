"use client";

import { useEffect, useMemo, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import {
  ChevronLeft,
  ChevronRight,
  CircleCheck,
  Globe,
  LayoutGrid,
  Mail,
  Phone,
  Inbox,
  RefreshCw,
  Rows3,
  Sparkles,
  Star,
  Undo2,
  X,
} from "lucide-react";
import { cn } from "@/lib/cn";
import { SALES_REP, type SalesLead, type SalesStatus } from "@/lib/data/sales";
import { formatInt, formatUsd } from "@/lib/format";
import { Can } from "@/components/rbac/Can";
import { Button } from "@/components/ui/button";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { CloseDealModal } from "./CloseDealModal";
import { ReturnLeadModal } from "./ReturnLeadModal";
import { SalesStatusPill } from "./SalesStatusPill";
import { SignalLed } from "./SignalLed";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";
import { useSales } from "./SalesProvider";

const FILTERS: { id: SalesStatus | "all"; label: string }[] = [
  { id: "all", label: "All" },
  { id: "new", label: "New" },
  { id: "contacted", label: "Contacted" },
  { id: "closed_won", label: "Closed" },
  { id: "closed_lost", label: "Lost" },
];

/** How the queue is laid out. Table is the default — density first for a rep
 *  working a list; cards are richer per lead (they carry the AI brief). */
type ViewMode = "table" | "cards";

const VIEW_STORAGE = "apmg:sales-view";

const EMPTY_SELECTION: ReadonlySet<string> = new Set();

const VIEWS: { id: ViewMode; label: string; icon: typeof Rows3 }[] = [
  { id: "table", label: "Table", icon: Rows3 },
  { id: "cards", label: "Cards", icon: LayoutGrid },
];

function Stat({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div className="flex-1 px-4 py-3">
      <div
        className={cn(
          "tnum font-mono text-2xl font-semibold sm:text-3xl",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-0.5 text-[11.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
        {label}
      </div>
    </div>
  );
}

/** Small ghost button used for the retract ("undo this mark") actions. */
function RevertButton({
  label,
  leadId,
  onRevert,
}: {
  label: string;
  leadId: string;
  onRevert: (id: string) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onRevert(leadId)}
      data-track="lead_revert_status"
      data-track-lead={leadId}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
    >
      <Undo2 className="h-4 w-4" aria-hidden />
      {label}
    </button>
  );
}

function LeadCard({
  lead,
  fresh,
  onContacted,
  onLost,
  onRequestClose,
  onRequestReturn,
  onRevert,
}: {
  lead: SalesLead;
  /** just arrived from admin and not yet acknowledged */
  fresh: boolean;
  onContacted: (id: string) => void;
  onLost: (id: string) => void;
  onRequestClose: (id: string) => void;
  onRequestReturn: (id: string) => void;
  onRevert: (id: string) => void;
}) {
  const hot = (lead.score ?? 0) >= 85;
  const closed = lead.status === "closed_won" || lead.status === "closed_lost";
  const value = lead.closedValue ?? lead.dealValue;
  const subtitle = [lead.category, lead.location].filter(Boolean).join(" · ");
  const hasContact = !!(lead.phone || lead.email || lead.website);

  return (
    <div
      className={cn(
        "flex h-full flex-col rounded-xl bg-card p-4 ring-1 ring-foreground/10",
        fresh && "bg-primary/[0.07] ring-2 ring-primary/50 motion-safe:animate-arrival",
      )}
    >
      {/* header */}
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="flex min-w-0 items-center gap-1.5 text-[16px] font-semibold text-foreground">
            <span className="truncate">{lead.business}</span>
            {fresh && (
              <span
                title="Just arrived from admin"
                className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-solid px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-foreground"
              >
                <span
                  aria-hidden
                  className="h-1 w-1 rounded-full bg-primary-foreground motion-safe:animate-notify-blink"
                />
                New
              </span>
            )}
          </h3>
          <div className="mt-0.5 truncate font-mono text-[12px] uppercase tracking-[0.08em] text-muted-foreground">
            {subtitle || "—"}
          </div>
        </div>
        <div className="flex shrink-0 flex-col items-end gap-1">
          <SalesStatusPill status={lead.status} />
          {lead.rating != null && (
            <span className="tnum inline-flex items-center gap-1 font-mono text-[12.5px] text-muted-foreground">
              <Star className="h-3.5 w-3.5" aria-hidden />
              {lead.rating.toFixed(1)}
              {lead.reviews != null && <> · {lead.reviews}</>}
            </span>
          )}
        </div>
      </div>

      {/* score + engagement */}
      <div className="mt-2.5 flex items-center gap-2">
        {lead.score != null && (
          <span className="tnum inline-flex items-center gap-1 rounded-md border border-border bg-background/50 px-2 py-1 font-mono text-[12.5px] text-foreground">
            {hot && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
            fit {lead.score}
          </span>
        )}
        {lead.engaged ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 bg-transparent px-2 py-1 font-mono text-[11.5px] font-semibold uppercase tracking-[0.08em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            Engaged
          </span>
        ) : (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background/50 px-2 py-1 font-mono text-[11.5px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">
            Email sent
            {(lead.emailsSent ?? 0) > 1 && <span className="tnum normal-case">×{lead.emailsSent}</span>}
          </span>
        )}
      </div>

      {/* contact details — everything the rep needs to call. The phone number
          is the money row: rendered big so it's readable at a glance mid-call. */}
      <div className="mt-3 grid grid-cols-1 gap-1.5 rounded-lg border border-border bg-background/40 p-2.5 sm:grid-cols-2">
        {lead.phone && (
          <a
            href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`}
            data-track="lead_call"
            data-track-lead={lead.id}
            className="tnum inline-flex items-center gap-2.5 rounded-md px-1.5 py-1.5 font-mono text-[19px] font-semibold tracking-tight text-foreground transition-colors hover:bg-muted hover:text-primary sm:col-span-2"
          >
            <Phone className="h-[18px] w-[18px] shrink-0 text-primary" aria-hidden />
            {lead.phone}
          </a>
        )}
        {lead.email && (
          <a
            href={`mailto:${lead.email}`}
            data-track="lead_email"
            data-track-lead={lead.id}
            className="inline-flex items-center gap-2 truncate rounded-md px-1.5 py-1 font-mono text-[13.5px] text-foreground transition-colors hover:bg-muted hover:text-primary"
          >
            <Mail className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{lead.email}</span>
          </a>
        )}
        {lead.website && (
          <a
            href={`https://${lead.website}`}
            target="_blank"
            rel="noreferrer"
            data-track="lead_website"
            data-track-lead={lead.id}
            className={cn(
              "inline-flex items-center gap-2 truncate rounded-md px-1.5 py-1 font-mono text-[13.5px] text-foreground transition-colors hover:bg-muted hover:text-primary",
              !lead.email && "sm:col-span-2",
            )}
          >
            <Globe className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
            <span className="truncate">{lead.website}</span>
          </a>
        )}
        {!hasContact && (
          <span className="px-1.5 py-1 font-mono text-[13.5px] text-muted-foreground sm:col-span-2">
            No contact details on file.
          </span>
        )}
      </div>

      {/* AI brief — only when one has been prepared for this lead */}
      {lead.aiSummary && (
        <div className="mt-3 rounded-lg border border-primary/20 bg-primary/5 p-3">
          <div className="mb-1.5 flex items-center gap-1.5">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.16em] text-primary">
              AI brief
            </span>
          </div>
          <p className="text-[14px] leading-relaxed text-foreground/90">{lead.aiSummary}</p>
          {(lead.talkingPoints ?? []).length > 0 && (
            <ul className="mt-2 space-y-1">
              {(lead.talkingPoints ?? []).map((point) => (
                <li key={point} className="flex gap-2 text-[13px] leading-snug text-muted-foreground">
                  <span aria-hidden className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-primary" />
                  {point}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      {/* actions */}
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-border pt-3">
        <span className="tnum font-mono text-[12.5px] text-muted-foreground">
          {lead.status === "closed_won" ? (
            <>
              Closed <span className="text-foreground">{formatUsd(value ?? 0)}</span>
            </>
          ) : lead.status === "closed_lost" ? (
            "Lost"
          ) : value != null ? (
            <>
              Est. <span className="text-foreground">{formatUsd(value)}</span>
            </>
          ) : (
            <>
              Received <span className="text-foreground">{lead.receivedAt}</span>
            </>
          )}
        </span>
        {lead.assignedRep && (
          <>
            <span aria-hidden className="text-border">·</span>
            <span className="font-mono text-[12.5px] text-muted-foreground">{lead.assignedRep}</span>
          </>
        )}

        {!closed && (
          <div className="ml-auto flex items-center gap-1.5">
            <Can perm="leads.contact">
              {lead.status === "new" ? (
                <button
                  type="button"
                  onClick={() => onContacted(lead.id)}
                  data-track="lead_mark_contacted"
                  data-track-lead={lead.id}
                  className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                >
                  <Phone className="h-4 w-4" aria-hidden />
                  Mark contacted
                </button>
              ) : (
                // marked contacted by mistake — put it back in New
                <RevertButton label="Undo contacted" leadId={lead.id} onRevert={onRevert} />
              )}
            </Can>
            <Can perm="leads.close">
              <button
                type="button"
                onClick={() => onRequestClose(lead.id)}
                data-track="lead_open_close_modal"
                data-track-lead={lead.id}
                className="inline-flex items-center gap-1.5 rounded-md bg-primary-solid px-3 py-1.5 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary-solid/90"
              >
                <CircleCheck className="h-4 w-4" aria-hidden />
                Closed
              </button>
              <button
                type="button"
                onClick={() => onLost(lead.id)}
                aria-label={`Mark ${lead.business} lost`}
                data-track="lead_close_lost"
                data-track-lead={lead.id}
                className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
              >
                <X className="h-4 w-4" aria-hidden />
              </button>
            </Can>
            {/* hand it back to admin — for leads we shouldn't be calling */}
            <button
              type="button"
              onClick={() => onRequestReturn(lead.id)}
              aria-label={`Return ${lead.business} to admin`}
              title="Return to admin"
              data-track="lead_open_return_modal"
              data-track-lead={lead.id}
              className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
            >
              <Undo2 className="h-4 w-4" aria-hidden />
            </button>
          </div>
        )}
        {closed && (
          <div className="ml-auto flex items-center gap-2">
            {lead.status === "closed_won" && (
              <span className="inline-flex items-center gap-1 font-mono text-[12.5px] text-primary">
                <CircleCheck className="h-4 w-4" aria-hidden />
                Closed{lead.assignedRep ? ` by ${lead.assignedRep}` : ""}
              </span>
            )}
            {/* retract the close / lost mark and hand the lead back to the queue */}
            <Can perm="leads.close">
              <RevertButton
                label={lead.status === "closed_won" ? "Reopen" : "Undo lost"}
                leadId={lead.id}
                onRevert={onRevert}
              />
            </Can>
          </div>
        )}
      </div>
    </div>
  );
}

/* ───────────────────────────  table view  ─────────────────────────── */

/**
 * The queue as a TABLE — the default. A rep working a list wants density and
 * one scannable column per fact (who / where they're up to / how to reach them
 * / what it's worth); the card grid is the alternative when they'd rather read
 * one lead at a time with its AI brief. Same data, same actions, same status
 * marks — only the layout differs, and the choice sticks per browser.
 */
function LeadRow({
  lead,
  fresh,
  selected,
  onToggle,
  onContacted,
  onLost,
  onRequestClose,
  onRequestReturn,
  onRevert,
}: {
  lead: SalesLead;
  /** just arrived from admin and not yet acknowledged — the row announces it */
  fresh: boolean;
  selected: boolean;
  onToggle: (id: string) => void;
  onContacted: (id: string) => void;
  onLost: (id: string) => void;
  onRequestClose: (id: string) => void;
  onRequestReturn: (id: string) => void;
  onRevert: (id: string) => void;
}) {
  const closed = lead.status === "closed_won" || lead.status === "closed_lost";
  const value = lead.closedValue ?? lead.dealValue;

  return (
    <TableRow
      className={cn(
        "transition-colors",
        // A fresh row has to stay legible as "new" while the rep scans past it,
        // so the tint wins over hover instead of being replaced by it.
        fresh
          ? "bg-primary/[0.09] hover:bg-primary/[0.13] motion-safe:animate-arrival"
          : selected
            ? "bg-primary/[0.06] hover:bg-primary/[0.1]"
            : "hover:bg-muted/40",
      )}
    >
      <TableCell className="w-9">
        <input
          type="checkbox"
          checked={selected}
          onChange={() => onToggle(lead.id)}
          aria-label={`Select ${lead.business}`}
          className="h-4 w-4 cursor-pointer accent-primary align-middle"
        />
      </TableCell>

      {/* who */}
      <TableCell className="relative max-w-[260px]">
        {/* left accent bar — the same device the leads table uses for a
            selected row, so "marked" reads consistently across the app */}
        {fresh && (
          <span aria-hidden className="absolute inset-y-0 left-0 w-[3px] bg-primary-solid" />
        )}
        <div className="flex min-w-0 items-center gap-1.5">
          <div className="truncate text-[15px] font-medium text-foreground">{lead.business}</div>
          {fresh && (
            <span
              title="Just arrived from admin"
              className="inline-flex shrink-0 items-center gap-1 rounded-full bg-primary-solid px-1.5 py-px text-[10px] font-semibold uppercase tracking-[0.08em] text-primary-foreground"
            >
              <span
                aria-hidden
                className="h-1 w-1 rounded-full bg-primary-foreground motion-safe:animate-notify-blink"
              />
              New
            </span>
          )}
        </div>
        <div className="mt-px truncate font-mono text-[12.5px] text-muted-foreground">
          {[lead.category, lead.location].filter(Boolean).join(" · ") || "—"}
        </div>
      </TableCell>

      {/* where the rep is up to */}
      <TableCell>
        <SalesStatusPill status={lead.status} />
      </TableCell>

      {/* how to reach them — phone leads, it's the money field */}
      <TableCell className="max-w-[220px]">
        {lead.phone ? (
          <a
            href={`tel:${lead.phone.replace(/[^0-9+]/g, "")}`}
            data-track="lead_call"
            data-track-lead={lead.id}
            className="tnum inline-flex items-center gap-1.5 font-mono text-[15px] font-semibold text-foreground transition-colors hover:text-primary"
          >
            <Phone className="h-4 w-4 shrink-0 text-primary" aria-hidden />
            {lead.phone}
          </a>
        ) : (
          <span className="font-mono text-[13.5px] text-muted-foreground/50">—</span>
        )}
        <div className="mt-0.5 flex min-w-0 items-center gap-2">
          {lead.email && (
            <a
              href={`mailto:${lead.email}`}
              data-track="lead_email"
              data-track-lead={lead.id}
              className="inline-flex min-w-0 items-center gap-1 truncate font-mono text-[12.5px] text-muted-foreground transition-colors hover:text-primary"
            >
              <Mail className="h-3.5 w-3.5 shrink-0" aria-hidden />
              <span className="truncate">{lead.email}</span>
            </a>
          )}
          {lead.website && (
            <a
              href={`https://${lead.website}`}
              target="_blank"
              rel="noreferrer"
              data-track="lead_website"
              data-track-lead={lead.id}
              aria-label={`Open ${lead.website}`}
              title={lead.website}
              className="shrink-0 text-muted-foreground transition-colors hover:text-primary"
            >
              <Globe className="h-3.5 w-3.5" aria-hidden />
            </a>
          )}
        </div>
      </TableCell>

      {/* has the outreach landed? */}
      <TableCell>
        {lead.engaged ? (
          <span className="inline-flex items-center gap-1.5 rounded-md border border-primary/40 px-1.5 py-0.5 font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-primary">
            <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
            Engaged
          </span>
        ) : (
          <span className="inline-flex items-center gap-1 font-mono text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground">
            Sent
            {(lead.emailsSent ?? 0) > 1 && <span className="tnum normal-case">×{lead.emailsSent}</span>}
          </span>
        )}
      </TableCell>

      {/* when ADMIN handed it over — what actually put it in this queue */}
      <TableCell
        className="tnum whitespace-nowrap font-mono text-[12.5px] text-muted-foreground"
        title={lead.emailSent ? `Last outreach email ${lead.emailSentAt}` : "No outreach email on record"}
      >
        {lead.receivedAt}
      </TableCell>

      {/* what it's worth */}
      <TableCell className="tnum whitespace-nowrap text-right font-mono text-[13.5px]">
        {lead.status === "closed_won" ? (
          <span className="font-semibold text-primary">{formatUsd(value ?? 0)}</span>
        ) : lead.status === "closed_lost" ? (
          <span className="text-muted-foreground">Lost</span>
        ) : value != null ? (
          <span className="text-foreground">{formatUsd(value)}</span>
        ) : (
          <span className="text-muted-foreground/50">—</span>
        )}
      </TableCell>

      {/* the same marks the card carries, compacted to icon buttons */}
      <TableCell className="text-right">
        <div className="flex items-center justify-end gap-1">
          {!closed ? (
            <>
              <Can perm="leads.contact">
                {lead.status === "new" ? (
                  <button
                    type="button"
                    onClick={() => onContacted(lead.id)}
                    aria-label={`Mark ${lead.business} contacted`}
                    title="Mark contacted"
                    data-track="lead_mark_contacted"
                    data-track-lead={lead.id}
                    className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Phone className="h-4 w-4" aria-hidden />
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => onRevert(lead.id)}
                    aria-label={`Undo contacted on ${lead.business}`}
                    title="Undo contacted"
                    data-track="lead_revert_status"
                    data-track-lead={lead.id}
                    className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
                  >
                    <Undo2 className="h-4 w-4" aria-hidden />
                  </button>
                )}
              </Can>
              <Can perm="leads.close">
                <button
                  type="button"
                  onClick={() => onRequestClose(lead.id)}
                  title="Close won"
                  data-track="lead_open_close_modal"
                  data-track-lead={lead.id}
                  className="inline-flex items-center gap-1.5 rounded-md bg-primary-solid px-2 py-1 text-[12.5px] font-semibold text-primary-foreground transition-colors hover:bg-primary-solid/90"
                >
                  <CircleCheck className="h-4 w-4" aria-hidden />
                  Closed
                </button>
                <button
                  type="button"
                  onClick={() => onLost(lead.id)}
                  aria-label={`Mark ${lead.business} lost`}
                  title="Mark lost"
                  data-track="lead_close_lost"
                  data-track-lead={lead.id}
                  className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground transition-colors hover:border-destructive/40 hover:text-destructive"
                >
                  <X className="h-4 w-4" aria-hidden />
                </button>
              </Can>
              {/* hand it back to admin — for leads we shouldn't be calling */}
              <button
                type="button"
                onClick={() => onRequestReturn(lead.id)}
                aria-label={`Return ${lead.business} to admin`}
                title="Return to admin"
                data-track="lead_open_return_modal"
                data-track-lead={lead.id}
                className="inline-flex items-center justify-center rounded-md border border-border bg-background p-2 text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Undo2 className="h-4 w-4" aria-hidden />
              </button>
            </>
          ) : (
            <Can perm="leads.close">
              <button
                type="button"
                onClick={() => onRevert(lead.id)}
                data-track="lead_revert_status"
                data-track-lead={lead.id}
                className="inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-3 py-1.5 text-[12.5px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
              >
                <Undo2 className="h-4 w-4" aria-hidden />
                {lead.status === "closed_won" ? "Reopen" : "Undo lost"}
              </button>
            </Can>
          )}
        </div>
      </TableCell>
    </TableRow>
  );
}

function LeadsTable({
  leads,
  freshIds,
  selected,
  onToggle,
  onToggleAll,
  onContacted,
  onLost,
  onRequestClose,
  onRequestReturn,
  onRevert,
}: {
  leads: SalesLead[];
  freshIds: ReadonlySet<string>;
  selected: ReadonlySet<string>;
  onToggle: (id: string) => void;
  onToggleAll: () => void;
  onContacted: (id: string) => void;
  onLost: (id: string) => void;
  onRequestClose: (id: string) => void;
  onRequestReturn: (id: string) => void;
  onRevert: (id: string) => void;
}) {
  // "All" means everything currently on screen (this page, after the status
  // filter) — never rows the rep can't see, which would make a bulk action
  // reach further than the tick box appears to promise.
  const allSelected = leads.length > 0 && leads.every((l) => selected.has(l.id));
  const someSelected = !allSelected && leads.some((l) => selected.has(l.id));

  return (
    <div className="min-w-0 overflow-x-auto rounded-xl bg-card ring-1 ring-foreground/10">
      <Table>
        <TableHeader>
          <TableRow className="hover:bg-transparent">
            <TableHead className="w-9">
              <input
                type="checkbox"
                checked={allSelected}
                // Half-filled when it's a partial selection, so the box tells
                // the truth about the three states instead of just two.
                ref={(el) => {
                  if (el) el.indeterminate = someSelected;
                }}
                onChange={onToggleAll}
                aria-label={allSelected ? "Clear selection" : "Select all leads on this page"}
                title={allSelected ? "Clear selection" : "Select all on this page"}
                className="h-4 w-4 cursor-pointer accent-primary align-middle"
              />
            </TableHead>
            <TableHead className="text-[13.5px]">Business</TableHead>
            <TableHead className="text-[13.5px]">Status</TableHead>
            <TableHead className="text-[13.5px]">Contact</TableHead>
            <TableHead className="text-[13.5px]">Outreach</TableHead>
            <TableHead className="text-[13.5px]">Received</TableHead>
            <TableHead className="text-right text-[13.5px]">Value</TableHead>
            <TableHead className="text-right text-[13.5px]">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {leads.map((lead) => (
            <LeadRow
              key={lead.id}
              lead={lead}
              fresh={freshIds.has(lead.id)}
              selected={selected.has(lead.id)}
              onToggle={onToggle}
              onContacted={onContacted}
              onLost={onLost}
              onRequestClose={onRequestClose}
              onRequestReturn={onRequestReturn}
              onRevert={onRevert}
            />
          ))}
        </TableBody>
      </Table>
    </div>
  );
}

/** Pulsing placeholder rows while a queue page loads in table view. */
function TableSkeleton() {
  return (
    <div className="overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10" aria-busy="true">
      <div className="divide-y divide-border">
        {Array.from({ length: 8 }, (_, i) => (
          <div key={i} className="flex items-center gap-3 px-4 py-3.5">
            <div className="h-3 w-44 animate-pulse rounded bg-muted" />
            <div className="h-3 w-16 animate-pulse rounded bg-muted" />
            <div className="ml-auto h-3 w-28 animate-pulse rounded bg-muted" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Pulsing placeholder card while a queue page loads. */
function CardSkeleton() {
  return (
    <div className="h-[220px] animate-pulse rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <div className="h-4 w-2/3 rounded bg-muted" />
      <div className="mt-2 h-3 w-1/2 rounded bg-muted" />
      <div className="mt-5 h-[72px] rounded-lg bg-muted/60" />
      <div className="mt-4 h-3 w-1/3 rounded bg-muted" />
    </div>
  );
}

export function SalesPage() {
  const {
    leads,
    stats,
    total,
    page,
    pageCount,
    loading,
    mode,
    error,
    needsMigration,
    arrivals,
    freshIds,
    acknowledgeArrivals,
    setPage,
    reload,
    markContacted,
    markLost,
    closeDeal,
    returnLeads,
    revertStatus,
  } = useSales();
  const [filter, setFilter] = useState<SalesStatus | "all">("all");
  const [closingId, setClosingId] = useState<string | null>(null);
  /** Leads queued for the return modal — one from a row button, or the whole
   *  tick-box selection. Empty means the modal is closed. */
  const [returningIds, setReturningIds] = useState<string[]>([]);
  const [returnBusy, setReturnBusy] = useState(false);
  const [returnError, setReturnError] = useState<string | null>(null);
  /** Tick-box selection, table view only. */
  const [selected, setSelected] = useState<ReadonlySet<string>>(EMPTY_SELECTION);
  const reduce = !!useReducedMotion();
  // Table is the default working layout; cards are the opt-in. Hydrated after
  // mount (never during render) so the server and first client pass agree.
  const [view, setView] = useState<ViewMode>("table");
  useEffect(() => {
    const saved = window.localStorage.getItem(VIEW_STORAGE);
    if (saved === "cards" || saved === "table") setView(saved);
  }, []);
  function chooseView(next: ViewMode) {
    setView(next);
    try {
      window.localStorage.setItem(VIEW_STORAGE, next);
    } catch {
      /* storage unavailable — the choice just won't survive a reload */
    }
  }

  const visible = useMemo(
    () => (filter === "all" ? leads : leads.filter((l) => l.status === filter)),
    [leads, filter],
  );
  const closingLead = closingId ? leads.find((l) => l.id === closingId) ?? null : null;
  const returningLeads = returningIds
    .map((id) => leads.find((l) => l.id === id))
    .filter((l): l is SalesLead => !!l);
  const initialLoad = loading && leads.length === 0;

  // Drop anything that has left the view — a page turn, a filter change, or a
  // lead being returned out from under the selection. Without this the bulk
  // action could reach rows the rep can no longer see.
  useEffect(() => {
    setSelected((prev) => {
      if (prev.size === 0) return prev;
      const onScreen = new Set(visible.map((l) => l.id));
      const next = new Set([...prev].filter((id) => onScreen.has(id)));
      return next.size === prev.size ? prev : next;
    });
  }, [visible]);

  const selectedLeads = visible.filter((l) => selected.has(l.id));

  function toggleOne(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function toggleAll() {
    setSelected((prev) =>
      visible.length > 0 && visible.every((l) => prev.has(l.id))
        ? EMPTY_SELECTION
        : new Set(visible.map((l) => l.id)),
    );
  }

  function openReturn(id: string) {
    setReturnError(null);
    setReturningIds([id]);
  }

  function openBulkReturn() {
    if (selected.size === 0) return;
    setReturnError(null);
    setReturningIds(selectedLeads.map((l) => l.id));
  }

  async function confirmReturn(note: string) {
    if (returningIds.length === 0) return;
    setReturnBusy(true);
    const err = await returnLeads(returningIds, note);
    setReturnBusy(false);
    if (err) {
      setReturnError(err);
      return;
    }
    // They're gone from the queue, so they can't stay selected.
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of returningIds) next.delete(id);
      return next;
    });
    setReturningIds([]);
  }

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      {/* header */}
      <Reveal className="mb-5" y={6}>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
          <div>
            <div className="font-mono text-[11.5px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              Sales desk
            </div>
            <h1 className="mt-1 text-lg font-semibold tracking-tight text-foreground sm:text-2xl">
              Your qualified queue
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              Leads admin has reviewed and handed over land here, newest first — ready to call. ·{" "}
              <span className="text-foreground/80">{SALES_REP}</span>
            </p>
          </div>
          <div className="flex items-center gap-2">
            {/* The desk is listening. The LED pulses whenever the queue is live;
                the label switches to the arrival count the moment admin sends
                something, so "is anything coming?" is answerable at a glance. */}
            <div
              className={cn(
                "inline-flex items-center gap-2 rounded-md border px-2.5 py-1.5 transition-colors",
                arrivals > 0
                  ? "border-primary/40 bg-primary/10"
                  : "border-border bg-background/60",
              )}
            >
              <SignalLed live={!error} />
              <span
                aria-live="polite"
                className={cn(
                  "font-mono text-[11px] uppercase tracking-[0.14em]",
                  arrivals > 0 ? "font-semibold text-primary" : "text-muted-foreground",
                )}
              >
                {error
                  ? "offline"
                  : arrivals > 0
                    ? `${formatInt(arrivals)} new`
                    : "listening"}
              </span>
            </div>
            {mode === "demo" && (
              <div className="inline-flex items-center gap-1 rounded border border-border bg-background/60 px-2 py-1 font-mono text-[11px] uppercase tracking-[0.14em] text-muted-foreground">
                demo mode
              </div>
            )}
          </div>
        </div>
      </Reveal>

      {/* score tally */}
      <Reveal delay={0.04}>
        <div className="grid grid-cols-2 divide-border overflow-hidden rounded-xl bg-card ring-1 ring-foreground/10 sm:flex sm:divide-x [&>*]:border-border [&>:nth-child(-n+2)]:border-b sm:[&>*]:border-b-0 [&>:nth-child(odd)]:border-r sm:[&>:nth-child(odd)]:border-r">
          <Stat label="Open in queue" value={String(stats.open)} />
          <Stat label="Engaged" value={String(stats.engaged)} accent />
          <Stat label="Closed" value={String(stats.won)} />
          <Stat label="Closed value · 30d" value={formatUsd(stats.wonValue)} accent />
        </div>
      </Reveal>

      {/* Arrivals from admin. Only present when there's something new, and it
          animates in so it's caught out of the corner of the eye — then takes
          the rep straight to the top of the queue where the new leads are. */}
      <AnimatePresence initial={false}>
        {arrivals > 0 && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -8, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -8, height: 0 }}
            transition={{ duration: reduce ? 0 : 0.28, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/[0.07] px-4 py-3">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary-solid text-primary-foreground motion-safe:animate-notify-blink">
                <Inbox className="h-4 w-4" aria-hidden />
              </span>
              <p className="min-w-0 flex-1 text-[14px] text-foreground">
                <span className="tnum font-semibold">{formatInt(arrivals)}</span>{" "}
                {arrivals === 1 ? "new lead" : "new leads"} just came through from admin.
              </p>
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={() => {
                    setPage(1);
                    acknowledgeArrivals();
                  }}
                  data-track="sales_arrivals_show"
                  className="gap-1.5 bg-primary-solid text-primary-foreground hover:bg-primary-solid/90"
                >
                  Show me
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={acknowledgeArrivals}
                  data-track="sales_arrivals_dismiss"
                >
                  Dismiss
                </Button>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Selection bar — only exists while something is ticked, so the desk
          stays uncluttered the rest of the time. Sits above the table it acts
          on, and states the count in words as well as in the button. */}
      <AnimatePresence initial={false}>
        {view === "table" && selected.size > 0 && (
          <motion.div
            initial={reduce ? { opacity: 0 } : { opacity: 0, y: -6, height: 0 }}
            animate={reduce ? { opacity: 1 } : { opacity: 1, y: 0, height: "auto" }}
            exit={reduce ? { opacity: 0 } : { opacity: 0, y: -6, height: 0 }}
            transition={{ duration: reduce ? 0 : 0.22, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div className="mt-3 flex flex-wrap items-center gap-3 rounded-xl border border-primary/40 bg-primary/[0.06] px-4 py-2.5">
              <span className="text-[14px] text-foreground">
                <span className="tnum font-semibold">{formatInt(selected.size)}</span>{" "}
                {selected.size === 1 ? "lead" : "leads"} selected
              </span>
              <button
                type="button"
                onClick={() => setSelected(EMPTY_SELECTION)}
                data-track="sales_selection_clear"
                className="text-[12.5px] font-medium text-muted-foreground underline-offset-2 transition-colors hover:text-foreground hover:underline"
              >
                Clear
              </button>
              <div className="ml-auto flex items-center gap-2">
                <Can perm="leads.contact">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={openBulkReturn}
                    data-track="sales_bulk_return"
                    className="gap-1.5"
                  >
                    <Undo2 className="h-4 w-4" aria-hidden />
                    Return {formatInt(selected.size)} to admin
                  </Button>
                </Can>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* filter + layout */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Filter leads by status">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              data-track="sales_filter"
              data-track-status={f.id}
              onClick={() => setFilter(f.id)}
              aria-pressed={filter === f.id}
              className={cn(
                "rounded-md border px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.1em] transition-colors",
                filter === f.id
                  ? "border-primary/40 bg-primary/10 text-foreground"
                  : "border-border bg-background text-muted-foreground hover:text-foreground",
              )}
            >
              {f.label}
            </button>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-1.5" role="group" aria-label="Queue layout">
          {VIEWS.map((v) => {
            const Icon = v.icon;
            return (
              <button
                key={v.id}
                type="button"
                data-track="sales_view"
                data-track-view={v.id}
                onClick={() => chooseView(v.id)}
                aria-pressed={view === v.id}
                title={`${v.label} view`}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 font-mono text-[11.5px] uppercase tracking-[0.1em] transition-colors",
                  view === v.id
                    ? "border-primary/40 bg-primary/10 text-foreground"
                    : "border-border bg-background text-muted-foreground hover:text-foreground",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden />
                {v.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* queue */}
      {error ? (
        <div className="mt-3 flex flex-1 flex-col items-center justify-center gap-3 rounded-xl border border-destructive/30 bg-card py-16 text-center ring-1 ring-foreground/10">
          <p className="text-base font-semibold text-foreground">Couldn&rsquo;t load the queue</p>
          <p role="alert" className="max-w-md font-mono text-[12.5px] leading-relaxed text-muted-foreground">
            {error}
          </p>
          <Button variant="outline" size="sm" onClick={reload} data-track="sales_retry" className="gap-1.5">
            <RefreshCw className="h-4 w-4" aria-hidden />
            Retry
          </Button>
        </div>
      ) : initialLoad ? (
        <div className="mt-3">
          {view === "table" ? (
            <TableSkeleton />
          ) : (
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3" aria-busy="true">
              {Array.from({ length: 6 }, (_, i) => (
                <CardSkeleton key={i} />
              ))}
            </div>
          )}
        </div>
      ) : visible.length === 0 ? (
        <div className="mt-3 flex flex-1 items-center justify-center rounded-xl border border-dashed border-border py-16 text-center">
          <div className="max-w-md">
            <p className="text-base font-semibold text-foreground">
              {total === 0 ? "Nothing handed over yet" : "No leads here"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {total === 0
                ? needsMigration
                  ? "The hand-off ledger isn't set up yet — run supabase/portal-telemetry.sql, then send leads over from the Hot Leads tab."
                  : "Leads reach this queue when an admin sends them over from the Hot Leads tab — being emailed isn't enough on its own."
                : "Nothing matches this filter on this page."}
            </p>
          </div>
        </div>
      ) : view === "table" ? (
        <div className={cn("mt-3", loading && "opacity-60")} aria-busy={loading || undefined}>
          <Reveal delay={0.06}>
            <LeadsTable
              leads={visible}
              freshIds={freshIds}
              selected={selected}
              onToggle={toggleOne}
              onToggleAll={toggleAll}
              onContacted={markContacted}
              onLost={markLost}
              onRequestClose={setClosingId}
              onRequestReturn={openReturn}
              onRevert={revertStatus}
            />
          </Reveal>
        </div>
      ) : (
        <div
          className={cn("mt-3 grid grid-cols-1 gap-3 lg:grid-cols-2 xl:grid-cols-3", loading && "opacity-60")}
          aria-busy={loading || undefined}
        >
          {visible.map((lead, i) => (
            <Reveal key={lead.id} delay={0.06 + 0.03 * i} className="h-full">
              <LeadCard
                lead={lead}
                fresh={freshIds.has(lead.id)}
                onContacted={markContacted}
                onLost={markLost}
                onRequestClose={setClosingId}
                onRequestReturn={openReturn}
                onRevert={revertStatus}
              />
            </Reveal>
          ))}
        </div>
      )}

      {/* pagination — server-side pages, so the queue stays fast at any size */}
      {!error && total > 0 && (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
          <span className="tnum font-mono text-[12.5px] text-muted-foreground">
            Page {page} of {pageCount} · {formatInt(total)} {total === 1 ? "lead" : "leads"} in queue
          </span>
          {pageCount > 1 && (
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => setPage(page - 1)}
                disabled={page <= 1 || loading}
                data-track="sales_page_prev"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <ChevronLeft className="h-4 w-4" aria-hidden />
                Prev
              </button>
              <button
                type="button"
                onClick={() => setPage(page + 1)}
                disabled={page >= pageCount || loading}
                data-track="sales_page_next"
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-3 py-1.5 font-mono text-[12.5px] text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                Next
                <ChevronRight className="h-4 w-4" aria-hidden />
              </button>
            </div>
          )}
        </div>
      )}

      <Footer />

      <CloseDealModal
        lead={closingLead}
        onCancel={() => setClosingId(null)}
        onConfirm={(input) => {
          if (closingId) closeDeal(closingId, input);
          setClosingId(null);
        }}
      />

      <ReturnLeadModal
        leads={returningLeads}
        busy={returnBusy}
        error={returnError}
        onCancel={() => {
          if (returnBusy) return;
          setReturningIds([]);
          setReturnError(null);
        }}
        onConfirm={(note) => void confirmReturn(note)}
      />
    </div>
  );
}
