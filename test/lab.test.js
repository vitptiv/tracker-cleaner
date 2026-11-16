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
