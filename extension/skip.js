// A link to a site that is already known to only pass you along (learned by Tracker Cleaner on this computer) is
// changed, as you press it, to the address it names: you go straight there and the passing site is never asked.
// Runs in every page after guard.js and learn.js (isSignIn, siteOf). It reads the link you press and nothing else of
// the page, keeps nothing and sends nothing. skipTo is pure, so the Node tests can load it.
const SKIP = typeof module !== 'undefined' ? { ...require('./guard.js'), ...require('./learn.js') } : { isSignIn, siteOf };
const web = (u) => u.protocol === 'https:' || u.protocol === 'http:';
// never skipped (1.25, H4): an address handed over as the way back (by its name), and a link that does something on the way
const BACK = /^(return|returnto|return_to|returnurl|return_url|redirect|redirect_uri|redirect_url|continue|next|callback|back|success_url|cancel_url)$/i;
const DOES = /^(logout|log-out|logoff|log-off|signout|sign-out|sign_out|wsignout[0-9.]*|pay|payment|payments|checkout|cart|auth|adfs|wp-login|verify|confirm|unsub|unsubscribe|subscribe|delete|remove)([-_.]|$)/i;
// sites: the passing hosts, each by its exact name (the shipped ones, and those the user chose to skip). The one address on
// another site that the link names, or null: never for a sign-in, never when a part of the path or a handed-over value says it does something.
const skipTo = (href, base, sites) => {
  let u; try { u = new URL(href, base); } catch { return null; }
  const site = SKIP.siteOf(u.hostname), to = [];
  if (!web(u) || u.username || !sites.includes(u.hostname.toLowerCase()) || SKIP.isSignIn(u.href) || u.pathname.split('/').some((seg) => DOES.test(seg))) return null;
  for (const [k, v] of u.searchParams) { if (DOES.test(v)) return null; let t; try { t = new URL(v); } catch { continue; }
    if (!web(t) || SKIP.siteOf(t.hostname) === site) continue;
    if (BACK.test(k)) return null;
    to.push(t); }
  return to.length === 1 && !to[0].username && !SKIP.isSignIn(to[0].href) ? to[0].href : null;
};
if (typeof module !== 'undefined') module.exports = { skipTo };
else {
  let skip = { sites: [], off: [] };
  const read = () => chrome.storage.local.get('skip').then((s) => { skip = s.skip && Array.isArray(s.skip.sites) && Array.isArray(s.skip.off) ? s.skip : { sites: [], off: [] }; }, () => {});
  read(); chrome.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.skip) read(); });
  for (const ev of ['pointerdown', 'mousedown', 'click', 'auxclick', 'keydown'])
    addEventListener(ev, (e) => { const a = e.target && e.target.closest && e.target.closest('a[href], area[href]'), h = location.hostname;
      if (!a || !skip.sites.length || skip.off.some((s) => h === s || h.endsWith('.' + s))) return;
      const to = skipTo(a.href, location.href, skip.sites); if (to) a.href = to; }, true);
}
