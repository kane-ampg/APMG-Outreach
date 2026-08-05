import "server-only";
import { supabaseTarget } from "@/lib/pipeline/server";
import {
  ALLOWED_MODELS,
  DEFAULT_LEAD_TEMPLATE,
  DEFAULT_MODEL,
  INSTRUCTIONS,
  OUTPUT_SCHEMA,
  composeModel,
} from "./composePrompt";

/**
 * Persistence for the Email Composer prompt. The editable config (model,
 * instructions, per-lead message template, output schema) lives in the
 * public.compose_prompt singleton (supabase/compose-prompt.sql), written with
 * the service role. When Supabase is unset or the row is missing we fall back to
 * the in-code defaults from composePrompt.ts, so drafting always works.
 *
 * A saved row OVERRIDES the code defaults; clear a field (empty) to fall back to
 * the code default for just that field.
 */

const TABLE = "compose_prompt";

export interface ComposePromptConfig {
  model: string;
  instructions: string;
  leadPromptTemplate: string;
  outputSchema: Record<string, unknown>;
  /** ISO time the row was last saved, or null when serving code defaults. */
  updatedAt: string | null;
  /** where the served config came from. */
  source: "db" | "default";
}

/** The in-code defaults, used as the fallback and the "reset" target. */
export function defaultComposePrompt(): ComposePromptConfig {
  return {
    model: DEFAULT_MODEL,
    instructions: INSTRUCTIONS,
    leadPromptTemplate: DEFAULT_LEAD_TEMPLATE,
    outputSchema: OUTPUT_SCHEMA,
    updatedAt: null,
    source: "default",
  };
}

/** Resolve the model actually sent to the API: a saved/allow-listed model wins,
 *  otherwise the env override (COMPOSE_MODEL) or the code default. Keeps a bad
 *  saved value from 404-ing every draft. */
export function resolveModel(model: string): string {
  return ALLOWED_MODELS.has(model) ? model : composeModel();
}

type DbRow = {
  model?: unknown;
  instructions?: unknown;
  lead_prompt_template?: unknown;
  output_schema?: unknown;
  updated_at?: unknown;
};

/** Read the saved config, falling back to code defaults for the whole row (no
 *  Supabase / missing table / no row) or per-field (a blank/invalid column). */
export async function loadComposePrompt(): Promise<ComposePromptConfig> {
  const def = defaultComposePrompt();
  const target = supabaseTarget();
  if (target.state !== "ok") return def;

  try {
    const res = await fetch(
      `${target.base}/rest/v1/${TABLE}?id=eq.true&select=model,instructions,lead_prompt_template,output_schema,updated_at&limit=1`,
      {
        headers: { apikey: target.key, Authorization: `Bearer ${target.key}` },
        cache: "no-store",
      },
    );
    if (!res.ok) return def; // missing table / RLS / network → code defaults
    const rows = (await res.json().catch(() => null)) as DbRow[] | null;
    const row = Array.isArray(rows) ? rows[0] : null;
    if (!row) return def;

    // Normalise CRLF → LF so text pasted via the SQL editor doesn't ship stray
    // carriage returns in the prompt (or leave a trailing \r on each template line).
    const str = (v: unknown, fallback: string): string =>
      typeof v === "string" && v.trim() ? v.replace(/\r\n/g, "\n") : fallback;
    const schema =
      row.output_schema && typeof row.output_schema === "object" && !Array.isArray(row.output_schema)
        ? (row.output_schema as Record<string, unknown>)
        : def.outputSchema;

    return {
      model: str(row.model, def.model),
      instructions: str(row.instructions, def.instructions),
      leadPromptTemplate: str(row.lead_prompt_template, def.leadPromptTemplate),
      outputSchema: schema,
      updatedAt: typeof row.updated_at === "string" ? row.updated_at : null,
      source: "db",
    };
  } catch {
    return def;
  }
}

export type SaveResult = "ok" | "demo" | "missing-table" | "error";

/** Upsert the singleton row (id = true). Overwrites in place — the config is
 *  never versioned. Returns a status the route maps to an HTTP response. */
export async function saveComposePrompt(patch: {
  model: string;
  instructions: string;
  leadPromptTemplate: string;
  outputSchema: Record<string, unknown>;
}): Promise<SaveResult> {
  const target = supabaseTarget();
  if (target.state !== "ok") return "demo";

  try {
    const res = await fetch(`${target.base}/rest/v1/${TABLE}?on_conflict=id`, {
      method: "POST",
      headers: {
        apikey: target.key,
        Authorization: `Bearer ${target.key}`,
        "Content-Type": "application/json",
        Prefer: "resolution=merge-duplicates,return=minimal",
      },
      body: JSON.stringify({
        id: true,
        model: patch.model,
        instructions: patch.instructions,
        lead_prompt_template: patch.leadPromptTemplate,
        output_schema: patch.outputSchema,
      }),
    });
    if (res.ok) return "ok";
    const detail = await res.text().catch(() => "");
    console.error(`[composer] compose_prompt upsert ${res.status}:`, detail.slice(0, 500));
    if (res.status === 404 || /find the table|PGRST205/i.test(detail)) return "missing-table";
    return "error";
  } catch (e) {
    console.error("[composer] compose_prompt upsert failed:", e);
    return "error";
  }
}
