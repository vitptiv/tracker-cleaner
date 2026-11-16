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
module.exports = { ask, form, PORT, lab: () => lab };
