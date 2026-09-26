"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, MailPlus, RefreshCw, Reply, Send, SkipForward, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Can } from "@/components/rbac/Can";
import { serviceName } from "@/lib/data/leadActivity";
import { useFollowUps } from "@/lib/followups/useFollowUps";
import { MAX_DRAFT_ALL, type FollowUpQueueItem } from "@/lib/followups/types";
import { mentionsTracking } from "@/lib/followups/wording";
import { htmlToText } from "@/lib/pipeline/campaign";
import { Footer } from "./Footer";
import { Reveal } from "./Reveal";

/**
 * Follow-Ups — hot leads (score 66+, i.e. opened a service) get up to two
 * Claude-written emails about the service they opened, each approved here
 * before it leaves. Email first, then Sales: a finished sequence shows as
 * "Ready for Sales" on Hot Leads. See the spec:
 * docs/superpowers/specs/2026-09-25-hot-lead-follow-up-design.md
 */

function Chip({
  children,
  tone = "muted",
  wrap = false,
}: {
  children: ReactNode;
  tone?: "muted" | "primary" | "warn";
  /** a sentence rather than a label: it may wrap, so square the corners off */
  wrap?: boolean;
}) {
  const cls =
    tone === "primary"
      ? "border-primary/40 bg-primary/10 text-primary"
      : tone === "warn"
        ? "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400"
        : "border-border bg-background text-muted-foreground";
  const shape = wrap ? "rounded-md py-0.5" : "rounded-full py-px";
  return <span className={`inline-flex items-center gap-1 border px-2 text-[10.5px] font-medium ${shape} ${cls}`}>{children}</span>;
}

function LeadHeader({ item }: { item: FollowUpQueueItem }) {
  // a draft names the service it is actually about (touch 2 keeps touch 1's)
  const service = item.draft?.service_slug ?? item.service;
  return (
    <div className="min-w-0">
      <div className="truncate text-[14px] font-semibold text-foreground">{item.business ?? "Unnamed lead"}</div>
      <div className="mt-1 flex flex-wrap items-center gap-1.5">
        {service && <Chip tone="primary">{serviceName(service)}</Chip>}
        <Chip>score {item.score}</Chip>
        {item.touch && <Chip>touch {item.touch} of 2</Chip>}
        {item.likelyScanner && (
          <Chip tone="warn">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            likely scanner ({item.scannerGapSeconds}s after delivery)
          </Chip>
        )}
        {item.clientWarning && (
          <Chip tone="warn">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Reads like client {item.clientWarning}, check before sending
          </Chip>
        )}
        {item.email && <span className="truncate font-mono text-[10.5px] text-muted-foreground">{item.email}</span>}
      </div>
    </div>
  );
}

function DraftCard({
  item,
  busy,
  locked,
  onSave,
  onSend,
  onRedraft,
  onSkip,
  onReplied,
  onDirtyChange,
}: {
  item: FollowUpQueueItem;
  /** this lead has an action in flight */
  busy: boolean;
  /** ANY lead has an action in flight: every mutating control is off */
  locked: boolean;
  onSave: (subject: string, body: string) => Promise<boolean>;
  onSend: () => void;
  onRedraft: () => void;
  onSkip: () => void;
  onReplied: () => void;
  onDirtyChange: (draftId: string, dirty: boolean) => void;
}) {
  const draft = item.draft!;
  const [subject, setSubject] = useState(draft.subject ?? "");
  const [body, setBody] = useState(draft.body_html ?? "");
  const dirty = subject !== (draft.subject ?? "") || body !== (draft.body_html ?? "");
  const preview = useMemo(() => htmlToText(body.replace(/\{\{link\}\}/g, "https://…")), [body]);
  // The prompt forbids it, but a model can still slip: a human gets the last look.
  const tracking = useMemo(() => mentionsTracking(`${subject}\n${htmlToText(body)}`), [subject, body]);

  // "Send all" lives outside this card and can't see its local `dirty` state
  // otherwise — report it up so an unsaved edit can't be mailed as the stale
  // pre-edit copy. Cleanup reports false so a card that disappears (sent, or
  // replaced by a refresh) can't leave a stale entry in the parent's set.
  useEffect(() => {
    onDirtyChange(draft.id, dirty);
    return () => onDirtyChange(draft.id, false);
  }, [draft.id, dirty, onDirtyChange]);

  return (
    <li className="rounded-xl bg-card p-4 ring-1 ring-foreground/10">
      <LeadHeader item={item} />
      {tracking && (
        <div className="mt-2">
          <Chip tone="warn">
            <AlertTriangle className="h-3 w-3" aria-hidden />
            Check wording: may mention tracking
          </Chip>
        </div>
      )}
      <label className="mt-3 block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Subject</label>
      <input
        value={subject}
        onChange={(e) => setSubject(e.target.value)}
        className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 text-sm"
      />
      <div className="mt-3 grid gap-3 lg:grid-cols-2">
        <div>
          <label className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Body (HTML, keep the {"{{link}}"} button)</label>
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={10}
            className="mt-1 w-full rounded-md border border-input bg-background px-2.5 py-1.5 font-mono text-xs"
          />
        </div>
        <div>
          <div className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">As sent (plain text)</div>
          <pre className="mt-1 max-h-60 overflow-auto whitespace-pre-wrap rounded-md bg-muted/40 p-2.5 text-xs text-foreground">{preview}</pre>
        </div>
      </div>
      <Can perm="followups.send">
        <div className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <Button variant="ghost" size="sm" disabled={locked} onClick={onSkip} className="gap-1.5">
            <SkipForward className="h-3.5 w-3.5" aria-hidden /> Skip
          </Button>
          <Button variant="ghost" size="sm" disabled={locked} onClick={onReplied} className="gap-1.5">
            <Reply className="h-3.5 w-3.5" aria-hidden /> Replied
          </Button>
          <Button variant="outline" size="sm" disabled={locked} onClick={onRedraft} className="gap-1.5">
            <Sparkles className="h-3.5 w-3.5" aria-hidden /> Redraft
          </Button>
          {dirty && (
            <Button variant="outline" size="sm" disabled={locked} onClick={() => void onSave(subject, body)}>
              Save edits
            </Button>
          )}
          <Button
            size="sm"
            disabled={locked || dirty || !subject.trim() || !body.trim()}
            title={dirty ? "Save your edits first" : undefined}
            onClick={onSend}
            className="gap-1.5"
          >
            <Send className="h-3.5 w-3.5" aria-hidden /> {busy ? "Working…" : "Approve & send"}
          </Button>
        </div>
      </Can>
    </li>
  );
}

function Section({ title, count, children, action }: { title: string; count: number; children: ReactNode; action?: ReactNode }) {
  return (
    <section className="mt-6">
      <div className="mb-2 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-foreground">
          {title} <span className="font-mono text-xs text-muted-foreground">{count}</span>
        </h2>
        {action}
      </div>
      {children}
    </section>
  );
}

export function FollowUpsPage() {
  const fu = useFollowUps();
  const by = (stage: FollowUpQueueItem["stage"]) => fu.items.filter((i) => i.stage === stage);
  const ready = by("ready");
  const awaiting = by("awaiting");
  // `sending` rows sit here too: a send holds them, so nothing may act on them
  const inSequence = [...by("sending"), ...by("waiting"), ...by("done")];
  const locked = fu.anyBusy;
  // Send all never includes a lead that already has an action in flight
  const sendable = awaiting.filter((i) => !fu.busy.has(i.leadId));
  const excluded = by("excluded");
  const skip = (leadId: string) => {
    const note = window.prompt("Skip this follow-up? Optional reason (e.g. scanner trail):") ?? null;
    if (note !== null) void fu.mark(leadId, "skipped", note || undefined);
  };

  // Draft ids with unsaved edits, reported up by each DraftCard. "Send all"
  // must not ship a stale pre-edit copy for a card the operator is mid-edit on.
  const [dirtyIds, setDirtyIds] = useState<ReadonlySet<string>>(new Set());
  const handleDirtyChange = useCallback((draftId: string, dirty: boolean) => {
    setDirtyIds((prev) => {
      if (prev.has(draftId) === dirty) return prev;
      const next = new Set(prev);
      if (dirty) next.add(draftId);
      else next.delete(draftId);
      return next;
    });
  }, []);

  return (
    <div className="flex min-h-full flex-col px-4 py-5 sm:px-6">
      <Reveal className="mb-2" y={6}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Sell</div>
            <h1 className="mt-1 text-base font-semibold tracking-tight text-foreground sm:text-xl">Follow-Ups</h1>
            <p className="mt-1 max-w-2xl text-xs text-muted-foreground">
              Leads who opened a service (score 66+) get up to two personal emails about that service, written by Claude and
              approved by you. Replies aren&apos;t detected: if someone answers by email, mark them replied.
            </p>
          </div>
          <Button variant="outline" size="sm" onClick={() => void fu.refresh()} className="gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" aria-hidden /> Refresh
          </Button>
        </div>
      </Reveal>

      {fu.notice && <div className="mt-2 rounded-md bg-muted/50 px-3 py-2 text-xs text-foreground">{fu.notice}</div>}
      {fu.needsMigration && (
        <div className="mt-2 rounded-md border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-xs">
          Run <code>supabase/follow-ups.sql</code> in the Supabase SQL editor to switch this tab on.
        </div>
      )}
      {fu.status === "error" && <div className="mt-2 rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{fu.error}</div>}
      {fu.status === "loading" && <p className="mt-6 text-xs text-muted-foreground">Loading the queue…</p>}

      {fu.status !== "loading" && (
        <>
          <Section
            title="Awaiting approval"
            count={awaiting.length}
            action={
              awaiting.length > 1 && (
                <Can perm="followups.send">
                  <Button
                    size="sm"
                    className="gap-1.5"
                    disabled={locked || dirtyIds.size > 0 || sendable.length === 0}
                    title={dirtyIds.size > 0 ? "Save your edits first" : undefined}
                    onClick={() => {
                      if (window.confirm(`Send all ${sendable.length} drafts as they are now?`)) {
                        void fu.send(sendable.map((i) => ({ id: i.draft!.id, leadId: i.leadId })));
                      }
                    }}
                  >
                    <Send className="h-3.5 w-3.5" aria-hidden /> Send all
                  </Button>
                </Can>
              )
            }
          >
            {awaiting.length === 0 ? (
              <p className="text-xs text-muted-foreground">No drafts waiting.</p>
            ) : (
              <ul className="grid gap-3">
                {awaiting.map((item) => (
                  <DraftCard
                    key={item.draft!.id + item.draft!.updated_at}
                    item={item}
                    busy={fu.busy.has(item.leadId)}
                    locked={locked}
                    onSave={(s, b) => fu.save({ id: item.draft!.id, leadId: item.leadId }, s, b)}
                    onSend={() => void fu.send([{ id: item.draft!.id, leadId: item.leadId }])}
                    onRedraft={() => void fu.draft([item.leadId])}
                    onSkip={() => skip(item.leadId)}
                    onReplied={() => void fu.mark(item.leadId, "replied")}
                    onDirtyChange={handleDirtyChange}
                  />
                ))}
              </ul>
            )}
          </Section>

          <Section
            title="Ready to draft"
            count={ready.length}
            action={
              ready.length > 0 && (
                <Can perm="followups.send">
                  <Button variant="outline" size="sm" className="gap-1.5" disabled={locked} onClick={() => void fu.draft(ready.map((i) => i.leadId))}>
                    <Sparkles className="h-3.5 w-3.5" aria-hidden /> Draft {Math.min(ready.length, MAX_DRAFT_ALL)}
                  </Button>
                </Can>
              )
            }
          >
            {ready.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nobody new. Leads arrive here once they open a service on the portal.</p>
            ) : (
              <ul className="grid gap-2">
                {ready.map((item) => (
                  <li key={item.leadId} className="flex items-center justify-between gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
                    <LeadHeader item={item} />
                    <Can perm="followups.send">
                      <div className="flex shrink-0 gap-2">
                        <Button variant="ghost" size="sm" disabled={locked} onClick={() => skip(item.leadId)}>
                          Skip
                        </Button>
                        {item.touch === 2 && (
                          <Button variant="ghost" size="sm" disabled={locked} onClick={() => void fu.mark(item.leadId, "replied")} className="gap-1.5">
                            <Reply className="h-3.5 w-3.5" aria-hidden /> Replied
                          </Button>
                        )}
                        <Button size="sm" disabled={locked} onClick={() => void fu.draft([item.leadId])} className="gap-1.5">
                          <MailPlus className="h-3.5 w-3.5" aria-hidden /> {fu.busy.has(item.leadId) ? "Drafting…" : "Draft"}
                        </Button>
                      </div>
                    </Can>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          <Section title="In sequence / done" count={inSequence.length}>
            {inSequence.length === 0 ? (
              <p className="text-xs text-muted-foreground">Nothing sent yet.</p>
            ) : (
              <ul className="grid gap-2">
                {inSequence.map((item) => (
                  <li key={item.leadId} className="flex items-center justify-between gap-3 rounded-xl bg-card p-3 ring-1 ring-foreground/10">
                    <LeadHeader item={item} />
                    <div className={`flex items-center gap-2 ${item.stage === "sending" ? "max-w-sm" : "shrink-0"}`}>
                      {item.stage === "sending" ? (
                        <Chip tone="warn" wrap>
                          <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden /> {item.reason}
                        </Chip>
                      ) : item.stage === "waiting" ? (
                        <>
                          <Chip>
                            <Clock className="h-3 w-3" aria-hidden /> #2 due {item.touch2DueOn ?? "soon"}
                          </Chip>
                          <Can perm="followups.send">
                            <Button variant="outline" size="sm" disabled={locked} onClick={() => void fu.mark(item.leadId, "replied")} className="gap-1.5">
                              <Reply className="h-3.5 w-3.5" aria-hidden /> Replied
                            </Button>
                          </Can>
                        </>
                      ) : (
                        <Chip tone="primary">
                          <CheckCircle2 className="h-3 w-3" aria-hidden /> Ready for Sales · {item.reason}
                        </Chip>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </Section>

          {excluded.length > 0 && (
            <details className="mt-6 text-xs text-muted-foreground">
              <summary className="cursor-pointer">Not eligible ({excluded.length})</summary>
              <ul className="mt-2 grid gap-1">
                {excluded.map((item) => (
                  <li key={item.leadId}>
                    {item.business ?? item.leadId} · {item.reason}
                  </li>
                ))}
              </ul>
            </details>
          )}
        </>
      )}

      <div className="mt-auto pt-8">
        <Footer />
      </div>
    </div>
  );
}
