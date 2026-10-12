import { describe, expect, it } from "vitest";
import { chatChannel, groupChatRows, toChatConversation, type ChatRow } from "./chats";

/**
 * The Chats view's grouping and attribution rules. Two things matter most to
 * the people reading the tab: that a question is never shown out of order or
 * in the wrong chat, and that "who was this, and where did they come from" is
 * right — Facebook / Google / LinkedIn / Outreach email / Direct.
 */

const LEAD = "11111111-1111-4111-8111-111111111111";

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
      new Map([[LEAD, { name: "St Mary's Primary", category: "Schools", source: "linkedin" }]]),
    );
    expect(chats[0]).toMatchObject({
      business: "St Mary's Primary",
      channel: "outreach",
      leadSource: "linkedin",
    });
  });

  it("falls back to the chat-time name once the lead has been deleted", () => {
    seq = 0;
    const chats = groupChatRows([row("a", { lead_id: LEAD, business: "Kew Childcare", category: "Childcare" })]);
    expect(chats[0]).toMatchObject({ business: "Kew Childcare", category: "Childcare", leadSource: null });
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
      new Map([[LEAD, { name: "X", category: null, source: "unknown" }]]),
    );
    expect(chats[0].leadSource).toBeNull();
  });

  it("caps the number of conversations, keeping the newest", () => {
    seq = 0;
    const rows = ["a", "b", "c"].map((id) => row(id));
    expect(groupChatRows(rows, new Map(), 2).map((c) => c.conversationId)).toEqual(["c", "b"]);
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
