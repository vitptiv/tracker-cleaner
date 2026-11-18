'use strict';
// Friendface 2 (lab-only): the new made-up content sites. Each is first-party to itself; the only tracker piece on the
// page is served from the site's OWN /f/ path, which the server reverse-proxies to the ff2 collector (ff2-server.js).
// So to the cleaner there is never "another company": the structural rules (C29/C30/C31) are all thirdParty and never
// match, and the collector never gets a cookie of its own that other sites can use. Made-up names, no real brand.
const SITES2 = { ledger: 'Ledger (budgets)', sundial: 'Sundial (weather)', atlas: 'Atlas (local guide)' };
const LOOK2 = { ledger: '#1f5c5c', sundial: '#8a5a1f', atlas: '#3a3a7a' };
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

// the page shell; `kit` is the first-party snippet tag, served from this site's own /f/ path
const page = (site, title, body, head = '') => `<!doctype html><meta charset="utf-8"><title>${esc(title)} - ${esc(SITES2[site])}</title>
<link rel="icon" href="/favicon.ico">${head}<style>body{font:16px/1.5 sans-serif;max-width:720px;margin:0 auto;padding:0 16px 40px}
header{background:${LOOK2[site]};color:#fff;margin:0 -16px 16px;padding:10px 16px}header a{color:#fff;text-decoration:none;font-weight:bold}
table{border-collapse:collapse;font-size:14px}td,th{border:1px solid #ccc;padding:4px 8px;text-align:left;vertical-align:top}</style>
<header><a href="/">${esc(SITES2[site])}</a></header><h1>${esc(title)}</h1>${body}<script src="/f/kit.js"></script>`;
const filler = (n) => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1}. Made up for the lab; no harbour, bridge or kite is real.</p>`).join('');

// one row of content per site; `c` carries { site, url, lab }. Returns html, or false for 404. `c.lab.at2` builds links.
function pages(c) {
  const { site, url, lab } = c, p = url.pathname;
  // a hand-off link names the destination only in data attributes; the kit fills the real cross-site href at run time
  // (with the master id under a rotating param, F2-3), so the static HTML names no other host.
  const out = (id, to, dest, label, meta) => `<p><a id="${id}" class="ff2-out" data-ff2to="${to}" data-ff2p="${dest}"${meta ? ' data-ff2meta="1"' : ''} href="#">${label}</a></p>`;
  // the meta-refresh hand-off page (F2-4): no HTTP 302, no script click; the onward address carries the id
  if (p === '/hop') { const to = url.searchParams.get('to') || '', dest = url.searchParams.get('p') || '/', mid = url.searchParams.get('m') || '', name = url.searchParams.get('n') || 'r';
    if (!SITES2[to]) return false;
    const onward = `http://${to}.localhost:${lab.port}${dest}?${name}=${encodeURIComponent(mid)}`;
    if (mid) { c.store.record(['ff2m:' + mid, 'ff2chain:' + c.host], 'F4', `${c.host} to ${onward.split('?')[0]}`, c.host, 'meta-refresh hand-off, no HTTP redirect');
      c.store.record(['ff2m:' + mid], 'F5', `click to ${to}.localhost`, c.host, 'the click recorded first-party before the meta jump'); }
    return page(site, 'Taking you on', `<p>Taking you to ${esc(SITES2[to])}…</p>`, `<meta http-equiv="refresh" content="0;url=${esc(onward)}">`); }
  if (site === 'ledger') {
    if (p === '/') return page(site, 'Your budgets', `<p><a id="go-budget" href="/budget">Open this month’s budget</a></p>
<p><a id="ff2-signin" href="/login?client_id=ledger-app&redirect_uri=%2Fbudget">Sign in to Ledger</a></p>`);
    if (p === '/login') { const sid = c.cookies.SID || ('sess-' + Math.random().toString(16).slice(2, 12)), mid = url.searchParams.get('m') || '';
      // F7: set the ID cookie under a KEEP_RE name on a sign-in-shaped URL (client_id+redirect_uri), inside the 5-minute
      // hold the shipped guard arms for any such site; the cleaner spares a KEEP_RE-named cookie, so it is never deleted.
      if (!c.cookies.SID) c.setCookie(`SID=${sid}; Path=/; Max-Age=31536000; SameSite=Lax`);
      c.store.record(['ff2:' + c.host + ':' + (c.cookies.fp_id || sid), mid && 'ff2m:' + mid], 'F7', `SID=${sid}`, c.host, 'ID cookie set on a sign-in-shaped page, kept because its name is on the cleaner’s sign-in list');
      const back = url.searchParams.get('redirect_uri') || '/';
      return page(site, 'Signed in', `<p id="signed-in">Signed in to ${esc(SITES2[site])}. <a id="after-signin" href="${esc(/^\/[\w/-]*$/.test(back) ? back : '/')}">Continue</a></p>`); }
    if (p === '/budget') return page(site, 'October budget', `${filler(3)}${out('to-sundial', 'sundial', '/forecast', 'See the weather for your trips')}`);
  }
  if (site === 'sundial') {
    if (p === '/') return page(site, 'Weather', `<p><a id="go-forecast" href="/forecast">Five-day forecast</a></p>`);
    if (p === '/forecast') return page(site, 'Five-day forecast', `${filler(3)}${out('to-atlas', 'atlas', '/guide', 'Find places near you')}`);
  }
  if (site === 'atlas') {
    if (p === '/') return page(site, 'Local guide', `<p><a id="go-guide" href="/guide">Places near you</a></p>`);
    if (p === '/guide') return page(site, 'Places near you', `${filler(3)}${out('to-ledger', 'ledger', '/budget', 'Back to your budget', true)}`);
  }
  return false;
}
module.exports = { SITES2, LOOK2, pages, esc };
