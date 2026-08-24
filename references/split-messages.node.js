// One item per message → LIGHT-HTML APMG email that reads as a REAL typed email:
// left-aligned text with no container box, native blue links, and a plain typed
// signature. No images. The only styled elements are the red CTA button and the
// subdued unsubscribe button.
// Body in:  { campaign, messages: [{ to, leadId, subject, text, attachment?: { url, filename }, hero?, hero_alt? }] }
// Body out: { campaign, to, leadId, subject, text, html, attachment_url, attachment_name }
//
// The paired Gmail node MUST be set to emailType "html" with message
// {{ $json.html }}. $json.text still carries the plain-text rendering as a
// fallback — flipping the Gmail node back to "text" + {{ $json.text }} reverts
// the whole design without touching this code.
//
// FORMAT DECISION (2026-08-17, supersedes the plain-text-only spec of
// 2026-08-16): the operator wants no visible raw URLs — the tracked CTA and the
// unsubscribe link render as buttons — but the email must NOT look like a boxed
// HTML template: no max-width container, no centering, text links keep the
// client's native blue, and the signature is plain typed lines with a bold
// name. No layout tables, NO IMAGES — a top photo was tried and removed the
// same day (operator, 2026-08-17). `hero`/`hero_alt` are still accepted in the
// payload and deliberately IGNORED.
//
// INTERIM NODE. Per docs/superpowers/specs/2026-08-16-plain-text-outreach-design.md
// the app will eventually build the whole body itself (signature + sender identity
// + unsubscribe) and this node will shrink to a URL normaliser. Until that ships,
// this node owns the footer — so the unsubscribe link (Spam Act 2003) can never
// go missing.

const BRAND = {
  website: "https://www.apmgservices.com.au/",
  // Sender identification (Spam Act 2003). Append " · ABN <number>" here
  // once the ABN is registered — keep it accurate, do not invent one.
  sender: "APMG Services · 1 Tesmar Cct, Chirnside Park, VIC, Australia",
  // Canonical customer-portal origin — the branded domain customers see.
  // Used as the unsubscribe/PDF host fallback AND as the host every outgoing
  // link is normalised onto (see canonicalUrl below).
  portalBase: "https://customer.apmgservices.com.au",
  // Accent used by the CTA button and links — same red as the old branded email.
  color: "#c8102e",
};

// WHO signs the cold emails. The email address is the outreach mailbox these
// campaigns actually send from, NOT farbod@ — replies must land in the mailbox
// the sender persona answers. The 0450 mobile from the original signature is
// deliberately omitted (it is not this persona's number); add a `mobile` field
// here and a line in the signature builders if a dedicated number is ever
// provisioned.
const SIG = {
  name: "George Collins",
  title: "Sales Representative, APMG Services",
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

// ── plain-text fallback helpers (unchanged behaviour) ────────────────────────

// The app flattens its HTML body to text as "label (url)" (htmlToText in
// lib/pipeline/campaign.ts). For the text fallback that shape is reshaped into
// the way a person actually pastes a link: the label, a colon, then the bare
// URL on its own line. A body that already carries a bare URL is left as-is.
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

function signatureText() {
  return [SIG.name, SIG.title, SIG.phone, SIG.email, SIG.websiteLabel].join("\n");
}

// Sender identity + the functional opt-out. Spam Act 2003 — this is a legal
// requirement, not styling, and it renders whenever we have any base and a
// recipient address.
function footerText(unsubHref) {
  const lines = [
    "--",
    BRAND.sender,
    "You're receiving this because APMG Services provides property maintenance in your area.",
  ];
  if (unsubHref) lines.push("Unsubscribe: " + unsubHref);
  return lines.join("\n");
}

// ── HTML rendering ────────────────────────────────────────────────────────────

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Text links carry NO inline color — the client renders its own native blue,
// which is what a link in a genuinely typed email looks like.

// One escaped paragraph → HTML with every URL hidden behind a label.
// "label (url)" becomes <a>label</a>; a bare URL (rare — the compose prompt
// always emits the labelled shape) falls back to its hostname as the label.
function paragraphHtml(escaped) {
  let s = escaped.replace(/([^\s(]?[^()\n]*?)\s*\((https?:\/\/[^\s)]+)\)/g, function (_, label, url) {
    const clean = label.replace(/[→–—\-\s]+$/, "").trim();
    return clean ? '<a href="' + url + '">' + clean + "</a>" : bareLink(url);
  });
  s = s.replace(/(^|[\s>])(https?:\/\/[^\s<]+)/g, function (_, pre, url) {
    return pre + bareLink(url);
  });
  return '<p style="margin:0 0 1em;">' + s.replace(/\n/g, "<br>") + "</p>";
}

function bareLink(url) {
  let label = url;
  try { label = new URL(url.replace(/&amp;/g, "&")).hostname; } catch (e) {}
  return '<a href="' + url + '">' + label + "</a>";
}

function buttonHtml(href, label) {
  return (
    '<p style="margin:8px 0 20px;"><a href="' + href + '" ' +
    'style="display:inline-block;background:' + BRAND.color + ";color:#ffffff;" +
    'font-weight:600;font-size:15px;text-decoration:none;padding:12px 24px;border-radius:8px;">' +
    escapeHtml(label) + "</a></p>"
  );
}

// Plain typed signature — the way a Gmail signature actually renders: bold
// name, then unstyled lines, native-blue links, no card, no border.
function signatureHtml() {
  return (
    '<p style="margin:1.6em 0 0;">' +
    "<b>" + escapeHtml(SIG.name) + "</b><br>" +
    escapeHtml(SIG.title) + "<br>" +
    escapeHtml(SIG.phone) + "<br>" +
    '<a href="mailto:' + SIG.email + '">' + escapeHtml(SIG.email) + "</a><br>" +
    '<a href="' + BRAND.website + '">' + escapeHtml(SIG.websiteLabel) + "</a>" +
    "</p>"
  );
}

// Spam Act 2003: sender identity + a functional opt-out, always rendered when
// we have any base + a recipient address. The opt-out is a button per the
// operator's 2026-08-17 direction — subdued, but plainly labelled and clickable.
function footerHtml(unsubHref) {
  let s =
    '<div style="margin-top:24px;padding-top:14px;border-top:1px solid #e5e7eb;' +
    'font-size:12px;color:#9ca3af;line-height:1.6;">' +
    escapeHtml(BRAND.sender) + "<br>" +
    "You're receiving this because APMG Services provides property maintenance in your area.";
  if (unsubHref) {
    s +=
      '<br><a href="' + unsubHref + '" ' +
      'style="display:inline-block;margin-top:10px;color:#6b7280;border:1px solid #d1d5db;' +
      'text-decoration:none;padding:7px 16px;border-radius:6px;font-size:12px;">Unsubscribe</a>';
  }
  return s + "</div>";
}

// Full message HTML. The FIRST paragraph shaped "label (tracked /t/ url)" is
// the app's CTA — it renders as the button, in place, labelled with its own
// copy (e.g. "Aged care upkeep, sorted"). Everything else renders as typed
// paragraphs with labelled links only.
function renderHtml(cleanText, playbookHtml, unsubHref) {
  const paras = cleanText.split(/\n{2,}/).map(function (p) { return p.trim(); }).filter(Boolean);
  let usedButton = false;
  const parts = paras.map(function (p) {
    if (!usedButton) {
      const cta = p.match(/^(.*?)\s*\((https?:\/\/[^\s)]+\/t\/[^\s)]+)\)\s*$/s);
      if (cta) {
        usedButton = true;
        const label = cta[1].replace(/[→–—\-\s:]+$/, "").trim() || "See how we can help";
        return buttonHtml(escapeHtml(cta[2]), label);
      }
    }
    return paragraphHtml(escapeHtml(p));
  });
  // No max-width, no centering, no container box — a real email is just text
  // starting at the left edge in the client's normal reading font.
  return (
    '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#222222;">' +
    parts.join("") +
    playbookHtml +
    signatureHtml() +
    footerHtml(unsubHref) +
    "</div>"
  );
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
  const playbookText = pdfHref
    ? "\n\n" + (pdfLabel ? "Our " + pdfLabel + ":" : "Our playbook for your sector:") + "\n" + pdfHref
    : "";
  const playbookHtml = pdfHref
    ? '<p style="margin:0 0 1em;"><a href="' + escapeHtml(pdfHref) + '">' +
      escapeHtml(pdfLabel ? "Our " + pdfLabel + " (PDF)" : "Our playbook for your sector (PDF)") + "</a></p>"
    : "";

  // Unsubscribe ALWAYS renders when we have any base + a recipient address
  // (Spam Act 2003). leadId is optional context.
  const unsubHref = base && to
    ? base + "/api/portal/unsubscribe?e=" + encodeURIComponent(to) +
      (leadId ? "&lead=" + encodeURIComponent(leadId) : "") +
      "&c=" + encodeURIComponent(campaign)
    : "";

  const cleanText = dropTeamSignoff(text);

  const plain = [
    reshapeCta(cleanText) + playbookText,
    signatureText(),
    footerText(unsubHref),
  ].join("\n\n").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";

  const html = renderHtml(cleanText, playbookHtml, escapeHtml(unsubHref));

  out.push({
    json: {
      campaign, to, leadId,
      subject: (m.subject || "").toString(),
      text: plain,
      html: html,
      attachment_url: attUrl, attachment_name: attName,
    },
  });
}
return out;
