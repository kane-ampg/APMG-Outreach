import { sameOrigin, supabaseTarget } from "@/lib/pipeline/server";
import { ALLOWED_MODELS } from "@/lib/ai/composePrompt";
import {
  defaultComposePrompt,
  loadComposePrompt,
  saveComposePrompt,
  type ComposePromptConfig,
} from "@/lib/ai/composeStore";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Email Composer config API (Email Composer tab). GET returns the current prompt
// config (saved row, or in-code defaults) plus the code defaults for a "reset";
// PUT upserts the overwriteable singleton (supabase/compose-prompt.sql). The
// compose flow (app/api/pipeline/campaigns/compose) reads the same config to
// draft each email. Server-side, service role.
export const runtime = "nodejs";

const MAX_INSTRUCTIONS = 20_000;
const MAX_TEMPLATE = 4_000;

interface StatePayload {
  ok: true;
  mode: "live" | "demo";
  canPersist: boolean;
  config: ComposePromptConfig;
  defaults: ComposePromptConfig;
  allowedModels: string[];
}

async function state(): Promise<StatePayload> {
  const supa = supabaseTarget();
  return {
    ok: true,
    mode: supa.state === "ok" ? "live" : "demo",
    canPersist: supa.state === "ok",
    config: await loadComposePrompt(),
    defaults: defaultComposePrompt(),
    allowedModels: [...ALLOWED_MODELS],
  };
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "composer.view");
  if (!guard.ok) return guardResponse(guard);

  return Response.json(await state());
}

export async function PUT(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "composer.view");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // Model: must be one the drafting call allow-lists (a typo can't 404 sends).
  const model = typeof b.model === "string" ? b.model.trim() : "";
  if (!ALLOWED_MODELS.has(model)) {
    return Response.json(
      { ok: false, error: `Model must be one of: ${[...ALLOWED_MODELS].join(", ")}.` },
      { status: 400 },
    );
  }

  // Instructions + per-lead template: non-empty prose within sane bounds.
  const instructions = typeof b.instructions === "string" ? b.instructions.trim() : "";
  if (!instructions) {
    return Response.json({ ok: false, error: "Instructions can't be empty." }, { status: 400 });
  }
  if (instructions.length > MAX_INSTRUCTIONS) {
    return Response.json(
      { ok: false, error: `Instructions are too long (max ${MAX_INSTRUCTIONS.toLocaleString("en-US")} chars).` },
      { status: 400 },
    );
  }

  const leadPromptTemplate = typeof b.leadPromptTemplate === "string" ? b.leadPromptTemplate.trim() : "";
  if (!leadPromptTemplate) {
    return Response.json({ ok: false, error: "The per-lead message can't be empty." }, { status: 400 });
  }
  if (leadPromptTemplate.length > MAX_TEMPLATE) {
    return Response.json(
      { ok: false, error: `The per-lead message is too long (max ${MAX_TEMPLATE.toLocaleString("en-US")} chars).` },
      { status: 400 },
    );
  }
  if (!leadPromptTemplate.includes("{{business}}")) {
    return Response.json(
      { ok: false, error: "The per-lead message must include the {{business}} token." },
      { status: 400 },
    );
  }

  // Output schema: accept a JSON object (or a JSON string that parses to one).
  let outputSchema: Record<string, unknown> | null = null;
  const rawSchema = b.outputSchema;
  if (rawSchema && typeof rawSchema === "object" && !Array.isArray(rawSchema)) {
    outputSchema = rawSchema as Record<string, unknown>;
  } else if (typeof rawSchema === "string") {
    try {
      const parsed = JSON.parse(rawSchema) as unknown;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        outputSchema = parsed as Record<string, unknown>;
      }
    } catch {
      /* fall through to the 400 below */
    }
  }
  if (!outputSchema) {
    return Response.json({ ok: false, error: "Output schema must be a JSON object." }, { status: 400 });
  }

  const result = await saveComposePrompt({ model, instructions, leadPromptTemplate, outputSchema });
  if (result === "demo") {
    return Response.json(
      { ok: false, error: "Connect Supabase (service role) to save the prompt here." },
      { status: 409 },
    );
  }
  if (result === "missing-table") {
    return Response.json(
      { ok: false, needsMigration: true, error: "Run supabase/compose-prompt.sql to create the compose_prompt table." },
      { status: 422 },
    );
  }
  if (result !== "ok") {
    return Response.json({ ok: false, error: "Couldn't save the prompt." }, { status: 502 });
  }

  return Response.json(await state());
}
