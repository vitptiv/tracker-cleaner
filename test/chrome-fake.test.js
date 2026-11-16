const test = require('node:test'), assert = require('node:assert');
const makeChrome = require('./chrome-fake.js');
const makeCore = require('../extension/core.js');
// 1.20's lists (no export line there): the last test pins what 1.20 did
const L = new Function(require('fs').readFileSync(require('path').join(__dirname, '../extension-1.20/lists.js'), 'utf8') + '; return { DOMAINS, COOKIE_RE, KEEP_RE };')();

test('cookies: set fires onChanged, remove deletes and is recorded', async () => {
  const f = makeChrome(), seen = [];
  f.chrome.cookies.onChanged.addListener((e) => seen.push(`${e.removed ? '-' : '+'}${e.cookie.name}`));
  await f.chrome.cookies.set({ url: 'https://www.google.com/', name: 'NID', value: '1', domain: '.google.com' });
  assert.equal((await f.chrome.cookies.getAll({})).length, 1);
  assert.ok(await f.chrome.cookies.remove({ url: 'https://google.com/', name: 'NID', storeId: '0' }));
  assert.equal(await f.chrome.cookies.remove({ url: 'https://google.com/', name: 'NID', storeId: '0' }), null);
  assert.deepEqual(seen, ['+NID', '-NID']);
  assert.equal((await f.chrome.cookies.getAll({})).length, 0);
  assert.equal(f.called('cookies.remove').length, 2);
});

test('destructive() lists only calls that delete or reroute something', async () => {
  const f = makeChrome({ tabs: [{ id: 1, url: 'https://a.test/' }, { id: 2, url: 'https://b.test/' }] });
  await f.chrome.storage.local.set({ a: 1 }); await f.chrome.cookies.getAll({}); await f.chrome.tabs.query({});
  await f.chrome.action.setBadgeText({ text: '2' }); f.chrome.alarms.create('sweep', { periodInMinutes: 15 });
  await f.chrome.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['trackers'] });
  assert.deepEqual(f.destructive(), []);
  await f.chrome.tabs.remove([2]); await f.chrome.browsingData.remove({ since: 0 }, { cache: true });
  await f.chrome.proxy.settings.set({ scope: 'regular', value: {} });
  assert.deepEqual(f.destructive().map((c) => c.api), ['tabs.remove', 'browsingData.remove', 'proxy.settings.set']);
  assert.deepEqual((await f.chrome.tabs.query({})).map((t) => t.id), [1]);
});

test('storage, alarms, badge, rulesets, scripting and runtime keep simple state', async () => {
  const f = makeChrome({ manifest: { version: '1.20' } }), c = f.chrome;
  await c.storage.local.set({ a: 1, b: 2 }); await c.storage.local.remove('b');
  assert.deepEqual(await c.storage.local.get(null), { a: 1 });
  assert.deepEqual(await c.storage.local.get({ a: 0, z: 9 }), { a: 1, z: 9 });
  assert.deepEqual(await c.storage.local.get('a'), { a: 1 });
  const fired = []; c.alarms.onAlarm.addListener((a) => fired.push(a.name));
  c.alarms.create('sweep', { periodInMinutes: 15 }); await f.fireAlarm('sweep');
  assert.deepEqual(fired, ['sweep']);
  await c.action.setBadgeText({ text: '3' }); assert.equal(f.badge.text, '3');
  assert.deepEqual(await c.declarativeNetRequest.getEnabledRulesets(), ['trackers']);
  await c.declarativeNetRequest.updateEnabledRulesets({ disableRulesetIds: ['trackers'] });
  assert.deepEqual(await c.declarativeNetRequest.getEnabledRulesets(), []);
  await c.scripting.registerContentScripts([{ id: 'yt-adfree' }]);
  assert.deepEqual((await c.scripting.getRegisteredContentScripts()).map((x) => x.id), ['yt-adfree']);
  await c.scripting.unregisterContentScripts({ ids: ['yt-adfree'] });
  assert.deepEqual(await c.scripting.getRegisteredContentScripts(), []);
  assert.equal(c.runtime.getManifest().version, '1.20');
  let started = 0; c.runtime.onStartup.addListener(() => started++); await c.runtime.onStartup.fire(); assert.equal(started, 1);
});

// The same three lines as 1.20's live listener (background.js is not run in Node), to pin the
// end-to-end effect through the fake: NID and li_at vanish as they are set, SID stays.
test('1.20 live cleaning through the fake: NID, li_at and a tracker-host cookie go, SID stays', async () => {
  const f = makeChrome(), { shouldGo } = makeCore(L);
  f.chrome.cookies.onChanged.addListener(async ({ removed, cookie: c }) => {
    if (removed || !shouldGo(c)) return;
    await f.chrome.cookies.remove({ url: (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path, name: c.name, storeId: c.storeId });
  });
  await f.chrome.cookies.set({ url: 'https://accounts.google.com/', name: 'NID', domain: '.google.com' });
  await f.chrome.cookies.set({ url: 'https://accounts.google.com/', name: 'SID', domain: '.google.com' });
  await f.chrome.cookies.set({ url: 'https://www.linkedin.com/', name: 'li_at', domain: '.www.linkedin.com' });
  await f.chrome.cookies.set({ url: 'https://ad.doubleclick.net/', name: 'anything' });
  assert.deepEqual((await f.chrome.cookies.getAll({})).map((c) => c.name), ['SID']);
  assert.deepEqual(f.destructive().map((c) => c.args[0].name), ['NID', 'li_at', 'anything']);
});
test('native messaging: no host installed rejects as Chrome does; a fake host answers with a copy and is recorded', async () => {
  const f = makeChrome();
  await assert.rejects(f.chrome.runtime.sendNativeMessage('com.x', { type: 'list' }), /host not found/);
  const answer = { ok: true, list: [1] };
  f.native = (name, msg) => ({ ...answer, name, got: msg.type });
  const r = await f.chrome.runtime.sendNativeMessage('com.x', { type: 'list' });
  assert.deepEqual(r, { ok: true, list: [1], name: 'com.x', got: 'list' }); assert.notEqual(r.list, answer.list);
  assert.equal(f.called('runtime.sendNativeMessage').length, 2); assert.deepEqual(f.destructive(), []);
});
