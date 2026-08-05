/**
 * Sales queue types + the demo-mode preset. A lead reaches Sales only AFTER
 * admin has sent the automation's custom email — live, that gate is the
 * `email_sent` ledger in portal_events, read by /api/sales/queue and mapped
 * into this shape by SalesProvider. `engaged` means the lead clicked the
 * tracked link in that email (proof the automation worked + the lead is ours).
 *
 * Optional fields are simply absent on real scraped leads (no AI brief, score,
 * or deal estimate yet) — the preset below fills everything in so demo mode
 * still shows the full card.
 */

export type SalesStatus = "new" | "contacted" | "closed_won" | "closed_lost";

export interface SalesLead {
  id: string;
  business: string;
  category: string;
  location?: string;
  website?: string;
  phone?: string;
  email?: string;
  rating?: number;
  reviews?: number;
  /** fit / qualification score 0–100 */
  score?: number;
  /** AI-prepared brief the rep reads before the call */
  aiSummary?: string;
  talkingPoints?: string[];
  /** admin has sent the automation's custom email — gates entry to the queue */
  emailSent: boolean;
  emailSentAt: string;
  /** total outreach emails sent to this lead (email_sent ledger tally) */
  emailsSent?: number;
  /** lead clicked the tracked link in the email (attribution confirmed) */
  engaged: boolean;
  engagedAt?: string;
  status: SalesStatus;
  assignedRep?: string;
  /** estimated (open) or realised (won) deal value, USD */
  dealValue?: number;
  /** when it landed in the sales queue */
  receivedAt: string;
  /** set when the rep closes the deal via the close modal */
  closedNote?: string;
  closedAt?: string;
  closedValue?: number;
}

export const SALES_LEADS: SalesLead[] = [
  {
    id: "L-4821",
    business: "Bob's Repair AC, Heating & Solar",
    category: "HVAC services",
    location: "Las Vegas, NV",
    website: "bobsrepair.com",
    phone: "(702) 830-4592",
    email: "info@bobsrepair.com",
    rating: 4.9,
    reviews: 505,
    score: 92,
    aiSummary:
      "Established Las Vegas HVAC contractor with a standout 4.9★ reputation across 505 Yelp reviews — one of the highest review counts in the metro. They install and service AC, heating, and residential solar, and post customer install videos on Facebook, so they invest in marketing and clearly value reputation. A high-volume, brand-conscious operator that would feel the pain of missed inbound leads during the Vegas cooling season.",
    talkingPoints: [
      "505 reviews at 4.9★ — lead with how more qualified inbound protects that reputation",
      "Solar + HVAC mix means higher ticket sizes; ROI conversation lands",
      "Peak summer demand in Vegas — urgency is real",
    ],
    emailSent: true,
    emailSentAt: "Jun 27, 09:12",
    engaged: true,
    engagedAt: "Jun 27, 11:48",
    status: "contacted",
    assignedRep: "Dana Okafor",
    dealValue: 18000,
    receivedAt: "2h ago",
  },
  {
    id: "L-4822",
    business: "Environment Masters",
    category: "HVAC services",
    location: "Madison, MS",
    website: "environmentmasters.com",
    phone: "(601) 921-7727",
    email: "info@environmentmasters.com",
    rating: 4.6,
    reviews: 188,
    score: 88,
    aiSummary:
      "Full-service HVAC and plumbing company serving the Jackson, MS area, open 24 hours — a sign they run an after-hours dispatch operation and care about responsiveness. Active on LinkedIn, Facebook, Instagram, and YouTube, which signals an in-house or contracted marketing function and an appetite for lead channels beyond word of mouth.",
    talkingPoints: [
      "24-hour operation — emergency-call lead routing is a natural hook",
      "Multi-channel social presence: they already buy marketing, easy to expand",
      "Plumbing + HVAC = two service lines to fill",
    ],
    emailSent: true,
    emailSentAt: "Jun 27, 09:12",
    engaged: true,
    engagedAt: "Jun 27, 14:03",
    status: "new",
    assignedRep: "Dana Okafor",
    dealValue: 14500,
    receivedAt: "2h ago",
  },
  {
    id: "L-4823",
    business: "Cascade Plumbing Co.",
    category: "Plumbing",
    location: "Portland, OR",
    website: "cascadeplumbingpdx.com",
    phone: "(503) 244-1180",
    email: "office@cascadeplumbingpdx.com",
    rating: 4.8,
    reviews: 274,
    score: 84,
    aiSummary:
      "Mid-size residential plumbing firm in Portland with a strong 4.8★ over 274 reviews. Their site emphasises same-day service and financing options, suggesting they track conversion closely and would respond well to a cost-per-qualified-lead pitch. No paid-search footprint detected — likely relying on organic and referrals, which is an opening.",
    talkingPoints: [
      "Offers financing — they think in conversion and deal size",
      "No detectable paid search — greenfield channel to pitch",
      "Same-day service promise pairs with fast lead delivery",
    ],
    emailSent: true,
    emailSentAt: "Jun 26, 16:40",
    engaged: false,
    status: "new",
    assignedRep: "Dana Okafor",
    dealValue: 12000,
    receivedAt: "Yesterday",
  },
  {
    id: "L-4824",
    business: "Summit Roofing & Exteriors",
    category: "Roofing contractor",
    location: "Denver, CO",
    website: "summitroofingco.com",
    phone: "(720) 558-3321",
    email: "estimates@summitroofingco.com",
    rating: 4.7,
    reviews: 142,
    score: 81,
    aiSummary:
      "Storm-restoration-focused roofer in the Denver hail belt — their estimates@ inbox and 'free inspection' CTA mean they run a high-volume estimate pipeline where lead speed wins jobs. Seasonal demand spikes after hail events, so a steady qualified-lead feed smooths their boom-bust cycle.",
    talkingPoints: [
      "Hail-driven demand — speed-to-lead is everything in restoration",
      "Free-inspection funnel: they already convert inbound to site visits",
      "High ticket per job — strong ROI on each qualified lead",
    ],
    emailSent: true,
    emailSentAt: "Jun 26, 16:40",
    engaged: true,
    engagedAt: "Jun 26, 18:22",
    status: "contacted",
    assignedRep: "Marco Bianchi",
    dealValue: 22000,
    receivedAt: "Yesterday",
  },
  {
    id: "L-4825",
    business: "Greenline Landscaping",
    category: "Landscaper",
    location: "Austin, TX",
    website: "greenlinetx.com",
    phone: "(512) 770-9043",
    email: "hello@greenlinetx.com",
    rating: 4.5,
    reviews: 96,
    score: 73,
    aiSummary:
      "Design-build landscaping studio in Austin skewing toward higher-end residential projects. Smaller review count (96) but a polished site and Instagram-led brand — they sell on aesthetics and would value pre-qualified leads with real budgets over volume. Best approached as a quality-over-quantity lead conversation.",
    talkingPoints: [
      "Design-build = long sales cycle; lead qualification matters more than volume",
      "Instagram-led brand — they value brand-fit leads",
      "Austin growth market — capacity to take on more projects",
    ],
    emailSent: true,
    emailSentAt: "Jun 26, 11:05",
    engaged: false,
    status: "new",
    assignedRep: "Marco Bianchi",
    dealValue: 9000,
    receivedAt: "Yesterday",
  },
  {
    id: "L-4826",
    business: "Harbor Dental Studio",
    category: "Dental clinic",
    location: "San Diego, CA",
    website: "harbordentalsd.com",
    phone: "(619) 402-7755",
    email: "frontdesk@harbordentalsd.com",
    rating: 4.9,
    reviews: 410,
    score: 90,
    aiSummary:
      "High-end cosmetic and general dental practice with a 4.9★ over 410 reviews — a premium consumer brand that lives and dies by new-patient acquisition. They run Google Ads (call-tracking number on site) so they already buy leads and measure cost-per-acquisition; the pitch is sharper qualified leads at a lower blended CPL.",
    talkingPoints: [
      "Already runs Google Ads — speaks the CPL/CPA language fluently",
      "Cosmetic dentistry = high lifetime value per new patient",
      "410 reviews — reputation-led, wants quality new patients",
    ],
    emailSent: true,
    emailSentAt: "Jun 25, 10:20",
    engaged: true,
    engagedAt: "Jun 25, 12:10",
    status: "closed_won",
    assignedRep: "Dana Okafor",
    dealValue: 26000,
    receivedAt: "2 days ago",
    closedAt: "Jun 25",
    closedValue: 26000,
    closedNote:
      "Signed a 12-month new-patient acquisition retainer. Decision-maker is Dr. Chen; office manager Lia handles billing. Wants monthly CPL reporting and a 30-day ramp review — flag at day 25.",
  },
  {
    id: "L-4827",
    business: "Ironclad Garage Doors",
    category: "Garage door supplier",
    location: "Phoenix, AZ",
    website: "ironcladgaragedoors.com",
    phone: "(602) 318-6644",
    email: "service@ironcladgaragedoors.com",
    rating: 4.4,
    reviews: 63,
    score: 68,
    aiSummary:
      "Owner-operator garage-door install and repair shop in Phoenix. Modest review count and a basic website — likely a smaller team without dedicated marketing, so the conversation should be simple and outcome-led (more booked jobs, less admin) rather than channel jargon. Price sensitivity is likely.",
    talkingPoints: [
      "Small team — keep it concrete: more booked jobs, less chasing",
      "Likely price-sensitive: lead with a low-risk starter offer",
      "Repair work is recurring and fast-closing",
    ],
    emailSent: true,
    emailSentAt: "Jun 25, 10:20",
    engaged: false,
    status: "closed_lost",
    assignedRep: "Marco Bianchi",
    dealValue: 0,
    receivedAt: "2 days ago",
  },
  {
    id: "L-4828",
    business: "Lumen Electric",
    category: "Electrician",
    location: "Seattle, WA",
    website: "lumenelectricwa.com",
    phone: "(206) 555-0148",
    email: "dispatch@lumenelectricwa.com",
    rating: 4.8,
    reviews: 219,
    score: 86,
    aiSummary:
      "Residential and light-commercial electrical contractor in Seattle with a 4.8★ over 219 reviews and an EV-charger install line — a fast-growing, high-margin segment. They have a dispatch inbox and book online, so they're operationally ready to absorb more qualified leads without adding admin overhead.",
    talkingPoints: [
      "EV-charger installs — booming, high-margin segment to fill",
      "Online booking + dispatch inbox: operationally ready for volume",
      "Light-commercial work means larger contract values",
    ],
    emailSent: true,
    emailSentAt: "Jun 24, 15:55",
    engaged: true,
    engagedAt: "Jun 24, 16:30",
    status: "closed_won",
    assignedRep: "Dana Okafor",
    dealValue: 19500,
    receivedAt: "3 days ago",
    closedAt: "Jun 24",
    closedValue: 19500,
    closedNote:
      "Closed on the EV-charger lead package. Owner Marcus is hands-on — route leads to dispatch@ and CC the owner. Start date Jul 1; revisit volume after two weeks.",
  },
];

export const SALES_REP = "Dana Okafor";
