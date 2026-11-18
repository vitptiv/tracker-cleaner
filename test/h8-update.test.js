// H8 (second audit): after an update to 1.25 nothing new is deleted before the user has answered the one-time line.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { renderPopup } = require('../extension/popup-view.js'), { mayRun } = require('../extension/registry.js'), { NET_BASE } = require('../extension/net-rules.js');
const ID = { name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };
const update = async (storage, o = {}) => { const bg = await load({ cookies: [ID], ...o, storage: { master: true, cacheClearedAt: 0, ...storage } }); await bg.chrome.runtime.onInstalled.fire({ reason: 'update', previousVersion: '1.24' }); await bg.settle(); return bg; };
const two = async (bg) => { for (const p of ['news.example', 'shop.example']) { await bg.request({ url: 'https://px.trk.example/p.gif', initiator: `https://www.${p}`, type: 'image' }); await bg.settle(); } };
const NEW = ['C11', 'C25', 'C27', 'C28'];

test('updated with cleaning on: blocking and the header rules start at once, but the four groups that are new to "by itself" keep asking until the line is answered', async () => {
  const bg = await update({}); await two(bg); bg.now += 25 * 3600e3; await bg.alarm('sweep');
  for (const id of NEW) assert.equal(mayRun(id, bg.state.storage), 'ask', id);
  assert.deepEqual(await bg.names(), ['uid']); assert.deepEqual(bg.state.storage.stopped || [], []); assert.deepEqual(bg.called('browsingData.remove'), []);
  assert.ok(bg.state.rules.some((r) => r.id === NET_BASE), 'the header rules are not on'); assert.deepEqual(bg.state.rulesets, ['trackers', 'google-paths', 'url-params']);
  const html = renderPopup(await bg.send({ type: 'state' }), null);
  assert.ok(html.includes('New: Tracker Cleaner now cleans by itself.')); assert.match(html, />OK<\/button>.*>Keep asking<\/button>/);
});
test('OK: from then on by itself. Keep asking: it stays as it was, and the line is gone either way', async () => {
  const ok = await update({}); await two(ok);
  assert.deepEqual(await ok.send({ type: 'seen', auto: true }), { ok: true }); await ok.settle();
  for (const id of NEW) assert.equal(mayRun(id, ok.state.storage), 'run', id);
  assert.deepEqual(ok.state.storage.stopped, ['trk.example']); assert.deepEqual(await ok.names(), []);
  assert.equal(renderPopup(await ok.send({ type: 'state' }), null).includes('New: Tracker Cleaner'), false);
  const keep = await update({}); await two(keep);
  assert.deepEqual(await keep.send({ type: 'seen', auto: false }), { ok: true }); await keep.settle(); keep.now += 3600e3; await keep.alarm('sweep');
  for (const id of NEW) assert.equal(mayRun(id, keep.state.storage), 'ask', id);
  assert.deepEqual(await keep.names(), ['uid']); assert.equal(renderPopup(await keep.send({ type: 'state' }), null).includes('New: Tracker Cleaner'), false);
});
test('a mode the user had chosen is never changed by the update or by OK', async () => {
  const bg = await update({ modes: { C25: 'off', C11: 'auto' } });
  assert.deepEqual([bg.state.storage.modes.C25, bg.state.storage.modes.C11, bg.state.storage.modes.C27], ['off', 'auto', 'ask']);
  await bg.send({ type: 'seen', auto: true });
  assert.deepEqual([bg.state.storage.modes.C25, bg.state.storage.modes.C11, bg.state.storage.modes.C27], ['off', 'auto', undefined]);
});
