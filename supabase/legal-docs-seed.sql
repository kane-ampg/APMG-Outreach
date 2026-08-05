-- Publish the portal Terms & Conditions + Privacy Policy into app_settings.
--
-- Run this ONCE in the Supabase SQL editor (the app's service-role key is
-- REST-only and cannot run DDL/upserts against app_settings from a migration).
-- It writes the JSON blob that lib/legal/legalStore.ts reads and that
-- GET /api/portal/legal serves to the customer portal + enquiry consent gate.
--
-- WHAT THIS IS / IS NOT
--   * These documents are drafted to describe THIS system's ACTUAL data flows
--     (scraped business leads, portal enquiry PII, click telemetry, cookies,
--     and the sub-processors Supabase / Anthropic / n8n->Gmail). They are a
--     faithful, plain-English description of what the code does.
--   * They are NOT legal advice and have NOT been reviewed by a lawyer. Before
--     go-live you MUST (a) replace every [BRACKETED PLACEHOLDER] with your real
--     entity details, and (b) have them reviewed. Do this either by editing
--     this file and re-running it, or via the admin Legal Documents tab.
--
-- VERSIONING: the `version` below ("2026-07-12") is pinned onto every recorded
-- consent (portal_inquiries.consent_version). Whenever you change the WORDING,
-- bump this version so prior acceptances no longer "cover" the new text and the
-- portal re-prompts. Keep it short and monotonic-ish (a date works well).
--
-- Prereqs: run schema.sql (app_settings table) and consent.sql (the
-- portal_inquiries.consent_version column) first.

insert into public.app_settings (key, value)
values (
  'legal_docs',
  jsonb_build_object(
    'version', '2026-07-12',
    'updatedAt', '2026-07-12',
    'termsHtml', $TERMS$
<h1>Terms &amp; Conditions</h1>
<p><strong>Last updated: 12 July 2026 &nbsp;|&nbsp; Version 2026-07-12</strong></p>
<p>These Terms &amp; Conditions ("Terms") govern your use of the services website and enquiry portal (the "Site") operated by <strong>[COMPANY LEGAL NAME]</strong> (ABN <strong>[ABN]</strong>), trading as APMG Services ("APMG", "we", "us", "our"). By using the Site or submitting an enquiry, you agree to these Terms and to our <strong>Privacy Policy</strong>. If you do not agree, please do not use the Site.</p>

<h2>1. Who we are</h2>
<p>APMG Services arranges property-maintenance trades &mdash; electrical, plumbing, painting, carpentry, flooring, gardening, handyman and make-safe services &mdash; for customers in Melbourne and surrounding areas. You can contact us at <strong>[PRIVACY EMAIL]</strong> or <strong>[PHONE]</strong>, or by post at <strong>[BUSINESS ADDRESS]</strong>.</p>

<h2>2. The Site and enquiries</h2>
<p>The Site describes the services we offer and lets you send us an enquiry. Submitting an enquiry is a request for us to contact you about the service you describe &mdash; it is not a contract for work, a quote, or a binding acceptance by us. Any work we carry out for you will be the subject of a separate agreement, quote or scope of works.</p>
<p>When you submit an enquiry you must provide accurate information and only submit details for yourself or for a person or property you are authorised to enquire about. Please do not include sensitive personal information (for example health information, government identifiers, or financial account details) in the free-text of your enquiry &mdash; the enquiry form is not the place for it.</p>

<h2>3. Marketing communications and unsubscribing</h2>
<p>We send outreach and service emails to businesses and contacts. Every marketing email includes a working unsubscribe link, and you can opt out at any time by using that link or by emailing us at <strong>[PRIVACY EMAIL]</strong>. We honour opt-outs in line with the <em>Spam Act 2003</em> (Cth) and record suppressed addresses so we do not contact them again. Where we email a business address (such as info@ or contact@), that message relates to the products and services of that business.</p>

<h2>4. Tracked links</h2>
<p>Links in our emails may be "tracked" &mdash; they route through our Site before redirecting you to the destination so that we can measure whether recipients engaged with an email. Following a tracked link records that the link was clicked (see the Privacy Policy for exactly what is recorded). Redirect destinations are restricted to our own Site and our data provider; we do not use tracked links to send you to arbitrary third-party sites.</p>

<h2>5. Acceptable use</h2>
<p>You agree not to: use the Site for any unlawful purpose; submit false, misleading or another person's details without authority; attempt to gain unauthorised access to any part of the Site, its administrative tools or its data; interfere with or disrupt the Site; or scrape, harvest or bulk-extract content or data from the Site.</p>

<h2>6. Intellectual property</h2>
<p>The Site, its content, branding, text and images are owned by APMG Services or our licensors and are protected by law. You may view the Site for the purpose of engaging our services. You may not copy, reproduce, republish or exploit any part of the Site without our written permission.</p>

<h2>7. Third-party services</h2>
<p>We use third-party providers to operate the Site and deliver our communications (for example our database and file hosting, our email delivery provider, and an AI provider that helps us draft copy). These providers process data on our behalf as described in the Privacy Policy. We are not responsible for the content or practices of external websites that we may link to.</p>

<h2>8. Availability and changes</h2>
<p>We provide the Site on an "as is" and "as available" basis and may change, suspend or withdraw all or part of it at any time without notice. We do not guarantee the Site will be uninterrupted or error-free.</p>

<h2>9. Disclaimers and liability</h2>
<p>Nothing in these Terms excludes, restricts or modifies any consumer guarantee, right or remedy you have under the <em>Australian Consumer Law</em> or other law that cannot lawfully be excluded. Subject to that, to the maximum extent permitted by law: (a) we exclude all implied warranties in relation to the Site; and (b) our total liability arising out of or in connection with the Site is limited to re-supplying the relevant service or the cost of doing so. We are not liable for indirect or consequential loss.</p>

<h2>10. Privacy</h2>
<p>Our handling of personal information is described in our <strong>Privacy Policy</strong>, which forms part of these Terms. Please read it before submitting an enquiry.</p>

<h2>11. Governing law</h2>
<p>These Terms are governed by the laws of the State of Victoria, Australia, and you submit to the non-exclusive jurisdiction of the courts of that State.</p>

<h2>12. Changes to these Terms</h2>
<p>We may update these Terms from time to time. When we do, we will publish the updated version here with a new version tag and effective date. Continued use of the Site after a change means you accept the updated Terms.</p>

<h2>13. Contact</h2>
<p>Questions about these Terms? Contact us at <strong>[PRIVACY EMAIL]</strong>, <strong>[PHONE]</strong>, or <strong>[BUSINESS ADDRESS]</strong>.</p>
$TERMS$,
    'privacyHtml', $PRIVACY$
<h1>Privacy Policy</h1>
<p><strong>Last updated: 12 July 2026 &nbsp;|&nbsp; Version 2026-07-12</strong></p>
<p>This Privacy Policy explains how <strong>[COMPANY LEGAL NAME]</strong> (ABN <strong>[ABN]</strong>), trading as APMG Services ("APMG", "we", "us", "our"), handles personal information. We are bound by the <em>Privacy Act 1988</em> (Cth) and the Australian Privacy Principles ("APPs"). This policy is written to describe what our systems actually do.</p>

<h2>1. The personal information we collect</h2>
<p>Depending on how you interact with us, we may collect:</p>
<ul>
  <li><strong>Business contact details (leads).</strong> We build a database of businesses that may benefit from our services. For each business we may hold its business name, address, phone number, email address(es), website, category/industry, publicly-listed rating, social media profiles (such as Facebook, Instagram and X/Twitter), and a link to its public map listing. This information is sourced from <strong>publicly available business listings</strong> collected via a mapping/listings scraper. For sole traders and small businesses these details may relate to an identifiable individual.</li>
  <li><strong>Enquiry details.</strong> When you submit an enquiry through our portal, we collect the name, email address and phone number you provide, the service you are enquiring about, and the free-text message you write. We also record the version of the Terms &amp; Privacy Policy you agreed to at the time.</li>
  <li><strong>Unsubscribe / opt-out records.</strong> If you unsubscribe, we record your email address (in lower case) and the reason, so that we can suppress future contact to that address.</li>
  <li><strong>Website activity and technical data.</strong> When you visit our portal or click a tracked link in our email, we record activity events such as which pages or services you viewed and which links you clicked, together with your browser's user-agent string, the referring URL, a timestamp, and a randomly-generated visitor identifier stored in your browser. If you arrived via a tracked outreach link, we also associate this activity with the corresponding lead record and campaign. We do <strong>not</strong> collect your name or contact details through this activity tracking, and we do not store your IP address at the application level.</li>
</ul>
<p>We do not intend to collect sensitive information (as defined in the Privacy Act). Please do not include it in your enquiry.</p>

<h2>2. How we collect it</h2>
<p>We collect information: (a) directly from you when you submit an enquiry, unsubscribe, or contact us; (b) automatically through cookies and activity tracking when you use the portal or click a tracked link (see section 8); and (c) from <strong>third-party public sources</strong> &mdash; specifically publicly available business listings gathered via a listings/mapping scraper &mdash; to build our leads database.</p>
<p><strong>Collection from third parties (APP 3.6 &amp; 5).</strong> Where we collect business contact details from public sources rather than from you directly, we take reasonable steps to make this policy available so you are aware we hold your information, why, and how to opt out or request access.</p>

<h2>3. Why we collect and use it</h2>
<p>We use personal information to:</p>
<ul>
  <li>contact businesses and individuals about our property-maintenance services (direct marketing outreach);</li>
  <li>receive, respond to and follow up on your enquiries, and arrange the services you ask about;</li>
  <li>measure the effectiveness of our outreach (for example whether a recipient clicked a link) and improve our website and services;</li>
  <li>use an AI tool to help us draft outreach copy and internal call briefs (see section 5);</li>
  <li>maintain our unsubscribe/suppression list and otherwise comply with our legal obligations, including the <em>Spam Act 2003</em>.</li>
</ul>

<h2>4. Direct marketing and how to opt out</h2>
<p>We use business contact details for direct marketing of our services. Every marketing email contains a functional unsubscribe link. You can opt out at any time using that link or by emailing <strong>[PRIVACY EMAIL]</strong>. Once you opt out we suppress your address and will not send you further marketing. We do not sell personal information, and we do not use or disclose it for direct marketing on behalf of other organisations.</p>

<h2>5. Automated tools / AI</h2>
<p>We use a third-party artificial-intelligence service (Anthropic's Claude API) to help us draft outreach emails and internal sales briefs. For this purpose we send limited business facts &mdash; typically a business's name, category/industry and website &mdash; to that service so it can generate draft copy. We do not send enquiry free-text, contact lists, or your enquiry details to the AI service for this purpose. Drafts are reviewed before anything is sent.</p>

<h2>6. Who we share it with (disclosure)</h2>
<p>We do not sell your personal information. We disclose it only to service providers who help us operate, and only as needed:</p>
<ul>
  <li><strong>Database &amp; file hosting</strong> &mdash; <em>Supabase</em>, which stores our leads, enquiries, activity events, suppression list and marketing assets.</li>
  <li><strong>Email delivery</strong> &mdash; our outreach emails are sent through an automation service (<em>n8n</em>) which dispatches them via <em>Google (Gmail)</em>. Recipient email addresses and message content therefore pass through these providers.</li>
  <li><strong>AI drafting</strong> &mdash; <em>Anthropic</em> (Claude API), as described in section 5, limited to the business facts noted there.</li>
  <li><strong>Hosting/infrastructure</strong> &mdash; our website hosting provider, which processes requests to the Site.</li>
</ul>
<p>We may also disclose personal information where required or authorised by law, or to protect our rights.</p>

<h2>7. Overseas disclosure (APP 8)</h2>
<p>Some of our service providers store or process data outside Australia (for example on servers located in other countries). By using the Site and providing your information, you acknowledge that your personal information may be handled by these providers overseas. We take reasonable steps to ensure providers handle personal information consistently with the APPs.</p>

<h2>8. Cookies and tracking technologies</h2>
<p>We use cookies and browser storage to make the portal work and to measure engagement:</p>
<ul>
  <li><strong>Attribution cookies</strong> &mdash; when you click a tracked link, we set cookies that record the associated lead reference and campaign (for up to 90 days) so we can attribute your portal activity to that outreach.</li>
  <li><strong>Visitor identifier</strong> &mdash; a randomly-generated identifier stored in your browser's local storage to distinguish visits; it is not linked to your name or contact details.</li>
  <li><strong>Preferences</strong> &mdash; storage for site preferences such as your acceptance of these documents and display settings.</li>
</ul>
<p>You can clear or block cookies and local storage through your browser settings; some parts of the Site may not work as intended if you do.</p>

<h2>9. Security</h2>
<p>We take reasonable steps to protect personal information from misuse, interference, loss and unauthorised access, modification or disclosure. Access to enquiry details and lead-activity records is restricted to authorised operators. No system is perfectly secure, so we cannot guarantee absolute security.</p>

<h2>10. Retention (APP 11.2)</h2>
<p>We keep personal information only for as long as we need it for the purposes described above or as required by law, after which we take reasonable steps to destroy or de-identify it. <span style="opacity:.75">[OPERATOR NOTE: state your actual retention periods here &mdash; e.g. how long leads, enquiries and activity events are kept &mdash; and ensure a corresponding deletion/purge process exists before publishing. Do not promise deletion the system does not perform.]</span></p>

<h2>11. Access and correction (APP 12 &amp; 13)</h2>
<p>You may request access to the personal information we hold about you, and ask us to correct it if it is inaccurate, out of date or incomplete. Contact us using the details below. We will respond within a reasonable time and may need to verify your identity. If we refuse access or correction, we will tell you why.</p>

<h2>12. Complaints</h2>
<p>If you have a privacy complaint, please contact us first at <strong>[PRIVACY EMAIL]</strong> and we will try to resolve it. If you are not satisfied with our response, you may complain to the Office of the Australian Information Commissioner (OAIC) at <a href="https://www.oaic.gov.au">oaic.gov.au</a> or 1300 363 992.</p>

<h2>13. Changes to this policy</h2>
<p>We may update this Privacy Policy from time to time. The current version and its effective date appear at the top. Material changes are published here under a new version tag.</p>

<h2>14. Contact us</h2>
<p><strong>[COMPANY LEGAL NAME]</strong> (trading as APMG Services)<br/>
Privacy enquiries: <strong>[PRIVACY EMAIL]</strong><br/>
Phone: <strong>[PHONE]</strong><br/>
Post: <strong>[BUSINESS ADDRESS]</strong></p>
$PRIVACY$
  )::text
)
on conflict (key) do update
  set value = excluded.value;

-- Verify:
--   select value::jsonb->>'version' as version,
--          length(value::jsonb->>'termsHtml')   as terms_len,
--          length(value::jsonb->>'privacyHtml') as privacy_len
--   from public.app_settings where key = 'legal_docs';
