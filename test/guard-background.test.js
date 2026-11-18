// Sign-in guard (C19) and pause (C18) end to end. master is on, so without them tracker cookies would go.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const MIN = 60e3, BOTH = ['trackers', 'google-paths', 'url-params'];
const tracker = (bg, name = 'x') => bg.setCookie({ url: 'https://ad.doubleclick.net/', name });
const opt = (o = {}) => ({ ...o, storage: { master: true, ...o.storage } });

test('without a sign-in tab the tracker cookie goes (control)', async () => {
  const bg = await load(opt({ tabs: [{ id: 1, url: 'https://example.com/' }] }));
  await tracker(bg); assert.deepEqual(await bg.names(), []);
});
test('a tracker cookie set while a tab is on accounts.google.com survives, also the sweep', async () => {
  const bg = await load(opt());
  await bg.openTab({ id: 1, active: true, url: 'https://accounts.google.com/v3/signin/identifier' }); await bg.settle();
  await tracker(bg); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['x']); assert.deepEqual(bg.destructive(), []);
  assert.deepEqual(bg.state.rulesets, BOTH);     // blocking is left alone under a loading sign-in page
});
test('it survives four minutes after that tab closes and goes at the first sweep after six', async () => {
  const bg = await load(opt());
  await bg.openTab({ id: 1, active: true, url: 'https://accounts.google.com/' }); await bg.settle();
  bg.now += 20 * MIN; await bg.alarm('proxy');   // a long sign-in: the guard does not run out while the tab is open
  await tracker(bg); await bg.closeTab(1);
  bg.now += 4 * MIN; await bg.alarm('sweep'); await tracker(bg, 'y');
  assert.deepEqual(await bg.names(), ['x', 'y']);
  bg.now += 2 * MIN; await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), []);
});
test('an OAuth-style navigation arms the guard for five minutes even after the tab moved on', async () => {
  const bg = await load(opt({ tabs: [{ id: 1, url: 'https://example.com/' }] }));
  await bg.navigate(1, 'https://idp.test/authorize?client_id=a&redirect_uri=b'); await bg.navigate(1, 'https://example.com/app'); await bg.settle();
  assert.equal(bg.state.storage.guardUntil, bg.now + 5 * MIN);
  await tracker(bg); assert.deepEqual(await bg.names(), ['x']);
  bg.now += 3 * MIN; await bg.navigate(1, 'https://example.com/login'); await bg.navigate(1, 'https://example.com/app');   // a further sign-in step extends it
  bg.now += 4 * MIN; await bg.alarm('sweep'); assert.deepEqual(await bg.names(), ['x']);
  bg.now += 2 * MIN; await bg.alarm('sweep'); assert.deepEqual(await bg.names(), []);
});
test('a /login tab parked in the background stops holding after five minutes; an active one keeps holding', async () => {
  for (const active of [false, true]) {
    const bg = await load(opt({ tabs: [{ id: 1, active: !active, url: 'https://example.com/' }] }));
    await bg.openTab({ id: 2, active, url: 'https://example.com/login' }); await bg.settle();
    await tracker(bg);
    bg.now += 4 * MIN; await bg.alarm('proxy'); await bg.alarm('sweep'); assert.deepEqual(await bg.names(), ['x'], String(active));
    bg.now += 16 * MIN; await bg.alarm('proxy'); await bg.alarm('sweep');
    assert.deepEqual(await bg.names(), active ? ['x'] : [], String(active));
  }
});
test('during the guard no tab is closed, no cache cleared, no storage or permission dropped, no self-reload', async () => {
  const modes = { C07: 'auto', C09: 'auto', C11: 'auto', C13: 'auto', C15: 'auto' };
  const limits = { chromeTabs: 1, forgetServers: true, storageBlacklist: ['bad.test'], permissionBlacklist: [{ site: 'https://bad.test', perm: 'camera' }] };
  const bg = await load(opt({ limits, storage: { modes }, tabs: [{ id: 1, url: 'https://a.test/', lastAccessed: 9 }, { id: 2, active: true, url: 'https://accounts.google.com/', lastAccessed: 1 }] }));
  await bg.alarm('sweep'); await bg.chrome.runtime.onUpdateAvailable.fire(); await bg.settle();
  assert.deepEqual(bg.destructive(), []); assert.equal(bg.state.tabs.length, 2); assert.equal(bg.called('runtime.reload').length, 0);
  await bg.closeTab(2); bg.now += 6 * MIN; await bg.chrome.runtime.onUpdateAvailable.fire(); await bg.settle();
  assert.equal(bg.called('runtime.reload').length, 1);
});
test('the guard leaves a Tor proxy as it is', async () => {
  const bg = await load(opt({ tor: true, storage: { modes: { C14: 'auto' } } }));
  await bg.alarm('proxy'); assert.ok(bg.state.proxy);
  await bg.openTab({ id: 1, active: true, url: 'https://accounts.google.com/' }); await bg.alarm('proxy');
  assert.ok(bg.state.proxy); assert.equal(bg.called('proxy.settings.clear').length, 0);
});
test('with the guard switched off (C19 off) a sign-in tab protects nothing', async () => {
  const bg = await load(opt({ storage: { modes: { C19: 'off' } }, tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/' }] }));
  await tracker(bg); assert.deepEqual(await bg.names(), []);
});

test('pause: nothing is removed, both rulesets and the YouTube scripts are off, Tor is cleared', async () => {
  const bg = await load(opt({ tor: true, storage: { modes: { C14: 'auto' } } }));
  await bg.alarm('proxy'); assert.ok(bg.state.proxy); assert.deepEqual(bg.state.rulesets, BOTH);
  assert.deepEqual(await bg.send({ type: 'pause' }), { pauseUntil: bg.now + 10 * MIN }); await bg.settle();
  assert.equal(bg.state.alarms.resume.when, bg.now + 10 * MIN);
  await tracker(bg); await bg.alarm('sweep'); await bg.alarm('proxy');
  assert.deepEqual(await bg.names(), ['x']); assert.deepEqual(bg.destructive().map((c) => c.api), ['proxy.settings.set']);
  assert.deepEqual(bg.state.rulesets, []); assert.deepEqual(bg.state.scripts, []); assert.equal(bg.state.proxy, null);
});
test('after the pause alarm everything is back on and the kept cookie goes at the next sweep', async () => {
  const bg = await load(opt({ tor: true, storage: { modes: { C14: 'auto' } } }));
  await bg.send({ type: 'pause', minutes: 10 }); await bg.settle(); await tracker(bg);
  bg.now += 10 * MIN - 1; await bg.alarm('proxy'); assert.deepEqual(bg.state.rulesets, []);
  bg.now += 1; await bg.alarm('resume');
  assert.deepEqual(bg.state.rulesets, BOTH); assert.equal(bg.state.scripts.length, 3); assert.ok(bg.state.proxy);
  assert.equal('pauseUntil' in bg.state.storage, false);
  await bg.alarm('sweep'); assert.deepEqual(await bg.names(), []);
});
test('resume ends a pause early', async () => {
  const bg = await load(opt());
  await bg.send({ type: 'pause', minutes: 30 }); await bg.settle(); assert.deepEqual(bg.state.rulesets, []);
  assert.deepEqual(await bg.send({ type: 'resume' }), { pauseUntil: 0 }); await bg.settle();
  assert.deepEqual(bg.state.rulesets, BOTH); assert.equal('resume' in bg.state.alarms, false);
  await tracker(bg); assert.deepEqual(await bg.names(), []);
});
test('C02 has its own switch: off disables only the Google/YouTube path rules', async () => {
  const bg = await load(opt({ storage: { modes: { C02: 'off' } } }));
  assert.deepEqual(bg.state.rulesets, ['trackers', 'url-params']);
  await bg.chrome.storage.local.set({ modes: { C01: 'off' } }); await bg.settle();
  assert.deepEqual(bg.state.rulesets, ['url-params', 'google-paths']);
});
