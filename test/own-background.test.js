// R6 (C28): what a tracker saved on its own site (background program, storage, the right to notify) is emptied for
// the companies the user stopped and for the built-in list: after one question each, then once a day.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { DOMAINS } = require('../extension/lists.js');
const OWN = 'what it saved on its own site', LISTED = 'the listed trackers', DAY = 24 * 3600e3;
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, stopped: ['trk.example'],
  follow: { 'trk.example': { on: ['a', 'b', 'c'], id: true, hosts: ['px.trk.example:8443'], t: 1 } }, ...o.storage } });
const queued = (bg) => ((bg.state.storage.pending || {}).own || { items: [] }).items.map((i) => [i.cap, i.kind, i.site, i.name]);
const emptied = (bg) => bg.called('browsingData.remove').map((c) => c.args), blocked = (bg) => bg.called('contentSettings.set').map((c) => c.args[0]);

test('ask first: one question per stopped company, none about the built-in list; nothing is emptied', async () => {
  const bg = await load(on()); await bg.alarm('sweep');
  assert.deepEqual(queued(bg), [['C28', 'own', 'trk.example', OWN]]); assert.deepEqual(bg.destructive(), []);
});
test('Approve for one company: its storage and background program go, its notifications are blocked; then daily without a question', async () => {
  const bg = await load(on()); await bg.alarm('sweep');
  assert.deepEqual(await bg.send({ type: 'approve', group: 'own', site: 'trk.example', name: OWN }), { ok: true, done: 1, of: 1 }); await bg.settle();
  const [[what, kinds]] = emptied(bg);
  assert.deepEqual(what.origins, ['https://trk.example', 'http://trk.example', 'https://www.trk.example', 'http://www.trk.example', 'https://px.trk.example:8443', 'http://px.trk.example:8443']);
  assert.deepEqual(kinds, { localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true, fileSystems: true, webSQL: true });
  assert.deepEqual(blocked(bg), [{ primaryPattern: '*://*.trk.example/*', setting: 'block' }]);
  assert.deepEqual(queued(bg), []);
  bg.now += DAY / 2; await bg.alarm('sweep'); assert.equal(emptied(bg).length, 1);
  bg.now += DAY; await bg.alarm('sweep'); assert.equal(emptied(bg).length, 2); assert.deepEqual(queued(bg), []);
});
test('automatic: both are done at the sweep; the list covers every listed tracker', async () => {
  const bg = await load(on({ storage: { modes: { C28: 'auto' } } })); await bg.alarm('sweep');
  assert.equal(emptied(bg).length, 2); assert.deepEqual(queued(bg), []);
  assert.ok(emptied(bg)[1][0].origins.includes('https://doubleclick.net') && emptied(bg)[1][0].origins.includes('http://www.hotjar.com'));
  assert.equal(blocked(bg).length, 1 + DOMAINS.length);
});
test('not while its own site is open in a tab, not during a sign-in, not when off', async () => {
  const open = await load(on({ storage: { modes: { C28: 'auto' } }, tabs: [{ id: 1, active: true, url: 'https://www.trk.example/home' }, { id: 2, url: 'https://app.hotjar.com/' }] }));
  await open.alarm('sweep');
  assert.equal(emptied(open).length, 1); assert.equal(emptied(open)[0][0].origins.some((o) => /trk\.example|hotjar\.com/.test(o)), false);
  assert.equal(blocked(open).some((b) => /trk\.example|hotjar\.com/.test(b.primaryPattern)), false);
  const signing = await load(on({ storage: { modes: { C28: 'auto' }, guardUntil: 1.8e12 + 60e3 } })); await signing.alarm('sweep');
  assert.deepEqual(signing.destructive(), []); assert.equal(queued(signing).length, 2);
  const off = await load(on({ storage: { modes: { C28: 'off' } } })); await off.alarm('sweep');
  assert.deepEqual(off.destructive(), []); assert.deepEqual(queued(off), []);
});
test('"Let it through again" gives the notifications back: the block is taken away, and the blocks of the others are set again', async () => {
  const bg = await load(on({ storage: { modes: { C28: 'auto' }, stopped: ['trk.example', 'other.example'] } })); await bg.alarm('sweep');
  const before = blocked(bg).length;
  assert.deepEqual((await bg.send({ type: 'unstop', site: 'trk.example' })).stopped, ['other.example']); await bg.settle();
  assert.equal(bg.called('contentSettings.clear').length, 1);
  const again = blocked(bg).slice(before).map((b) => b.primaryPattern);
  assert.ok(again.includes('*://*.other.example/*') && again.includes('*://*.doubleclick.net/*')); assert.equal(again.includes('*://*.trk.example/*'), false);
});
