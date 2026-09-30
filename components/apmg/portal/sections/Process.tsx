"use client";

import { APPROACH, PROCESS, numberWord } from "../data";

/**
 * "How we work": the sequence after an enquiry, then the standing commitments,
 * on one screen.
 *
 * The steps keep the reference's charcoal rule and red numerals, because the
 * order is the information: a facility manager reading this is deciding
 * whether contacting us costs them anything. The commitments run underneath as
 * one hairline row, not a boxed panel: they are things a client can hold us to,
 * not stages six to eight, and the box's padding was most of what kept this
 * section off a single screen.
 *
 * `#approach` is the redirect target for the retired /portal/approach route.
 */
export function ProcessSection() {
  return (
    <section
      id="process"
      className="section screen wrap"
      tabIndex={-1}
      aria-labelledby="process-title"
    >
      <div className="stack">
        <span className="eyebrow">How we work</span>
        <h2 id="process-title" className="serif h2-sm">
          {numberWord(PROCESS.length)} steps, and you only make one call.
        </h2>
      </div>

      <ol className="steps">
        {PROCESS.map((item, i) => (
          <li key={item.step} className="step">
            <span className="step-num" aria-hidden>
              {String(i + 1).padStart(2, "0")}
            </span>
            <h3 className="serif step-title">{item.step}</h3>
            <p className="step-copy">{item.body}</p>
          </li>
        ))}
      </ol>

      <div id="approach" className="hold" tabIndex={-1}>
        <div className="hold-intro">
          <h3 className="serif hold-title">What you can hold us to</h3>
          <p className="hold-lede">
            Almost nobody picks a maintenance contractor on the trade work itself. These are the
            things that separate a job that lands on time from one that doesn&rsquo;t.
          </p>
        </div>
        <ul className="hold-list">
          {APPROACH.map((item) => (
            <li key={item.heading} className="hold-item">
              <h4 className="serif hold-item-title">{item.heading}</h4>
              <p>{item.body}</p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
