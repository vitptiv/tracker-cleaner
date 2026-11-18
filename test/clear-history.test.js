// S16: one press in the popup clears all of Chrome's browsing history. Never by itself.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { renderPopup } = require('../extension/popup-view.js');
const cleared = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].history);

test('the press clears all of the history and nothing else, and it is in the log', async () => {
  const bg = await load({ storage: { master: true, cacheClearedAt: 1.8e12 } });
  assert.deepEqual(await bg.send({ type: 'clearBrowsing' }), { ok: true }); await bg.settle();
  assert.deepEqual(cleared(bg).map((c) => c.args), [[{ since: 0 }, { history: true }]]);
  assert.deepEqual(bg.state.storage.log.slice(-1).map((l) => [l.kind, l.name, l.did]), [['history', 'all of your browsing history', 'removed']]);
});
test('never by itself: a day of sweeps, a start and a stop clear no history', async () => {
  const bg = await load({ storage: { master: true, cacheClearedAt: 0, stopped: ['trk.example'] } });
  await bg.chrome.runtime.onStartup.fire(); for (let i = 0; i < 100; i++) { bg.now += 15 * 60e3; await bg.alarm('sweep'); }
  assert.deepEqual(cleared(bg), []);
});
test('refused while paused or switched off', async () => {
  for (const storage of [{ master: true, pauseUntil: 1.8e12 + 60e3 }, { master: false }]) { const bg = await load({ storage });
    assert.equal((await bg.send({ type: 'clearBrowsing' })).ok, false); assert.deepEqual(cleared(bg), []); }
});
test('the popup says plainly what it does: all of it, and it cannot be put back; the press must be repeated', () => {
  const html = renderPopup({ now: 1, master: true, hold: {}, groups: [] }, null);
  assert.match(html, /<button data-twice="Press again: this clears all of your browsing history and cannot be put back" data-msg="[^"]*clearBrowsing[^"]*">Clear my browsing history<\/button>/);
  assert.ok(html.includes('Clears every page Chrome remembers you visited, on all sites. It cannot be put back. Tracker Cleaner never does this by itself.'));
});
