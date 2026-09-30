"use client";

import Image from "next/image";
import { TEAM } from "../data";
import crewPhoto from "@/app/apmgteam.jpg";

/**
 * Who'll actually turn up: the full crew in one photograph, then the named
 * people a client deals with. Faces, names and roles are the whole point;
 * LinkedIn appears where the person lists one, as a checkable identity.
 *
 * On laptops and desktops it is one screen: the crew photograph takes
 * whatever height the single row of eight portraits leaves it.
 *
 * Presentational only. No funnel contract event fires from here: a face is
 * not a service enquiry. LinkedIn clicks carry the plain
 * `portal_team_linkedin` name they always did.
 */
export function TeamSection() {
  return (
    <section id="team" className="section screen wrap" tabIndex={-1} aria-labelledby="team-title">
      <div className="sec-head">
        <div className="stack">
          <span className="eyebrow">The team</span>
          <h2 id="team-title" className="serif h2-sm">
            The people who&rsquo;ll actually turn up.
          </h2>
        </div>
        <p className="lede sec-lede">
          The same people from the first call to the job done — not a call centre and a
          subcontractor you&rsquo;ve never met.
        </p>
      </div>

      <div className="team-photo">
        <Image
          src={crewPhoto}
          alt="The APMG Services crew standing in a line in front of the company's vans and utes"
          fill
          placeholder="blur"
          sizes="(min-width: 1440px) 1312px, 100vw"
          className="fill-img"
          style={{ objectPosition: "50% 62%" }}
        />
      </div>

      <ul className="roster">
        {TEAM.map((member) => (
          <li key={member.name}>
            <div className="person">
              {/* Empty alt: the name and role sit right under the portrait,
                  so describing it would announce each person twice. */}
              <div className="person-photo">
                <Image
                  src={member.photo}
                  alt=""
                  fill
                  placeholder="blur"
                  sizes="(min-width: 1181px) 160px, (min-width: 721px) 25vw, 50vw"
                  className="fill-img"
                />
              </div>
              <div className="person-body">
                <h3 className="serif person-name">{member.name}</h3>
                <p className="person-role">{member.role}</p>
                {member.linkedin && (
                  <a
                    className="plainlink person-link focusable"
                    href={member.linkedin}
                    target="_blank"
                    rel="noreferrer"
                    data-track="portal_team_linkedin"
                    data-track-person={member.name}
                    aria-label={`${member.name} on LinkedIn`}
                  >
                    LinkedIn
                  </a>
                )}
              </div>
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}
