// The other half of the page shield (S7): runs beside shield.js but in the extension's own closed-off world, after
// learn.js (siteOf, mark). It gives shield.js the value that decides the small changes: made from a random value of
// this run of Chrome (written by background.js) and the site in the address bar, so one site gets the same changes
// all through a run of Chrome and another site gets others. The value crosses to the page's world sealed with the
// token shield.js handed over before any page code ran; sealed 0 means "leave this page alone" (a site cleaning is
// switched off for, a pause, a sign-in going on). It reads the page's address and nothing else of the page.
(() => {
  const doc = document; let token = null;
  doc.addEventListener('tc-shield-token', (e) => { if (token !== null || typeof e.detail !== 'number') return; token = e.detail; e.preventDefault(); e.stopImmediatePropagation(); }, true);
  doc.dispatchEvent(new CustomEvent('tc-shield-hello'));   // shield.js ran first: it answers now, before any page code
  const up = location.ancestorOrigins, under = (h, s) => h === s || h.endsWith('.' + s);
  let top = location.hostname; try { if (up && up.length) top = new URL(up[up.length - 1]).hostname; } catch {}
  chrome.storage.local.get('shield').then(({ shield }) => { const s = shield || {};
    if (token === null || typeof s.salt !== 'string' || !s.salt) return;   // nothing known: shield.js keeps its own random value
    const off = s.off === true || (Array.isArray(s.sites) ? s.sites : []).some((x) => under(top, x) || under(location.hostname, x));
    const seed = off ? 0 : parseInt(mark(`${s.salt} ${siteOf(top)}`), 36) >>> 0 || 1;
    doc.dispatchEvent(new CustomEvent('tc-shield-seed', { detail: (seed ^ token) >>> 0 })); }, () => {});
})();
