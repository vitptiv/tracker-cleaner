// F6 (audit): the settings program on this computer (127.0.0.1:8088) is asked only when its row is on, and the popup
// says when it has switched something off.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { renderPopup } = require('../extension/popup-view.js');
const OFF = { enabled: true, cookieClean: false, blocking: false, chromeTabs: 1, cookieBlacklist: [{ h: 'example.com', n: 'session' }], storageBlacklist: ['example.com'] };
const cookies = () => [{ name: '_ga', domain: '.example.com', value: 'GA1.2.3' }, { name: 'session', domain: 'example.com', value: 's' }];
const tabs = () => [{ id: 1, active: true, url: 'https://a.test/' }, { id: 2, url: 'https://b.test/' }];
const local = (bg) => bg.asked.filter((u) => u.includes('127.0.0.1:8088'));

test('its row off (as installed): it is never asked, and whatever it would answer changes nothing', async () => {
  const bg = await load({ limits: OFF, cookies: cookies(), tabs: tabs(), storage: { master: true, cacheClearedAt: 1.8e12, modes: { C07: 'auto', C13: 'auto' } } });
  await bg.alarm('sweep'); await bg.alarm('proxy');
  assert.deepEqual(local(bg), []);
  assert.deepEqual(await bg.names(), ['session']); assert.deepEqual(bg.state.rulesets, ['trackers', 'google-paths', 'url-params']); assert.equal(bg.state.tabs.length, 2);
  const s = await bg.send({ type: 'state' }); assert.equal(s.serverOff, undefined); assert.equal(s.server, false);
});
test('its row on and it has switched things off: the popup says which, in one line', async () => {
  const bg = await load({ limits: OFF, cookies: cookies(), storage: { master: true, cacheClearedAt: 1.8e12, modes: { C15: 'auto' } } });
  await bg.alarm('sweep');
  assert.ok(local(bg).length > 0); assert.deepEqual(await bg.names(), ['_ga', 'session']);
  const s = await bg.send({ type: 'state' }); assert.deepEqual(s.serverOff, ['deleting cookies', 'blocking']);
  assert.ok(renderPopup(s, null).includes('Switched off by the settings program: deleting cookies, blocking.'));
  bg.limits = { enabled: false }; await bg.alarm('sweep');
  assert.deepEqual((await bg.send({ type: 'state' })).serverOff, ['blocking', 'the YouTube ad remover', 'your own lists']);
});
test('its row switched off again: what it had switched off is back on at once', async () => {
  const bg = await load({ limits: OFF, cookies: cookies(), storage: { master: true, cacheClearedAt: 1.8e12, modes: { C15: 'auto' } } });
  await bg.alarm('sweep'); assert.deepEqual(await bg.names(), ['_ga', 'session']);
  await bg.send({ type: 'setMode', group: 'server', mode: 'off' }); await bg.settle();
  assert.deepEqual(await bg.names(), ['session']); assert.deepEqual([...bg.state.rulesets].sort(), ['google-paths', 'trackers', 'url-params']);
  assert.equal((await bg.send({ type: 'state' })).serverOff, undefined);
  assert.equal(renderPopup(await bg.send({ type: 'state' }), null).includes('settings program on this computer has switched off'), false);
});
