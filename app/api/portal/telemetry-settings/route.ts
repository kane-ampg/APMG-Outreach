import {
  sameOrigin,
  writeSetting,
  SETTING_TELEMETRY_HIDE_WARM_FALSE_POSITIVES,
} from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// POST /api/portal/telemetry-settings — saves the Telemetry tab's list
// preferences to app_settings. Today that is the one tickbox, "Hide warm false
// positives". The value is read back by GET /api/portal/lead-activity?view=telemetry,
// which applies it before the row cap, so the Telemetry page never has to ask
// for it separately.
//
// Gated on telemetry.view, not settings.manage: it changes what the table
// shows, never the data, and anyone who can see the tab can see its tickbox.
export const runtime = "nodejs";

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "telemetry.view");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const hide = (body ?? {}) as { hideWarmFalsePositives?: unknown };
  if (typeof hide.hideWarmFalsePositives !== "boolean") {
    return Response.json({ ok: false, error: "hideWarmFalsePositives must be true or false." }, { status: 400 });
  }

  const result = await writeSetting(
    SETTING_TELEMETRY_HIDE_WARM_FALSE_POSITIVES,
    hide.hideWarmFalsePositives ? "true" : "false",
  );
  if (result === "demo") {
    return Response.json({ ok: false, error: "Connect Supabase to save this setting." }, { status: 409 });
  }
  if (result === "missing-table") {
    return Response.json(
      { ok: false, needsMigration: true, error: "Run supabase/schema.sql to create the app_settings table." },
      { status: 422 },
    );
  }
  if (result !== "ok") {
    return Response.json({ ok: false, error: "Couldn't save the setting." }, { status: 502 });
  }
  return Response.json({ ok: true, hideWarmFalsePositives: hide.hideWarmFalsePositives });
}
