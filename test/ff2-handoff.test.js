'use strict';
// Friendface 2 (lab-only), F2-4: the scripted hand-off. The browser is passed between sites by a scripted navigation
// (location.assign) or a <meta refresh>, never an HTTP 302, and the outgoing click is recorded first-party before the
// jump. So background.js noteRedirect (which listens on onBeforeRedirect only) never fires, skip.js and the bounce
// question never engage, and no-ping.js has no ping attribute to strip -- yet the redirect log still fills.
const test = require('node:test'), assert = require('node:assert'), http = require('node:http'), fs = require('node:fs'), path = require('node:path');
const { start2 } = require('../lab/ff2-server');

const PORT = Number(process.env.FF2_TEST_PORT4) || 8372;
function ask(site, p, { method = 'GET', body = null } = {}) { return new Promise((done, fail) => { const q = http.request({ host: '127.0.0.1', port: PORT, path: p, method, headers: { Host: `${site}.localhost:${PORT}`, ...(body ? { 'Content-Type': 'application/json' } : {}) } }, (r) => {
  let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => done({ status: r.statusCode, body: t })); }); q.on('error', fail); q.end(body); }); }

let lab;
test.before(async () => { lab = await start2({ port: PORT }); });
test.after(() => lab && lab.close());

test('F2-4: the hand-off is scripted/meta, records the click first-party before the jump, and never uses the ping attribute or an HTTP redirect', () => {
  const ho = fs.readFileSync(path.join(__dirname, '../lab/ff2-handoff.js'), 'utf8');
  assert.match(ho, /preventDefault/); assert.match(ho, /location\.(assign|href)/, 'a scripted navigation');
  assert.match(ho, /\/f\/hop/, 'the hop is recorded first-party before the jump');
  assert.equal(/\bping=/.test(ho), false, 'no ping attribute is used');
  // the server never hands a site off with a 302 Location
  const srv = fs.readFileSync(path.join(__dirname, '../lab/ff2-server.js'), 'utf8'), sites = fs.readFileSync(path.join(__dirname, '../lab/ff2-sites.js'), 'utf8');
  assert.equal(/Location:/.test(sites), false, 'ff2-sites uses no HTTP redirect');
  // one site hands off by <meta refresh> to show that path too
  assert.match(sites, /http-equiv="refresh"/i);
});
test('F2-4 (F4 redirect log, F5 first-party click): /f/hop records the from->to hop and the click, joined to the browser, with no onBeforeRedirect involved', async () => {
  const mid = 'ff2m-hop1234';
  const r = await ask('ledger', '/f/hop', { method: 'POST', body: JSON.stringify({ m: mid, from: `http://ledger.localhost:${PORT}/budget`, to: `http://sundial.localhost:${PORT}/forecast` }) });
  assert.equal(r.status, 200);
  const g = lab.store.lookup(['ff2m:' + mid]); assert.ok(g !== null);
  const recs = lab.store.of(g);
  const f4 = recs.find((x) => x.trace === 'F4'); assert.ok(f4, 'F4 recorded'); assert.match(f4.value, /\/budget/); assert.match(f4.value, /sundial/); assert.match(f4.via, /scripted|meta/);
  assert.ok(recs.some((x) => x.trace === 'F5' && /sundial/.test(x.value)), 'F5 (the click) recorded first-party');
});
test('F2-4: the meta-refresh hand-off page carries the id onward in the address', async () => {
  const mid = 'ff2m-meta5678';
  const r = await ask('atlas', `/hop?to=ledger&p=/budget&m=${mid}`);
  assert.match(r.body, /http-equiv="refresh"/i);
  assert.match(r.body, new RegExp(`ledger\\.localhost:${PORT}/budget\\?[a-z]+=${mid}`), 'the onward address carries the id under a rotating name');
});
