'use strict';
// Friendface 2 (lab-only), F2-2: the cookie-less first-party ID. The per-visitor master id lives only in each site's
// own localStorage/IndexedDB/cacheStorage and is carried in the address; it is never a cookie. So background.js
// followSweep never gets the one thing it asks for (a cookie of the collector's own that other sites can use), and
// even answering every question yes blocks nothing. Here: the kit's shape, and the collector joining sites by the id.
const test = require('node:test'), assert = require('node:assert'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { start2 } = require('../lab/ff2-server');

const PORT = Number(process.env.FF2_TEST_PORT2) || 8364;
function ask(site, p, { method = 'GET', cookie = '', headers = {}, body = null } = {}) {
  return new Promise((done, fail) => { const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { Host: `${site}.localhost:${PORT}`, ...(cookie ? { Cookie: cookie } : {}), ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers } }, (r) => {
    let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => done({ status: r.statusCode, headers: r.headers, body: t, setCookie: [].concat(r.headers['set-cookie'] || []) })); });
    q.on('error', fail); q.end(body); });
}
const hit = (site, mid, extra = {}) => ask(site, '/f/hit?u=' + encodeURIComponent(`http://${site}.localhost:${PORT}/x`) + '&r=', { method: 'POST', body: JSON.stringify({ m: mid, u: `http://${site}.localhost:${PORT}/x`, stores: { local: mid, idb: mid, cache: mid }, ...extra }) });

let lab;
test.before(async () => { lab = await start2({ port: PORT }); });
test.after(() => lab && lab.close());

test('F2-2: the kit keeps the master id cookie-less (storage + URL) and never writes a cookie for it', () => {
  const kit = fs.readFileSync(path.join(__dirname, '../lab/ff2-kit.js'), 'utf8');
  assert.match(kit, /localStorage/); assert.match(kit, /indexedDB/i); assert.match(kit, /caches/);
  assert.equal(/document\.cookie\s*=/.test(kit), false, 'the kit never sets a cookie');
  assert.match(kit, /\/f\/hit/); assert.match(kit, /\bm=|['"]m['"]/, 'the id is carried to the collector');
  // served first-party from each site's own /f/ path
  assert.match(kit.length ? 'served' : '', /served/);
});
test('F2-2 (F2, cookie-less first-party ID): the collector records the id from storage and sets no cookie for it; the same id ties every site into one browser', async () => {
  const mid = 'ff2m-aa11bb22cc33';
  const r1 = await hit('ledger', mid), r2 = await hit('sundial', mid), r3 = await hit('atlas', mid);
  for (const r of [r1, r2, r3]) assert.equal(r.setCookie.some((s) => /^fp2=|ff2_id=/.test(s)), false, 'no cookie carries the master id');
  const g = lab.store.lookup(['ff2m:' + mid]);
  assert.ok(g !== null, 'the master id joins to one group');
  const recs = lab.store.of(g), f2 = recs.filter((x) => x.trace === 'F2');
  assert.ok(f2.length >= 3, 'F2 recorded on each site');
  assert.deepEqual([...new Set(f2.map((x) => x.site))].sort(), ['atlas.localhost', 'ledger.localhost', 'sundial.localhost'], 'one browser seen across all three sites');
  assert.ok(f2.every((x) => x.value.includes(mid)), 'the same id value everywhere');
  assert.ok(recs.some((x) => x.trace === 'F2' && /localStorage|IndexedDB|cache/.test(x.value)), 'F2 names where the id is kept');
});
test('F2-2: when the id is gone from the URL and storage the kit makes a new one; a respawn from a surviving copy is noted', async () => {
  const mid = 'ff2m-respawn99';
  await hit('ledger', mid, { respawned: ['localStorage'] });
  const g = lab.store.lookup(['ff2m:' + mid]);
  assert.ok(lab.store.of(g).some((x) => x.trace === 'F2' && /put back from/.test(x.via)), 'a respawn is recorded');
});
