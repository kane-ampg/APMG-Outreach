import "server-only";
import { supabaseTarget } from "@/lib/pipeline/server";
import { isMissingPortalTable } from "@/lib/portal/server";
import { type AuditAction, type AuditSource } from "./types";

/**
 * The audit writer.
 *
 * Its contract is deliberately the INVERSE of insertPortalEvents: that helper
 * returns false and lets callers shrug, because a missed telemetry beacon is
 * not worth failing a page load. An audit row is not telemetry — if we cannot
 * record who did something, the something must not be treated as done. Every
 * caller is expected to fail its request on anything but `ok`.
 */

export interface AuditActor {
  email: string;
  role: string;
  /** non-null only while previewing another role */
  actingAs: string | null;
}

export interface AuditEntry {
  action: AuditAction;
  /** defaults to 'claimed' — pass 'witnessed' only for things the server saw */
  source?: AuditSource;
  leadId?: string | null;
  targetEmail?: string | null;
  note?: string | null;
  /** AUD cents */
  valueCents?: number | null;
  meta?: Record<string, unknown>;
}

export type AuditWriteResult =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "missing_table" | "error" };

/**
 * Narrow a successful permission guard to just the identity the trail needs.
 *
 * Takes the guard rather than raw strings so a caller cannot accidentally pass
 * an address that came from the request body — the only way to build an actor
 * is from a session the server already verified.
 */
export function actorFromGuard(guard: {
  email: string;
  role: string;
  actingAs: string | null;
}): AuditActor {
  return { email: guard.email, role: guard.role, actingAs: guard.actingAs };
}

export async function recordAudit(
  actor: AuditActor,
  entries: AuditEntry | AuditEntry[],
): Promise<AuditWriteResult> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return { ok: true };

  const target = supabaseTarget();
  if (target.state !== "ok") return { ok: false, reason: "unconfigured" };

  const rows = list.map((e) => ({
    action: e.action,
    actor_email: actor.email,
    actor_role: actor.role,
    acting_as: actor.actingAs,
    source: e.source ?? "claimed",
    lead_id: e.leadId ?? null,
    target_email: e.targetEmail ?? null,
    note: e.note ?? null,
    value_cents: e.valueCents ?? null,
    meta: e.meta ?? {},
  }));

  try {
    const res = await fetch(`${target.base}/rest/v1/console_audit`, {
      method: "POST",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": "application/json",
        Prefer: "return=minimal",
      },
      body: JSON.stringify(rows),
    });
    if (res.ok) return { ok: true };
    const detail = await res.text().catch(() => "");
    console.error(`[audit] console_audit insert ${res.status}:`, detail.slice(0, 500));
    return {
      ok: false,
      reason: isMissingPortalTable(res.status, detail) ? "missing_table" : "error",
    };
  } catch (e) {
    console.error("[audit] console_audit insert failed:", e);
    return { ok: false, reason: "error" };
  }
}
