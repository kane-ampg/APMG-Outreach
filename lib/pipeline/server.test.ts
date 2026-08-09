import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { campaignWebhook, isProductionRuntime, requireLiveSupabase } from "./server";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
  vi.unstubAllGlobals();
  delete process.env.SUPABASE_URL;
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  delete process.env.N8N_CAMPAIGN_WEBHOOK_URL;
  delete process.env.VERCEL_ENV;
  vi.stubEnv("NODE_ENV", "test");
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.unstubAllEnvs();
  process.env = { ...ORIGINAL_ENV };
});

/** readSetting() reads app_settings over PostgREST. Stub fetch so each key
 *  resolves to the supplied value (absent key -> no row -> null). */
function stubSettings(values: Record<string, string>): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: unknown) => {
      const url = new URL(String(input));
      const key = (url.searchParams.get("key") ?? "").replace(/^eq\./, "");
      const value = values[key];
      return new Response(JSON.stringify(value === undefined ? [] : [{ value }]), { status: 200 });
    }),
  );
}

function configureSupabase(): void {
  vi.stubEnv("SUPABASE_URL", "https://project.supabase.co");
  vi.stubEnv("SUPABASE_SERVICE_ROLE_KEY", "service-key");
}

describe("isProductionRuntime", () => {
  it("is false on a developer machine", () => {
    expect(isProductionRuntime()).toBe(false);
  });

  it("is true when NODE_ENV is production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(isProductionRuntime()).toBe(true);
  });

  it("is true on any Vercel deployment, including preview", () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(isProductionRuntime()).toBe(true);
  });
});

describe("requireLiveSupabase", () => {
  it("returns null when Supabase is configured", () => {
    configureSupabase();
    vi.stubEnv("NODE_ENV", "production");
    expect(requireLiveSupabase("test")).toBeNull();
  });

  it("returns a 503 when Supabase is missing on a production runtime", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const res = requireLiveSupabase("test");
    expect(res).not.toBeNull();
    expect(res!.status).toBe(503);
    await expect(res!.json()).resolves.toMatchObject({ ok: false });
  });

  it("returns null when Supabase is missing in development, so local work still runs", () => {
    expect(requireLiveSupabase("test")).toBeNull();
  });
});

describe("campaignWebhook — paused is not unconfigured", () => {
  it("is unconfigured when no URL is set anywhere", async () => {
    await expect(campaignWebhook()).resolves.toEqual({ state: "unconfigured" });
  });

  it("is ok when an env URL is set and no toggle has been written", async () => {
    vi.stubEnv("N8N_CAMPAIGN_WEBHOOK_URL", "https://n8n.example/hook");
    await expect(campaignWebhook()).resolves.toEqual({
      state: "ok",
      url: "https://n8n.example/hook",
      source: "env",
    });
  });

  it("is PAUSED — not unconfigured — when a configured webhook's toggle is off", async () => {
    configureSupabase();
    stubSettings({
      n8n_campaign_webhook_url: "https://n8n.example/hook",
      n8n_campaign_webhook_enabled: "false",
    });
    await expect(campaignWebhook()).resolves.toEqual({
      state: "paused",
      url: "https://n8n.example/hook",
      source: "setting",
    });
  });
});
