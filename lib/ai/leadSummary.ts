import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * AI-prepared lead brief generator. Given a business's public details (from the
 * Bing Maps scraper + the n8n email-extraction step), produces the 2–3 sentence
 * brief a sales rep reads before cold-calling — what the business does, signals
 * about its size/marketing maturity, and why it would value more qualified leads.
 *
 * Uses the Anthropic SDK (claude-opus-4-8). Falls back to a deterministic
 * template when ANTHROPIC_API_KEY isn't set, so the app works without a key.
 */

export interface LeadFacts {
  business: string;
  category?: string;
  location?: string;
  rating?: number;
  reviews?: number;
  website?: string;
  notes?: string;
}

const SYSTEM =
  "You are a B2B sales-prep assistant for a lead-generation agency. Given a business's public details, write a tight 2–3 sentence brief that a sales rep reads before cold-calling: what the business does, signals about its size and marketing maturity, and why it would value a steady feed of qualified leads. Be concrete and specific to the details given. No greeting, no preamble, no markdown, no bullet points — just the brief.";

function factsToPrompt(f: LeadFacts): string {
  const lines = [
    `Business: ${f.business}`,
    f.category && `Category: ${f.category}`,
    f.location && `Location: ${f.location}`,
    f.rating != null && `Rating: ${f.rating}★${f.reviews != null ? ` (${f.reviews} reviews)` : ""}`,
    f.website && `Website: ${f.website}`,
    f.notes && `Notes: ${f.notes}`,
  ].filter(Boolean);
  return `Write the sales brief for this lead:\n${lines.join("\n")}`;
}

function fallbackSummary(f: LeadFacts): string {
  const where = f.location ? ` in ${f.location}` : "";
  const cat = f.category ? f.category.toLowerCase() : "local business";
  const rep =
    f.rating != null
      ? ` It holds a ${f.rating}★ rating${f.reviews != null ? ` across ${f.reviews} reviews` : ""}, so reputation matters to them.`
      : "";
  return `${f.business} is a ${cat}${where}.${rep} A good fit for a steady feed of qualified, ready-to-buy leads — open the call on how more inbound would help them book more of the work they already do well.`;
}

export async function generateLeadSummary(
  facts: LeadFacts,
): Promise<{ summary: string; source: "claude" | "fallback" }> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { summary: fallbackSummary(facts), source: "fallback" };
  }
  try {
    const client = new Anthropic();
    const message = await client.messages.create({
      // Default per Claude API guidance. Switch to "claude-haiku-4-5" if you
      // want cheaper, higher-volume summaries — your call, not a default.
      model: "claude-opus-4-8",
      max_tokens: 400,
      system: SYSTEM,
      messages: [{ role: "user", content: factsToPrompt(facts) }],
    });
    const text = message.content
      .map((block) => (block.type === "text" ? block.text : ""))
      .join("")
      .trim();
    return text
      ? { summary: text, source: "claude" }
      : { summary: fallbackSummary(facts), source: "fallback" };
  } catch {
    // Network / auth / rate-limit — degrade gracefully to the template.
    return { summary: fallbackSummary(facts), source: "fallback" };
  }
}
