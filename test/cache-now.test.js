// R2: the saved copies of pages (C11) are cleared the moment the user turns that on, not a day later, and the popup has "Clean now".
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { renderPopup } = require('../extension/popup-view.js');
const cleared = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].cache).length;
const queued = (bg) => ((bg.state.storage.pending || {}).cache || { items: [] }).items;
const fresh = async (o = {}) => { const bg = await load({ ...o, storage: { master: true, ...o.storage } }); await bg.chrome.runtime.onInstalled.fire({ reason: 'install' }); await bg.settle(); return bg; };

test('fresh install: nothing is cleared or offered; set to Automatic it is cleared at once, once, and then daily', async () => {
  const bg = await fresh();
  assert.equal(cleared(bg), 0); assert.deepEqual(queued(bg), []);
  await bg.send({ type: 'setMode', group: 'cache', mode: 'auto' }); await bg.settle(); assert.equal(cleared(bg), 1);
  await bg.send({ type: 'setMode', group: 'cache', mode: 'auto' }); await bg.alarm('sweep'); assert.equal(cleared(bg), 1);
  bg.now += 25 * 3600e3; await bg.alarm('sweep'); assert.equal(cleared(bg), 2);
});
test('switched from Off to "Ask first": offered at once, nothing cleared', async () => {
  const bg = await fresh({ storage: { modes: { C11: 'off' } } });
  await bg.send({ type: 'setMode', group: 'cache', mode: 'ask' }); await bg.settle();
  assert.equal(cleared(bg), 0); assert.deepEqual(queued(bg).map((i) => i.kind), ['cache']);
});
test('turned on during a sign-in: held, and cleared when the sign-in is over', async () => {
  const bg = await fresh({ tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/' }] });
  await bg.send({ type: 'setMode', group: 'cache', mode: 'auto' }); await bg.settle();
  assert.equal(cleared(bg), 0); assert.deepEqual(queued(bg).map((i) => i.kind), ['cache']);
  await bg.navigate(1, 'https://example.com/'); bg.now += 6 * 60e3; await bg.alarm('sweep');
  assert.equal(cleared(bg), 1); assert.deepEqual(queued(bg), []);
});
test('the popup row has "Clean now" while the group is on, and not when it is off', async () => {
  const bg = await fresh(), row = async () => renderPopup(await bg.send({ type: 'state' }), null).split('data-group="cache"')[1].split('data-group=')[0];
  assert.ok((await row()).includes('<button data-msg="{&quot;type&quot;:&quot;drop&quot;,&quot;kind&quot;:&quot;servers&quot;}">Clean now</button>'));
  await bg.send({ type: 'drop', kind: 'servers' }); assert.equal(cleared(bg), 1);
  await bg.send({ type: 'setMode', group: 'cache', mode: 'off' });
  assert.equal((await row()).includes('Clean now'), false);
});
