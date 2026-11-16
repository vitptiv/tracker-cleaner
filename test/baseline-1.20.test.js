// What 1.20 did end to end, run from the untouched baseline. 1.21 changes these on purpose (see background.test.js).
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const tabs = () => [1, 2, 3].map((id) => ({ id, url: `https://site${id}.test/`, lastAccessed: id }));
const opt = (o) => ({ dir: 'extension-1.20', ...o });

test('1.20: a tracker cookie is removed as it is set, NID too, SID stays (server down)', async () => {
  const bg = await load(opt());
  await bg.setCookie({ url: 'https://ad.doubleclick.net/', name: 'x' });
  await bg.setCookie({ url: 'https://www.google.com/', name: 'NID', domain: '.google.com' });
  await bg.setCookie({ url: 'https://www.google.com/', name: 'SID', domain: '.google.com' });
  assert.deepEqual(await bg.names(), ['SID']);
});
test('1.20: the 15-minute sweep removes stored tracker cookies', async () => {
  const bg = await load(opt({ cookies: [{ name: '_ga', domain: '.example.com' }, { name: 'session', domain: 'example.com' }] }));
  await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['session']);
});
test('1.20: with the server unreachable no tab is closed, the cache is not cleared, Tor is not set', async () => {
  const bg = await load(opt({ tabs: tabs() }));
  await bg.alarm('sweep'); await bg.alarm('proxy');
  assert.deepEqual(bg.destructive(), []);
  assert.equal(bg.state.tabs.length, 3);
});
test('1.20: the server alone switches on tab closing, cache clearing and Tor, with nothing stored', async () => {
  const bg = await load(opt({ tabs: tabs(), limits: { chromeTabs: 1, forgetServers: true, torChrome: true } }));
  await bg.alarm('sweep'); await bg.alarm('proxy');
  assert.deepEqual(bg.state.tabs.map((t) => t.id), [3]);
  assert.deepEqual(bg.called('browsingData.remove')[0].args, [{ since: 0 }, { cache: true }]);
  assert.equal(bg.state.proxy.rules.singleProxy.port, 9050);
  assert.ok(bg.reports.length > 0);
});
