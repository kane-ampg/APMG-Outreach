"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, FileDown, FileSpreadsheet, FileText, Printer } from "lucide-react";
import { cn } from "@/lib/cn";
import {
  exportLeadsCsv,
  exportLeadsPdf,
  exportLeadsXlsx,
  leadFolderCount,
} from "@/lib/pipeline/leadExport";
import type { LeadView } from "./LeadsTable";

/**
 * "Export" popover for the leads toolbar — CSV, XLSX or PDF. The parent passes
 * in the rows already scoped to what's on screen (the open folder, the search
 * filter, and any checkbox selection), so the export always matches the view.
 * Styling mirrors the Telemetry "Export PDF" popover (ui-standards §7).
 */
export function LeadsExportMenu({
  rows,
  scope,
  selectionCount = 0,
}: {
  /** Rows to export — already folder-scoped / filtered / selection-narrowed. */
  rows: LeadView[];
  /** Human label for the scope (folder name or "All leads") — drives filenames + PDF title. */
  scope: string;
  /** How many rows are checkbox-selected (0 = exporting everything shown). */
  selectionCount?: number;
}) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // close on outside click / Escape
  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const count = rows.length;
  // >1 folder in scope → the workbook splits into one sheet per folder
  const folders = leadFolderCount(rows);
  const multiFolder = folders > 1;
  const scopeHint =
    selectionCount > 0
      ? `${count.toLocaleString("en-US")} selected lead${count === 1 ? "" : "s"}${
          multiFolder ? ` · ${folders} folders` : ""
        }`
      : `${count.toLocaleString("en-US")} lead${count === 1 ? "" : "s"} · ${
          multiFolder ? `${folders} folders` : scope
        }`;

  function run(kind: "csv" | "xlsx" | "pdf") {
    setError(null);
    if (kind === "csv") exportLeadsCsv(rows, scope);
    else if (kind === "xlsx") exportLeadsXlsx(rows, scope);
    else if (!exportLeadsPdf(rows, scope)) {
      setError("Your browser blocked the print window — allow pop-ups for this site.");
      return;
    }
    setOpen(false);
  }

  const items: { kind: "csv" | "xlsx" | "pdf"; label: string; hint: string; icon: typeof FileText }[] = [
    {
      kind: "csv",
      label: "CSV",
      hint: multiFolder ? "Every field — grouped by folder" : "Every field — spreadsheets, imports",
      icon: FileText,
    },
    {
      kind: "xlsx",
      label: "Excel (XLSX)",
      hint: multiFolder ? "One sheet per folder — every field" : "Every field — formatted workbook",
      icon: FileSpreadsheet,
    },
    {
      kind: "pdf",
      label: "PDF",
      hint: multiFolder ? "Print-ready — split by folder" : "Print-ready summary table",
      icon: Printer,
    },
  ];

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => {
          setError(null);
          setOpen((v) => !v);
        }}
        disabled={count === 0}
        aria-expanded={open}
        aria-haspopup="menu"
        data-track="leads_export_open"
        className={cn(
          "inline-flex items-center gap-1.5 rounded-md border border-border bg-background px-2.5 py-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground",
          count === 0 && "cursor-not-allowed opacity-50 hover:border-border hover:text-muted-foreground",
        )}
      >
        <FileDown className="h-3.5 w-3.5" aria-hidden />
        Export
        <ChevronDown
          className={cn("h-3 w-3 transition-transform duration-200 ease-out", open && "rotate-180")}
          aria-hidden
        />
      </button>

      {/* Kept mounted so the close animates too (see `.apmg-menu` in
          globals.css) — `aria-hidden` is belt-and-braces on top of the
          visibility:hidden that already hides it from AT. */}
      <div
        role="menu"
        aria-label="Export leads"
        aria-hidden={!open}
        data-open={open}
        className="apmg-menu apmg-menu-end absolute right-0 top-full z-40 mt-2 w-[17.5rem] rounded-xl border border-border bg-card p-2 shadow-lg ring-1 ring-foreground/10"
      >
        <div className="px-2 pb-1.5 pt-1">
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Export leads
          </div>
          <div className="mt-0.5 break-words font-mono text-[10.5px] leading-snug text-muted-foreground">
            {scopeHint}
          </div>
        </div>
        <div className="flex flex-col gap-0.5">
          {items.map((item) => (
            <button
              key={item.kind}
              type="button"
              role="menuitem"
              tabIndex={open ? 0 : -1}
              onClick={() => run(item.kind)}
              data-track={`leads_export_${item.kind}`}
              className="group flex w-full items-start gap-2.5 rounded-lg px-2 py-2 text-left transition-colors hover:bg-muted"
            >
              <span className="mt-px flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors group-hover:border-primary/40 group-hover:text-primary">
                <item.icon className="h-3.5 w-3.5" aria-hidden />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-foreground">{item.label}</span>
                {/* wraps rather than truncating — the folder-split hints are
                    longer than any fixed panel width can hold on one line */}
                <span className="mt-0.5 block break-words text-[10.5px] leading-snug text-muted-foreground">
                  {item.hint}
                </span>
              </span>
            </button>
          ))}
        </div>
        {error && (
          <p role="alert" className="px-2 pb-1 pt-1.5 font-mono text-[10.5px] leading-relaxed text-destructive">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
