// The other half of the page shield (S7, H3): runs beside shield.js but in the extension's own closed-off world. It
// asks background.js for this site's key (128 random bits per site and run of Chrome; background.js takes the site
// from the tab's address as Chrome reports it, not from this script) and hands it to shield.js sealed with the token
// that shield.js gave it before any page code ran. "Leave this page alone" (a site cleaning is switched off for, a
// pause, a sign-in) is sealed the same way, so a page cannot fake it. It reads nothing of the page.
(() => {
  const doc = document; let token = null;
  doc.addEventListener('tc-shield-token', (e) => { if (token !== null || typeof e.detail !== 'string' || !/^[0-9a-f]{32}$/.test(e.detail)) return; token = e.detail; e.preventDefault(); e.stopImmediatePropagation(); }, true);
  doc.dispatchEvent(new CustomEvent('tc-shield-hello'));   // shield.js ran first: it answers now, before any page code
  const part = (s, i) => parseInt(s.slice(i, i + 8), 16), seal = (key) => [0, 8, 16, 24].map((i) => ((part(key, i) ^ part(token, i)) >>> 0).toString(16).padStart(8, '0')).join('');
  chrome.runtime.sendMessage({ type: 'shieldKey' }).then((r) => { const key = r && r.off === true ? '0'.repeat(32) : r && r.key;
    if (token === null || typeof key !== 'string' || !/^[0-9a-f]{32}$/.test(key)) return;   // nothing known: shield.js keeps its own random key
    doc.dispatchEvent(new CustomEvent('tc-shield-seed', { detail: seal(key) })); }, () => {});
})();
