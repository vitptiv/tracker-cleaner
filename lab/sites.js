'use strict';
// The pretend sites that have installed the test network's pieces, plus Hop (redirector) and Pennant (advertising partner).
const http = require('node:http');
const { rid, sha } = require('./store');
const ICON = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const KEY = 'lab-server-key';
const enc = encodeURIComponent;
const here = (c) => c.lab.at(c.site, c.url.pathname + c.url.search);
// what a site owner pastes in: the invisible image, and the script kit
const pixel = (c, pl) => `<img alt="" width="1" height="1" src="${c.lab.at('testbook', `/tr?site=${c.host}&ev=PageView&pl=${pl}&u=${enc(here(c))}&r=${enc(c.q.headers.referer || '')}`)}">`;
const kit = (c, pl, more = '') => `<script src="${c.lab.at('testbook', '/kit.js')}" data-pl="${pl}"${more}></script>`;
const filler = (n) => Array.from({ length: n }, (_, i) => `<p>Paragraph ${i + 1}. Nothing here happened; the harbour, the bridge and the kites are made up for the lab.</p>`).join('');
// a request from one pretend server to another, on this computer
const s2s = (c, path, body) => new Promise((done, fail) => { const data = body ? JSON.stringify(body) : null;
  const q = http.request({ host: '127.0.0.1', port: c.lab.port, path, method: body ? 'POST' : 'GET', headers: { Host: `testbook.localhost:${c.lab.port}`, 'X-Lab-Server-Key': KEY } }, (r) => {
    let t = ''; r.on('data', (d) => t += d); r.on('end', () => { try { done(JSON.parse(t)); } catch (e) { fail(e); } }); });
  q.on('error', fail); q.end(data); });

const ARTICLES = { 'harbour-bridge': 'Harbour bridge closes for repairs', 'ferry-timetable': 'Winter ferry timetable published' };
function gazette(c) {
  const { esc } = c.lab, path = c.url.pathname, pl = rid('pl', 4), m = path.match(/^\/article\/([\w-]+)$/);
  const wrap = (title, body, script = '') => c.html(title, `${body}<hr><form id="search" action="/search"><input name="q" placeholder="Search"> <button>Search</button></form>
<form id="newsletter" onsubmit="return false"><input id="nl" name="email" type="email" placeholder="Your e-mail for the newsletter"> <button>Subscribe</button></form>${pixel(c, pl)}`, kit(c, pl) + script);
  if (path === '/') return wrap('Today', Object.entries(ARTICLES).map(([k, t]) => `<p><a id="a-${k}" href="/article/${k}">${esc(t)}</a></p>`).join(''));
  if (m && ARTICLES[m[1]]) return wrap(ARTICLES[m[1]], `${filler(14)}<p><a id="share" target="_blank" href="${esc(c.lab.at('testbook', '/share?u=' + enc(here(c))))}">Share on Testbook</a></p>
<p><small>Advert from Pennant</small> <img id="ad" alt="" width="1" height="1" src="${c.lab.at('pennant', `/ad?site=${c.host}&pl=${pl}`)}"></p>`);
  if (path === '/search') return wrap(`Search: ${c.p('q')}`, `<p id="results">Nothing found for "${esc(c.p('q'))}".</p>`, `<script>ffq('track', 'Search', { search_string: ${JSON.stringify(c.p('q'))} })</script>`);
  return false;
}

const PRICE = 49;
async function parcelpine(c) {
  const { esc } = c.lab, path = c.url.pathname, pl = rid('pl', 4), post = c.q.method === 'POST', orders = c.store.site.orders;
  const page = (title, body, script = '') => c.html(title, body, kit(c, pl, ` data-metrics="${c.lab.at('metrics.parcelpine', '')}" data-worker="/ff-sw.js"`) + (script && `<script>${script}</script>`));
  if (path === '/') return page('Kite parts', '<p><a id="p-kite-line" href="/product/kite-line">Kite line, 25 m</a></p>');
  if (path === '/product/kite-line') return page('Kite line, 25 m', `<p>${PRICE} euros.</p><form method="post" action="/basket"><button id="add">Add to basket</button></form>`,
    `ffq('track', 'ViewContent', { content_name: 'Kite line, 25 m', value: ${PRICE}, currency: 'EUR' })`);
  if (path === '/basket' && post) { c.cookie('pp_basket=kite-line; Path=/'); return c.to('/basket'); }
  if (path === '/basket') return page('Basket', `<p>1 kite line, ${PRICE} euros.</p><p><a id="checkout" href="/checkout">Check out</a></p>`, `ffq('track', 'AddToCart', { content_name: 'Kite line, 25 m', value: ${PRICE}, currency: 'EUR' })`);
  if (path === '/checkout' && post) { const order = rid('o', 3), eid = rid('e', 4), b = c.body;
    orders.set(order, { eid, email: b.email, name: b.name });
    // the shop's own server tells the test network directly; the browser is not asked
    await s2s(c, '/s2s/event', { event: 'Purchase', event_id: eid, value: PRICE, currency: 'EUR', order, site: c.host, em: sha(b.email), fn: sha(b.name), ct: sha(b.city), zp: sha(b.postcode),
      ffp: c.cookies._ffp || '', ffc: c.cookies._ffc || '', client_ip: c.q.socket.remoteAddress, client_user_agent: c.q.headers['user-agent'] || '' });
    return c.to('/thanks?order=' + order); }
  if (path === '/checkout') return page('Checkout', `<form id="pay" method="post" action="/checkout"><input id="email" name="email" type="email" placeholder="E-mail"> <input id="name" name="name" placeholder="Name">
<input id="city" name="city" placeholder="City"> <input id="postcode" name="postcode" placeholder="Postcode"> <button id="buy">Buy (pretend)</button></form>`, `ffq('track', 'InitiateCheckout', { value: ${PRICE}, currency: 'EUR' })`);
  if (path === '/thanks') { const o = orders.get(c.p('order')); if (!o) return false;
    return page('Thank you', `<p id="order">Order ${esc(c.p('order'))}. Nothing will be sent.</p>`, `ffq('track', 'Purchase', { value: ${PRICE}, currency: 'EUR', event_id: ${JSON.stringify(o.eid)} }, { em: ${JSON.stringify(o.email)} })`); }
  // the worker file the shop hosts for the test network: it keeps the site ID in its own text
  if (path === '/ff-sw.js') return c.send(200, 'text/javascript', `const ID = ${JSON.stringify(c.cookies._ffp || '')};
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(fetch(${JSON.stringify(c.lab.at('testbook', '/worker'))} + '?site=${c.host}&id=' + encodeURIComponent(ID), { mode: 'no-cors', credentials: 'include' })));`);
  return false;
}
// metrics.parcelpine.localhost looks like the shop and is answered by the test network's code
function metrics(c) {
  if (c.url.pathname === '/') return c.html('Metrics', '<p>Nothing to see.</p>');
  if (c.url.pathname !== '/c.gif') return false;
  const sid = c.cookies.pp_sid || rid('m');
  if (c.cookies.pp_sid) c.store.record(['pp_sid:' + sid, c.p('ffp') && `_ffp:parcelpine.localhost:${c.p('ffp')}`], 'T7', `pp_sid=${sid}`, 'parcelpine.localhost', 'cookie hidden from scripts, sent to ' + c.host);
  c.cookie(`pp_sid=${sid}; Path=/; Max-Age=31536000; HttpOnly; SameSite=Lax`);
  return c.gif();
}

const POSTS = { 'mending-a-kite': 'Mending a kite' };
async function tidewater(c) {
  const { esc } = c.lab, path = c.url.pathname, pl = rid('pl', 4), m = path.match(/^\/post\/([\w-]+)$/), st = c.store.site, user = st.users.get(c.cookies.tw_user);
  if (path === '/') return c.html('Notes', Object.entries(POSTS).map(([k, t]) => `<p><a href="/post/${k}">${esc(t)}</a></p>`).join(''), kit(c, pl));
  if (m && POSTS[m[1]]) return c.html(POSTS[m[1]], `${filler(4)}
<iframe id="like" title="Like" width="260" height="60" style="border:0" src="${esc(c.lab.at('testbook', `/plugins/like?href=${enc(c.lab.at(c.site, path))}&site=${c.host}&pl=${pl}`))}"></iframe>
<h2>Comments</h2>${st.comments.map((x) => `<p class="comment"><b>${esc(x.name)}</b>: ${esc(x.text)}</p>`).join('')}
${user ? `<p id="tw-user">Signed in as ${esc(user.name)} (${esc(c.cookies.tw_user)}).</p><form method="post" action="/comment"><input type="hidden" name="back" value="${esc(path)}"><input id="comment" name="text" placeholder="Comment"> <button id="send">Send</button></form>`
    : `<p><a id="signin-with" href="${esc(c.lab.at('testbook', `/dialog/oauth?app=tidewater&back=${enc(c.lab.at(c.site, path))}`))}">Sign in with Testbook</a></p>`}`, kit(c, pl));
  if (path === '/auth/callback') { const got = await s2s(c, '/oauth/token?app=tidewater&code=' + enc(c.p('code')));
    if (!got.id) return c.send(403, 'text/plain', 'The test network did not know that code');
    const id = rid('tw', 3); st.users.set(id, { name: got.name, testbook: got.id }); await s2s(c, '/s2s/event', { event: 'AppUser', site: c.host, app_user: got.id, external_id: id });
    c.cookie(`tw_user=${id}; Path=/; Max-Age=31536000`); return c.to(c.p('back').startsWith(c.lab.at(c.site, '/')) ? c.p('back') : '/'); }
  if (path === '/comment' && c.q.method === 'POST' && user) { st.comments.push({ name: user.name, text: c.body.text }); return c.to(/^\/post\/[\w-]+$/.test(c.body.back) ? c.body.back : '/'); }
  return false;
}

function loopreel(c) {
  if (c.url.pathname !== '/') return false; const pl = rid('pl', 4);
  return c.html('A kite over the harbour', `<canvas id="clip" width="320" height="180" style="background:#cde"></canvas><p><button id="play">Play</button> <span id="state">stopped</span></p>
<script>document.getElementById('play').onclick = () => { let x = 0; document.getElementById('state').textContent = 'playing';
  setInterval(() => { const g = document.getElementById('clip').getContext('2d'); g.clearRect(0, 0, 320, 180); g.fillRect(x = (x + 3) % 320, 60, 14, 14); }, 60); };</script>${pixel(c, pl)}`, kit(c, pl, ' data-only="beacon"'));
}
// Pennant knows the browser under its own number and swaps it with the test network's
function pennant(c) {
  const path = c.url.pathname;
  if (path === '/') return c.html('Pennant', '<p>A pretend advertising company.</p>');
  if (path === '/ad') { const pn = c.cookies.pn_uid || rid('p');
    c.cookie(`pn_uid=${pn}; Path=/; Max-Age=31536000; SameSite=None; Secure`);
    return c.to(c.lab.at('testbook', `/sync?pn_uid=${pn}&site=${enc(c.p('site'))}&pl=${enc(c.p('pl'))}`)); }
  if (path === '/matched') { if (c.cookies.pn_uid && c.p('ff_uid')) c.store.pennant.set(c.cookies.pn_uid, c.p('ff_uid')); return c.gif(); }
  return false;
}
// Hop: for a moment the redirector is the site in front, notes the click, and forwards
function hop(c) {
  if (c.url.pathname === '/') return c.html('Hop', '<p>Testbook\'s link shortener. Links pass through.</p>');
  if (c.url.pathname !== '/r') return false;
  const to = c.p('to'), cid = c.p('c'), id = c.cookies.hop_id || rid('h'), from = c.q.headers.referer || '';
  if (!new RegExp(`^http://[\\w.-]+\\.localhost:${c.lab.port}/`).test(to)) return c.send(400, 'text/plain', 'Hop forwards to the lab\'s own sites only');
  const ids = ['hop_id:' + id, cid && 'click:' + cid];
  c.store.record(ids, 'T30', `${from || 'unknown'} to ${to}, click ${cid}`, 'hop.localhost', 'passed through Hop');
  if (c.cookies.hop_id) c.store.record(ids, 'T5', `hop_id=${id}`, 'hop.localhost', 'cookie sent again at this pass');
  c.cookie(`hop_id=${id}; Path=/; Max-Age=31536000; SameSite=Lax`);
  const u = new URL(to); if (cid) u.searchParams.set('ffclid', cid);
  return c.to(u.href);
}
module.exports = { icon: (c) => c.send(200, 'image/png', ICON, { 'Cache-Control': 'max-age=31536000' }),
  hop, gazette, parcelpine, 'metrics.parcelpine': metrics, tidewater, loopreel, pennant, KEY };
