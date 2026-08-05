import { INTEGRATIONS, type IntegrationState } from "@/lib/data/integrations";
import { parseNotifyEmails } from "@/lib/pipeline/notifyEmails";
import {
  deleteSetting,
  readSetting,
  sameOrigin,
  supabaseTarget,
  writeSetting,
  SETTING_ENQUIRY_NOTIFY_EMAIL,
} from "@/lib/pipeline/server";
import { guardResponse, requirePermission } from "@/lib/rbac/server";

// Realtime state + configuration for the app's n8n integrations (Integrations
// tab). GET resolves each integration's live wiring (a URL saved from this tab
// wins, else the env var, else demo); POST saves or clears the webhook URL for
// one integration so an operator can point the app at their automation without
// editing environment variables. Server-side (keeps the service role key off
// the browser and never returns the full webhook URL — only a masked form).
export const runtime = "nodejs";

/** Only http(s) URLs, capped so a paste can't wedge the store. */
function normalizeUrl(v: unknown): string | null {
  if (typeof v !== "string") return null;
  const t = v.trim();
  if (!t || t.length > 2048) return null;
  try {
    const u = new URL(t);
    return u.protocol === "http:" || u.protocol === "https:" ? t : null;
  } catch {
    return null;
  }
}

/** Mask a webhook URL for display: keep the origin + a short tail, hide the
 *  rest of the path (the webhook id is the sensitive part). */
function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    const tail = u.pathname.length > 4 ? u.pathname.slice(-4) : u.pathname;
    return `${u.origin}/…${tail}`;
  } catch {
    return "configured";
  }
}

async function resolveState(): Promise<IntegrationState[]> {
  return Promise.all(
    INTEGRATIONS.map(async (meta): Promise<IntegrationState> => {
      const enabled = (await readSetting(meta.enabledKey)) !== "false"; // default on
      const saved = await readSetting(meta.settingKey);
      let url = "";
      let source: "setting" | "env" | null = null;
      if (saved && normalizeUrl(saved)) {
        url = saved;
        source = "setting";
      } else {
        const env = process.env[meta.envVar];
        if (env && normalizeUrl(env)) {
          url = env;
          source = "env";
        }
      }
      const configured = !!url;
      // connected = live; paused = configured but toggled off; demo = no URL
      const status = configured ? (enabled ? "connected" : "paused") : "demo";
      return { id: meta.id, configured, enabled, maskedUrl: configured ? maskUrl(url) : null, source, status };
    }),
  );
}

export async function GET(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, mode: "live", integrations: [], error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "integrations.view");
  if (!guard.ok) return guardResponse(guard);

  const supa = supabaseTarget();
  const mode = supa.state === "ok" ? "live" : "demo";
  const integrations = await resolveState();
  // Notification address enquiries are emailed to (Enquiry Notification card).
  const notifyEmail = (await readSetting(SETTING_ENQUIRY_NOTIFY_EMAIL)) ?? "";
  // In demo mode saved overrides can't persist — the UI shows this so a save
  // doesn't silently no-op.
  return Response.json({ ok: true, mode, canPersist: supa.state === "ok", integrations, notifyEmail });
}

export async function POST(req: Request): Promise<Response> {
  if (!sameOrigin(req)) {
    return Response.json({ ok: false, error: "Forbidden." }, { status: 403 });
  }

  const guard = await requirePermission(req, "integrations.manage");
  if (!guard.ok) return guardResponse(guard);

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return Response.json({ ok: false, error: "Invalid JSON body." }, { status: 400 });
  }
  const b = (body ?? {}) as Record<string, unknown>;

  // Global (not per-integration) setting: the enquiry notification address(es) —
  // one address or a comma-separated list, all of which get notified.
  // Handled before the integration lookup so it isn't rejected as "unknown
  // integration". A blank value clears it (notifications fall back to demo).
  //
  // parseNotifyEmails owns ALL normalization (trim, lowercase, dedupe, canonical
  // join) and is the same module the Integrations panel validates with, so the
  // client and server can't disagree and the stored value round-trips exactly.
  if ("notifyEmail" in b) {
    const raw = typeof b.notifyEmail === "string" ? b.notifyEmail : "";
    const parsed = parseNotifyEmails(raw);
    if (!parsed.ok) {
      return Response.json({ ok: false, error: parsed.error }, { status: 400 });
    }
    if (parsed.emails.length === 0) {
      const result = await deleteSetting(SETTING_ENQUIRY_NOTIFY_EMAIL);
      if (result === "demo") {
        return Response.json({ ok: false, error: "Nothing to clear (Supabase not connected)." }, { status: 409 });
      }
      if (result !== "ok") {
        return Response.json({ ok: false, error: "Couldn't clear the notification email." }, { status: 502 });
      }
    } else {
      const result = await writeSetting(SETTING_ENQUIRY_NOTIFY_EMAIL, parsed.value);
      if (result === "demo") {
        return Response.json(
          { ok: false, error: "Connect Supabase to save the notification email here." },
          { status: 409 },
        );
      }
      if (result === "missing-table") {
        return Response.json(
          { ok: false, needsMigration: true, error: "Run supabase/schema.sql to create the app_settings table." },
          { status: 422 },
        );
      }
      if (result !== "ok") {
        return Response.json({ ok: false, error: "Couldn't save the notification email." }, { status: 502 });
      }
    }
    const integrations = await resolveState();
    const notifyEmail = (await readSetting(SETTING_ENQUIRY_NOTIFY_EMAIL)) ?? "";
    return Response.json({ ok: true, mode: "live", canPersist: true, integrations, notifyEmail });
  }

  const id = typeof b.id === "string" ? b.id : "";
  const meta = INTEGRATIONS.find((i) => i.id === id);
  if (!meta) {
    return Response.json({ ok: false, error: "Unknown integration." }, { status: 400 });
  }

  // On/off toggle — writes only the `_enabled` key, so the saved webhook URL is
  // retained across pauses.
  if (typeof b.enabled === "boolean") {
    const result = await writeSetting(meta.enabledKey, b.enabled ? "true" : "false");
    if (result === "demo") {
      return Response.json(
        { ok: false, error: "Connect Supabase to change this here, or set the environment variable." },
        { status: 409 },
      );
    }
    if (result === "missing-table") {
      return Response.json(
        { ok: false, needsMigration: true, error: "Run supabase/schema.sql to create the app_settings table." },
        { status: 422 },
      );
    }
    if (result !== "ok") {
      return Response.json({ ok: false, error: "Couldn't update the toggle." }, { status: 502 });
    }
    const integrations = await resolveState();
    return Response.json({ ok: true, mode: "live", canPersist: true, integrations });
  }

  // A blank/null url clears the saved override (falls back to env/demo).
  const rawUrl = b.url;
  const clearing = rawUrl == null || (typeof rawUrl === "string" && rawUrl.trim() === "");

  if (!clearing) {
    const url = normalizeUrl(rawUrl);
    if (!url) {
      return Response.json({ ok: false, error: "Enter a valid http(s) webhook URL." }, { status: 400 });
    }
    const result = await writeSetting(meta.settingKey, url);
    if (result === "demo") {
      return Response.json(
        { ok: false, error: "Connect Supabase to save a webhook here, or set the environment variable." },
        { status: 409 },
      );
    }
    if (result === "missing-table") {
      return Response.json(
        { ok: false, needsMigration: true, error: "Run supabase/schema.sql to create the app_settings table." },
        { status: 422 },
      );
    }
    if (result !== "ok") {
      return Response.json({ ok: false, error: "Couldn't save the webhook URL." }, { status: 502 });
    }
  } else {
    const result = await deleteSetting(meta.settingKey);
    if (result === "demo") {
      return Response.json({ ok: false, error: "Nothing saved to clear (Supabase not connected)." }, { status: 409 });
    }
    if (result !== "ok") {
      return Response.json({ ok: false, error: "Couldn't clear the webhook URL." }, { status: 502 });
    }
  }

  const integrations = await resolveState();
  return Response.json({ ok: true, mode: "live", canPersist: true, integrations });
}
