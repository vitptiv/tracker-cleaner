// Sign-in guard (C19) and pause (C18) end to end. master is on, so without them tracker cookies would go.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const MIN = 60e3, BOTH = ['trackers', 'google-paths', 'url-params'];
const tracker = (bg, name = 'x') => bg.setCookie({ url: 'https://ad.doubleclick.net/', name });
const opt = (o = {}) => ({ ...o, storage: { master: true, ...o.storage } });

test('without a sign-in tab the tracker cookie goes (control)', async () => {
  const bg = await load(opt({ tabs: [{ id: 1, url: 'https://example.com/' }] }));
  await tracker(bg); assert.deepEqual(await bg.names(), []);
});
// (1.25, L4: a test of the old hold on everything stood here; what a sign-in holds now is in l4-hold.test.js)
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
  assert.deepEqual(bg.state.rulesets, BOTH); assert.equal(bg.state.scripts.length, 4); assert.ok(bg.state.proxy);   // 4: 1.25 added skip.js (the page shield is off unless switched on)
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
