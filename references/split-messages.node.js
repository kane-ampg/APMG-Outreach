// One item per message → PLAIN-TEXT APMG email (no HTML, no images, no buttons).
// Body in:  { campaign, messages: [{ to, leadId, subject, text, attachment?: { url, filename }, hero?, hero_alt? }] }
// Body out: { campaign, to, leadId, subject, text, attachment_url, attachment_name }
//
// The paired Gmail node MUST be set to emailType "text" with message
// {{ $json.text }}. Leaving it on "html" renders this body as one unbroken wall
// with no line breaks.
//
// WHY PLAIN TEXT: the sending domain has no warm-up history. An image-heavy
// table-layout HTML email (hosted logo, 600px hero photo, red CTA button) is the
// classic template-blast fingerprint, and plain text is normal practice for cold
// outreach. `hero`/`hero_alt` are still accepted in the payload and deliberately
// IGNORED — the app still sends them when a service template is picked, and this
// node no longer renders an image.
//
// INTERIM NODE. Per docs/superpowers/specs/2026-08-16-plain-text-outreach-design.md
// the app will eventually build the whole body itself (signature + sender identity
// + unsubscribe) and this node will shrink to a URL normaliser. Until that ships,
// this node owns the footer, exactly as the branded version did — so the
// unsubscribe link (Spam Act 2003) can never go missing.

const BRAND = {
  website: "https://www.apmgservices.com.au/",
  // Sender identification (Spam Act 2003). Append " · ABN <number>" here
  // once the ABN is registered — keep it accurate, do not invent one.
  sender: "APMG Services · 1 Tesmar Cct, Chirnside Park, VIC, Australia",
  // Canonical customer-portal origin — the branded domain customers see.
  // Used as the unsubscribe/PDF host fallback AND as the host every outgoing
  // link is normalised onto (see canonicalUrl below).
  portalBase: "https://customer.apmgservices.com.au",
};

// WHO signs the cold emails. In plain text this is a few lines, not a card.
// The email address is the outreach mailbox these campaigns actually send
// from, NOT farbod@ — replies must land in the mailbox the sender persona
// answers. The 0450 mobile from the original signature is deliberately
// omitted (it is not this persona's number); add a `mobile` field here and a
// line in signature() if a dedicated number is ever provisioned.
const SIG = {
  name: "George Collins",
  title: "Managing Director, APMG Services",
  phone: "1300 97 97 40",
  email: "outreach@apmgmaintenance.com.au",
  websiteLabel: "www.apmgservices.com.au",
};

// Hosts that USED to serve the customer portal. Any customer-facing link that
// lands on one of these is rewritten onto BRAND.portalBase before send.
//
// WHY THIS EXISTS: the app builds its tracked CTA links from
// NEXT_PUBLIC_TRACK_BASE, which Next.js inlines at BUILD time — changing that
// variable in Vercel has no effect until a fresh deploy. A stale host can
// therefore sit in live emails with no visible error, because the old host
// still answers. This node is the last thing to touch every URL before the
// email goes out, so normalising here guarantees a customer can only ever
// land on the branded portal, whatever the app sent us.
const LEGACY_PORTAL_HOSTS = ["customers-apmg-services.vercel.app"];

function canonicalUrl(u) {
  const raw = (u == null ? "" : u.toString()).trim();
  if (!raw) return raw;
  try {
    const url = new URL(raw);
    const stale =
      LEGACY_PORTAL_HOSTS.indexOf(url.hostname) !== -1 ||
      url.hostname.endsWith(".vercel.app");
    if (!stale) return raw;
    const canon = new URL(BRAND.portalBase);
    url.protocol = canon.protocol;
    url.hostname = canon.hostname;
    url.port = canon.port;
    return url.toString();
  } catch (e) {
    return raw;
  }
}

// The app flattens its HTML body to text as "label (url)" (htmlToText in
// lib/pipeline/campaign.ts). That shape is a leftover of the HTML era and reads
// like machine output in a typed email, so it is reshaped into the way a person
// actually pastes a link: the label, a colon, then the bare URL on its own line.
// A body that already carries a bare URL is left exactly as it is.
function reshapeCta(text) {
  return text
    .split(/\n{2,}/)
    .map(function (p) {
      const para = p.trim();
      const cta = para.match(/^(.*?)\s*\((https?:\/\/[^\s)]+)\)\s*$/s);
      if (!cta) return para;
      const label = cta[1].replace(/[→–—\-\s]+$/, "").trim();
      const url = cta[2];
      return label ? label + ":\n" + url : url;
    })
    .filter(Boolean)
    .join("\n\n");
}

// The body's own sign-off. The app's prompt and the 8 service templates both end
// with "The APMG Services team", and this node then signs as George Collins —
// two identities in one email. Drop the generic one so it signs once.
function dropTeamSignoff(text) {
  return text.replace(/\n+\s*(?:Kind regards,?\s*\n+)?The APMG Services team\.?\s*$/i, "").trimEnd();
}

function signature() {
  return [SIG.name, SIG.title, SIG.phone, SIG.email, SIG.websiteLabel].join("\n");
}

// Sender identity + the functional opt-out. Spam Act 2003 — this is a legal
// requirement, not styling, and it renders whenever we have any base and a
// recipient address.
function footer(unsubHref) {
  const lines = [
    "--",
    BRAND.sender,
    "You're receiving this because APMG Services provides property maintenance in your area.",
  ];
  if (unsubHref) lines.push("Unsubscribe: " + unsubHref);
  return lines.join("\n");
}

const first = $input.first().json;
const body = first.body ?? first;
const campaign = (body.campaign || "outreach-2026").toString();
const messages = Array.isArray(body.messages) ? body.messages : [];

const out = [];
for (const m of messages) {
  if (!m || typeof m !== "object") continue;
  const to = (m.to || "").toString().trim();
  if (!to) continue;

  // Normalise EVERY url in the body up front, before anything reads it. The
  // tracked CTA, the scraped track host, the playbook link and the unsubscribe
  // link all derive from this text, so one pass here fixes all four at once.
  const rawText = (m.text ?? m.html ?? "").toString();
  const text = rawText.replace(/https?:\/\/[^\s)\]<>"']+/g, function (u) { return canonicalUrl(u); });

  const leadId = (m.leadId || "").toString();
  const att = m.attachment && typeof m.attachment === "object" ? m.attachment : null;
  const attUrl = att && att.url ? att.url.toString() : "";
  const attName = att && att.filename ? att.filename.toString() : "";

  // Prefer the host scraped from the (already normalised) tracked link so dev and
  // preview sends keep pointing at themselves; fall back to the canonical portal
  // base so unsubscribe/playbook links still work whatever shape the body is in.
  // Matches the link with OR without the legacy "(...)" wrapper, so this keeps
  // working once the app stops emitting "label (url)".
  let trackBase = "";
  const ctaLink = text.match(/https?:\/\/[^\s)\]<>"']+\/t\/[^\s)\]<>"']+/);
  if (ctaLink) { try { trackBase = new URL(ctaLink[0]).origin; } catch (e) {} }
  const base = (canonicalUrl(trackBase) || BRAND.portalBase || "").replace(/\/+$/, "");

  // The sector playbook is LINKED, never attached — the download is routed
  // through the /t/ hook so it is recorded like a CTA click.
  const pdfHref = attUrl && base && leadId
    ? base + "/t/" + encodeURIComponent(leadId) + "?c=" + encodeURIComponent(campaign) + "&to=" + encodeURIComponent(attUrl)
    : attUrl;
  const pdfLabel = attName ? attName.replace(/\.pdf$/i, "").trim() : "";
  const playbook = pdfHref
    ? "\n\n" + (pdfLabel ? "Our " + pdfLabel + ":" : "Our playbook for your sector:") + "\n" + pdfHref
    : "";

  // Unsubscribe ALWAYS renders when we have any base + a recipient address
  // (Spam Act 2003). leadId is optional context.
  const unsubHref = base && to
    ? base + "/api/portal/unsubscribe?e=" + encodeURIComponent(to) +
      (leadId ? "&lead=" + encodeURIComponent(leadId) : "") +
      "&c=" + encodeURIComponent(campaign)
    : "";

  const plain = [
    dropTeamSignoff(reshapeCta(text)) + playbook,
    signature(),
    footer(unsubHref),
  ].join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  out.push({
    json: {
      campaign, to, leadId,
      subject: (m.subject || "").toString(),
      text: plain,
      attachment_url: attUrl, attachment_name: attName,
    },
  });
}
return out;
