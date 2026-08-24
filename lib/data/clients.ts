"use client";

/**
 * Browser access to the Master Client List and to the outreach guard.
 *
 * NOT a poll. Both come from a bundled export that only changes when someone
 * deploys a new one, so a 15-second interval would be pure Fast Origin Transfer
 * spend against the free-tier allowance for an answer that is identical every
 * time (see the note at the top of lib/data/useLeadStats.ts for what that cost
 * us before). Each is fetched at most once per tab, then shared: mounting the
 * hook in three components is one request, not three.
 *
 * The heavy list and the compact guard index are separate fetches on purpose.
 * The send flow needs only the guard — a few hundred names, domains and
 * addresses — and must not pull 1,400 sites with contact details to render a
 * warning.
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { matchClient, type ClientGuardData, type ClientMatch, type GuardProspect } from "@/lib/clients/guard";
import type { ClientGroup, MasterClientListStats } from "@/lib/clients/normalize";

export type { ClientGroup, ClientMatch, ClientGuardData, GuardProspect };

export interface MasterClientData {
  groups: ClientGroup[];
  stats: MasterClientListStats;
}

export type ClientListState =
  | { status: "loading" }
  | { status: "error"; error: string }
  | { status: "ready"; data: MasterClientData };

/* ── the master list (Master Client List tab) ─────────────────────────────── */

let listState: ClientListState = { status: "loading" };
const listListeners = new Set<() => void>();
let listInflight: Promise<void> | null = null;

function emitList() {
  for (const l of listListeners) l();
}

async function loadList(): Promise<void> {
  try {
    const res = await fetch("/api/clients", { cache: "no-cache" });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; groups?: ClientGroup[]; stats?: MasterClientListStats; error?: string }
      | null;
    if (!res.ok || !body?.ok || !body.groups || !body.stats) {
      listState = {
        status: "error",
        error: body?.error ?? `Couldn't load the client list (${res.status}).`,
      };
    } else {
      listState = { status: "ready", data: { groups: body.groups, stats: body.stats } };
    }
  } catch {
    listState = { status: "error", error: "Network error loading the client list." };
  }
  emitList();
}

function subscribeList(cb: () => void) {
  listListeners.add(cb);
  // One in-flight fetch shared by every subscriber; a failed load is retryable
  // via `reload` rather than retried on a timer.
  if (!listInflight && listState.status !== "ready") {
    listInflight = loadList().finally(() => {
      listInflight = null;
    });
  }
  return () => {
    listListeners.delete(cb);
  };
}

const LIST_LOADING: ClientListState = { status: "loading" };

/**
 * The folded client list. `enabled` gates the subscription entirely — the route
 * requires `clients.view`, so a role without it must not fire a request it can
 * only be 403'd for.
 */
export function useMasterClients(enabled = true): { state: ClientListState; reload: () => void } {
  const sub = useCallback((cb: () => void) => (enabled ? subscribeList(cb) : () => {}), [enabled]);
  const state = useSyncExternalStore(
    sub,
    () => (enabled ? listState : LIST_LOADING),
    () => LIST_LOADING,
  );
  const reload = useCallback(() => {
    if (listInflight) return;
    listState = { status: "loading" };
    emitList();
    listInflight = loadList().finally(() => {
      listInflight = null;
    });
  }, []);
  return { state, reload };
}

/* ── the outreach guard (send flow) ───────────────────────────────────────── */

let guardData: ClientGuardData | null = null;
let guardError: string | null = null;
let guardInflight: Promise<void> | null = null;

async function loadGuard(): Promise<void> {
  try {
    const res = await fetch("/api/clients/guard", { cache: "no-cache" });
    const body = (await res.json().catch(() => null)) as
      | { ok?: boolean; guard?: ClientGuardData; error?: string }
      | null;
    if (!res.ok || !body?.ok || !body.guard) {
      guardError = body?.error ?? `Couldn't load the client guard (${res.status}).`;
      return;
    }
    guardData = body.guard;
    guardError = null;
  } catch {
    guardError = "Network error loading the client guard.";
  }
}

/**
 * The client guard, for warning about an audience before it is mailed.
 *
 * Fails LOUD, not open: while this is loading or has failed, `ready` is false
 * and `match` returns null, so the send flow must say it could not check rather
 * than imply a clean audience. The server-side check in the send route is the
 * one that actually protects the client list, so a browser that never loads
 * this still cannot get a customer emailed.
 */
export function useClientGuard(enabled = true): {
  ready: boolean;
  error: string | null;
  match: (prospect: GuardProspect) => ClientMatch | null;
} {
  const [, bump] = useState(0);

  useEffect(() => {
    if (!enabled || guardData) return;
    let live = true;
    guardInflight ??= loadGuard().finally(() => {
      guardInflight = null;
    });
    void guardInflight.then(() => {
      if (live) bump((n) => n + 1);
    });
    return () => {
      live = false;
    };
  }, [enabled]);

  const match = useCallback(
    (prospect: GuardProspect) => (guardData ? matchClient(prospect, guardData) : null),
    // guardData is module state, so the identity of this callback must change
    // when it arrives — otherwise a memo built on it keeps the pre-load answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [guardData !== null],
  );

  return { ready: guardData !== null, error: guardError, match };
}

/** Test seam: drop all module state between cases. */
export function __resetClientStores() {
  listState = { status: "loading" };
  listListeners.clear();
  listInflight = null;
  guardData = null;
  guardError = null;
  guardInflight = null;
}
