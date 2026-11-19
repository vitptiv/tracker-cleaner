'use strict';
// The hidden collector (lab-only): the first-party reverse-proxy collector and its new sites (F2-1). Server-level checks:
// the kit, beacon, image, ETag and loopback probe are all reached through the visited site's OWN name, so to the
// cleaner nothing is "another company". No Chrome here; the cleaner-on measurement is test/lab/ff2-trip.js.
const test = require('node:test'), assert = require('node:assert'), http = require('node:http');
const { start2 } = require('../lab/ff2-server');

const PORT = Number(process.env.FF2_TEST_PORT) || 8360;
// one request to a site of the lab, as a browser on that site would make it (same-site: Host is the site's own name)
function ask(site, path, { method = 'GET', cookie = '', headers = {}, body = null } = {}) {
  return new Promise((done, fail) => {
    const q = http.request({ host: '127.0.0.1', port: PORT, path, method, headers: { Host: `${site}.localhost:${PORT}`, ...(cookie ? { Cookie: cookie } : {}), ...headers } }, (r) => {
      let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => done({ status: r.statusCode, headers: r.headers, body: t,
        setCookie: [].concat(r.headers['set-cookie'] || []) })); });
    q.on('error', fail); q.end(body); });
}
const cookieOf = (res, name) => { const m = res.setCookie.map((s) => s.match(new RegExp(`(?:^|)${name}=([^;]*)`))).find(Boolean); return m ? m[1] : ''; };

let lab;
test.before(async () => { lab = await start2({ port: PORT }); });
test.after(() => lab && lab.close());

test('F2-1: each new site serves a page with its own first-party kit; nothing points at another company', async () => {
  for (const site of lab.siteNames) { const r = await ask(site, '/');
    assert.equal(r.status, 200, site); assert.match(r.body, /src="\/f\/kit\.js"/, `${site} loads its own /f/ kit`);
    // every address the page names is this site's own; no other host appears
    const urls = [...r.body.matchAll(/(?:src|href|action)="([^"]*)"/g)].map((m) => m[1]);
    for (const u of urls) assert.ok(/^\//.test(u) || u.startsWith(`http://${site}.localhost:${PORT}`), `${site}: off-site url ${u}`);
  }
});
test('F2-1: /f/ is reverse-proxied to the collector; the kit is served same-site as JavaScript', async () => {
  const r = await ask('ledger', '/f/kit.js');
  assert.equal(r.status, 200); assert.match(r.headers['content-type'], /javascript/);
  assert.match(r.body, /\/f\/hit/); assert.match(r.body, /\/f\/px\.gif/);
});
test('F2-1 (F1, first-party reverse-proxy ID): the collector sets a first-party cookie under the site\'s own name and records the id and its join to the browser', async () => {
  const r1 = await ask('ledger', '/f/hit?u=' + encodeURIComponent(`http://ledger.localhost:${PORT}/budget`) + '&r=' + encodeURIComponent(`http://ledger.localhost:${PORT}/`));
  const id = cookieOf(r1, 'fp_id');
  assert.match(id, /^fp-[0-9a-f]+$/, 'a first-party fp_id cookie was set');
  assert.match(r1.setCookie[0], /SameSite=Lax/i); assert.equal(/SameSite=None/i.test(r1.setCookie[0]), false, 'first-party, not a cross-site cookie');
  const g = lab.store.lookup(['ff2:ledger.localhost:' + id]);
  assert.ok(g !== null, 'the id joins to a browser group');
  const recs = lab.store.of(g);
  assert.ok(recs.some((x) => x.trace === 'F1' && x.value === `fp_id=${id}` && x.site === 'ledger.localhost'), 'F1 recorded first-party');
  assert.ok(recs.some((x) => x.trace === 'F8' && /\/budget/.test(x.value) && x.site === 'ledger.localhost'), 'F8 (address + referrer) recorded first-party');
  // sent again with the cookie: the same id, no new cookie
  const r2 = await ask('ledger', '/f/hit?u=' + encodeURIComponent(`http://ledger.localhost:${PORT}/x`), { cookie: 'fp_id=' + id });
  assert.equal(cookieOf(r2, 'fp_id'), '', 'no new cookie when it is already there');
  assert.equal(lab.store.of(g).filter((x) => x.trace === 'F1').every((x) => x.value === `fp_id=${id}`), true);
});
test('F2-1 (F10, first-party ETag): /f/px.gif carries the id as an ETag and a revalidation is recorded', async () => {
  const r1 = await ask('sundial', '/f/px.gif', { cookie: 'fp_id=fp-abc123' });
  assert.match(r1.headers['content-type'], /image\/gif/); assert.ok(r1.headers.etag, 'an ETag is set');
  const r2 = await ask('sundial', '/f/px.gif', { cookie: 'fp_id=fp-abc123', headers: { 'If-None-Match': r1.headers.etag } });
  assert.equal(r2.status, 304, 'the browser revalidates and the server recognises the tag');
  const g = lab.store.lookup(['ff2:sundial.localhost:fp-abc123']);
  assert.ok(lab.store.of(g).some((x) => x.trace === 'F10' && x.site === 'sundial.localhost'), 'F10 recorded');
});
test('F2-1 (F9, first-party loopback probe): the page asks its own site, the collector probes loopback server-side', async () => {
  const r = await ask('atlas', `/f/probe?ports=${lab.probe[0]},${lab.probe[1]}`, { cookie: 'fp_id=fp-probe1' });
  assert.equal(r.status, 200);
  const g = lab.store.lookup(['ff2:atlas.localhost:fp-probe1']);
  const rec = lab.store.of(g).find((x) => x.trace === 'F9');
  assert.ok(rec, 'F9 recorded'); assert.match(rec.value, new RegExp(`open: ${lab.probe[0]}`)); assert.match(rec.value, new RegExp(`closed: ${lab.probe[1]}`));
});
test('F2-1: the collector refuses a connection that is not loopback or not a known site', async () => {
  const r = await ask('evil', '/'); assert.equal(r.status, 403);
});
