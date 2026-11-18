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
  if (site === 'ledger') {
    if (p === '/') return page(site, 'Your budgets', `<p><a id="go-budget" href="/budget">Open this month’s budget</a></p>`);
    if (p === '/budget') return page(site, 'October budget', `${filler(3)}<p><a id="to-sundial" href="/out?to=sundial&p=/forecast">See the weather for your trips</a></p>`);
  }
  if (site === 'sundial') {
    if (p === '/') return page(site, 'Weather', `<p><a id="go-forecast" href="/forecast">Five-day forecast</a></p>`);
    if (p === '/forecast') return page(site, 'Five-day forecast', `${filler(3)}<p><a id="to-atlas" href="/out?to=atlas&p=/guide">Find places near you</a></p>`);
  }
  if (site === 'atlas') {
    if (p === '/') return page(site, 'Local guide', `<p><a id="go-guide" href="/guide">Places near you</a></p>`);
    if (p === '/guide') return page(site, 'Places near you', `${filler(3)}<p><a id="to-ledger" href="/out?to=ledger&p=/budget">Back to your budget</a></p>`);
  }
  return false;
}
module.exports = { SITES2, LOOK2, pages, esc };
