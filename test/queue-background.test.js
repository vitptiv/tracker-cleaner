// Approval queue (C20) end to end: whatever the gate answers 'ask' or 'held' is queued, not dropped.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').asks;
const { GROUPS, CLEANABLE } = require('../extension/registry.js');
const MIN = 60e3;
const tracker = (bg, name = 'x') => bg.setCookie({ url: 'https://ad.doubleclick.net/', name, value: 'secret-value' });
// cacheClearedAt = the loader's clock: the daily cache clear (C11) is not due, so the counts below are cookies only
const ask = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage, modes: { C03: 'ask', ...(o.storage || {}).modes } } });
const queued = (bg, group) => ((bg.state.storage.pending || {})[group] || { items: [] }).items;
const cookies = () => [{ name: '_ga', domain: '.example.com' }, { name: 'session', domain: 'example.com' }, { name: 'id', domain: '.doubleclick.net' }];

test('ask mode: a sweep and a live cookie queue the candidates and remove nothing; no value is stored', async () => {
  const bg = await load(ask({ cookies: cookies() }));
  await bg.alarm('sweep'); await tracker(bg); await tracker(bg);
  assert.deepEqual(bg.destructive(), []);
  assert.deepEqual(queued(bg, 'cookies').map((i) => [i.cap, i.kind, i.site, i.name, i.why, i.t]), [['C03', 'cookie', 'example.com', '_ga', 'name', bg.now],
    ['C03', 'cookie', 'doubleclick.net', 'id', 'host', bg.now], ['C03', 'cookie', 'ad.doubleclick.net', 'x', 'host', bg.now]]);
  assert.equal(JSON.stringify(bg.state.storage).includes('secret-value'), false);
  assert.equal(bg.badge.text, '3');
});
test('approve removes exactly the queued cookies, not one set afterwards, and empties the group', async () => {
  const bg = await load(ask({ cookies: cookies() }));
  await bg.alarm('sweep');
  assert.deepEqual(await bg.send({ type: 'approve', group: 'cookies' }), { ok: true, done: 2, of: 2 }); await bg.settle();
  assert.deepEqual(await bg.names(), ['session']); assert.equal(bg.badge.text, '');
  await tracker(bg);                                                 // set after the approval: waits for the next one
  assert.deepEqual(await bg.names(), ['session', 'x']); assert.deepEqual(queued(bg, 'cookies').map((i) => i.name), ['x']);
  assert.equal(bg.badge.text, '1');
});
test('approve skips a cookie that has gone or is no longer a candidate, without error', async () => {
  const bg = await load(ask({ limits: {}, cookies: cookies(), storage: { modes: { C15: 'auto' } } }));
  await bg.alarm('sweep');
  await bg.chrome.cookies.remove({ url: 'https://example.com/', name: '_ga' });
  bg.limits = { cookieClean: false }; await bg.alarm('proxy');      // the server switch now says: keep cookies
  assert.deepEqual(await bg.send({ type: 'approve', group: 'cookies' }), { ok: true, done: 0, of: 2 });
  assert.deepEqual(await bg.names(), ['session', 'id']); assert.deepEqual(queued(bg, 'cookies'), []);
});
test('approve is refused while paused and allowed during the sign-in guard', async () => {
  const bg = await load(ask({ cookies: cookies(), tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/' }] }));
  await bg.alarm('sweep'); await bg.send({ type: 'pause' }); await bg.settle();
  assert.equal(bg.badge.text, 'II');
  assert.deepEqual(await bg.send({ type: 'approve', group: 'cookies' }), { ok: false, why: 'paused' });
  assert.equal(queued(bg, 'cookies').length, 2); assert.deepEqual(bg.destructive(), []);
  await bg.send({ type: 'resume' }); await bg.settle(); assert.equal(bg.badge.text, '2');
  assert.equal((await bg.send({ type: 'approve', group: 'cookies' })).done, 2);
  assert.deepEqual(await bg.names(), ['session']);
});
test('postpone hides the group from the badge until the clock passes; default 60 minutes; items keep collecting', async () => {
  const bg = await load(ask({ cookies: cookies() }));
  await bg.alarm('sweep'); assert.equal(bg.badge.text, '2');
  assert.deepEqual(await bg.send({ type: 'postpone', group: 'cookies' }), { ok: true, postponedUntil: bg.now + 60 * MIN }); await bg.settle();
  assert.equal(bg.badge.text, '');
  await tracker(bg); assert.equal(queued(bg, 'cookies').length, 3);
  bg.now += 59 * MIN; await bg.alarm('proxy'); assert.equal(bg.badge.text, '');
  bg.now += MIN; await bg.alarm('proxy'); assert.equal(bg.badge.text, '3');
  await bg.send({ type: 'postpone', group: 'cookies', minutes: 5 }); await bg.settle();
  assert.equal(bg.state.storage.pending.cookies.postponedUntil, bg.now + 5 * MIN);
  assert.deepEqual(await bg.send({ type: 'postpone', group: 'nonsense' }), { ok: false });
});
test("postpone until 'restart' lasts until Chrome starts again", async () => {
  const bg = await load(ask({ cookies: cookies() }));
  await bg.alarm('sweep'); await bg.send({ type: 'postpone', group: 'cookies', minutes: 'restart' }); await bg.settle();
  bg.now += 1000 * MIN; await bg.alarm('proxy'); assert.equal(bg.badge.text, '');
  await bg.chrome.runtime.onStartup.fire(); await bg.settle();
  assert.equal(bg.badge.text, '2'); assert.deepEqual(bg.destructive(), []);
});
// (1.25, L4: a test of the old hold on everything stood here; what a sign-in holds now is in l4-hold.test.js)
test('a sweep forgets queued cookies that are gone and items of a group since switched off', async () => {
  const bg = await load(ask({ cookies: cookies() }));
  await bg.alarm('sweep'); await bg.chrome.cookies.remove({ url: 'https://example.com/', name: '_ga' });
  await bg.alarm('sweep'); assert.deepEqual(queued(bg, 'cookies').map((i) => i.name), ['id']);
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'off' }); await bg.alarm('sweep');
  assert.deepEqual(queued(bg, 'cookies'), []); assert.deepEqual(await bg.names(), ['session', 'id']);
});
test('storage and permission drops, cache clear and tab closing are queued in ask mode and carried out on approve', async () => {
  const limits = { chromeTabs: 1, storageBlacklist: ['bad.test'], permissionBlacklist: [{ site: 'https://bad.test', perm: 'camera' }],
    cookieBlacklist: [{ h: 'google.com', n: 'SID' }] };
  const tabs = [{ id: 1, url: 'https://a.test/', lastAccessed: 1 }, { id: 2, url: 'https://b.test/x', lastAccessed: 2 }, { id: 3, url: 'https://c.test/', lastAccessed: 3 }];
  const bg = await load({ limits, tabs, cookies: [{ name: 'SID', domain: '.google.com' }], storage: { master: true, modes: { C13: 'ask', C15: 'auto' } } });
  await bg.alarm('sweep'); await bg.alarm('sweep');
  assert.deepEqual(bg.destructive(), []);
  const all = Object.entries(bg.state.storage.pending).flatMap(([g, q]) => q.items.map((i) => [g, i.cap, i.kind, i.site, i.name].join(' ')));
  assert.deepEqual(all.sort(), ['cache C11 cache * http-cache', 'permissions C09 permission https://bad.test camera', 'storage C07 cookie google.com SID',
    'storage C07 storage bad.test storage', 'tabs C13 tabs a.test 1', 'tabs C13 tabs b.test 2']);
  assert.equal(bg.badge.text, '6');
  await bg.navigate(2, 'https://b.test/login');                       // approval never closes a sign-in page (it is allowed during the guard)
  for (const g of ['storage', 'permissions', 'cache', 'tabs']) assert.equal((await bg.send({ type: 'approve', group: g })).ok, true, g);
  assert.deepEqual(bg.destructive().map((c) => c.api).sort(), ['browsingData.remove', 'browsingData.remove', 'contentSettings.set', 'cookies.remove', 'tabs.remove']);
  assert.deepEqual(bg.state.tabs.map((t) => t.id), [2, 3]); assert.deepEqual(await bg.names(), []);
  assert.deepEqual(bg.called('browsingData.remove').map((c) => Object.keys(c.args[1])[0]).sort(), ['cache', 'localStorage']);
  await bg.settle(); assert.equal(bg.badge.text, '');
});
test('nothing stored: candidates are queued and approve works, so a fresh install is usable', async () => {
  const bg = await load({ cookies: cookies() });
  await bg.alarm('sweep'); assert.equal(bg.badge.text, '3'); assert.deepEqual(bg.destructive(), []);   // 2 cookies + the cache clear
  await bg.send({ type: 'approve', group: 'cookies' }); assert.deepEqual(await bg.names(), ['session']);
});
test('master off: nothing is queued and approve is refused', async () => {
  const bg = await load(ask({ cookies: cookies() }));
  await bg.alarm('sweep'); assert.deepEqual(await bg.send({ type: 'setMaster', on: false }), { master: false }); await bg.settle();
  assert.deepEqual(await bg.send({ type: 'approve', group: 'cookies' }), { ok: false, why: 'off' });
  await bg.alarm('sweep'); await tracker(bg);
  assert.deepEqual(queued(bg, 'cookies'), []); assert.deepEqual(bg.destructive(), []);
});
test('state message: settings, hold state, and per group its mode, pending count and at most 20 items', async () => {
  const many = Array.from({ length: 25 }, (_, i) => ({ name: 'c' + i, domain: '.doubleclick.net' }));
  const bg = await load(ask({ cookies: many }));
  await bg.alarm('sweep'); await bg.send({ type: 'pause', minutes: 3 }); await bg.settle();
  const s = await bg.send({ type: 'state' });
  assert.deepEqual(Object.keys(s).sort(), ['allow', 'always', 'autoDone', 'groups', 'hard', 'histOn', 'hold', 'level', 'log', 'master', 'modes', 'now', 'server', 'sitesOff', 'skipped', 'stopped', 'stoppedUsed', 'tor', 'undo']);   // 1.30: level (the dial); 1.32: autoDone (F3)
  assert.equal(s.level, 'custom');   // the four rows the loader stores as "Ask first" differ from Balanced
  assert.equal(s.master, true); assert.deepEqual(s.modes, { C11: 'ask', C25: 'ask', C27: 'ask', C28: 'ask', C03: 'ask' });
  assert.deepEqual(s.hold, { paused: true, guard: false, tab: false, pauseUntil: bg.now + 3 * MIN, guardUntil: 0 });
  assert.deepEqual(s.groups.map((g) => g.id), GROUPS.map((g) => g.id));
  // the Wi-Fi row also says it is never automatic and what its helper answered (none installed here)
  // 1.30: answers (the two question rows can say yes by themselves), cleanable (the row has Clean now)
  const more = (g) => [...(['unknown', 'bounce'].includes(g.id) ? ['answers'] : []), ...(CLEANABLE.includes(g.id) ? ['cleanable'] : [])];
  for (const g of s.groups) assert.deepEqual(Object.keys(g).sort(), (g.id === 'wifi' ? ['ask', 'helper', 'id', 'items', 'looping', 'mode', 'noAuto', 'pending', 'postponedUntil', 'says', 'title']
    : ['ask', 'id', 'items', 'looping', 'mode', ...(g.id === 'cache' ? ['nextAt'] : []), 'pending', 'postponedUntil', 'says', 'title', ...more(g)]).sort(), g.id);
  const c = s.groups.find((g) => g.id === 'cookies');
  assert.equal(c.mode, 'ask'); assert.equal(c.pending, 25); assert.equal(c.items.length, 20);
  assert.deepEqual(Object.keys(c.items[0]).sort(), ['cap', 'kind', 'name', 'site', 't', 'why']);
  assert.deepEqual(s.groups.filter((g) => g.id !== 'cookies').map((g) => [g.mode, g.pending]),
    [['auto', 0], ['auto', 0], ['ask', 0], ['auto', 0], ['auto', 0], ['auto', 0], ['auto', 0], ['auto', 0], ['auto', 0], ['ask', 0], ['ask', 0], ['ask', 0], ['ask', 0], ['ask', 0], ['ask', 0], ['ask', 0], ['off', 0], ['off', 0], ['off', 0], ['off', 0]]);
});
test('setMode sets every capability of the group and takes effect at once; bad input is refused', async () => {
  const bg = await load({ storage: { master: true } });
  assert.deepEqual(await bg.send({ type: 'setMode', group: 'blocking', mode: 'off' }), { ok: true, modes: { C11: 'ask', C25: 'ask', C27: 'ask', C28: 'ask', C01: 'off', C02: 'off', C05: 'off', C26: 'off' } });
  await bg.settle(); assert.deepEqual(bg.state.rulesets, ['url-params']);   // C23 has its own row
  assert.deepEqual(await bg.send({ type: 'setMode', group: 'blocking', mode: 'sometimes' }), { ok: false });
  assert.deepEqual(await bg.send({ type: 'setMode', group: 'control', mode: 'off' }), { ok: false });
  await bg.send({ type: 'setMaster', on: true }); await bg.send({ type: 'setMode', group: 'cookies', mode: 'ask' });
  assert.deepEqual(bg.state.storage.modes, { C11: 'ask', C25: 'ask', C27: 'ask', C28: 'ask', C01: 'off', C02: 'off', C05: 'off', C26: 'off', C03: 'ask' });
});
test('20 cookie changes at once, not awaited, leave 20 items queued: queue writes go one after the other', async () => {
  const bg = await load(ask());
  for (let i = 0; i < 20; i++) bg.chrome.cookies.set({ url: 'https://ad.doubleclick.net/', name: 'c' + i });
  await bg.settle(); await bg.settle();
  assert.deepEqual(queued(bg, 'cookies').map((i) => i.name), Array.from({ length: 20 }, (_, i) => 'c' + i));
  assert.equal(bg.badge.text, '20');
});
const cacheClears = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].cache).length;
test('cache clear (C11) is local: offered with the 8088 server down, and once approved not again for 24 hours', async () => {
  const bg = await load({ storage: { master: true } });
  await bg.alarm('sweep'); await bg.alarm('sweep');
  assert.deepEqual(queued(bg, 'cache').map((i) => [i.cap, i.kind, i.site, i.name]), [['C11', 'cache', '*', 'http-cache']]);
  assert.equal(cacheClears(bg), 0);
  assert.deepEqual(await bg.send({ type: 'approve', group: 'cache' }), { ok: true, done: 1, of: 1 });
  assert.equal(cacheClears(bg), 1); assert.equal(bg.state.storage.cacheClearedAt, bg.now);
  await bg.alarm('sweep'); assert.deepEqual(queued(bg, 'cache'), []);
  bg.now += 24 * 60 * MIN - 1; await bg.alarm('sweep'); assert.deepEqual(queued(bg, 'cache'), []);
  bg.now += 1; await bg.alarm('sweep'); assert.equal(queued(bg, 'cache').length, 1);
  assert.equal(cacheClears(bg), 1);
});
test('cache clear in auto mode runs at most once per 24 hours, whatever the server says', async () => {
  const bg = await load({ limits: { forgetServers: false }, storage: { master: true, modes: { C11: 'auto' } } });
  await bg.alarm('sweep'); await bg.alarm('sweep'); assert.equal(cacheClears(bg), 1);
  bg.now += 23 * 60 * MIN; await bg.alarm('sweep'); assert.equal(cacheClears(bg), 1);
  bg.now += 60 * MIN; await bg.alarm('sweep'); assert.equal(cacheClears(bg), 2);
  assert.deepEqual(queued(bg, 'cache'), []);
});
test('pack.sh ships queue.js', () => {
  assert.ok(require('fs').readFileSync(require('path').join(__dirname, '../extension/pack.sh'), 'utf8').includes('queue.js'));
});
