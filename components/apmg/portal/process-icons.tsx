import type { CSSProperties, ReactNode } from "react";

/**
 * Process glyphs for the customer portal.
 *
 * Ported from the APMG Painting site (components/icons/process-icons.tsx) so
 * the two customer-facing surfaces read as one business. One mark per stage of
 * "What happens after you enquire", all drawn on the same 24x24 grid with the
 * same stroke treatment.
 *
 * They exist for one reason: the rail is five near-identical text columns, and a
 * reader skimming it has nothing to fix on between the first stage and the last.
 * A glyph gives each stage a silhouette, and — because each one acts out its
 * stage as the red line reaches it — lets the sequence be read at a glance
 * rather than word by word.
 *
 * ## Each glyph performs its own stage
 *
 * The message writes itself, the pin drops onto ground that redraws under it,
 * the quote is written, the roller runs and lays its band of paint, and the key
 * turns in the lock. The moving parts are marked with `glyph-*` classes;
 * `.process-rail__glyph` in app/portal/portal-world.css owns the timing, and
 * every one of those animations is written to end exactly where it started, so
 * it can loop forever without a reset frame.
 *
 * ## Nothing here depends on the animation running
 *
 * Every glyph is drawn complete and legible at rest: the writing is written, the
 * key is whole. A reader who asked for less motion, or an engine that ignores
 * the keyframes, gets a finished icon rather than an empty one. That is why the
 * sweeps are dash OFFSETS over a fully drawn path rather than a
 * `stroke-dasharray` that starts hidden — there is no state in this file that
 * only JavaScript or a keyframe can undo.
 */

/** Marks a stroke that sweeps away and back, as if being written. */
const WRITE = "glyph-write";

/** Staggers one part behind the rest of its glyph — a second line of writing. */
const beat = (seconds: number) => ({ "--glyph-beat": `${seconds}s` }) as CSSProperties;

/**
 * Enquiry: a message, writing itself.
 *
 * The first contact, before anyone has been to site — someone typing out what
 * has gone wrong and where.
 */
function EnquiryGlyph() {
  return (
    <>
      <path d="M4 4.5h16A1.5 1.5 0 0 1 21.5 6v9a1.5 1.5 0 0 1-1.5 1.5h-9.6L6 20.5v-4H4A1.5 1.5 0 0 1 2.5 15V6A1.5 1.5 0 0 1 4 4.5Z" />
      <path className={WRITE} pathLength={1} d="M6.5 9h11" />
      <path className={WRITE} pathLength={1} style={beat(0.24)} d="M6.5 12.5h7" />
    </>
  );
}

/**
 * Site visit: a pin dropping onto the ground and marking it.
 *
 * The stage is the attendance itself, so the glyph is the moment of arriving
 * somewhere rather than a static marker. The ground rule is what makes the drop
 * legible — a pin bouncing against nothing is just a bouncing pin — and it
 * redraws itself under the landing, so the mark is placed rather than merely
 * present.
 *
 * That rule replaced a ripple ring, which could not be made to work at this
 * size: a CSS `scale` on an SVG element scales its stroke with it, so a ring
 * expanding to 2x arrives twice as thick as it left, and at four pixels tall it
 * closes its own hole and reads as a blot under the pin.
 */
function SiteVisitGlyph() {
  return (
    <>
      <path className={WRITE} pathLength={1} d="M4.5 21h15" />
      <g className="glyph-drop">
        <path d="M12 20s5.5-4.9 5.5-9a5.5 5.5 0 1 0-11 0c0 4.1 5.5 9 5.5 9Z" />
        <path d="M14 11a2 2 0 1 1-4 0 2 2 0 0 1 4 0Z" />
      </g>
    </>
  );
}

/** The itemised quote: a document with its two lines being set down. */
function QuoteGlyph() {
  return (
    <>
      <path d="M14 2.5H6.5A1.5 1.5 0 0 0 5 4v16a1.5 1.5 0 0 0 1.5 1.5h11A1.5 1.5 0 0 0 19 20V7.5Z" />
      <path d="M14 2.5v5h5" />
      <path className={WRITE} pathLength={1} d="M8.5 13h7" />
      <path className={WRITE} pathLength={1} style={beat(0.24)} d="M8.5 16.5h4.5" />
    </>
  );
}

/**
 * Work around your operations: a roller running, laying its band of paint.
 *
 * The roller pulls back and then pushes forward, because that is the direction
 * the band fills in: a dash offset grows a stroke from the start of its path, so
 * the paint appears left to right and the roller has to be travelling left to
 * right underneath it or it reads as taking the coating off.
 *
 * The band is the one stroke in the set drawn heavier than 1.5 — not drift, but
 * depiction. Paint laid by a roller is thick, and at 1.5 the band reads as
 * another hairline rule rather than as coating on a wall.
 */
function DeliveryGlyph() {
  return (
    <>
      <path className={WRITE} pathLength={1} strokeWidth={3} d="M3.5 3h17" />
      <g className="glyph-roll">
        <path d="M6.5 6.5h8a1.5 1.5 0 0 1 1.5 1.5v1.5A1.5 1.5 0 0 1 14.5 11h-8A1.5 1.5 0 0 1 5 9.5V8a1.5 1.5 0 0 1 1.5-1.5Z" />
        <path d="M16 8.75h2.5a1.75 1.75 0 0 1 1.75 1.75v1.75a1.75 1.75 0 0 1-1.75 1.75H13V15" />
        <path d="M11.75 15h2.5a.75.75 0 0 1 .75.75v4a2 2 0 1 1-4 0v-4a.75.75 0 0 1 .75-.75Z" />
      </g>
    </>
  );
}

/**
 * Handed back clean: the key, turning.
 *
 * The stage is a space being given back in working order, so the glyph is the
 * key being used rather than a key sitting there. It turns anticlockwise about
 * the centre of its bow at (17, 7) — the shaft was shortened from the first
 * draft precisely so a 24-degree turn keeps the tip and its stroke inside the
 * viewBox, which clips.
 */
function HandoverGlyph() {
  return (
    <g className="glyph-turn">
      <path d="M20.5 7a3.5 3.5 0 1 1-7 0 3.5 3.5 0 0 1 7 0Z" />
      <path d="M14.6 9.4 5.5 18.5" />
      <path d="m8.1 15.9 2.4 2.4" />
      <path d="m10.5 13.5 2.4 2.4" />
    </g>
  );
}

/** Keys are the `icon` field on a process step. */
const PROCESS_GLYPHS = {
  enquiry: EnquiryGlyph,
  "site-visit": SiteVisitGlyph,
  quote: QuoteGlyph,
  delivery: DeliveryGlyph,
  handover: HandoverGlyph,
} satisfies Record<string, () => ReactNode>;

export type ProcessIconName = keyof typeof PROCESS_GLYPHS;

/**
 * One stage glyph, or nothing if the stage did not name one.
 *
 * Decorative: the stage name sits directly beside every one of them, so
 * announcing the icon would just read the heading to a screen reader twice.
 */
export function ProcessIcon({
  name,
  className,
}: {
  name?: ProcessIconName;
  className?: string;
}) {
  const Glyph = name ? PROCESS_GLYPHS[name] : undefined;
  if (!Glyph) return null;

  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      <Glyph />
    </svg>
  );
}
