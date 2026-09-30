---
name: APMG Services Customer Portal
description: Every trade, one partner. The page cold-email visitors land on, proved with real photographs of real APMG people and fleet.
colors:
  ivory: "#f7f5f1"
  paper: "#ffffff"
  sand: "#efebe5"
  ink: "#171614"
  ink-2: "#3d3932"
  muted: "#57524a"
  line: "#e2ddd5"
  line-2: "#c9c2b8"
  char: "#131210"
  char-2: "#1e1c19"
  char-line: "#4a453e"
  char-line-hover: "#6d6760"
  on-dark: "#cfc9c0"
  on-dark-strong: "#e8e4de"
  on-dark-muted: "#b9b2a8"
  on-dark-dim: "#a49d94"
  red: "#b3121d"
  red-hover: "#8c0d16"
  red-bright: "#ec5256"
typography:
  display:
    fontFamily: "Bitter, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(40px, 5vw, 70px)"
    fontWeight: 700
    lineHeight: 1.02
    letterSpacing: "-0.02em"
  headline:
    fontFamily: "Bitter, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(30px, 3.4vw, 46px)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  headline-sm:
    fontFamily: "Bitter, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(28px, 3vw, 40px)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  headline-xs:
    fontFamily: "Bitter, Georgia, 'Times New Roman', serif"
    fontSize: "clamp(28px, 3vw, 38px)"
    fontWeight: 700
    lineHeight: 1.12
    letterSpacing: "-0.015em"
  title:
    fontFamily: "Bitter, Georgia, 'Times New Roman', serif"
    fontSize: "26px"
    fontWeight: 700
    lineHeight: 1.15
    letterSpacing: "-0.015em"
  title-md:
    fontFamily: "Bitter, Georgia, 'Times New Roman', serif"
    fontSize: "22px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  title-sm:
    fontFamily: "Bitter, Georgia, 'Times New Roman', serif"
    fontSize: "19px"
    fontWeight: 700
    lineHeight: 1.2
    letterSpacing: "-0.015em"
  quote:
    fontFamily: "Bitter, Georgia, 'Times New Roman', serif"
    fontSize: "19px"
    fontWeight: 600
    lineHeight: 1.5
  body-lg:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "20px"
    fontWeight: 400
    lineHeight: 1.55
  body-lead:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "18px"
    fontWeight: 400
    lineHeight: 1.6
  body:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 400
    lineHeight: 1.6
  body-sm:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "15px"
    fontWeight: 400
    lineHeight: 1.6
  caption:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "14px"
    fontWeight: 400
    lineHeight: 1.5
  button:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "16px"
    fontWeight: 600
    lineHeight: 1.2
  button-lg:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "17px"
    fontWeight: 600
    lineHeight: 1.2
  label:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "13px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.16em"
  label-xs:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "12px"
    fontWeight: 700
    lineHeight: 1.5
    letterSpacing: "0.14em"
  label-sm:
    fontFamily: "Archivo, 'Helvetica Neue', Helvetica, Arial, sans-serif"
    fontSize: "11px"
    fontWeight: 600
    lineHeight: 1.5
    letterSpacing: "0.14em"
rounded:
  none: "0px"
spacing:
  gutter: "24px"
  pad-desktop: "64px"
  pad-tablet: "40px"
  pad-phone: "20px"
  section: "88px"
  section-phone: "56px"
  panel: "48px"
  measure: "1312px"
components:
  button-primary:
    backgroundColor: "{colors.red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0 26px"
    height: "52px"
    typography: "{typography.button}"
  button-primary-hover:
    backgroundColor: "{colors.red-hover}"
    textColor: "{colors.paper}"
  button-primary-lg:
    backgroundColor: "{colors.red}"
    textColor: "{colors.paper}"
    rounded: "{rounded.none}"
    padding: "0 34px"
    height: "62px"
    typography: "{typography.button-lg}"
  button-ghost:
    backgroundColor: "transparent"
    textColor: "{colors.ivory}"
    rounded: "{rounded.none}"
    padding: "0 34px"
    height: "62px"
    typography: "{typography.button-lg}"
  card:
    backgroundColor: "{colors.paper}"
    textColor: "{colors.ink}"
    rounded: "{rounded.none}"
    padding: "26px 30px 30px"
  tag:
    backgroundColor: "{colors.char}"
    textColor: "{colors.paper}"
    typography: "{typography.label-sm}"
    rounded: "{rounded.none}"
    padding: "6px 12px"
  chip:
    backgroundColor: "transparent"
    textColor: "{colors.ink-2}"
    rounded: "{rounded.none}"
    padding: "8px 14px"
  input-dark:
    backgroundColor: "{colors.char-2}"
    textColor: "{colors.ivory}"
    rounded: "{rounded.none}"
    padding: "14px 16px"
    height: "52px"
---

# Design System: APMG Services Customer Portal

> **Scope.** This file describes the customer portal only: `/portal` on the customer host, and the same page rendered inside the internal console's "Our Services" preview tab. The internal console in this repository is a separate, dark-first "signal console" world, documented in `ui-standards.md`. Nothing here applies to it, and nothing in `ui-standards.md` applies here. Do not borrow tokens across the boundary in either direction.

## Overview

**Creative North Star: "The Yard Ledger"**

The portal reads like a well-run trade business's own paperwork set in daylight: an ivory ground, charcoal slabs where the business speaks with authority (the utility bar, the hero, the make-safe tile and the enquiry), one deep red for the next action, and real photographs of APMG's own jobs and people doing the persuading, with the group's own reel filling the hero behind the copy. It is pinned to the reference Kane supplied (`docs/superpowers/specs/index.html`), and its class names follow that file so the two can be read side by side. It is deliberately not a SaaS landing page. There is no glass, no illustration, no rounded cards and no shadows, and exactly one gradient: the charcoal wash that keeps the hero copy readable over the reel. Every surface is a rectangle drawn with a 1px warm hairline.

The density is editorial rather than dashboard-like. On laptops and desktops every section is exactly one screen and the page snaps between them, content caps at a 1312px measure while the charcoal slabs run full bleed behind it, and the type pairing does the hierarchy work: Bitter, a sturdy slab-leaning serif, for anything that is a claim or a name, and Archivo for everything that explains. Uppercase, widely tracked eyebrows mark the start of each section, as a ledger's column heads would.

The page earns trust with checkable facts, not adjectives. The visual system is built so that proof (a Google rating, a founding year, a photo of the actual van) carries the weight a decorative flourish would carry elsewhere. The page's truthfulness is a design rule, not only a copy rule: see the Proof Before Polish Rule below.

**Key Characteristics:**
- Pinned light. Ivory and white surfaces, charcoal slabs, never theme-switched.
- One accent: deep red on light, a brighter red on charcoal.
- Bitter display over Archivo body. Serif for claims and names, sans for explanation.
- Square corners everywhere, 1px warm hairlines, no shadows.
- Real APMG photography in every card, with a sand placeholder while it loads.
- One screen per section on laptops and desktops, snapping between them; phones scroll naturally.
- Three authored motions only (the hero entrance, the nav rule and the down button's nudge), plus the hero reel, all motion-safe. Hover responses stay small.

## Colors

A warm neutral ledger (ivory, paper, sand and a charcoal family, all tinted slightly toward yellow-brown) carrying a single deep brick red.

### Primary
- **Brick Red** (`red`): the one accent on light surfaces. Primary buttons, the nav's sliding rule, step numbers, review stars, the trust strip's star, plain text links and hover states on header and footer links. Sits at 6.4:1 on ivory; white text on it is 6.9:1.
- **Kiln Red** (`red-hover`): the pressed-in step of Brick Red. Hover and disabled/in-progress states of red controls only.
- **Signal Red on Charcoal** (`red-bright`): the red for dark surfaces, and the portal-wide focus ring. Eyebrows on the hero and the make-safe tile, required-field asterisks, form errors and alerts, the sector message-match rule. The reference had `#E23B3F` here; the build brightened it one step because the 13px eyebrows set in it measured 4.4:1 on charcoal. This value measures 5.3:1. That divergence is intentional and stays.

### Neutral
- **Ivory** (`ivory`): the page ground, and the text colour on charcoal slabs.
- **Paper** (`paper`): the white of trade tiles, review cards and team cards, the sticky header, the trust strip and the footer. Paper on ivory is the portal's only form of layering.
- **Sand** (`sand`): photo placeholders (every photo frame's background).
- **Ink** (`ink`): headings and primary text on light surfaces.
- **Ink Soft** (`ink-2`): reserved for longer reading copy on light surfaces. Unused since the featured card and its chips were retired on 2026-09-30.
- **Muted Stone** (`muted`): ledes, card copy, captions, eyebrows on light, inactive nav links. 7.1:1 on ivory.
- **Hairline** (`line`): every 1px border on light surfaces: cards, header base, trust dividers, chips, footer rules.
- **Hairline Strong** (`line-2`): the hover state of a hairline (card hover, social links) and the unsubscribe input's border.
- **Charcoal** (`char`): the slabs (utility bar, hero, enquiry), the make-safe tile, and the 3px rule over each process step. Also the featured tag.
- **Charcoal Raised** (`char-2`): photo frames and form inputs set on charcoal.
- **Charcoal Rule** (`char-line`): hairlines on charcoal: ghost-button border, consent and done-panel frames, input borders at rest.
- **Charcoal Rule Hover** (`char-line-hover`): the hover step of Charcoal Rule, on ghost buttons and inputs.
- **On-Dark** (`on-dark`): body copy on charcoal. 11.4:1.
- **On-Dark Strong** (`on-dark-strong`): emphasised text and links in the utility bar, and the hero's sector line.
- **On-Dark Dim** (`on-dark-dim`): fine print on charcoal (hero fineprint, form notes, consent document line). 7.0:1.

### Named Rules

**The One Red Rule.** Red is the only chromatic colour in the portal. It marks action, the current section, and the few ratings and numbers that carry proof (stars and step numbers). A second accent hue does not exist; if a new element needs emphasis, use Charcoal, weight or Bitter, not a new colour.

**The Two Reds Rule.** Brick Red belongs on light surfaces and Signal Red belongs on charcoal. Small red text on charcoal is always Signal Red; filled red buttons stay Brick Red on both, because white-on-Brick is what passes.

**The Pinned Light Rule.** The portal owns its tokens under `.portal-world` in plain CSS and never reads the console's semantic Tailwind variables. A staff member's dark-mode preference must not move a single pixel of the customer page.

## Typography

**Display Font:** Bitter 600/700 (with Georgia, "Times New Roman", serif)
**Body Font:** Archivo 400/500/600/700 (with "Helvetica Neue", Helvetica, Arial, sans-serif)

Both are self-hosted through `next/font` (`components/apmg/portal/fonts.ts`), with no runtime request to a font CDN.

**Character:** Bitter is a workmanlike slab-serif: it sets claims, names and quotes with the weight of a signwritten van door. Archivo is a plain grotesque that stays out of the way for explanation, labels and form text.

### Hierarchy
- **Display** (Bitter 700, clamp 40 to 70px, 1.02, -0.02em): the hero headline only. There is exactly one.
- **Headline** (Bitter 700, clamp 30 to 46px, 1.12): the lead section heading (Services), the first heading after the hero.
- **Headline Small** (Bitter 700, clamp 28 to 40px): the How we work, Reviews and Team section headings. The done-panel's 28px title sits in the same band.
- **Headline Extra Small** (Bitter 700, clamp 28 to 38px): the enquiry heading, at the reference's own size.
- **Title** (Bitter 700, 26px, 1.15): the "What you can hold us to" heading.
- **Title Medium** (Bitter 700, 22px, 1.2): trade tile names, trust strip facts, process step names and the footer's company name.
- **Title Small** (Bitter 700, 19px, 1.2 to 1.25): commitment items, team names (17px on phones), the make-safe tile's number, and trade tile and step names in one-screen mode.
- **Quote** (Bitter 600, 19px, 1.5): Google review text, verbatim. 16px in one-screen mode, so the longest review still fits its card.
- **Body Large** (Archivo 400, 20px, 1.55): the hero copy only (Body Lead on phones), max 590px.
- **Body Lead** (Archivo 400, 18px, 1.6): the hero copy on phones. The review stars glyph is set at the same 18px.
- **Body** (Archivo 400, 16px, 1.6): ledes and general copy, measure capped at 760px in a heading stack.
- **Body Small** (Archivo 400, 15px, 1.6): step and commitment copy (Caption size in one-screen mode); footer links.
- **Caption** (Archivo 400, 14px, 1.5): trade tile copy, trust-strip source lines, review captions and the reviews count, team roles, fine print and form notes.
- **Button** (Archivo 600, 16px, 1.2; large 17px): every button. 17px is also the enquiry copy size and the phone-size team name.
- **Label** (Archivo 700, 13px, 0.16em, uppercase): section eyebrows. Form field labels use the same size at 600 and 0.1em.
- **Label Small** (Archivo 600, 11px, 0.14em, uppercase): the featured tag and the brand sub-line.
- **Label Extra Small** (Archivo 700, 12px, 0.14em, uppercase): footer column heads.

### Named Rules

**The Serif Claims Rule.** Bitter sets things a visitor could check or quote: headings, trade and people names, facts in the trust strip, the phone number in the header, and review text. Archivo sets everything that explains or instructs. Do not set body paragraphs in Bitter or headings in Archivo.

**The Font Wrapper Rule.** The `portal-fonts` class remaps the app-wide `--font-sans` and `--font-display` to Archivo and Bitter. It sits on a wrapper outside `.portal-world`, so the shared Tailwind pieces rendered beside the page (enquiry modal, chat, legal modals) also set in the portal's faces rather than the console's Inter and Fraunces. Any new portal-adjacent overlay must mount inside that wrapper.

## Layout

One document page, top to bottom: utility bar, sticky header, charcoal hero beside the reel, the four-fact trust strip, trades, process and commitments, reviews, team, the charcoal enquiry block, footer.

- **Measure and bleed.** Horizontal padding is `max(pad, (100% - 1312px) / 2)`. Slab backgrounds run full width; their content never exceeds the 1312px measure. Nothing stretches edge to edge on a wide monitor.
- **Side padding.** 64px on desktop, 40px at 1180px and below, 20px at 720px and below.
- **Section rhythm.** Below the one-screen breakpoint, 88px between sections (56px on phones). Inside a section, heading-to-content is 24 to 36px and grid gutters are 20 to 24px.
- **Grids.** Trades in fours (two rows of four: the featured trade first, make-safe last), reviews three to a view in a sideways track, process in fives, commitments in threes beside their intro, team in one row of eight, trust facts in fours. At 1180px trades, process and reviews fall to twos, the team to fours, and the hero, commitments and enquiry stack to one column. At 720px everything but the team roster (twos) goes to one column, the reviews track shows one card and a sliver of the next, and full-width buttons take the width, except the paired hero actions, which flex side by side.
- **Header.** Sticky at 88px on tablet and desktop. On phones it goes static and the nav becomes a horizontally scrolling row under a hairline.
- **Scroll offsets.** Sections carry `scroll-margin-top` equal to the header height (plus 8px below the one-screen breakpoint), so an in-page jump never hides a heading under the sticky header.
- **One screen per section.** From 1181px wide and 700px tall, the first screen (utility bar, header, hero, trust strip) and every section after it are exactly one viewport, and the customer host snaps between them (`scroll-snap-type: y mandatory` on the document, opted in by `.portal-snap`). Photographs flex to the height the text leaves them; text never clips, because every screen is `min-height: fit-content`. The footer is the last snap point, aligned to its end. Below that breakpoint the page scrolls naturally.
- **Breakpoints.** 1180px, 900px (the header phone number hides) and 720px. These come from the reference.

### Named Rules

**The Measure Rule.** Content caps at 1312px while slabs stay full bleed. A trade tile never grows past the reference's own 1440px composition.

**The One Screen Rule.** On laptops and desktops a section is one screen and no more. New content in a section has to be paid for inside that screen, by flexing a photograph or tightening a step, never by letting the section grow. Anything that would need a second screen belongs in a sideways track or a modal.

## Elevation & Depth

The portal is flat. There is no `box-shadow` anywhere in the world. Depth is conveyed by exactly two means: tonal layering (paper cards on the ivory ground, charcoal-raised inputs and photo frames on charcoal slabs) and 1px hairlines. The sticky header separates from the page with a hairline under it, not a shadow.

### Named Rules

**The Hairline, Not Shadow Rule.** If a surface needs to lift, it goes one tone lighter (ivory to paper, charcoal to charcoal-raised) and takes a 1px hairline. Hover raises a hairline to Hairline Strong. It never grows a shadow.

## Shapes

Every corner is square (0px): buttons, cards, inputs, chips, tags, photo frames, panels and the skip link. Borders are 1px warm hairlines. There are two heavier strokes, each with a single job: the 3px charcoal rule over each process step (which reads as a sequence), and the 2px red rule under the current nav link. Photographs are cropped with `object-fit: cover` into frames (16:10 trade tiles, 1:1 portraits and a 1920:620 crew panorama below the one-screen breakpoint; in one-screen mode the tile and crew frames flex to the height left to them, and on phones the crew panorama is 16:7, zoomed toward its top edge), and every frame has a sand or charcoal-raised background so an unloaded image is still a clean rectangle.

## Components

### Buttons
Blunt and full-height, like a label on a switchboard.
- **Shape:** square (0px), 52px tall, 26px side padding, Archivo 600 16px. Large size: 62px tall, 34px padding, 17px.
- **Primary:** Brick Red with white text. One primary per viewport region: the header's "Get a quote", the hero's main action, the enquiry submit.
- **Hover / Focus:** background steps to Kiln Red over 160ms. A trailing arrow glyph nudges 3px right on hover (220ms, ease-out). Focus is a 3px Signal Red outline, offset 2px.
- **Ghost (on charcoal only):** transparent with a 1px Charcoal Rule border and ivory text; hover brightens the border to Charcoal Rule Hover and the text to white. It is the hero's phone-number button.
- **Underlink:** a text button with a 2px Hairline underline that turns red on hover. It is a secondary action beside a heading ("Read them on Google"). On charcoal the underline starts as Charcoal Rule and turns Signal Red.
- **Step buttons:** 48px paper squares with a 1px Hairline Strong border and a plain arrow glyph, beside the reviews heading. Hover takes the border to Ink; at either end of the track the button disables to Hairline grey.

### Chips and Tags
- **Tag:** a solid charcoal block, white 11px uppercase tracked label. There is one, "Featured trade", set over the featured tile's photograph, 12px in from its top-left corner.

### Cards / Containers
- **Corner Style:** square (0px).
- **Background:** Paper on the ivory ground.
- **Shadow Strategy:** none (see Elevation & Depth).
- **Border:** 1px Hairline, rising to Hairline Strong on hover (200ms).
- **Trade tile:** leads with its trade's own photograph (16:10, or flexed in one-screen mode), which scales to 1.035 on hover over 900ms; then the Bitter name, one Caption line and "Tell me more". Padding 18px 20px 20px (14px 18px 16px in one-screen mode).
- **Whole-tile target:** the visible "Tell me more" is a real button whose `::after` stretches over the tile. The trade name stays a real `h3`. Keyboard focus draws the 3px Signal Red ring around the whole tile.
- **Review card:** paper, 1px Hairline, 28px padding (24px in one-screen mode); stars, the verbatim quote, then the author and age pinned to the foot.

### Inputs / Fields
- **Style:** set on the charcoal enquiry slab. Charcoal Raised fill, 1px Charcoal Rule border, square, 52px minimum height, ivory 16px text; textareas are 120px minimum and resize vertically. Labels sit above in the 13px uppercase label style.
- **Focus:** a 3px Signal Red outline at zero offset. Hover raises the border to Charcoal Rule Hover.
- **Error:** the border turns Signal Red and a 14px Signal Red hint sits beneath. Form-level alerts are a 1px Signal Red frame with white text.
- **Consent:** a framed block with a 20px native checkbox (red accent colour). It is required: the server refuses an enquiry without the current consent version.
- **Light variant:** the footer's one-click unsubscribe uses a 40px paper input with a Hairline Strong border and a 40px Brick Red button.

### Navigation
- **Utility bar:** a 40px charcoal strip. Hours on the left; ABN, the main website and "24/7 make-safe" with the phone number on the right. Phones drop the ABN and service area to keep it to two lines.
- **Header:** paper, sticky, 88px, with a hairline under it. The logo (ink asset, 50px) and Bitter wordmark on the left, section links in Archivo 500 15px Muted Stone, then the Bitter phone number and the primary button.
- **Current section:** a scroll-spy marks the link for the section in a thin band just above the middle of the viewport, `aria-current="true"`, in Ink. One 2px Brick Red rule slides under it (420ms, ease-out) and fades out above the first section and inside the enquiry block. On phones the sliding rule is replaced by a per-link 2px red underline.
- **In-page jumps** scroll smoothly (instantly with reduced motion) and move focus to the section. Only the customer host writes the hash to the URL.

### Hero Reel
The group's 29-second reel (`public/video/hero-720.mp4`, from the Commercial Painters site) is the whole charcoal hero's background, edge to edge behind the copy, with no poster image: Kane had the placeholder frame removed and the reel made full-bleed on 2026-09-30. The video is server-rendered, fades up from charcoal on its first decoded frame (1200ms), plays while the hero is on screen and pauses whenever it leaves. Under reduced motion or Save-Data it stays paused on its own first frame, fetched with `preload="metadata"` only. A 44px square pause toggle sits top right, aligned to the content edge, on a 60% charcoal wash, as WCAG 2.2.2 requires. Only the 720p encode ships.

Between the footage and the copy sits `.hero-scrim`: 92% to 90% charcoal behind the copy column, easing to 55%, 22% and 12% across the right so the footage carries that side; a flat 90% where the hero is one column (1180px and below). Over the reel's brightest frames (a hazy white sky, a fluorescent-lit office) that holds the hero's body copy and fine print at about 4.8:1. The hero's eyebrow is On-Dark Strong with a short Signal Red rule in front, not red text, because 13px red cannot hold contrast over those frames through any wash that still shows the video.

### Down Button
The first screen's one hint that the page continues: a Charcoal Raised block reading "See all eight trades" with a Brick Red arrow square, hung on the seam between the hero and the trust strip and centred on the page. It steps to the services screen. The arrow drops 4px three times once the hero has settled, then stays still (motion-safe only). Hidden on phones, where the hero is taller than the screen.

### Hero Entrance (signature motion)
The page's one authored entrance. The copy rises 18px into place in sequence (700ms each, 70ms stagger via `--i`) while the reel fades up behind it. Both are gated by `prefers-reduced-motion: no-preference`. The resting state is the finished page, so a reduced-motion visitor simply gets the page.

### Make-safe Tile (signature component)
The emergency trade is the grid's eighth and only charcoal tile: its photo, a Signal Red "24/7 emergency" eyebrow, the Bitter name, then the phone number as a Bitter call link and a "What we cover" link to its modal. It has no stretched target, because the call is the point. It never rotates into the featured tile.

## Do's and Don'ts

### Do:
- **Do** scope every rule as `.portal-world .some-class`. Target classes, never bare elements (`a`, `p`, `h2`, `button`). The legal modals and the unsubscribe control render inside the scope with their own Tailwind utilities, and a bare-element rule would outrank and repaint them.
- **Do** mount the enquiry modal, the chat and any future overlay outside `.portal-world` but inside the `portal-fonts` wrapper, as `PortalShell` does. Outside, so scoped rules can never repaint their Tailwind styling. Inside the wrapper, so they still set in Bitter and Archivo.
- **Do** back every figure and claim on the page with PRODUCT.md's Evidence on Hand. Derive counts from data (the trade count is `SERVICES.length`, the rating and count come from the transcribed Google listing, the year is `FOUNDED`), and quote reviews and trade descriptions verbatim.
- **Do** roll the featured trade on the server per request (`force-dynamic` in `app/portal/page.tsx`) and pass it down as `spotlight`. Never re-roll it on the client, because the first tile on the page would reflow after hydration.
- **Do** take funnel event names from `useEnquiry().openEvent` and gate customer-only behaviour on `standalone`. The customer host emits `portal_service_open` and `portal_view`; the console preview emits `services_card_open` and never writes customer events, a skip link, a second `main`, or the unsubscribe.
- **Do** use real APMG photography for every photographic frame (crew, one job photo per trade, headshots), and the group's own reel in the hero, each on a sand or charcoal-raised placeholder.
- **Do** keep bottom-right content clear of the fixed chat launcher (56px, 20px from the corner). One-screen sections put content in that corner, so controls belong at the top of a section, and the last column of a row keeps 16px of right padding.
- **Do** use Signal Red for any small red text on charcoal, and the 3px Signal Red ring for every focus state.
- **Do** gate every animation behind `prefers-reduced-motion: no-preference`, with the finished page as the resting state.

### Don't:
- **Don't** add `box-shadow`, gradients or rounded corners to anything inside `.portal-world`. The one exception is the Scrim Rule's hero wash.

**The Scrim Rule.** A gradient is allowed only as a legibility wash between moving or photographic media and text set on it, measured against the media's brightest frame, never as decoration. Today there is exactly one: `.hero-scrim`.
- **Don't** introduce a second accent hue, or put Brick Red text on charcoal.
- **Don't** consume the console's Tailwind semantic colour variables or its `dark` theme inside the portal. The portal is pinned light.
- **Don't** add any figure the evidence does not hold: licence numbers, warranty lengths, "on site within N hours", client logos, insurance claims or job counts. Nothing unbacked goes in the trust strip.
- **Don't** use stock photography, illustration or icon grids in place of the real photographs.
- **Don't** let make-safe rotate into the featured tile, or move it out of the eighth, charcoal cell. The grid stays at exactly eight.
- **Don't** add new authored motion beyond the hero entrance, the nav rule, the down button's nudge and the hero reel. Small hover responses (the arrow nudge, the photo scale, colour and border steps) are part of the world, and that is where motion stops.
- **Don't** treat the 1px Charcoal Rule border as a sufficient input boundary for new controls on charcoal. At rest it measures 1.8:1 against Charcoal Raised, below the 3:1 non-text target. The existing fields rely on their labels and fill; that is a known gap, not a pattern to copy.
