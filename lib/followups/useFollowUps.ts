"use client";

import { useCallback, useEffect, useState } from "react";
import {
  MAX_DRAFT_ALL,
  MAX_DRAFT_PER_REQUEST,
  type FollowUpDraftResponse,
  type FollowUpMutationResponse,
  type FollowUpQueueItem,
  type FollowUpQueueResponse,
  type FollowUpSendResponse,
} from "./types";

/**
 * Client state for the Follow-Ups tab. Loads once on mount and on Refresh —
 * deliberately NO polling (Vercel free-tier transfer budget). Every action
 * re-reads the queue afterwards, so the page always shows the server's
 * judgement rather than an optimistic guess.
 */

export interface FollowUpsState {
  status: "loading" | "ready" | "error";
  mode: "live" | "demo";
  needsMigration: boolean;
  error: string | null;
  items: FollowUpQueueItem[];
  /** lead ids with an action in flight */
  busy: ReadonlySet<string>;
  /** the last action's outcome, in words */
  notice: string | null;
}

/** fetch + JSON that never throws: a dropped connection comes back as an
 *  ordinary failure, so every action still sets its notice and refreshes. */
async function call<T>(url: string, init?: RequestInit): Promise<T & { ok: boolean; error?: string }> {
  let res: Response;
  try {
    res = await fetch(url, {
      cache: "no-store",
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    return { ok: false, error: "Network error. Check your connection and refresh." } as T & { ok: boolean; error?: string };
  }
  const data = (await res.json().catch(() => ({}))) as T & { ok?: boolean; error?: string };
  return { ...data, ok: res.ok && data.ok !== false, error: data.error ?? (res.ok ? undefined : `Request failed (${res.status})`) };
}

export function useFollowUps() {
  const [state, setState] = useState<FollowUpsState>({
    status: "loading",
    mode: "live",
    needsMigration: false,
    error: null,
    items: [],
    busy: new Set(),
    notice: null,
  });

  const setBusy = (ids: string[], on: boolean) =>
    setState((s) => {
      const busy = new Set(s.busy);
      for (const id of ids) (on ? busy.add(id) : busy.delete(id));
      return { ...s, busy };
    });
  const setNotice = (notice: string | null) => setState((s) => ({ ...s, notice }));

  const refresh = useCallback(async () => {
    const data = await call<FollowUpQueueResponse>("/api/followups");
    setState((s) => ({
      ...s,
      status: data.ok ? "ready" : "error",
      mode: data.mode ?? "live",
      needsMigration: Boolean(data.needsMigration),
      error: data.ok ? null : (data.error ?? "Couldn't load the queue."),
      items: data.ok ? (data.items ?? []) : s.items,
    }));
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const draft = useCallback(
    async (leadIds: string[]) => {
      let queue = leadIds.slice(0, MAX_DRAFT_ALL);
      setBusy(queue, true);
      let drafted = 0;
      const failed: string[] = [];
      try {
        while (queue.length > 0) {
          const chunk = queue.slice(0, MAX_DRAFT_PER_REQUEST);
          const data = await call<FollowUpDraftResponse>("/api/followups/draft", {
            method: "POST",
            body: JSON.stringify({ leadIds: chunk }),
          });
          if (!data.ok) {
            failed.push(data.error ?? "Drafting failed.");
            break;
          }
          drafted += data.drafted.length;
          failed.push(...data.failed.map((f) => f.error));
          // unreached leads go back on the front of the queue
          queue = [...data.remaining, ...queue.slice(chunk.length)];
          if (data.drafted.length === 0 && data.failed.length === 0) break; // no progress
        }
      } finally {
        setBusy(leadIds, false);
      }
      setNotice(
        `${drafted} draft${drafted === 1 ? "" : "s"} written` + (failed.length ? ` · ${failed.length} failed: ${failed[0]}` : ""),
      );
      await refresh();
    },
    [refresh],
  );

  const save = useCallback(
    async (row: { id: string; leadId: string }, subject: string, bodyHtml: string): Promise<boolean> => {
      setBusy([row.leadId], true);
      let data: FollowUpMutationResponse;
      try {
        data = await call<FollowUpMutationResponse>("/api/followups", {
          method: "PATCH",
          body: JSON.stringify({ id: row.id, subject, body_html: bodyHtml }),
        });
      } finally {
        setBusy([row.leadId], false);
      }
      setNotice(data.ok ? "Draft saved" : (data.error ?? "Couldn't save the draft."));
      // Always re-read: the card is keyed on the row's updated_at, so the
      // refresh remounts it with the saved copy and clears its "dirty" state
      // (otherwise Approve & send would stay disabled after a successful save).
      await refresh();
      return data.ok;
    },
    [refresh],
  );

  const send = useCallback(
    async (rows: Array<{ id: string; leadId: string }>) => {
      setBusy(rows.map((r) => r.leadId), true);
      try {
        const data = await call<FollowUpSendResponse>("/api/followups/send", {
          method: "POST",
          body: JSON.stringify({ ids: rows.map((r) => r.id) }),
        });
        const parts = [
          data.ok ? `${data.sent ?? 0} sent` : (data.error ?? "Nothing was sent."),
          data.blocked?.length ? `${data.blocked.length} blocked (${data.blocked[0].reason})` : "",
          data.skipped?.length ? `${data.skipped.length} skipped (${data.skipped[0].reason})` : "",
          data.warning ?? "",
        ].filter(Boolean);
        setNotice(parts.join(" · "));
      } finally {
        setBusy(rows.map((r) => r.leadId), false);
      }
      await refresh();
    },
    [refresh],
  );

  const mark = useCallback(
    async (leadId: string, status: "skipped" | "replied", note?: string) => {
      setBusy([leadId], true);
      try {
        const data = await call<FollowUpMutationResponse>("/api/followups/mark", {
          method: "POST",
          body: JSON.stringify({ leadId, status, note }),
        });
        setNotice(data.ok ? (status === "replied" ? "Marked as replied" : "Skipped") : (data.error ?? "Couldn't save that."));
      } finally {
        setBusy([leadId], false);
      }
      await refresh();
    },
    [refresh],
  );

  // One action at a time: while anything is in flight every mutating control
  // is disabled, so a click can't race a send that is still settling.
  const anyBusy = state.busy.size > 0;

  return { ...state, anyBusy, refresh, draft, save, send, mark };
}
