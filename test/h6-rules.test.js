// H6 (second audit): each rule is installed on its own and a refused one is named in the popup; the referring page stays
// for embedded frames; fewer and exact exemptions.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { NET_BASE, FAMILIES, GOOGLE_APIS, netRules } = require('../extension/net-rules.js'), { renderPopup } = require('../extension/popup-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const removed = (r, k) => (r.action[k] || []).map((h) => h.header);

test('a header rule Chrome refuses: the others are installed, and the popup names what is not working instead of saying nothing', async () => {
  const bg = await load(on()); bg.refuse = (r) => r.id === NET_BASE;
  await bg.send({ type: 'setMode', group: 'othercookies', mode: 'off' }); await bg.send({ type: 'setMode', group: 'othercookies', mode: 'auto' }); await bg.settle();
  const ids = bg.state.rules.map((r) => r.id);
  assert.equal(ids.includes(NET_BASE), false); assert.ok(ids.includes(NET_BASE + 1) && ids.includes(NET_BASE + 5));
  const s = await bg.send({ type: 'state' });
  assert.deepEqual(s.notWorking, ['Other companies get no cookies or cache tags']);
  assert.ok(renderPopup(s, null).includes('Not working right now, because Chrome refused a rule: Other companies get no cookies or cache tags.'));
  bg.refuse = null; await bg.send({ type: 'setMode', group: 'othercookies', mode: 'off' }); await bg.send({ type: 'setMode', group: 'othercookies', mode: 'auto' }); await bg.settle();
  assert.equal((await bg.send({ type: 'state' })).notWorking, undefined);
});
test('the same for the other rules: a refused local-network rule or stop rule is named', async () => {
  const bg = await load(on({ storage: { stopped: ['trk.example'] } })); bg.refuse = (r) => r.id === NET_BASE + 22 || r.id === 100001;
  await bg.send({ type: 'setMode', group: 'local', mode: 'off' }); await bg.send({ type: 'setMode', group: 'local', mode: 'auto' }); await bg.settle();
  assert.deepEqual((await bg.send({ type: 'state' })).notWorking.sort(), ['Pages may not call this computer', 'Stopped trackers are blocked']);
});
test('the referring page is kept for an embedded frame (players check it) and removed for everything else', () => {
  const rules = netRules({ cookies: true, tags: true, exempt: [] }), main = rules.find((r) => r.id === NET_BASE), ref = rules.find((r) => removed(r, 'requestHeaders').includes('referer'));
  assert.deepEqual(removed(main, 'requestHeaders'), ['cookie', 'if-none-match', 'if-modified-since']); assert.ok(main.condition.resourceTypes.includes('sub_frame'));
  assert.deepEqual(removed(ref, 'requestHeaders'), ['referer']); assert.equal(ref.condition.resourceTypes.includes('sub_frame'), false); assert.ok(ref.condition.resourceTypes.includes('image'));
  assert.equal(netRules({ cookies: true, exempt: [] }).some((r) => removed(r, 'requestHeaders').includes('referer')), false);
});
test('exemptions: not all of googleapis.com (storage.googleapis.com holds anyone\'s files), Google\'s country sites are one family with google.com, Wikipedia\'s sites are one', async () => {
  const bg = await load(on()); await bg.alarm('sweep');
  const ex = bg.state.rules.find((r) => r.id === NET_BASE).condition.excludedRequestDomains;
  assert.equal(ex.includes('googleapis.com'), false); assert.equal(ex.includes('storage.googleapis.com'), false); assert.ok(ex.includes('maps.googleapis.com') && ex.includes('accounts.google.com'));
  const g = FAMILIES.find((f) => f.includes('google.com')), w = FAMILIES.find((f) => f.includes('wikipedia.org'));
  for (const d of ['google.de', 'google.co.uk', 'google.fr', 'google.com.au', 'google.co.jp', 'youtube.com']) assert.ok(g.includes(d), d);
  assert.equal(g.includes('googleapis.com'), false); assert.equal(g.includes('storage.googleapis.com'), false); assert.ok(GOOGLE_APIS.every((d) => d.endsWith('.googleapis.com') && d !== 'storage.googleapis.com'));
  assert.ok(w.includes('wikimedia.org') && w.includes('wiktionary.org'));
  for (const f of FAMILIES) for (const d of f) assert.match(d, /^[a-z0-9-]+(\.[a-z0-9-]+)+$/, d);
});
