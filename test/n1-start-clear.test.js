'use strict';
// N1 (1.28): the servers Chrome remembers (Alt-Svc, lab row T20) and its forced-HTTPS entries (T21) outlive the daily
// clearing, because they are saved after it. Measured in real Chrome 157: of the chrome.browsingData types only
// `cache` over all time ({ since: 0 }, { cache: true }) drops them -- not `history`, not `cacheStorage`, and not `cache`
// limited to an origin. So the saved copies (C11) are also cleared once at each start of Chrome: behind the same row
// and mode as the daily clearing, only on Automatic, held while paused or while a tab is on a sign-in host, one log line.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const NOW = 1.8e12;
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: NOW, ...o.storage } });   // the daily clearing is not due
const clears = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].cache);
const lines = (bg) => (bg.state.storage.log || []).filter((l) => l.kind === 'cache');
const start = async (bg) => { await bg.chrome.runtime.onStartup.fire(); await bg.settle(); };

test('N1: a start of Chrome clears the saved copies once: all time, the cache and nothing else; later sweeps do not repeat it', async () => {
  const bg = await load(on());
  assert.equal(clears(bg).length, 0, 'nothing before the start');
  await start(bg);
  assert.equal(clears(bg).length, 1, 'not cleared at the start');
  assert.deepEqual(JSON.parse(JSON.stringify(clears(bg)[0].args)), [{ since: 0 }, { cache: true }], 'the narrowest set that works: the cache alone');
  // (the same sweep empties what the listed trackers saved on their own sites, C28: that names its origins and no cache)
  assert.equal(bg.called('browsingData.remove').filter((c) => !c.args[0].origins).length, 1, 'something else was removed for all sites');
  assert.deepEqual(bg.called('cookies.remove'), []);
  for (let i = 0; i < 8; i++) { bg.now += 15 * 60e3; await bg.alarm('sweep'); }
  assert.equal(clears(bg).length, 1, 'cleared again within the same start');
  assert.equal(bg.state.storage.cacheClearedAt, NOW, 'the day of the daily clearing counts from the start clearing');
});
test('N1: it is logged with one line', async () => {
  const bg = await load(on());
  await start(bg); bg.now += 15 * 60e3; await bg.alarm('sweep');
  assert.deepEqual(lines(bg).map((l) => [l.cap, l.kind, l.site, l.name, l.did]), [['C11', 'cache', '*', 'http-cache', 'removed']]);
});
test('N1: a start that falls on the day of the daily clearing clears once, not twice', async () => {
  const bg = await load(on({ storage: { cacheClearedAt: NOW - 25 * 3600e3 } }));
  await start(bg);
  assert.equal(clears(bg).length, 1); assert.equal(lines(bg).length, 1);
});
test('N1: the next start of Chrome clears again', async () => {
  const bg = await load(on());
  await start(bg); bg.now += 3600e3; await start(bg);
  assert.equal(clears(bg).length, 2);
});
test('N1: not when cleaning is switched off, not when the row is off, and on "Ask first" nothing is cleared or asked at a start', async () => {
  for (const storage of [{ master: false }, { modes: { C11: 'off' } }, { modes: { C11: 'ask' } }]) {
    const bg = await load(on({ storage }));
    await start(bg); bg.now += 15 * 60e3; await bg.alarm('sweep');
    assert.equal(clears(bg).length, 0, JSON.stringify(storage)); assert.deepEqual(lines(bg), [], JSON.stringify(storage));
    assert.equal('cache' in (bg.state.storage.pending || {}), false, 'a question was made at the start: ' + JSON.stringify(storage)); }
  // with nothing stored for the main switch (never a fresh install: that stores it as on) the most a destructive row does is ask
  const bg = await load({ storage: { cacheClearedAt: NOW } }); await start(bg); assert.equal(clears(bg).length, 0, 'main switch not stored');
});
test('N1: held while a tab is on a sign-in host; done at the first sweep after it has left', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/v3/signin/identifier' }] }));
  await start(bg);
  assert.equal(clears(bg).length, 0, 'cleared under a sign-in');
  bg.now += 15 * 60e3; await bg.alarm('sweep'); assert.equal(clears(bg).length, 0, 'cleared under a sign-in at the next sweep');
  await bg.navigate(1, 'https://mail.example/inbox'); await bg.settle();
  bg.now += 15 * 60e3; await bg.alarm('sweep');
  assert.equal(clears(bg).length, 1, 'not done once the sign-in was over'); assert.equal(lines(bg).length, 1);
  bg.now += 15 * 60e3; await bg.alarm('sweep'); assert.equal(clears(bg).length, 1);
});
test('N1: the five minutes for which a site\'s own sign-in page holds deleting for that site do not hold it (they do not hold the daily clearing either)', async () => {
  const bg = await load(on({ storage: { sguard: { 'shop.example': NOW - 60e3 } }, cookies: [{ name: 'session', domain: 'shop.example', value: 's-1' }] }));
  await start(bg);
  assert.equal(clears(bg).length, 1);
  assert.deepEqual(bg.called('cookies.remove'), [], 'a cookie was touched'); assert.deepEqual(await bg.names(), ['session']);
});
test('N1: held while paused; done at the first sweep after the pause', async () => {
  const bg = await load(on({ storage: { pauseUntil: NOW + 10 * 60e3 } }));
  await start(bg);
  assert.equal(clears(bg).length, 0, 'cleared while paused');
  bg.now += 15 * 60e3; await bg.alarm('sweep');
  assert.equal(clears(bg).length, 1);
});
test('N1: the note that a start clearing is due is kept in memory only, and no new permission is asked for', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/' }] }));
  await start(bg);
  assert.equal(bg.state.session.startClear, true, 'the held start clearing is not noted in session storage');
  assert.equal(JSON.stringify(bg.state.storage).includes('startClear'), false, 'the note went to storage.local');
  const m = require('../extension/manifest.json');
  assert.deepEqual(m.permissions, ['cookies', 'storage', 'alarms', 'declarativeNetRequest', 'declarativeNetRequestFeedback', 'webRequest', 'proxy', 'browsingData', 'contentSettings', 'scripting', 'sidePanel']);
  assert.deepEqual(m.optional_permissions, ['history']);
});
test('N1: the row and the first-run line say that the saved copies also go when Chrome starts', () => {
  const says = require('../extension/registry.js').GROUPS.find((g) => g.id === 'cache').says;
  assert.match(says, /Cleared daily and when Chrome starts/);
  const { renderPopup } = require('../extension/popup-view.js');
  assert.match(require('fs').readFileSync(require('path').join(__dirname, '..', 'README.md'), 'utf8').replace(/\s+/g, ' '), /each time Chrome starts/);   // 1.32: the long version is in the README
});
