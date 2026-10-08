import { describe, expect, it } from "vitest";
import { isExternalSource, resolveSource, sourceFromReferer } from "./source";

const params = (q = "") => new URLSearchParams(q);

describe("sourceFromReferer", () => {
  it("names the known platforms, search engines and AI assistants", () => {
    expect(sourceFromReferer("https://l.facebook.com/")).toBe("facebook");
    expect(sourceFromReferer("https://www.google.com.au/")).toBe("google");
    expect(sourceFromReferer("https://www.bing.com/")).toBe("bing");
    expect(sourceFromReferer("https://duckduckgo.com/")).toBe("duckduckgo");
    expect(sourceFromReferer("https://au.search.yahoo.com/")).toBe("yahoo");
    expect(sourceFromReferer("https://chatgpt.com/")).toBe("chatgpt");
  });

  it("names any other site by its hostname, minus www", () => {
    expect(sourceFromReferer("https://www.careforkids.com.au/child-care/vic")).toBe("careforkids.com.au");
    expect(sourceFromReferer("https://strata.community/members")).toBe("strata.community");
  });

  it("counts the APMG marketing site as outside traffic", () => {
    expect(sourceFromReferer("https://www.apmgservices.com.au/")).toBe("apmgservices.com.au");
    expect(sourceFromReferer("https://apmgservices.com.au/")).toBe("apmgservices.com.au");
  });

  it("ignores our own hosts: the admin console, the portal, previews, dev", () => {
    expect(sourceFromReferer("https://admin.apmgservices.com.au/")).toBeNull();
    expect(sourceFromReferer("https://customer.apmgservices.com.au/portal")).toBeNull();
    expect(sourceFromReferer("https://customers-apmg-services.vercel.app/")).toBeNull();
    expect(sourceFromReferer("http://localhost:3000/")).toBeNull();
    expect(sourceFromReferer("https://apmgau.app.n8n.cloud/")).toBeNull();
  });

  it("ignores same-origin navigation", () => {
    expect(sourceFromReferer("https://portal.example.org/portal", "portal.example.org")).toBeNull();
    expect(sourceFromReferer("https://portal.example.org/portal", "portal.example.org:443")).toBeNull();
  });

  it("never mistakes mail for a traffic source", () => {
    expect(sourceFromReferer("https://mail.google.com/")).toBeNull();
    expect(sourceFromReferer("https://outlook.office.com/")).toBeNull();
    expect(sourceFromReferer("https://outlook.live.com/")).toBeNull();
    expect(sourceFromReferer("https://aus01.safelinks.protection.outlook.com/")).toBeNull();
    expect(sourceFromReferer("https://protect-au.mimecast.com/")).toBeNull();
    expect(sourceFromReferer("https://urldefense.com/")).toBeNull();
    expect(sourceFromReferer("https://linkprotect.cudasvc.com/")).toBeNull();
    expect(sourceFromReferer("https://webmail.example.com.au/")).toBeNull();
  });

  it("ignores non-web and unparseable Referers", () => {
    expect(sourceFromReferer("android-app://com.google.android.gm/")).toBeNull();
    expect(sourceFromReferer("not a url")).toBeNull();
    expect(sourceFromReferer("")).toBeNull();
    expect(sourceFromReferer(null)).toBeNull();
  });
});

describe("resolveSource", () => {
  it("lets an explicit utm tag win over the Referer", () => {
    expect(resolveSource(params("utm_source=FB"), "https://www.bing.com/")).toBe("facebook");
  });

  it("falls back to the Referer when untagged", () => {
    expect(resolveSource(params(), "https://www.bing.com/")).toBe("bing");
  });

  it("never re-labels an outreach visitor from their Referer", () => {
    // Gmail sends clicks through google.com/url — that is the email, not search.
    expect(resolveSource(params(), "https://www.google.com/", { outreach: true })).toBeNull();
    expect(resolveSource(params(), "https://www.bing.com/", { outreach: true })).toBeNull();
  });

  it("still honours an explicit tag on an outreach visitor", () => {
    expect(resolveSource(params("utm_source=facebook"), null, { outreach: true })).toBe("facebook");
  });
});

describe("isExternalSource", () => {
  it("excludes the gauged platforms and the fallback buckets", () => {
    for (const s of ["facebook", "google", "linkedin", "outreach", "direct"]) {
      expect(isExternalSource(s)).toBe(false);
    }
  });

  it("includes every other tagged source", () => {
    for (const s of ["instagram", "tiktok", "bing", "careforkids.com.au", "apmgservices.com.au"]) {
      expect(isExternalSource(s)).toBe(true);
    }
  });
});
