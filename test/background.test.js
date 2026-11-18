// 1.21 end to end: background.js acts only where the registry gate says 'run'. Compare baseline-1.20.test.js.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').asks;
const tabs = () => [1, 2, 3].map((id) => ({ id, url: `https://site${id}.test/`, lastAccessed: id }));
// a server that asks for everything 1.20 would do
const GREEDY = { chromeTabs: 1, forgetServers: true, torChrome: true, storageBlacklist: ['bad.test'], permissionBlacklist: [{ site: 'https://bad.test', perm: 'camera' }],
  cookieBlacklist: [{ h: 'google.com', n: 'SID' }], cookieMode: 'allowlist', cookieAllow: [{ site: 'spotify.com', names: ['*'] }] };
const cookies = () => [{ name: '_ga', domain: '.example.com' }, { name: 'session', domain: 'example.com' }, { name: 'SID', domain: '.google.com' }];
const everything = async (bg) => { await bg.setCookie({ url: 'https://ad.doubleclick.net/', name: 'x' }); await bg.alarm('sweep'); await bg.alarm('proxy'); };

test('nothing stored: nothing is deleted, closed or rerouted, whatever the server says', async () => {
  for (const limits of [undefined, GREEDY]) {
    const bg = await load({ limits, tabs: tabs(), cookies: cookies() });
    await everything(bg);
    assert.deepEqual(bg.destructive(), []);
    assert.deepEqual(await bg.names(), ['_ga', 'session', 'SID', 'x']);
    assert.deepEqual(bg.reports, []);
  }
});
test('nothing stored: blocking and the YouTube ad remover are on, also with the server down', async () => {
  const bg = await load();
  assert.deepEqual(bg.state.rulesets, ['trackers', 'google-paths', 'url-params']);
  assert.deepEqual(bg.state.scripts.map((s) => s.id), ['yt-adfree', 'yt-adfree-css', 'no-ping', 'shield']);   // (M4: the page shield is on by default)
});
test('master on, default modes: tracker cookies go (live and sweep); the server cannot switch on the rest', async () => {
  const bg = await load({ limits: GREEDY, tabs: tabs(), cookies: cookies(), storage: { master: true } });
  await everything(bg);
  assert.deepEqual(await bg.names(), ['session', 'SID']);       // allow-list mode (C12) and blacklist (C07) did not act
  assert.deepEqual(bg.destructive().map((c) => c.api), ['cookies.remove', 'cookies.remove']);
  assert.equal(bg.state.tabs.length, 3); assert.equal(bg.state.proxy, null);
  assert.deepEqual(bg.reports, []); assert.equal(bg.called('runtime.requestUpdateCheck').length, 0);
});
test('master on, server down: tracker cookies still go', async () => {
  const bg = await load({ cookies: cookies(), storage: { master: true } });
  await everything(bg);
  assert.deepEqual(await bg.names(), ['session', 'SID']);
});
test('master on and a group set to auto: that group acts, with the lists the server supplies', async () => {
  const modes = { C07: 'auto', C09: 'auto', C11: 'auto', C13: 'auto', C14: 'auto', C15: 'auto' };
  const bg = await load({ tor: true, limits: { ...GREEDY, cookieMode: 'normal' }, tabs: tabs(), cookies: cookies(), storage: { master: true, modes } });
  await everything(bg);
  assert.deepEqual(await bg.names(), ['session']);               // blacklisted SID gone
  assert.deepEqual(bg.state.tabs.map((t) => t.id), [3]);
  assert.equal(bg.state.proxy.rules.singleProxy.port, 9050);
  const api = bg.destructive().filter((c) => !(c.api === 'browsingData.remove' && c.args[0].origins && c.args[1].cache)).map((c) => c.api);   // 1.25: not the per-site saved copies
  assert.equal(api.filter((a) => a === 'browsingData.remove').length, 2);   // storage drop + cache
  assert.ok(api.includes('contentSettings.set'));
  assert.ok(bg.reports.length > 0); assert.ok(bg.called('runtime.requestUpdateCheck').length > 0);
});
test('allow-list mode deletes unlisted cookies only when C12 is set to auto', async () => {
  const bg = await load({ limits: GREEDY, cookies: cookies(), storage: { master: true, modes: { C12: 'auto', C15: 'auto' } } });   // C15: the settings program is asked (1.25, F6)
  await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), []);
});
test('a group set to ask or off does not act', async () => {
  for (const mode of ['ask', 'off']) {
    const bg = await load({ cookies: cookies(), storage: { master: true, modes: { C03: mode } } });
    await everything(bg);
    assert.deepEqual(bg.destructive(), [], mode);
  }
});
test('master off stops everything: cookies, tabs, cache, Tor, reports, blocking and the YouTube scripts', async () => {
  const modes = Object.fromEntries(['C01', 'C03', 'C05', 'C07', 'C09', 'C11', 'C12', 'C13', 'C14', 'C15'].map((id) => [id, 'auto']));
  const bg = await load({ limits: GREEDY, tabs: tabs(), cookies: cookies(), storage: { master: false, modes } });
  await everything(bg);
  assert.deepEqual(bg.destructive(), []);
  assert.deepEqual(bg.reports, []);
  assert.deepEqual(bg.state.rulesets, []); assert.deepEqual(bg.state.scripts, []);
});
test('switching master off clears the Tor proxy this extension set and disables blocking, at once', async () => {
  const bg = await load({ tor: true, storage: { master: true, modes: { C14: 'auto' } } });
  await bg.alarm('proxy');
  assert.equal(bg.state.proxy.rules.singleProxy.port, 9050); assert.deepEqual(bg.state.rulesets, ['trackers', 'google-paths', 'url-params']);
  await bg.chrome.storage.local.set({ master: false }); await bg.settle();
  assert.equal(bg.state.proxy, null); assert.equal(bg.called('proxy.settings.clear').length, 1);
  assert.deepEqual(bg.state.rulesets, []); assert.deepEqual(bg.state.scripts, []);
  await bg.chrome.storage.local.set({ master: true }); await bg.settle();
  assert.deepEqual(bg.state.rulesets, ['trackers', 'google-paths', 'url-params']); assert.equal(bg.state.proxy.rules.singleProxy.port, 9050);
});
test('the manifest asks for the storage permission the settings need', () => {
  assert.ok(require('../extension/manifest.json').permissions.includes('storage'));
});
