'use strict';
// Friendface 2 (lab-only), F2-3: the URL-ID chain. The outgoing hand-off links carry the master id under a rotating
// ordinary-looking parameter name; the next site's server reads whichever name is present and rebuilds the id
// server-side, so one browser is joined across sites. C23 (the shipped URL-parameter strip) only touches its own
// listed names, and learn.js NEVER_PARAM shields common names, so a novel rotating name is never stripped.
const test = require('node:test'), assert = require('node:assert'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { start2, CHAIN } = require('../lab/ff2-server');

const PORT = Number(process.env.FF2_TEST_PORT3) || 8368;
function ask(site, p) { return new Promise((done, fail) => { const q = http.request({ host: '127.0.0.1', port: PORT, path: p, headers: { Host: `${site}.localhost:${PORT}` } }, (r) => {
  let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => done({ status: r.statusCode, body: t })); }); q.on('error', fail); q.end(); }); }

let lab;
test.before(async () => { lab = await start2({ port: PORT }); });
test.after(() => lab && lab.close());

test('F2-3: the kit carries the id on outgoing links under several rotating names, not one fixed name', () => {
  const kit = fs.readFileSync(path.join(__dirname, '../lab/ff2-kit.js'), 'utf8');
  assert.match(kit, /ff2chain/); assert.ok(Array.isArray(CHAIN) && CHAIN.length >= 4, 'a list of rotating names');
  for (const n of CHAIN) assert.match(n, /^[a-z]{1,4}$/, `ordinary-looking name ${n}`);
  // the names are ordinary and not in the shipped strip list / never-param shield
  const { URL_PARAMS } = require('../extension/lists.js');
  for (const n of CHAIN) assert.equal(URL_PARAMS.includes(n), false, `${n} is not a shipped tracking param`);
});
test('F2-3: the static page names no other host; the hand-off links carry the destination in data attributes for the kit to fill', async () => {
  const r = await ask('ledger', '/budget');
  assert.match(r.body, /data-ff2to="sundial"/); assert.match(r.body, /data-ff2p="\/forecast"/);
  const urls = [...r.body.matchAll(/(?:src|href|action)="([^"]*)"/g)].map((m) => m[1]);
  for (const u of urls) assert.ok(/^(#|\/)/.test(u) || u.startsWith(`http://ledger.localhost:${PORT}`), `off-site url in static page: ${u}`);
});
test('F2-3 (F3): a landing page that carries the id under any rotating name rebuilds it server-side, joins the browser, and seeds the page kit', async () => {
  const mid = 'ff2m-chain1234';
  for (const name of CHAIN.slice(0, 3)) { const r = await ask('sundial', `/forecast?${name}=${mid}`);
    assert.match(r.body, new RegExp(`__ff2seed[^]*${mid}`), `${name}: the id is seeded into the page so the kit adopts it`); }
  const g = lab.store.lookup(['ff2m:' + mid]);
  assert.ok(g !== null, 'the carried id joins to one browser');
  const f3 = lab.store.of(g).filter((x) => x.trace === 'F3');
  assert.ok(f3.length >= 1 && f3.every((x) => x.value.includes(mid)), 'F3 recorded with the id, rebuilt from the address');
  assert.match(f3[0].via, /carried in the address/);
});
test('F2-3: a page with no carried id and no stored id is not joined to anyone', async () => {
  const r = await ask('atlas', '/guide');
  assert.equal(/__ff2seed/.test(r.body), false, 'nothing seeded when nothing was carried');
});
