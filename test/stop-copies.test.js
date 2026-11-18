// S2a, S2b: after a stop the saved copies are cleared again a minute later and when Chrome starts; a stopped tracker's
// notifications are blocked even while its own page is open, and nothing else of that page is touched.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').pressing;
const req = async (bg, host, page) => { await bg.request({ url: `https://${host}/px.gif`, initiator: `https://www.${page}`, type: 'image' }); await bg.settle(); };
const three = async (bg) => { for (const p of ['news.example', 'shop.example', 'blog.example']) await req(bg, 'trk.example', p); };
const ID = { name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };
const on = (o = {}) => ({ cookies: [ID], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const clears = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].cache && c.args[0].since === 0).length;
const blocked = (bg, site = 'trk.example') => bg.called('contentSettings.set').filter((c) => c.args[0].primaryPattern === `*://*.${site}/*` && c.args[0].setting === 'block').length;

test('H7, I1, K1: all saved copies are cleared once after the block and once at the press on Remove, and at most once a day otherwise: no wake-up a minute later, nothing when Chrome starts or the extension is loaded again', async () => {
  const bg = await load(on()); await three(bg); assert.equal(clears(bg), 1);
  await bg.send({ type: 'approve', group: 'unknown', site: 'trk.example', name: 'what it keeps to follow you' }); await bg.settle();
  assert.equal(clears(bg), 2); assert.equal('copies' in bg.state.alarms, false);
  await bg.chrome.runtime.onStartup.fire(); await bg.settle(); await bg.chrome.runtime.onInstalled.fire({ reason: 'update', previousVersion: '1.25' }); await bg.settle();
  for (let i = 0; i < 4; i++) { bg.now += 15 * 60e3; await bg.alarm('sweep'); }
  assert.equal(clears(bg), 2, 'cleared again within the day');
  bg.now += 24 * 3600e3; await bg.alarm('sweep'); assert.equal(clears(bg), 3, 'the daily clearing');
});
test('H7: twenty starts of Chrome with a tracker stopped clear nothing; the row says what really happens', async () => {
  const bg = await load(on({ storage: { stopped: ['trk.example'], hard: ['trk.example'] } }));
  for (let i = 0; i < 20; i++) { await bg.chrome.runtime.onStartup.fire(); await bg.settle(); }
  assert.equal(clears(bg), 0);
  assert.equal(require('../extension/registry.js').GROUPS.find((g) => g.id === 'cache').says, 'All copies of pages that Chrome saved to load them faster are thrown away once a day, once more when a tracker is cleaned out, and at most once an hour when a new tracker is blocked; pages then load a little slower the first time.');
});
test("a stopped tracker's notifications are blocked once even while its own page is open; its cookies and what it saved there stay", async () => {
  const bg = await load(on({ storage: { stopped: ['trk.example'], hard: ['trk.example'] }, tabs: [{ id: 1, active: true, url: 'https://www.trk.example/feed' }],
    cookies: [ID, { name: 'session', domain: 'www.trk.example', value: 's-1' }] }));
  await bg.alarm('sweep');
  assert.equal(blocked(bg), 1); assert.deepEqual(await bg.names(), ['uid', 'session']);
  assert.equal(bg.called('browsingData.remove').some((c) => (c.args[0].origins || []).some((o) => o.includes('trk.example')) && c.args[1].serviceWorkers), false);
  await bg.alarm('sweep'); assert.equal(blocked(bg), 1, 'blocked again at the next sweep');
  await bg.send({ type: 'unstop', site: 'trk.example' });
  assert.ok(bg.called('contentSettings.set').some((c) => c.args[0].primaryPattern === '*://*.trk.example/*' && c.args[0].setting === 'ask'), '"Let it through again" does not give the notifications back');
});
test('notifications are not blocked on "Ask first" before the answer, nor while cleaning is switched off', async () => {
  for (const storage of [{ stopped: ['trk.example'], hard: ['trk.example'], modes: { C28: 'ask' } }, { stopped: ['trk.example'], hard: ['trk.example'], master: false }]) {
    const bg = await load(on({ storage })); await bg.alarm('sweep'); assert.equal(blocked(bg), 0); }
});
test('a block this extension set can be gone when Chrome starts or the extension is loaded again: it is set again then', async () => {
  for (const ev of ['onStartup', 'onInstalled']) {
    const bg = await load(on({ storage: { stopped: ['trk.example'], hard: ['trk.example'] } })); await bg.alarm('sweep'); assert.equal(blocked(bg), 1);
    await bg.chrome.runtime[ev].fire({ reason: 'update', previousVersion: '1.25' }); await bg.settle(); await bg.alarm('sweep');
    assert.equal(blocked(bg), 2, ev); }
});
