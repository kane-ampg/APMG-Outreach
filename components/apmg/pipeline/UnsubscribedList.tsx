"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { AlertTriangle, Ban, Lock, RotateCcw, Search } from "lucide-react";
import { cn } from "@/lib/cn";
import { formatInt } from "@/lib/format";
import { adminHeaders, saveAdminKey } from "@/lib/portal/adminKey";
import type { UnsubscribedPerson } from "@/lib/data/leadActivity";
import { Button } from "@/components/ui/button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Reveal } from "../Reveal";

/**
 * Pipeline → Unsubscribed. The opt-out list, sitting next to the tab that sends
 * the email — this is the one audience the send route will never mail again, and
 * an operator picking a batch should not have to cross to System → Telemetry to
 * see who is on it.
 *
 * It READS the same payload the Telemetry tab does (GET /api/portal/lead-activity
 * → `unsubscribes`) rather than owning a second query. One endpoint, two render
 * sites: the two lists can never disagree about who opted out.
 *
 * Same shared-secret gate as the other admin reads (x-portal-admin-key, parked in
 * localStorage by whichever tab asked first), so a 401 here shows the same unlock
 * field rather than an error.
 *
 * Three states are kept apart on purpose, because on a compliance surface they
 * point at different fixes: an empty-and-readable list ("nobody has
 * unsubscribed"), a table that could not be read (email_suppression has its OWN
 * migration, supabase/unsubscribe.sql), and an API that predates the opt-out
 * fields entirely (needs a deploy). None of them is a zero.
 */

type Phase = "loading" | "ready" | "locked" | "error";

/** Why the list is not showing. "missing-field" and "unreadable" are separated
 *  because they point at different fixes: an API that predates the opt-out
 *  fields needs a deploy, an unreadable table needs a migration. Guessing wrong
 *  on a compliance surface sends someone to the wrong place. */
type Unavailable = "none" | "missing-field" | "unreadable";

export function UnsubscribedList() {
  const reduce = !!useReducedMotion();
  const [phase, setPhase] = useState<Phase>("loading");
  const [people, setPeople] = useState<UnsubscribedPerson[]>([]);
  const [total, setTotal] = useState(0);
  const [unavailable, setUnavailable] = useState<Unavailable>("none");
  const [keyInput, setKeyInput] = useState("");
  const [query, setQuery] = useState("");
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async (manual = false) => {
    if (manual) setRefreshing(true);
    try {
      const res = await fetch("/api/portal/lead-activity", { cache: "no-store", headers: adminHeaders() });
      if (res.status === 401) {
        setPhase("locked");
        return;
      }
      const data = (await res.json().catch(() => null)) as
        | { unsubscribes?: unknown; unsubscribesTotal?: unknown; unsubscribesAvailable?: unknown }
        | null;
      if (!res.ok || !data) {
        setPhase("error");
        return;
      }
      const rows = (Array.isArray(data.unsubscribes) ? data.unsubscribes : []) as UnsubscribedPerson[];
      setPeople(rows);
      setTotal(
        typeof data.unsubscribesTotal === "number"
          ? Math.max(data.unsubscribesTotal, rows.length)
          : rows.length,
      );
      // Absent (an API that predates the opt-out fields) is NOT the same as
      // present-and-false (the table could not be read). Never a zero either way.
      setUnavailable(
        !("unsubscribesAvailable" in data)
          ? "missing-field"
          : data.unsubscribesAvailable === true
            ? "none"
            : "unreadable",
      );
      setPhase("ready");
    } catch {
      setPhase("error");
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter(
      (p) =>
        p.email.toLowerCase().includes(q) ||
        (p.business ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q) ||
        (p.campaign ?? "").toLowerCase().includes(q),
    );
  }, [people, query]);

  return (
    <div className="flex min-h-full flex-col gap-4 px-4 py-5 sm:px-6">
      <Reveal y={6}>
        <div className="flex flex-wrap items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-border bg-background/60 text-muted-foreground">
            <Ban className="h-4 w-4" aria-hidden />
          </span>
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-foreground">Unsubscribed</h2>
            <p className="text-[12px] text-muted-foreground">
              Everyone who has opted out. The send route drops these addresses — and any other address at
              the same organisation — before a campaign is built.
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {phase === "ready" && unavailable === "none" && (
              <span className="rounded-md border border-border bg-background/60 px-2.5 py-1 font-mono text-[11.5px] text-muted-foreground">
                {formatInt(total)} on the list
              </span>
            )}
            <Button
              variant="outline"
              size="sm"
              className="gap-1.5"
              data-track="pipeline_unsub_refresh"
              disabled={refreshing || phase === "locked"}
              onClick={() => void load(true)}
            >
              <RotateCcw className={cn("h-3.5 w-3.5", refreshing && !reduce && "animate-spin")} aria-hidden />
              Refresh
            </Button>
          </div>
        </div>
      </Reveal>

      {phase === "locked" && (
        <UnlockCard
          value={keyInput}
          onChange={setKeyInput}
          onSubmit={() => {
            const k = keyInput.trim();
            if (!k) return;
            saveAdminKey(k);
            setKeyInput("");
            setPhase("loading");
            void load();
          }}
        />
      )}

      {phase === "error" && (
        <Notice tone="error" title="The opt-out list could not be loaded">
          The lead-activity endpoint did not answer. This surface only reads — nothing was sent or changed.
        </Notice>
      )}

      {phase === "ready" && unavailable === "unreadable" && (
        <Notice tone="error" title="The opt-out list could not be read">
          <code className="font-mono text-[11.5px]">email_suppression</code> has its own migration. Run{" "}
          <code className="font-mono text-[11.5px]">supabase/unsubscribe.sql</code> — until then this is an
          unknown rather than a zero, and the send route&apos;s suppression check is failing open.
        </Notice>
      )}

      {phase === "ready" && unavailable === "missing-field" && (
        <Notice tone="error" title="This build of the API does not return the opt-out list">
          <code className="font-mono text-[11.5px]">/api/portal/lead-activity</code> answered without the
          <code className="font-mono text-[11.5px]"> unsubscribes</code> fields, so there is nothing to show
          here yet — the list itself is fine. Deploy the lead-activity change and this fills in.
        </Notice>
      )}

      {phase === "ready" && unavailable === "none" && people.length === 0 && (
        <Notice tone="quiet" title="Nobody has unsubscribed yet">
          The list is empty and readable. Every outreach email still carries a working opt-out.
        </Notice>
      )}

      {phase === "ready" && unavailable === "none" && people.length > 0 && (
        <>
          <Reveal y={6} delay={0.04}>
            <label className="relative block max-w-sm">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
                aria-hidden
              />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Filter by address, business, sector or campaign"
                aria-label="Filter the opt-out list"
                data-track="pipeline_unsub_filter"
                className="w-full rounded-md border border-border bg-background/60 py-1.5 pl-8 pr-3 text-[12.5px] text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              />
            </label>
          </Reveal>

          <motion.div
            initial={reduce ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: reduce ? 0 : 0.26, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden rounded-lg border border-border"
          >
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="text-[12px]">Address</TableHead>
                    <TableHead className="text-[12px]">Business</TableHead>
                    <TableHead className="text-[12px]">Sector</TableHead>
                    <TableHead className="text-[12px]">Campaign</TableHead>
                    <TableHead className="text-[12px]">Opted out</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {shown.map((p) => (
                    <TableRow key={p.email}>
                      <TableCell className="font-mono text-[11.5px] text-foreground">
                        {p.email}
                        {/* Every self-service opt-out reads "unsubscribe". A
                            bounce-policy row was put there by hand and means
                            something different to whoever reads this list. */}
                        {p.reason !== "unsubscribe" && (
                          <span className="ml-2 rounded border border-amber-500/40 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
                            {p.reason}
                          </span>
                        )}
                      </TableCell>
                      <TableCell className="text-[12px] text-foreground">
                        {p.business ?? <span className="text-muted-foreground">—</span>}
                      </TableCell>
                      <TableCell className="text-[12px] text-muted-foreground">{p.category ?? "—"}</TableCell>
                      <TableCell className="font-mono text-[11px] text-muted-foreground">
                        {p.campaign ?? "—"}
                      </TableCell>
                      <TableCell className="whitespace-nowrap text-[12px] text-muted-foreground">
                        {formatWhen(p.createdAt)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </motion.div>

          {shown.length === 0 && (
            <p className="text-[12px] text-muted-foreground">
              Nothing on the opt-out list matches that filter.
            </p>
          )}
          {total > people.length && (
            <p className="text-[11.5px] text-muted-foreground">
              Showing the {formatInt(people.length)} most recent of {formatInt(total)}.
            </p>
          )}
        </>
      )}
    </div>
  );
}

/** Local dates — "who opted out and when" is read against a send day. */
function formatWhen(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });
}

function Notice({
  tone,
  title,
  children,
}: {
  tone: "error" | "quiet";
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div
      className={cn(
        "flex items-start gap-3 rounded-lg border px-3 py-2.5",
        tone === "error" ? "border-destructive/30 bg-destructive/[0.06]" : "border-border bg-background/40",
      )}
    >
      <AlertTriangle
        className={cn("mt-0.5 h-4 w-4 shrink-0", tone === "error" ? "text-destructive" : "text-muted-foreground")}
        aria-hidden
      />
      <div className="min-w-0">
        <div className="text-[13px] font-semibold text-foreground">{title}</div>
        <p className="text-[12px] leading-relaxed text-muted-foreground">{children}</p>
      </div>
    </div>
  );
}

function UnlockCard({
  value,
  onChange,
  onSubmit,
}: {
  value: string;
  onChange: (v: string) => void;
  onSubmit: () => void;
}) {
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit();
      }}
      className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-background/40 px-3 py-2.5"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border border-border text-muted-foreground">
        <Lock className="h-4 w-4" aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="text-[13px] font-semibold text-foreground">Access key required</div>
        <p className="text-[12px] text-muted-foreground">
          The opt-out list names real people, so it sits behind the same key as Enquiries and Telemetry.
          Unlocking here unlocks all three.
        </p>
      </div>
      <input
        type="password"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="PORTAL_ADMIN_KEY"
        aria-label="Portal admin access key"
        className="w-48 rounded-md border border-border bg-background px-2.5 py-1.5 font-mono text-[12px] text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      />
      <Button type="submit" size="sm" data-track="pipeline_unsub_unlock" disabled={!value.trim()}>
        Unlock
      </Button>
    </form>
  );
}
