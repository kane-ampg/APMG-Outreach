import { describe, expect, it } from "vitest";
import { mentionsTracking } from "./wording";

describe("mentionsTracking", () => {
  it.each([
    "I saw you were interested in our plumbing work.",
    "I noticed you had a look at our electrical services.",
    "You had a look at painting last week, so here's more.",
    "Since you looked at our strata maintenance page…",
    "you were looking at gutter cleaning",
    "You were browsing our site on Tuesday.",
    "When you viewed our plumbing services, we thought of you.",
    "You visited our portal recently.",
    "You clicked through to our painting page.",
    "You opened our last email about roofing.",
    "You downloaded the childcare playbook.",
    "Since you visited, we've added more detail.",
    "since you viewed the page",
    "Since you were browsing electrical options…",
    "Thanks for browsing our services.",
    "I NOTICED YOU were keen on plumbing",
    "I saw\nyou were interested",
    "You've been looking at our plumbing services.",
    "You have been browsing our site.",
  ])("flags %j", (text) => {
    expect(mentionsTracking(text)).toBe(true);
  });

  it.each([
    "I wrote to you last week about plumbing for your centre.",
    "You can book a site visit whenever it suits.",
    "We look after plumbing for childcare centres across Melbourne.",
    "If the timing isn't right, that's completely fine.",
    "I saw your centre is on Smith Street.",
    "Happy to visit your site for a no-obligation quote.",
    "We've looked after strata buildings for 20 years.",
    "",
  ])("leaves %j alone", (text) => {
    expect(mentionsTracking(text)).toBe(false);
  });
});
