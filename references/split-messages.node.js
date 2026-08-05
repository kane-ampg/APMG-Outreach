// One item per message → branded APMG HTML email (PDF shown as a downloadable file card, linked not attached).
// Body in:  { campaign, messages: [{ to, leadId, subject, text, attachment?: { url, filename }, hero?, hero_alt? }] }
// Body out: { campaign, to, leadId, subject, html, text, attachment_url, attachment_name }
// `hero`/`hero_alt` (optional, per message) swap the hero band to that service's
// photo — the app sends them when a service template is picked on Step 2
// Compose (lib/pipeline/services.ts), so the image matches the pitched service.

const BRAND = {
  color: "#c8102e",
  logo: "https://www.apmgservices.com.au/images/apmg-logo.png",
  // Hero band under the header — the DEFAULT team + fleet photo (hosted in
  // Supabase Storage, public bucket), used when a message carries no `hero` of
  // its own. Set to "" to hide the default hero entirely.
  hero: "https://iskvglrdgqubwcmyjsbq.supabase.co/storage/v1/object/public/sector-assets/apmgteam.jpg",
  heroAlt: "The APMG Services team in front of our head office and fleet",
  website: "https://www.apmgservices.com.au/",
  facebook: "https://www.facebook.com/p/APMG-Services-100072630217180/",
  instagram: "https://www.instagram.com/apmg.services",
  location: "1 Tesmar Cct, Chirnside Park, VIC, Australia",
  // Sender identification (Spam Act 2003). Append " · ABN <number>" here
  // once the ABN is registered — keep it accurate, do not invent one.
  sender: "APMG Services · 1 Tesmar Cct, Chirnside Park, VIC, Australia",
  // Deployed customer-portal origin. Used as the unsubscribe/PDF host FALLBACK
  // when the CTA link can't be scraped from the body, so the unsubscribe link
  // (Spam Act 2003) ALWAYS renders regardless of the email's body shape.
  portalBase: "https://customers-apmg-services.vercel.app",
};

const esc = (s) =>
  (s || "").toString()
    .replace(/&/g, "&amp;").replace(/</g, "&lt;")
    .replace(/>/g, "&gt;").replace(/"/g, "&quot;");

function bodyBlocks(text) {
  const paras = (text || "").toString().split(/\n{2,}/).map((p) => p.trim()).filter(Boolean);
  const rows = [];
  for (const p of paras) {
    const cta = p.match(/^(.*?)\s*\((https?:\/\/[^\s)]+)\)\s*$/s);
    if (cta) {
      const label = esc(cta[1].replace(/[→–—\-\s]+$/, "").trim()) || "Learn more";
      const url = esc(cta[2]);
      rows.push(
        '<tr><td style="padding:6px 0 22px;">' +
          '<a href="' + url + '" style="display:inline-block;background:' + BRAND.color + ';color:#ffffff;' +
          'text-decoration:none;font-weight:600;font-size:15px;padding:12px 24px;border-radius:8px;">' +
          label + ' &rarr;</a>' +
        '</td></tr>'
      );
    } else {
      rows.push(
        '<tr><td style="padding:0 0 16px;font-size:15px;line-height:1.65;color:#1a1a1a;">' +
          esc(p).replace(/\n/g, "<br>") + '</td></tr>'
      );
    }
  }
  return rows.join("");
}

function pdfCard(href, attName) {
  if (!href) return "";
  const name = esc(attName || "APMG capability statement.pdf");
  return '<tr><td style="padding:4px 28px 26px;">' +
    '<a href="' + esc(href) + '" style="text-decoration:none;color:inherit;display:block;">' +
      '<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;border:1px solid #e5e7eb;border-radius:10px;">' +
        '<tr>' +
          '<td width="58" style="padding:12px 0 12px 14px;vertical-align:middle;">' +
            '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
              '<td width="42" height="50" align="center" valign="middle" style="width:42px;height:50px;background:' + BRAND.color + ';border-radius:6px;color:#ffffff;font-family:Arial,Helvetica,sans-serif;font-size:11px;font-weight:700;letter-spacing:1px;line-height:50px;">PDF</td>' +
            '</tr></table>' +
          '</td>' +
          '<td style="padding:12px 14px;vertical-align:middle;">' +
            '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:14px;font-weight:600;color:#111111;line-height:1.3;">' + name + '</div>' +
            '<div style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:12px;color:#6b7280;margin-top:2px;">PDF document</div>' +
          '</td>' +
          '<td width="120" style="padding:12px 16px 12px 8px;vertical-align:middle;text-align:right;">' +
            '<span style="font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;font-size:13px;font-weight:600;color:' + BRAND.color + ';white-space:nowrap;">Download &darr;</span>' +
          '</td>' +
        '</tr>' +
      '</table>' +
    '</a>' +
  '</td></tr>';
}

function buildHtml(text, pdfHref, attName, unsubHref, hero, heroAlt) {
  const linkStyle = 'color:' + BRAND.color + ';text-decoration:none;font-weight:600;';
  const dot = '<span style="color:#d1d5db;">&nbsp;&middot;&nbsp;</span>';
  const wordmark =
    '<span style="color:#ffffff;font-size:19px;font-weight:700;letter-spacing:.5px;">APMG <span style="color:' + BRAND.color + ';">Services</span></span>' +
    '<div style="color:#9ca3af;font-size:11px;letter-spacing:1.5px;text-transform:uppercase;margin-top:3px;">Property Maintenance</div>';
  const header = BRAND.logo
    ? '<table role="presentation" cellpadding="0" cellspacing="0"><tr>' +
        '<td style="vertical-align:middle;padding-right:14px;">' +
          '<a href="' + esc(BRAND.website) + '" style="text-decoration:none;display:inline-block;">' +
          '<img src="' + esc(BRAND.logo) + '" alt="APMG Services" width="68" height="52" ' +
          'style="display:block;border:0;outline:none;width:68px;height:52px;"></a>' +
        '</td>' +
        '<td style="vertical-align:middle;">' + wordmark + '</td>' +
      '</tr></table>'
    : wordmark;
  return '<!doctype html>\n<html lang="en">\n<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>\n<body style="margin:0;padding:0;background:#f4f4f5;">\n' +
'<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f5;padding:24px 12px;">\n' +
'  <tr><td align="center">\n' +
'    <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px;width:100%;background:#ffffff;border-radius:12px;overflow:hidden;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">\n' +
'      <tr><td style="background:#111111;padding:18px 28px;">' + header + '</td></tr>\n' +
'      <tr><td style="height:3px;background:' + BRAND.color + ';font-size:0;line-height:0;">&nbsp;</td></tr>\n' +
    (hero
      ? '      <tr><td style="font-size:0;line-height:0;background:#e5e7eb;">' +
          '<img src="' + esc(hero) + '" alt="' + esc(heroAlt || BRAND.heroAlt) + '" width="600" ' +
          'style="display:block;border:0;outline:none;width:100%;max-width:600px;height:auto;"></td></tr>\n'
      : '') +
'      <tr><td style="padding:28px 28px 8px;">\n' +
'        <table role="presentation" width="100%" cellpadding="0" cellspacing="0">' + bodyBlocks(text) + '</table>\n' +
'      </td></tr>\n' +
'      ' + pdfCard(pdfHref, attName) + '\n' +
'      <tr><td style="background:#fafafa;border-top:1px solid #ececec;padding:22px 28px;">\n' +
'        <div style="font-size:13px;color:#374151;font-weight:700;margin-bottom:5px;">APMG Services</div>\n' +
'        <div style="font-size:12px;color:#6b7280;line-height:1.6;">' + esc(BRAND.location) + '</div>\n' +
'        <div style="margin-top:12px;font-size:13px;">\n' +
'          <a href="' + esc(BRAND.website) + '" style="' + linkStyle + '">Website</a>' + dot + '\n' +
'          <a href="' + esc(BRAND.facebook) + '" style="' + linkStyle + '">Facebook</a>' + dot + '\n' +
'          <a href="' + esc(BRAND.instagram) + '" style="' + linkStyle + '">Instagram</a>\n' +
'        </div>\n' +
'      </td></tr>\n' +
'    </table>\n' +
'    <div style="max-width:600px;margin:14px auto 0;font-size:11px;color:#9ca3af;text-align:center;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,Helvetica,Arial,sans-serif;">\n' +
'      ' + esc(BRAND.sender) + '<br>You are receiving this because APMG Services provides property maintenance in your area.\n' +
'    </div>\n' +
    (unsubHref
      ? '<div style="max-width:600px;margin:10px auto 0;text-align:center;">' +
          '<a href="' + esc(unsubHref) + '" style="display:inline-block;border:1px solid #d1d5db;border-radius:6px;padding:7px 16px;font-size:11px;font-weight:600;color:#6b7280;text-decoration:none;background:#ffffff;">Unsubscribe</a>' +
        '</div>\n'
      : '') +
'  </td></tr>\n' +
'</table>\n</body></html>';
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
  const text = (m.text ?? m.html ?? "").toString();
  const leadId = (m.leadId || "").toString();
  const att = m.attachment && typeof m.attachment === "object" ? m.attachment : null;
  const attUrl = att && att.url ? att.url.toString() : "";
  const attName = att && att.filename ? att.filename.toString() : "";
  // Per-message hero (service template photo) — falls back to the team photo.
  const hero = (m.hero || BRAND.hero || "").toString();
  const heroAlt = (m.hero_alt || BRAND.heroAlt || "").toString();

  // Prefer the host scraped from the CTA link (correct across dev/preview/prod);
  // fall back to the configured portal base so unsubscribe/PDF links still work
  // even when the body doesn't carry a scrapable "(https://.../t/...)" CTA.
  let trackBase = "";
  const ctaLink = text.match(/\((https?:\/\/[^\s)]+\/t\/[^\s)]+)\)/);
  if (ctaLink) { try { trackBase = new URL(ctaLink[1]).origin; } catch (e) {} }
  const base = (trackBase || BRAND.portalBase || "").replace(/\/+$/, "");

  const pdfHref = attUrl && base && leadId
    ? base + "/t/" + encodeURIComponent(leadId) + "?c=" + encodeURIComponent(campaign) + "&to=" + encodeURIComponent(attUrl)
    : attUrl;

  // Unsubscribe ALWAYS renders when we have any base + a recipient address
  // (Spam Act 2003). leadId is optional context.
  const unsubHref = base && to
    ? base + "/api/portal/unsubscribe?e=" + encodeURIComponent(to) +
      (leadId ? "&lead=" + encodeURIComponent(leadId) : "") +
      "&c=" + encodeURIComponent(campaign)
    : "";

  out.push({
    json: {
      campaign, to, leadId,
      subject: (m.subject || "").toString(),
      html: buildHtml(text, pdfHref, attName, unsubHref, hero, heroAlt),
      text, attachment_url: attUrl, attachment_name: attName,
    },
  });
}
return out;
