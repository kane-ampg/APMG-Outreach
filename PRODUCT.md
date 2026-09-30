# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Two audiences share this codebase, and they never see each other's surfaces.

- **Prospective clients (the customer portal, `/portal` on `customer.apmgservices.com.au`).** These are facility managers, strata and body-corporate managers, operations leads and property owners across Melbourne and regional Victoria. Most arrive from a cold outreach email or a social post, usually on a phone, deciding within seconds whether APMG Services is a real, capable business worth replying to. Their job is to work out whether one contractor can cover the trades they currently juggle, and then to start an enquiry without friction.
- **APMG staff (the internal console on `admin.apmgservices.com.au`).** Sales reps, the operator (Kane) and management run outreach, read the click trail and work enquiries. They preview the customer portal from the console's "Our Services" tab.

## Product Purpose

APMG Services is a Melbourne property-maintenance group: eight trades under one team, trading since 2015. The customer portal turns outreach attention into enquiries. Success is a visitor who understands "every trade, one partner" at a glance, trusts that the business is real, and sends an enquiry or calls.

## Positioning

One accountable partner for electrical, plumbing, painting, carpentry and joinery, flooring, gardening and grounds, handyman and property make-safe work, scheduled against one programme instead of eight separate contractors. The method is part of the offer: a site visit before a quote, itemised pricing, and work staged around occupied buildings such as aged care, childcare and schools.

## Operating Context

- Visitors land on `/portal` from tracked `/t/[id]` outreach links or `?utm_source=` social links. Attribution cookies and a sector message-match line come from `/api/portal/context`.
- Enquiries go to `/api/portal/inquiries`. The server refuses any enquiry without a valid email and the current published consent version (`/api/portal/legal`).
- Funnel telemetry: `portal_view` fires once per landing, and `portal_service_open` / `portal_inquiry_submit` / `consent_accept` fire on the customer host only. The console preview emits `services_card_open` instead, so staff demos never inflate the funnel.
- The one-click unsubscribe must be reachable from every portal page an outreach recipient can land on.
- The project runs on Vercel's free tier; Fast Origin Transfer is the binding cost, so per-request HTML weight matters.

## Capabilities and Constraints

- Sectors served: retirement villages, health and aged care, early childhood centres, schools, strata and body corporate, commercial and retail, hospitality, local government.
- The featured trade on `/portal` is picked at random on the server for each request (`force-dynamic`) and must never be re-rolled on the client.
- Public contact: 1300 97 97 40, kane@apmgservices.com.au, 1 Tesmar Cct, Chirnside Park VIC. ABN 63 633 883 897. The legal entity and ACN are still outstanding.

## Brand Commitments

- Always "APMG Services". Australian English. Professional, direct, confident and respectful; never pushy, never slang, never small-handyman wording (Company-Brief.md).
- Real logo assets are `public/images/brand/apmg-logo-ink.webp` and `apmg-logo-white.webp`.
- Claims confirmed by Kane on 2026-09-29: 24/7 property make-safe; hours Mon–Sat, 7am–5pm; quoted and replied to within one business day; no call-out fee on quoted work.

## Evidence on Hand

- Google listing: 5.0 from 22 reviews, transcribed verbatim in `components/apmg/googleReviews.ts`. Verbatim only; never paraphrase or invent.
- Real photography: the fleet and headquarters (`app/apmgbg.jpg`), the full crew (`app/apmgteam.jpg`), one job photo per trade (`app/services/*.png`), and headshots (`app/team/*.jpg`).
- The group's 29-second aerial reel of Melbourne, from the Commercial Painters site, now the portal hero (`public/video/hero-720.mp4`, no poster image), added 2026-09-30 at Kane's request.
- Each trade's client-published description and "what's included" list in `components/apmg/portal/data.ts`, carried verbatim from apmgservices.com.au.
- **Absent, so never fabricate:** REC and plumbing licence numbers, warranty length, any "on site within N hours" figure, client logos, insurance claims, job counts.

## Product Principles

1. Prove, don't boast: every figure on a customer surface must be substantiated, with checkable third-party proof preferred.
2. One call is enough. The visitor never needs to know which trade their problem is.
3. Respect the funnel: telemetry names are a contract, and staff previews never write customer events.
4. The customer surface is a trust surface: light, legible and calm, with nothing of the internal console's voice.

## Accessibility & Inclusion

WCAG 2.2 AA on the customer portal: a skip link, one `main` landmark, real headings, visible focus, and reduced-motion fallbacks for every animation.
