import { describe, expect, it } from "vitest";
import { MAX_NOTIFY_EMAILS, commitNotifyDraft } from "./notifyEmails";

describe("commitNotifyDraft", () => {
  it("adds the first address to an empty committed list", () => {
    const r = commitNotifyDraft("", "a@b.com");
    expect(r).toEqual({ ok: true, emails: ["a@b.com"], value: "a@b.com" });
  });

  it("appends a second address onto an existing committed list", () => {
    const r = commitNotifyDraft("a@b.com", "c@d.com");
    expect(r).toEqual({ ok: true, emails: ["a@b.com", "c@d.com"], value: "a@b.com, c@d.com" });
  });

  it("is a no-op success when the draft is blank", () => {
    const r = commitNotifyDraft("a@b.com", "   ");
    expect(r).toEqual({ ok: true, emails: ["a@b.com"], value: "a@b.com" });
  });

  it("is a no-op success on an empty committed list and blank draft", () => {
    const r = commitNotifyDraft("", "");
    expect(r).toEqual({ ok: true, emails: [], value: "" });
  });

  it("splits a pasted comma-separated draft into multiple addresses at once", () => {
    const r = commitNotifyDraft("", "a@b.com, c@d.com");
    expect(r).toEqual({ ok: true, emails: ["a@b.com", "c@d.com"], value: "a@b.com, c@d.com" });
  });

  it("rejects a malformed draft address without touching the committed list", () => {
    const r = commitNotifyDraft("a@b.com", "not-an-email");
    expect(r.ok).toBe(false);
  });

  it("rejects a draft that would push the list past the cap", () => {
    const committed = Array.from({ length: MAX_NOTIFY_EMAILS }, (_, i) => `a${i}@b.com`).join(", ");
    const r = commitNotifyDraft(committed, "one-too-many@b.com");
    expect(r.ok).toBe(false);
  });

  it("dedupes case-differing addresses silently, same as parseNotifyEmails", () => {
    const r = commitNotifyDraft("a@b.com", "A@B.com");
    expect(r).toEqual({ ok: true, emails: ["a@b.com"], value: "a@b.com" });
  });
});
