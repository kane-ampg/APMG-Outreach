/**
 * Layout for the public customer-facing portal (/portal).
 *
 * The rest of the app is dark-first (the "signal console" identity, §17.8) —
 * the root layout stamps `dark` on <html> and `themeBootstrap` forces it before
 * paint. The customer portal is the trust surface, so it opens in LIGHT
 * instead. There is no theme toggle on this route (it lives only in the
 * internal Sidebar), so light is applied unconditionally.
 *
 * The inline script below runs before the portal body paints — it strips the
 * `dark` class the root bootstrap added and pins colorScheme to light, so there
 * is no flash of the dark theme. It deliberately does NOT touch the persisted
 * `apmg-theme` value, so a staff member's dark preference for the internal app
 * survives a detour through the portal.
 */
const PORTAL_LIGHT = `(function(){try{var r=document.documentElement;r.classList.remove('dark');r.style.colorScheme='light';}catch(e){}})();`;

export default function PortalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: PORTAL_LIGHT }} />
      {children}
    </>
  );
}
