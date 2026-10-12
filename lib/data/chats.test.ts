import { describe, expect, it } from "vitest";
import {
  chatChannel,
  chatDisplayName,
  describeDevice,
  groupChatRows,
  toChatConversation,
  type ChatLeadContact,
  type ChatRow,
} from "./chats";

/**
 * The Chats view's grouping and attribution rules. Two things matter most to
 * the people reading the tab: that a question is never shown out of order or
 * in the wrong chat, and that "who was this, and where did they come from" is
 * right — Facebook / Google / LinkedIn / Outreach email / Direct.
 */

const LEAD = "11111111-1111-4111-8111-111111111111";

const CONTACT: ChatLeadContact = {
  contactName: "Jane Smith",
  contactTitle: "Business Manager",
  emails: ["office@stmarys.vic.edu.au"],
  phone: "03 9000 0000",
  website: "stmarys.vic.edu.au",
  address: "1 Church St, Kew VIC 3101",
};

let seq = 0;
function row(conversation: string, extra: Partial<ChatRow> = {}): ChatRow {
  seq += 1;
  return {
    conversation_id: conversation,
    visitor_id: null,
    lead_id: null,
    business: null,
    category: null,
    campaign: null,
    source: null,
    question: `q${seq}`,
    reply: `a${seq}`,
    outcome: "answered",
    ua: null,
    created_at: new Date(Date.UTC(2026, 9, 1) + seq * 60_000).toISOString(),
    ...extra,
  };
}

describe("chatChannel", () => {
  it("files an outreach lead under Outreach email, whatever source cookie it carries", () => {
    expect(chatChannel("facebook", LEAD)).toBe("outreach");
  });
  it("uses the traffic source for a visitor with no lead", () => {
    expect(chatChannel("google", null)).toBe("google");
  });
  it("calls an untagged visitor direct", () => {
    expect(chatChannel(null, null)).toBe("direct");
  });
});

describe("groupChatRows", () => {
  it("groups by conversation, oldest question first, newest-active chat first", () => {
    seq = 0;
    const a1 = row("a");
    const b1 = row("b");
    const a2 = row("a");
    // Rows arrive newest-first from the route.
    const chats = groupChatRows([a2, b1, a1]);
    expect(chats.map((c) => c.conversationId)).toEqual(["a", "b"]);
    expect(chats[0].exchanges.map((e) => e.question)).toEqual([a1.question, a2.question]);
    expect(chats[0].startedAt).toBe(a1.created_at);
    expect(chats[0].lastAt).toBe(a2.created_at);
  });

  it("names the lead from the live leads row, and says where the lead came from", () => {
    seq = 0;
    const chats = groupChatRows(
      [row("a", { lead_id: LEAD, business: "Old Name School", category: "Schools" })],
      new Map([[LEAD, { name: "St Mary's Primary", category: "Schools", source: "linkedin", contact: CONTACT }]]),
    );
    expect(chats[0]).toMatchObject({
      business: "St Mary's Primary",
      channel: "outreach",
      leadSource: "linkedin",
      contact: CONTACT,
    });
  });

  it("falls back to the chat-time name once the lead has been deleted", () => {
    seq = 0;
    const chats = groupChatRows([row("a", { lead_id: LEAD, business: "Kew Childcare", category: "Childcare" })]);
    expect(chats[0]).toMatchObject({
      business: "Kew Childcare",
      category: "Childcare",
      leadSource: null,
      contact: null,
    });
  });

  it("keeps attribution stamped on any question, not just the first", () => {
    seq = 0;
    const chats = groupChatRows([row("a"), row("a", { source: "facebook", visitor_id: "v1" })]);
    expect(chats[0]).toMatchObject({ channel: "facebook", visitorId: "v1" });
  });

  it("never names an 'unknown' lead origin", () => {
    seq = 0;
    const chats = groupChatRows(
      [row("a", { lead_id: LEAD })],
      new Map([[LEAD, { name: "X", category: null, source: "unknown", contact: CONTACT }]]),
    );
    expect(chats[0].leadSource).toBeNull();
  });

  it("caps the number of conversations, keeping the newest", () => {
    seq = 0;
    const rows = ["a", "b", "c"].map((id) => row(id));
    expect(groupChatRows(rows, new Map(), 2).map((c) => c.conversationId)).toEqual(["c", "b"]);
  });

  it("says what device they chatted from", () => {
    seq = 0;
    const ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Version/17.0 Mobile/15E148 Safari/604.1";
    expect(groupChatRows([row("a", { ua })])[0].device).toBe("Safari on iPhone");
  });

  it("reads an unrecognised outcome as answered", () => {
    seq = 0;
    expect(groupChatRows([row("a", { outcome: "weird" })])[0].exchanges[0].outcome).toBe("answered");
  });
});

describe("toChatConversation", () => {
  it("drops a chat with no readable exchange", () => {
    expect(toChatConversation({ conversationId: "a", exchanges: [{ nope: 1 }] })).toBeNull();
  });

  it("rebuilds a partial payload with safe defaults", () => {
    const chat = toChatConversation({
      conversationId: "a",
      exchanges: [{ question: "Do you do roofing?", ts: "2026-10-01T00:00:00.000Z" }],
      leadSource: "unknown",
    });
    expect(chat).toMatchObject({
      channel: "direct",
      leadSource: null,
      startedAt: "2026-10-01T00:00:00.000Z",
      exchanges: [{ question: "Do you do roofing?", reply: "", outcome: "answered" }],
    });
  });
});

describe("describeDevice", () => {
  it.each([
    ["Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/130.0 Safari/537.36", "Chrome on Windows"],
    ["Mozilla/5.0 (Windows NT 10.0) AppleWebKit/537.36 Chrome/130.0 Safari/537.36 Edg/130.0", "Edge on Windows"],
    ["Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 Version/17.0 Safari/605.1.15", "Safari on Mac"],
    ["Mozilla/5.0 (Linux; Android 14) AppleWebKit/537.36 Chrome/130.0 Mobile Safari/537.36", "Chrome on Android"],
    ["Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0", "Firefox on Linux"],
  ])("%s → %s", (ua, expected) => {
    expect(describeDevice(ua)).toBe(expected);
  });

  it("is null with nothing to go on", () => {
    expect(describeDevice(null)).toBeNull();
    expect(describeDevice("curl/8.0")).toBeNull();
  });
});

describe("chatDisplayName", () => {
  it("prefers the school / business name", () => {
    expect(chatDisplayName({ business: "St Mary's Primary", leadId: LEAD, channel: "outreach" })).toBe(
      "St Mary's Primary",
    );
  });
  it("names an unattributed lead as such", () => {
    expect(chatDisplayName({ business: null, leadId: LEAD, channel: "outreach" })).toBe("Unattributed lead");
  });
  it("names a visitor by the door they came through", () => {
    expect(chatDisplayName({ business: null, leadId: null, channel: "facebook" })).toBe("Facebook visitor");
    expect(chatDisplayName({ business: null, leadId: null, channel: "direct" })).toBe("Anonymous visitor");
  });
});
