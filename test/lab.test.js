'use strict';
// The tracking lab without a browser: each pretend site over plain HTTP on 127.0.0.1. The real-Chrome trip is test/lab/trip.js.
const test = require('node:test'), assert = require('node:assert'), http = require('node:http');
const { start, SITES } = require('../lab/server');
const PORT = 8240;
let lab;
// one request to the lab under a site's name; cookies are a plain object the caller keeps
const ask = (site, path, { method = 'GET', body, jar, headers = {} } = {}) => new Promise((done, fail) => {
  const data = body === undefined ? null : typeof body === 'string' ? body : JSON.stringify(body);
  const q = http.request({ host: '127.0.0.1', port: PORT, path, method, headers: { Host: `${site}.localhost:${PORT}`,
    ...(jar && Object.keys(jar).length ? { Cookie: Object.entries(jar).map(([k, v]) => `${k}=${v}`).join('; ') } : {}), ...headers } }, (r) => {
    let text = ''; r.setEncoding('utf8'); r.on('data', (d) => text += d);
    r.on('end', () => { for (const sc of r.headers['set-cookie'] || []) { const [kv] = sc.split(';'), i = kv.indexOf('='); if (jar) { if (/Max-Age=0/.test(sc)) delete jar[kv.slice(0, i)]; else jar[kv.slice(0, i)] = kv.slice(i + 1); } }
      done({ status: r.statusCode, headers: r.headers, text, json: () => JSON.parse(text) }); }); });
  q.on('error', fail); q.end(data); });
const form = (o) => new URLSearchParams(o).toString();
test.before(async () => { lab = await start({ port: PORT }); });
test.after(() => lab.close());
test.beforeEach(() => lab.store.forget());

test('lab: every site answers under its own name with its own page', async () => {
  for (const [site, title] of Object.entries(SITES)) { const r = await ask(site, '/');
    assert.equal(r.status, 200, site); assert.ok(r.text.includes(title.replace('&', '&#38;')), site); }
});
test('lab: bound to 127.0.0.1 only, and an unknown name is refused', async () => {
  assert.equal(lab.server.address().address, '127.0.0.1');
  assert.equal((await ask('elsewhere', '/')).status, 403);
});

const MARA = { name: 'Mara Lindqvist', email: 'mara.lindqvist@example.test', password: 'lab-only-1' };
const JONAS = { name: 'Jonas Weller', email: 'jonas.weller@example.test', password: 'lab-only-2' };
const join = async (who, jar = {}) => { await ask('friendface', '/join', { method: 'POST', body: form(who), jar }); return jar; };
const knows = async (jar) => (await ask('friendface', '/what-i-know.json', { jar })).json();
const row = (k, id) => k.rows.find((r) => r.id === id);

test('lab: sign-in sets the session cookie, a wrong password does not, two accounts stay apart', async () => {
  const mara = await join(MARA), jonas = await join(JONAS);
  assert.ok(mara.ff_session && jonas.ff_session && mara.ff_session !== jonas.ff_session);
  assert.match((await ask('friendface', '/', { jar: mara })).text, /Signed in as <b>Mara Lindqvist/);
  assert.match((await ask('friendface', '/profile', { jar: jonas })).text, /jonas\.weller@example\.test/);
  const wrong = {}; await ask('friendface', '/login', { method: 'POST', body: form({ email: MARA.email, password: 'nope' }), jar: wrong });
  assert.equal(wrong.ff_session, undefined);
  await ask('friendface', '/logout', { jar: mara }); assert.equal(mara.ff_session, undefined);
  await ask('friendface', '/login', { method: 'POST', body: form(MARA), jar: mara }); assert.ok(mara.ff_session);
  assert.equal((await knows(mara)).who.name, 'Mara Lindqvist'); assert.equal((await knows(jonas)).who.name, 'Jonas Weller');
});
test('lab: the feed links out through Hop, each link with its own click ID', async () => {
  const feed = (await ask('friendface', '/', { jar: await join(MARA) })).text, ids = [...feed.matchAll(/hop\.localhost:\d+\/r\?c=(c-\w+)&#38;to=/g)].map((m) => m[1]);
  assert.equal(ids.length, 3); assert.equal(new Set(ids).size, 3); assert.match(feed, /Tidewater Notes: mending a kite/);
});
test('lab: "What I know about you" lists all 36 rows, and an empty log shows 0 of 36', async () => {
  const traces = require('../lab/traces.json'), k = await knows({});
  assert.equal(traces.length, 36); assert.deepEqual(k.rows.map((r) => r.id), traces.map((t) => t.id));
  assert.equal(k.tracked, 0); assert.equal(k.of, 36); assert.deepEqual(k.history, []);
  assert.ok(k.rows.every((r) => r.status === 'built' ? r.mark === 'not yet seen' && r.value === '' : r.mark === r.status && r.reason));
  const html = (await ask('friendface', '/what-i-know')).text;
  for (const t of traces) assert.ok(html.includes(`data-row="${t.id}"`), t.id);
  assert.match(html, /0 of 36 kinds tracked/);
});
test('lab: the canary says off when the link tag arrives and on when it was stripped', async () => {
  const hop = await ask('friendface', '/lab/check'); assert.match(hop.headers.location, /utm_source=canary/);
  assert.match((await ask('friendface', hop.headers.location)).text, /cleaner seems off/);
  assert.equal((await knows({})).canary.blockedName.startsWith('skipped'), true);
  assert.match((await ask('friendface', '/lab/check/result')).text, /cleaner seems on/);
});

// what a browser does with an embedded piece: find its address in the page and ask for it with Friendface's cookies
const embedded = (html, re) => { const m = html.match(re); assert.ok(m, String(re)); const u = new URL(m[1].replace(/&#38;/g, '&')); return [u.hostname.replace('.localhost', ''), u.pathname + u.search]; };
const IMG = /<img[^>]+src="([^"]+\/tr\?[^"]+)"/;
const view = async (site, path, jar, headers) => { const html = (await ask(site, path, { headers: { Referer: `http://${site}.localhost:${PORT}/` } })).text;
  const [to, p] = embedded(html, IMG); await ask(to, p, { jar, headers }); return html; };

test('lab step 7: one cookie ID on two sites, the pages, the request details and a second simulated address', async () => {
  const jar = {};
  await view('gazette', '/article/harbour-bridge', jar); assert.match(jar.ff_uid, /^u-\w+$/);
  await view('loopreel', '/', jar); await view('gazette', '/', jar, { 'X-Forwarded-For': '203.0.113.7' });
  const k = await knows(jar);
  assert.equal(row(k, 'T1').value, 'ff_uid=' + jar.ff_uid); assert.deepEqual(row(k, 'T1').sites, ['loopreel.localhost', 'gazette.localhost']);
  assert.deepEqual(k.history.map((h) => h.url), ['/article/harbour-bridge', '/', '/'].map((p, i) => `http://${i === 1 ? 'loopreel' : 'gazette'}.localhost:${PORT}${p}`));
  assert.match(row(k, 'T23').value, /article\/harbour-bridge \(came from http:\/\/gazette/);
  const addresses = row(k, 'T24').captures.map((x) => x.value.split(',')[0]);
  assert.ok(addresses.includes('address 127.0.0.1') && addresses.includes('address 203.0.113.7 (forwarded; simulated)'), addresses.join());
  assert.match(row(k, 'T24').value, /header pattern h-\w{6}$/);
  assert.equal(k.who, null); assert.equal(row(k, 'T2').mark, 'not yet seen');
});
test('lab step 7: pages from before sign-in end up under the person', async () => {
  const jar = {}; await view('gazette', '/article/harbour-bridge', jar); await join(MARA, jar); await view('loopreel', '/', jar);
  const k = await knows(jar);
  assert.equal(k.who.name, 'Mara Lindqvist'); assert.deepEqual(k.history.map((h) => h.beforeSignIn), [true, false]);
  assert.equal(row(k, 'T2').value, `ff_session=${jar.ff_session} is Mara Lindqvist`); assert.deepEqual(row(k, 'T2').sites, ['loopreel.localhost']);
  assert.equal((await knows(await join(JONAS))).history.length, 0);
});

const { sha } = require('../lab/store'), { rhythmDistance } = require('../lab/friendface');
const FRAME = /<iframe[^>]+src="([^"]+)"/, kitSays = (jar, data) => ask('friendface', '/report', { method: 'POST', jar, body: data });
const post = (path, jar, body) => ask('friendface', path, { method: 'POST', jar, body });

test('lab step 8 (c2): the frame\'s storage ID still names the browser when every cookie is gone', async () => {
  const jar = {}; await view('gazette', '/', jar);
  const [, src] = embedded((await ask('tidewater', '/post/mending-a-kite')).text, FRAME);
  assert.match((await ask('friendface', src, { jar })).text, /localStorage\.getItem\('ff_fsid'\)/);
  await post('/plugins/frame-report', jar, { fsid: 's-1234abcd', site: 'tidewater.localhost' });
  const k = await knows(jar), c = row(k, 'T9').captures[0];
  assert.deepEqual([c.value, c.site, c.via], ['frame key ff_fsid = s-1234abcd', 'tidewater.localhost', 'Friendface frame inside the site']);
  const fresh = {}; await post('/plugins/frame-report', fresh, { fsid: 's-1234abcd', site: 'tidewater.localhost' });
  assert.notEqual(fresh.ff_uid, jar.ff_uid); assert.equal((await knows(fresh)).history.length, 1);
});
test('lab step 8 (c3): the cache tag comes back in the request and names the browser without cookies or storage', async () => {
  const jar = {}; await view('gazette', '/', jar);
  const first = await ask('friendface', '/tag.gif?site=gazette.localhost', { jar }), tag = first.headers.etag;
  assert.match(tag, /^"t-\w+"$/); assert.match(first.headers['cache-control'], /no-cache/); assert.equal(row(await knows(jar), 'T16').mark, 'not yet seen');
  const fresh = {}, again = await ask('friendface', '/tag.gif?site=gazette.localhost', { jar: fresh, headers: { 'If-None-Match': tag } });
  assert.equal(again.status, 304);
  const k = await knows(fresh); assert.equal(row(k, 'T16').value, `If-None-Match: ${tag}`); assert.deepEqual(row(k, 'T16').sites, ['gazette.localhost']); assert.equal(k.history.length, 1);
});

const feedClick = async (jar, n = 0) => { const html = (await ask('friendface', '/', { jar })).text; return [...html.matchAll(/href="([^"]*hop\.localhost[^"]+)"/g)].map((m) => new URL(m[1].replace(/&#38;/g, '&')))[n]; };
test('lab step 9 (c4): the click ID arrives in the address, lands in the site cookie and names the account', async () => {
  const mara = await join(MARA), link = await feedClick(mara), cid = link.searchParams.get('c'), hopJar = {};
  const hop = await ask('hop', link.pathname + link.search, { jar: hopJar });
  assert.equal(hop.status, 302); assert.equal(new URL(hop.headers.location).searchParams.get('ffclid'), cid); assert.match(hop.headers.location, /tidewater\.localhost.*mending-a-kite/);
  const other = {}; await kitSays(other, { kind: 'page', site: 'tidewater.localhost', url: hop.headers.location, ffc: `ffc.1.1700000000000.${cid}`, ffp: 'ffp.1.1.2' });
  const k = await knows(other); assert.equal(k.who.name, 'Mara Lindqvist'); assert.equal(row(k, 'T4').value, `_ffc=ffc.1.1700000000000.${cid}`); assert.deepEqual(row(k, 'T4').sites, ['tidewater.localhost']);
  const stray = {}; await kitSays(stray, { kind: 'page', site: 'tidewater.localhost', url: 'x', ffc: 'ffc.1.1.c-notissued' }); assert.equal((await knows(stray)).who, null);
});
test('lab step 9 (c5): one fingerprint code on two sites', async () => {
  const jar = {}, fp = { code: 'fp-0badc0de', canvas: 'a', graphics: 'b', audio: 'c', fonts: 'd', traits: '1200,900' };
  for (const site of ['gazette.localhost', 'parcelpine.localhost']) await kitSays(jar, { kind: 'page', site, url: `http://${site}/`, fp });
  const r = row(await knows(jar), 'T25'); assert.equal(r.value, 'fp-0badc0de'); assert.deepEqual(r.sites, ['gazette.localhost', 'parcelpine.localhost']); assert.match(r.captures[0].via, /canvas a, graphics b, audio c, fonts d/);
});

test('lab step 10 (c7): a typed address matches the right account and no other', async () => {
  await join(MARA); await join(JONAS);
  const typed = async (email) => { const jar = {}; await kitSays(jar, { kind: 'typed', site: 'gazette.localhost', em: sha(email), field: 'email' }); return knows(jar); };
  const m = await typed(' Mara.Lindqvist@example.test'), j = await typed(JONAS.email), n = await typed('nobody@example.test');
  assert.equal(m.who.name, 'Mara Lindqvist'); assert.equal(j.who.name, 'Jonas Weller'); assert.equal(n.who, null);
  assert.equal(row(m, 'T27').value, `sha256 ${sha(MARA.email)}: matches ${MARA.email}`); assert.match(row(m, 'T27').captures[0].via, /typed into the field "email", not sent/);
  assert.match(row(n, 'T27').value, /matches no account$/);
});
test('lab step 10 (c9): two typing sessions of one made-up person score closer than two people', async () => {
  const mara1 = [80, 95, 70, 88, 91, 77, 84, 90], mara2 = [83, 92, 74, 85, 95, 79, 81, 86], jonas = [210, 150, 320, 180, 260, 140, 300, 230];
  assert.ok(rhythmDistance(mara1, mara2) < rhythmDistance(mara1, jonas) / 5);
  const jar = {}; await kitSays(jar, { kind: 'rhythm', site: 'gazette.localhost', gaps: mara1, moves: 12, dist: 340 });
  assert.equal(row(await knows(jar), 'T35').value, '9 keys, gap mean 84 ms, spread 8 ms; mouse 12 moves, 340 px');
});

test('lab step 11 (c8): the permission is read; the push subscription is designed, not built', async () => {
  const jar = {}; await ask('friendface', '/perm?state=denied', { jar }); assert.equal(row(await knows(jar), 'T22').mark, 'not yet seen');
  await ask('friendface', '/perm?state=granted', { jar }); const k = await knows(jar);
  assert.equal(row(k, 'T22').value, 'notifications: granted'); assert.equal(row(k, 'T34').mark, 'designed, not built'); assert.match(row(k, 'T34').reason, /push service/);
});
test('lab step 11 (c10): the probe finds the listener the lab opened and misses the closed port', async () => {
  const knock = (port) => new Promise((done) => http.get({ host: '127.0.0.1', port }, (r) => { r.resume(); done('open'); }).on('error', () => done('closed')));
  assert.deepEqual([await knock(PORT + 1), await knock(PORT + 2)], ['open', 'closed']);
  const kit = (await ask('friendface', '/kit.js')).text; assert.ok(kit.includes(`PROBE = [${PORT + 1},${PORT + 2}]`)); assert.ok(!/127\.0\.0\.1:\d/.test(kit) && !/192\.168|10\.0\./.test(kit));
  const jar = {}; await kitSays(jar, { kind: 'page', site: 'gazette.localhost', url: 'u', probe: [[PORT + 1, 'open'], [PORT + 2, 'closed']] });
  assert.equal(row(await knows(jar), 'T36').value, `open: ${PORT + 1}; closed: ${PORT + 2}`);
});

test('lab step 12 (c11): the shop\'s server reports the purchase; reported twice it is counted once; it names the account without any Friendface cookie', async () => {
  await join(MARA); const shop = { _ffp: 'ffp.1.5.77' }, ff = {};
  const done = await ask('parcelpine', '/checkout', { method: 'POST', jar: shop, body: form({ email: MARA.email, name: MARA.name, city: 'Nordhavn', postcode: '00100' }) });
  const order = new URL(done.headers.location, 'http://x').searchParams.get('order'), thanks = (await ask('parcelpine', done.headers.location, { jar: shop })).text;
  const eid = thanks.match(/event_id: "(e-\w+)"/)[1];
  await kitSays(ff, { kind: 'page', site: 'parcelpine.localhost', url: 'thanks', ffp: shop._ffp });
  let k = await knows(ff); assert.equal(k.who.name, 'Mara Lindqvist'); assert.deepEqual(k.purchases.map((p) => p.sources), [['server']]);
  assert.equal(row(k, 'T33').value, `Purchase 49 EUR, order ${order}, event ${eid}`); assert.match(row(k, 'T27').captures[0].via, /shop's server/);
  await kitSays(ff, { kind: 'event', site: 'parcelpine.localhost', name: 'Purchase', params: { value: 49, currency: 'EUR', event_id: eid }, ffp: shop._ffp });
  k = await knows(ff); assert.equal(k.purchases.length, 1); assert.deepEqual(k.purchases[0].sources, ['server', 'browser']);
  assert.equal((await ask('friendface', '/s2s/event', { method: 'POST', body: { event: 'Purchase', event_id: 'e-x' } })).status, 403);
});

test('lab step 13: site cookie, events with values, the closing beacon', async () => {
  const jar = {}, base = { site: 'gazette.localhost', ffp: 'ffp.1.9.123', pl: 'pl-1', url: 'http://gazette.localhost/search?q=kite+repair' };
  assert.match((await ask('gazette', '/search?q=kite+repair')).text, /ffq\('track', 'Search', \{ search_string: "kite repair" \}\)/);
  await kitSays(jar, { kind: 'page', ...base }); await kitSays(jar, { kind: 'event', ...base, name: 'Search', params: { search_string: 'kite repair' } });
  await ask('friendface', '/beacon', { method: 'POST', jar, body: { kind: 'close', ...base, seconds: 10.2, scroll: 100 } });
  const k = await knows(jar);
  assert.equal(row(k, 'T3').value, '_ffp=ffp.1.9.123'); assert.equal(row(k, 'T26').value, 'Search {"search_string":"kite repair"}');
  assert.equal(row(k, 'T28').value, '10.2 s on http://gazette.localhost/search?q=kite+repair, scrolled 100%'); assert.equal(k.history.length, 1);
  assert.match((await ask('loopreel', '/')).text, /data-only="beacon"/);
});
test('lab step 13: Hop logs from and to, its cookie comes back, the link pings, the share page logs the article', async () => {
  const mara = await join(MARA), hopJar = {}, feed = `http://friendface.localhost:${PORT}/`;
  for (const n of [0, 1]) { const link = await feedClick(mara, n); await ask('friendface', `/ping?c=${link.searchParams.get('c')}`, { method: 'POST', jar: mara });
    await ask('hop', link.pathname + link.search, { jar: hopJar, headers: { Referer: feed } }); }
  await ask('friendface', '/share?u=' + encodeURIComponent(`http://gazette.localhost:${PORT}/article/harbour-bridge`), { jar: mara });
  const k = await knows(mara);
  assert.match(row(k, 'T30').value, new RegExp(`^${feed} to http://tidewater\\.localhost:${PORT}/post/mending-a-kite, click c-`)); assert.equal(row(k, 'T30').captures.length, 2);
  assert.equal(row(k, 'T5').value, 'hop_id=' + hopJar.hop_id); assert.equal(row(k, 'T5').captures.length, 1);
  assert.match(row(k, 'T29').value, /^click c-\w+ to http:\/\/tidewater/); assert.deepEqual(row(k, 'T29').sites, ['tidewater.localhost', 'parcelpine.localhost']);
  assert.match(row(k, 'T31').value, /^share page opened for http:\/\/gazette.*harbour-bridge$/);
  assert.equal((await ask('hop', '/r?to=' + encodeURIComponent('http://example.com/'))).status, 400);
});

test('lab step 14: the like frame names the signed-in person and keeps a per-site cookie', async () => {
  const mara = await join(MARA), [, src] = embedded((await ask('tidewater', '/post/mending-a-kite')).text, FRAME);
  const frame = await ask('friendface', src, { jar: mara }); assert.match(frame.text, /as Mara Lindqvist/);
  assert.match(frame.headers['set-cookie'].join(), /ff_frame=f-\w+;.*Secure; Partitioned/);
  await post('/plugins/like', mara, { fsid: 's-1', site: 'tidewater.localhost', href: 'http://tidewater.localhost/post/mending-a-kite' });
  const k = await knows(mara); assert.equal(row(k, 'T8').value, 'ff_frame=' + mara.ff_frame); assert.equal(row(k, 'T31').value, 'liked http://tidewater.localhost/post/mending-a-kite');
});
test('lab step 14: "Sign in with Friendface" gives the blog the account\'s ID, and Friendface a note', async () => {
  const mara = await join(MARA), blog = {}, post = `http://tidewater.localhost:${PORT}/post/mending-a-kite`, q = `/dialog/oauth?app=tidewater&back=${encodeURIComponent(post)}`;
  assert.match((await ask('friendface', q, { jar: mara })).text, /Continue as Mara Lindqvist/);
  assert.equal((await ask('friendface', q.replace('tidewater.localhost', 'elsewhere.localhost'), { jar: mara })).status, 400);
  const back = new URL((await ask('friendface', q, { method: 'POST', jar: mara })).headers.location);
  assert.equal((await ask('tidewater', back.pathname + back.search, { jar: blog })).headers.location, post); assert.match(blog.tw_user, /^tw-\w+$/);
  assert.match((await ask('tidewater', '/post/mending-a-kite', { jar: blog })).text, /Signed in as Mara Lindqvist/);
  assert.match(row(await knows(mara), 'T32').value, new RegExp(`^tidewater\\.localhost knows this account as ${blog.tw_user} \\(Friendface app ID ffu-\\w+\\)$`));
  assert.equal((await ask('tidewater', back.pathname + back.search, { jar: {} })).status, 403);
});
test('lab step 14: cookie syncing leaves the pair in both tables; the disguised subdomain\'s cookie is hidden from scripts', async () => {
  const ff = {}, pn = {}, shop = {};
  const ad = await ask('pennant', '/ad?site=gazette.localhost&pl=pl-9', { jar: pn }), sync = new URL(ad.headers.location);
  const matched = new URL((await ask('friendface', sync.pathname + sync.search, { jar: ff })).headers.location); await ask('pennant', matched.pathname + matched.search, { jar: pn });
  assert.equal(row(await knows(ff), 'T6').value, `pn_uid=${pn.pn_uid} is ff_uid=${ff.ff_uid}`); assert.equal(lab.store.pennant.get(pn.pn_uid), ff.ff_uid);
  const first = await ask('metrics.parcelpine', '/c.gif?ffp=ffp.1.3.4', { jar: shop }); assert.match(first.headers['set-cookie'][0], /^pp_sid=m-\w+;.*HttpOnly/);
  await kitSays(ff, { kind: 'page', site: 'parcelpine.localhost', url: 'u', ffp: 'ffp.1.3.4' }); assert.equal(row(await knows(ff), 'T7').mark, 'not yet seen');
  await ask('metrics.parcelpine', '/c.gif?ffp=ffp.1.3.4', { jar: shop }); assert.equal(row(await knows(ff), 'T7').value, 'pp_sid=' + shop.pp_sid);
});

test('lab step 15: copies in four stores, the cookie put back, the saved file, the worker, storage totals', async () => {
  const jar = {}, id = 'ffp.1.7.555', page = { kind: 'page', site: 'gazette.localhost', url: 'u', ffp: id, held: { 'local storage': id, IndexedDB: id, 'cache storage': id },
    tab: { id: 'tab-ab12', pages: 2 }, storage: { usage: 1234, quota: 5000000 } };
  const saved = (await ask('friendface', '/saved.js')).text.match(/"(k-\w+)"/)[1];
  await kitSays(jar, { ...page, saved }); let k = await knows(jar);
  assert.deepEqual(['T9', 'T11', 'T12', 'T10', 'T14'].map((t) => row(k, t).value), [`key ff_copy = ${id}`, `database ff, key id = ${id}`, `cache ff, entry /ff-id = ${id}`, 'tab tab-ab12, page 2', 'usage 1234 bytes, quota 5000000 bytes']);
  assert.equal(row(k, 'T15').mark, 'not yet seen');
  await kitSays(jar, { ...page, saved, respawned: ['local storage', 'IndexedDB'] }); k = await knows(jar);
  assert.equal(row(k, 'T15').value, `saved.js says ${saved}`); assert.equal(row(k, 'T3').captures[1].via, 'the cookie was gone; put back from local storage, IndexedDB');
  assert.ok((await ask('friendface', '/sw.js', { jar })).text.includes(JSON.stringify(jar.ff_uid)));
  await ask('friendface', `/worker?site=friendface.localhost&id=${jar.ff_uid}`, { jar }); await ask('friendface', `/worker?site=parcelpine.localhost&id=${id}`, { jar });
  assert.deepEqual(row(await knows(jar), 'T13').captures.map((c) => [c.value, c.site]), [[`worker holds ${jar.ff_uid}`, 'friendface.localhost'], [`worker holds ${id}`, 'parcelpine.localhost']]);
});
test('lab step 15: rows only Chrome\'s own files can show are handed in from outside; the rows that cannot be created say why', async () => {
  const jar = {}; await post('/lab/outside', jar, { rows: { T17: '4 compiled files', T18: '3 icons', T19: '12 addresses', T1: 'made up', T20: 'x' } });
  const k = await knows(jar);
  for (const t of ['T17', 'T18', 'T19']) { assert.equal(row(k, t).mark, 'tracked'); assert.match(row(k, t).captures[0].via, /checked from outside/); }
  assert.equal(row(k, 'T1').mark, 'not yet seen');
  for (const t of ['T20', 'T21']) { assert.equal(row(k, t).mark, 'not buildable here'); assert.ok(row(k, t).reason.length > 40); assert.equal(row(k, t).value, ''); }
});
