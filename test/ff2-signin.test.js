'use strict';
// Friendface 2 (lab-only), F2-6: the sign-in-window cookie. An arbitrary site's /login?client_id=&redirect_uri= page
// is treated by the shipped guard (guard.js isSignIn) as a sign-in, which arms the 5-minute per-site hold and spares
// KEEP_RE-named cookies. ff2 sets its ID cookie there under a KEEP_RE name, so the cleaner keeps it. This file checks
// the server route and documents, against the shipped guard.js (read-only), that any site's URL shape arms the hold.
const test = require('node:test'), assert = require('node:assert'), http = require('node:http');
const { start2 } = require('../lab/ff2-server');
const { isSignIn } = require('../extension/guard.js');
const { KEEP_RE } = require('../extension/lists.js');

const PORT = Number(process.env.FF2_TEST_PORT6) || 8380;
function ask(site, p, { cookie = '' } = {}) { return new Promise((done, fail) => { const q = http.request({ host: '127.0.0.1', port: PORT, path: p, headers: { Host: `${site}.localhost:${PORT}`, ...(cookie ? { Cookie: cookie } : {}) } }, (r) => {
  let t = ''; r.on('data', (d) => { t += d; }); r.on('end', () => done({ status: r.statusCode, body: t, setCookie: [].concat(r.headers['set-cookie'] || []) })); }); q.on('error', fail); q.end(); }); }

let lab;
test.before(async () => { lab = await start2({ port: PORT }); });
test.after(() => lab && lab.close());

test('F2-6: the shipped guard arms its hold on an arbitrary site\'s sign-in-shaped URL (documents the loophole; guard.js unchanged)', () => {
  assert.equal(isSignIn(`http://ledger.localhost:${PORT}/login?client_id=ledger-app&redirect_uri=%2Fbudget`), true, 'client_id + redirect_uri on any site arms the hold');
  assert.equal(isSignIn(`http://ledger.localhost:${PORT}/login`), true, 'a /login path on any site arms the hold');
  assert.equal(isSignIn(`http://ledger.localhost:${PORT}/budget`), false, 'an ordinary page does not');
});
test('F2-6 (F7): the /login page sets the ID cookie under a name the cleaner spares (KEEP_RE) and records it', async () => {
  const r = await ask('ledger', '/login?client_id=ledger-app&redirect_uri=%2Fbudget&m=ff2m-signin1', { cookie: 'fp_id=fp-signin1' });
  assert.equal(r.status, 200);
  const sc = r.setCookie.find((s) => /^SID=/.test(s));
  assert.ok(sc, 'an SID cookie is set on the sign-in page'); assert.match(sc, /SID=sess-/);
  assert.ok(KEEP_RE.test('SID'), 'SID is a name the shipped cleaner keeps (KEEP_RE), so it is never deleted');
  const g = lab.store.lookup(['ff2m:ff2m-signin1']);
  assert.ok(g !== null && lab.store.of(g).some((x) => x.trace === 'F7'), 'F7 recorded, joined to the browser');
  assert.match(lab.store.of(g).find((x) => x.trace === 'F7').via, /sign-in/);
});
test('F2-6: the ledger home offers the sign-in link that opens that window', async () => {
  const r = await ask('ledger', '/');
  assert.match(r.body, /id="ff2-signin"/); assert.match(r.body, /client_id=/); assert.match(r.body, /redirect_uri=/);
});
