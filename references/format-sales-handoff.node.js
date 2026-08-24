// Format one "admin sent leads to the Sales dashboard" hand-off into the
// internal notification email the desk reads before ringing.
//
// Body in:  { type: "sales_handoff", version, notifyTo, handedOverAt,
//             handedOverBy: { email, role, actingAs }, consoleUrl,
//             totalLeads, leads: [{ leadId, business, contactName, email, phone,
//               website, sector, campaign, score, band, summary,
//               talkingPoints: [], activity: {…} | null,
//               timeline: [{ ts, label }] }] }
// Body out: { to, subject, html }
//
// The app builds every fact in `leads` server-side out of Supabase
// (lib/sales/handoffNotify.ts) — the same reads and the same reducer the
// console's own lead brief uses. This node does NO reasoning: it renders what
// it is given. If a number here disagrees with the console, the bug is in the
// app, not in this node.
//
// `to` is passed through verbatim — the Gmail node splits it on commas and puts
// every recipient on ONE To: header, so a list of recipients costs one Gmail
// send, not one per address. No re-paste needed when the operator adds an
// address on the Integrations tab.
//
// The paired Gmail node MUST be set to emailType "html" with message
// {{ $json.html }}.

const BRAND = {
  color: "#c8102e",
  // Times are rendered in the operator's own timezone — the desk is in VIC and
  // "clicked at 3am" vs "clicked at 1pm" changes when a rep should ring.
  timeZone: "Australia/Melbourne",
};

/** Most leads rendered in full. A hand-off of more than this is summarised as a
 *  count — the app already caps how many it briefs, this is belt and braces so
 *  a big payload can never produce an unreadable email. */
const MAX_CARDS = 20;

const esc = (s) =>
  (s == null ? "" : s.toString())
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

/** "23 Aug, 4:05 pm" in the desk's timezone. Falls back to the raw stamp rather
 *  than throwing if the runtime has no ICU data for the zone. */
function when(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString("en-AU", {
      day: "numeric",
      month: "short",
      hour: "numeric",
      minute: "2-digit",
      timeZone: BRAND.timeZone,
    });
  } catch (e) {
    return iso.toString().slice(0, 16).replace("T", " ");
  }
}

/** A tel: href — strip everything a dialler doesn't want. */
function telHref(phone) {
  return "tel:" + phone.toString().replace(/[^\d+]/g, "");
}

const first = $input.first().json;
const body = first.body ?? first;

// Refuse anything that isn't a hand-off. This workflow shares a Gmail
// credential and a recipient list with the enquiry notifier, and the two
// payloads are NOT interchangeable — rendering the wrong one would email the
// desk a card with every field blank.
if (!body || body.type !== "sales_handoff") {
  return [];
}

const to = (body.notifyTo || "").toString().trim();
// No destination address configured (Integrations tab) → nothing to send. The
// hand-off itself has already been recorded by the app.
if (!to) return [];

const leads = Array.isArray(body.leads) ? body.leads.slice(0, MAX_CARDS) : [];
if (leads.length === 0) return [];

const total = Number.isFinite(body.totalLeads) ? Number(body.totalLeads) : leads.length;
const overflow = Math.max(0, total - leads.length);

const by = body.handedOverBy && typeof body.handedOverBy === "object" ? body.handedOverBy : {};
const actor = esc(by.email || "An admin");
// An admin acting while previewing another role is named as such — the same
// attribution the console's audit trail records.
const actorRole = by.actingAs ? esc(by.role) + " as " + esc(by.actingAs) : esc(by.role || "");
const consoleUrl =
  typeof body.consoleUrl === "string" && /^https?:\/\//i.test(body.consoleUrl)
    ? body.consoleUrl
    : "";

const subject =
  total === 1
    ? "New lead for Sales: " + ((leads[0] && leads[0].business) || "unnamed lead")
    : total + " new leads for Sales";

/* ─────────────────────────────  pieces  ───────────────────────────── */

function detailRow(label, valueHtml) {
  return (
    "<tr>" +
    '<td style="padding:5px 12px 5px 0;font-size:12px;color:#6b7280;white-space:nowrap;vertical-align:top;">' +
    label +
    "</td>" +
    '<td style="padding:5px 0;font-size:13px;color:#111111;">' +
    valueHtml +
    "</td>" +
    "</tr>"
  );
}

/** The score chip — the number that put this lead on Hot Leads in the first
 *  place, which IS the answer to "why was this sent to me". */
function scoreChip(lead) {
  if (lead.score == null) return "";
  const hot = Number(lead.score) >= 60;
  const bg = hot ? BRAND.color : "#f3f4f6";
  const fg = hot ? "#ffffff" : "#374151";
  return (
    '<span style="display:inline-block;background:' +
    bg +
    ";color:" +
    fg +
    ';border-radius:999px;font-size:11px;font-weight:700;padding:3px 10px;white-space:nowrap;">' +
    esc(lead.band || "Score") +
    " · " +
    esc(lead.score) +
    "</span>"
  );
}

/** The counted funnel — the evidence line under the prose. */
function activityLine(a) {
  if (!a) return "";
  const bits = [];
  if (a.emailClicks > 0) bits.push(a.emailClicks + "× email link");
  if (a.packDownloads > 0) bits.push(a.packDownloads + "× info pack");
  if (a.portalViews > 0) bits.push(a.portalViews + "× portal visit");
  if (a.serviceOpens > 0) bits.push(a.serviceOpens + "× service card");
  if (a.chatPrompts > 0) bits.push(a.chatPrompts + "× chat question");
  if (a.enquiries > 0) bits.push(a.enquiries + "× enquiry");
  if (bits.length === 0) return "";
  const span =
    a.daysActive > 1
      ? " over " + a.daysActive + " days, last seen " + when(a.lastSeen)
      : ", last seen " + when(a.lastSeen);
  return (
    '<div style="margin-top:10px;font-size:12px;color:#6b7280;">' +
    esc(bits.join(" · ")) +
    esc(span) +
    "</div>"
  );
}

function pointsList(points) {
  const items = (Array.isArray(points) ? points : []).slice(0, 6);
  if (items.length === 0) return "";
  return (
    '<div style="margin-top:14px;">' +
    '<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">Talking points</div>' +
    '<ul style="margin:0;padding-left:18px;font-size:13px;color:#111;line-height:1.65;">' +
    items.map((p) => "<li>" + esc(p) + "</li>").join("") +
    "</ul>" +
    "</div>"
  );
}

function timelineList(steps) {
  const items = Array.isArray(steps) ? steps : [];
  if (items.length === 0) return "";
  return (
    '<div style="margin-top:14px;padding-top:12px;border-top:1px solid #ececec;">' +
    '<div style="font-size:11px;color:#6b7280;text-transform:uppercase;letter-spacing:.08em;margin-bottom:6px;">What they did</div>' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%">' +
    items
      .map(
        (s) =>
          "<tr>" +
          '<td style="padding:3px 10px 3px 0;font-size:12px;color:#9ca3af;white-space:nowrap;vertical-align:top;">' +
          esc(when(s.ts)) +
          "</td>" +
          '<td style="padding:3px 0;font-size:13px;color:#111;">' +
          esc(s.label) +
          "</td>" +
          "</tr>",
      )
      .join("") +
    "</table>" +
    "</div>"
  );
}

/** Call and email buttons — the whole point of the notification is the call. */
function actions(lead) {
  const btns = [];
  if (lead.phone) {
    btns.push(
      '<a href="' +
        esc(telHref(lead.phone)) +
        '" style="display:inline-block;background:' +
        BRAND.color +
        ';color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:9px 18px;border-radius:8px;margin:0 8px 8px 0;">Call ' +
        esc(lead.phone) +
        "</a>",
    );
  }
  if (lead.email) {
    btns.push(
      '<a href="mailto:' +
        esc(lead.email) +
        '" style="display:inline-block;border:1px solid #d1d5db;color:#111;text-decoration:none;font-weight:600;font-size:13px;padding:8px 17px;border-radius:8px;margin:0 8px 8px 0;">Email them</a>',
    );
  }
  if (btns.length === 0) {
    return '<div style="margin-top:14px;font-size:12px;color:#9ca3af;">No phone or email on file — open the lead in the console to check the website.</div>';
  }
  return '<div style="margin-top:16px;">' + btns.join("") + "</div>";
}

function leadCard(lead) {
  const name = esc(lead.business || lead.contactName || "Unnamed lead");
  const details =
    detailRow("Contact", lead.contactName ? esc(lead.contactName) : '<span style="color:#9ca3af;">not on file</span>') +
    detailRow(
      "Phone",
      lead.phone
        ? '<a href="' + esc(telHref(lead.phone)) + '" style="color:' + BRAND.color + ';">' + esc(lead.phone) + "</a>"
        : '<span style="color:#9ca3af;">not on file</span>',
    ) +
    detailRow(
      "Email",
      lead.email
        ? '<a href="mailto:' + esc(lead.email) + '" style="color:' + BRAND.color + ';">' + esc(lead.email) + "</a>"
        : '<span style="color:#9ca3af;">not on file</span>',
    ) +
    (lead.website
      ? detailRow(
          "Website",
          '<a href="https://' + esc(lead.website) + '" style="color:' + BRAND.color + ';">' + esc(lead.website) + "</a>",
        )
      : "") +
    (lead.sector ? detailRow("Sector", esc(lead.sector)) : "") +
    (lead.campaign ? detailRow("Campaign", esc(lead.campaign)) : "");

  return (
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #ececec;border-radius:10px;margin-bottom:16px;">' +
    '<tr><td style="padding:16px 18px;">' +
    // name + score
    '<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>' +
    '<td style="font-size:16px;font-weight:700;color:#111;padding-right:10px;">' +
    name +
    "</td>" +
    '<td align="right" style="white-space:nowrap;">' +
    scoreChip(lead) +
    "</td>" +
    "</tr></table>" +
    // the brief
    '<div style="margin-top:12px;font-size:13px;color:#111;line-height:1.65;">' +
    esc(lead.summary || "No recorded activity for this lead.") +
    "</div>" +
    activityLine(lead.activity) +
    pointsList(lead.talkingPoints) +
    // contact details
    '<div style="margin-top:14px;padding-top:12px;border-top:1px solid #ececec;">' +
    '<table role="presentation" cellpadding="0" cellspacing="0" width="100%">' +
    details +
    "</table></div>" +
    timelineList(lead.timeline) +
    actions(lead) +
    "</td></tr></table>"
  );
}

/* ─────────────────────────────  the email  ───────────────────────────── */

const intro =
  "Hey mate — " +
  actor +
  (actorRole ? " (" + actorRole + ")" : "") +
  " just sent " +
  (total === 1 ? "a lead" : total + " leads") +
  " through to the Sales dashboard" +
  (body.handedOverAt ? " at " + esc(when(body.handedOverAt)) : "") +
  ". Here's what they did and why " +
  (total === 1 ? "it's" : "they're") +
  " worth a call.";

const html =
  '<!doctype html><html><head><meta charset="utf-8"></head>' +
  '<body style="margin:0;background:#f4f4f5;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">' +
  '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="padding:24px 12px;"><tr><td align="center">' +
  '<table role="presentation" width="620" cellpadding="0" cellspacing="0" style="max-width:620px;width:100%;background:#fff;border-radius:12px;overflow:hidden;">' +
  '<tr><td style="background:#111;padding:16px 24px;color:#fff;font-size:16px;font-weight:700;">' +
  (total === 1 ? "New lead on the Sales desk" : total + " new leads on the Sales desk") +
  "</td></tr>" +
  '<tr><td style="height:3px;background:' +
  BRAND.color +
  ';font-size:0;line-height:0;">&nbsp;</td></tr>' +
  '<tr><td style="padding:20px 24px;">' +
  '<div style="font-size:14px;color:#111;line-height:1.65;margin-bottom:18px;">' +
  intro +
  "</div>" +
  leads.map(leadCard).join("") +
  (overflow > 0
    ? '<div style="font-size:13px;color:#6b7280;margin-bottom:16px;">+ ' +
      overflow +
      (overflow === 1
        ? " more lead was handed over in the same batch"
        : " more leads were handed over in the same batch") +
      " — they're all waiting on the Sales tab.</div>"
    : "") +
  (consoleUrl
    ? '<div style="margin-top:4px;">' +
      '<a href="' +
      esc(consoleUrl) +
      '" style="display:inline-block;background:#111;color:#fff;text-decoration:none;font-weight:600;font-size:13px;padding:10px 20px;border-radius:8px;">Open the Sales desk</a>' +
      '<div style="margin-top:8px;font-size:11px;color:#9ca3af;">Sign in, then choose Sales in the sidebar.</div>' +
      "</div>"
    : "") +
  "</td></tr>" +
  '<tr><td style="background:#fafafa;border-top:1px solid #ececec;padding:14px 24px;font-size:11px;color:#9ca3af;">' +
  "APMG Services — automated Sales hand-off notification. Every figure above is counted off the lead's own tracked activity. " +
  "Sent to everyone on the notification list (Integrations tab)." +
  "</td></tr>" +
  "</table></td></tr></table></body></html>";

return [{ json: { to, subject, html } }];
