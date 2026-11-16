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
