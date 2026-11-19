// H6 (second audit): each rule is installed on its own and a refused one is named in the popup; the referring page stays
// for embedded frames; fewer and exact exemptions.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').pressing;
const { NET_BASE, FAMILIES, GOOGLE_APIS, netRules } = require('../extension/net-rules.js'), { renderPopup } = require('../extension/popup-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const removed = (r, k) => (r.action[k] || []).map((h) => h.header);

test('a header rule Chrome refuses: the others are installed, and the popup names what is not working instead of saying nothing', async () => {
  // (P1, 1.29: a rule that is there and works is never taken out before its replacement is in, so the header rules are
  // first switched off altogether: Chrome then refuses one of them as they are installed anew)
  const bg = await load(on()); const flip = async (mode) => { for (const group of ['othercookies', 'othertags']) await bg.send({ type: 'setMode', group, mode }); await bg.settle(); };
  await flip('off'); bg.refuse = (r) => r.id === NET_BASE; await flip('auto');
  const ids = bg.state.rules.map((r) => r.id);
  assert.equal(ids.includes(NET_BASE), false); assert.ok(ids.includes(NET_BASE + 1) && ids.includes(NET_BASE + 5));
  const s = await bg.send({ type: 'state' });
  assert.deepEqual(s.notWorking, ['Other companies get no cookies or cache tags']);
  assert.ok(renderPopup(s, null).includes('Chrome refused a rule, so this is not working: Other companies get no cookies or cache tags.'));
  bg.refuse = null; await flip('off'); await flip('auto');
  assert.equal((await bg.send({ type: 'state' })).notWorking, undefined);
});
test('the same for the other rules: a refused local-network rule or stop rule is named', async () => {
  const bg = await load(on()); bg.refuse = (r) => r.id === NET_BASE + 22 || r.id === 101000;
  await bg.chrome.storage.local.set({ stopped: ['trk.example'] }); await bg.settle();   // (P1: a rule that is there is not installed anew, so the block is made after Chrome starts refusing it)
  await bg.send({ type: 'setMode', group: 'local', mode: 'off' }); await bg.send({ type: 'setMode', group: 'local', mode: 'auto' }); await bg.settle();
  assert.deepEqual((await bg.send({ type: 'state' })).notWorking.sort(), ['Hosts you blocked', 'Pages may not call this computer']);
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
