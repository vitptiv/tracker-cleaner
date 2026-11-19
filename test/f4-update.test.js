// F4 (audit): an update that makes an existing install automatic must say so.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { renderPopup } = require('../extension/popup-view.js'), { mayRun } = require('../extension/registry.js');
const update = async (storage, previousVersion = '1.24') => { const bg = await load({ storage }); await bg.chrome.runtime.onInstalled.fire({ reason: 'update', previousVersion }); await bg.settle(); return bg; };

test('a profile that had cleaning on and no modes stored: after the update the popup says once what is new; until it is answered the four groups ask as before (1.25, H8)', async () => {
  const bg = await update({ master: true, cacheClearedAt: 1.8e12 });
  for (const id of ['C11', 'C25', 'C27', 'C28']) assert.equal(mayRun(id, bg.state.storage), 'ask', id);
  const s = await bg.send({ type: 'state' }); assert.equal(s.firstRun, 'update');
  assert.ok(renderPopup(s, null).includes('New: cleaning can now run without asking.'));
  await bg.send({ type: 'seen', auto: true }); assert.equal(renderPopup(await bg.send({ type: 'state' }), null).includes('New: Tracker Cleaner'), false);
  for (const id of ['C11', 'C25', 'C27', 'C28']) assert.equal(mayRun(id, bg.state.storage), 'run', id);
});
test('a mode the user chose before is kept; no line when cleaning was never on, when it is off, or when 1.25 was there already', async () => {
  const kept = await update({ master: true, cacheClearedAt: 1.8e12, modes: { C25: 'ask', C11: 'off' } });
  assert.equal(mayRun('C25', kept.state.storage), 'ask'); assert.equal(mayRun('C11', kept.state.storage), 'no');
  for (const [storage, v] of [[{}, '1.24'], [{ master: false }, '1.24'], [{ master: true }, '1.25'], [{ master: true }, '1.26'], [{ master: true }, '2.0']])
    assert.equal((await (await update({ cacheClearedAt: 1.8e12, ...storage }, v)).send({ type: 'state' })).firstRun, undefined, JSON.stringify([storage, v]));
});
