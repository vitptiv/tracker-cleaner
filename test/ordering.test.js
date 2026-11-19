'use strict';
// Regression / documentation only (the extension is NOT changed in this batch). The plan flags a DNR-vs-webRequest
// ordering concern: one-sighting learning (background.js noteAnswer sets follow[site].ck) reads a third-party
// Set-Cookie in onHeadersReceived, while the structural rule C29 (net-rules.js) strips Set-Cookie on third-party
// responses. Whether the extension's own onHeadersReceived sees the header before or after its own DNR strip is a
// Chrome ordering detail the Node fake does not model. This test pins the code path as it is today; the real-Chrome
// ordering is stated in docs/build-log.md as a known limitation, to be settled (and fixed if needed) in a later batch.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const answer = async (bg, host, page) => { await bg.answer({ url: `https://${host}/a`, initiator: `https://www.${page}`, type: 'script', responseHeaders: [{ name: 'Set-Cookie', value: 'tid=t-77ab12cd34ef; SameSite=None; Secure' }] }); await bg.settle(); };
const asks = (bg) => ((bg.state.storage.pending || {}).unknown || { items: [] }).items.filter((i) => i.kind === 'tracker').map((i) => i.site);

const req = async (bg, host, page, tab) => { await bg.request({ url: `https://${host}/kit.js`, initiator: `https://www.${page}/`, type: 'script', tabId: tab, frameId: 0 }); await bg.settle(); };
test('today: a third-party Set-Cookie marks evidence (e.ck) but one sighting alone raises NO question; two sightings do', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://www.news.example/' }, { id: 2, active: false, url: 'https://www.shop.example/' }] }));
  await req(bg, 'px.trk.example', 'news.example', 1); await answer(bg, 'px.trk.example', 'news.example');
  assert.equal((bg.state.storage.follow['px.trk.example'] || {}).ck, true, 'the answer set the evidence flag e.ck');
  await bg.alarm('sweep'); assert.deepEqual(asks(bg), [], 'one sighting with a cookie is not enough: no question (needs two sites, or the handed-ID signal)');
  await req(bg, 'px.trk.example', 'shop.example', 2); await answer(bg, 'px.trk.example', 'shop.example');
  await bg.alarm('sweep'); assert.deepEqual(asks(bg), ['px.trk.example'], 'seen on a second site: now one Block question, keyed on the exact host');
});
test('the same Set-Cookie header is what C29 removes on a third-party response, so the two depend on Chrome\'s header ordering', () => {
  const { netRules } = require('../extension/net-rules.js');
  const r = netRules({ cookies: true })[0];
  assert.ok((r.action.responseHeaders || []).some((h) => h.header === 'set-cookie' && h.operation === 'remove'), 'C29 removes set-cookie third-party');
  // documented, not asserted about real Chrome: if the strip runs before the extension's own onHeadersReceived, e.ck
  // never becomes true for a third party and this one-sighting path cannot fire on the wire. See docs/build-log.md.
});
