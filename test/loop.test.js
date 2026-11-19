// Loop breaker: a cookie its site puts back every time it is removed is left alone after 5 removals in 10 minutes
// and waits for the user instead. Found in use: google.com NID removed 30 times in 9 minutes.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { LOOP_N, LOOP_MS, LOOP_HOLD_MS, LOOP_WHY, loopNote, loopStuck } = require('../extension/loop.js');
const MIN = 60e3, HOUR = 60 * MIN, T = 1.8e12, K = 'example.com _ga';
const noted = (times, loops = {}) => times.reduce((l, t) => loopNote(l, K, t), loops);

test('loop.js: 5 removals within 10 minutes leave the cookie alone for one hour (1.25, L8: not a day); fewer, or slower, do not', () => {
  assert.deepEqual([LOOP_N, LOOP_MS, LOOP_HOLD_MS, LOOP_WHY], [5, 10 * MIN, HOUR, 'this site keeps putting it back']);
  const four = noted([0, 1, 2, 3].map((i) => T + i * MIN));
  assert.equal(loopStuck(four, K, T + 4 * MIN), false);
  const five = loopNote(four, K, T + 4 * MIN);
  assert.equal(loopStuck(five, K, T + 4 * MIN), true); assert.equal(loopStuck(five, 'example.com other', T + 4 * MIN), false);
  assert.equal(loopStuck(five, K, T + 4 * MIN + LOOP_HOLD_MS - 1), true); assert.equal(loopStuck(five, K, T + 4 * MIN + LOOP_HOLD_MS), false);
  // 4 quick ones, a pause longer than the window, 4 more: never 5 within 10 minutes
  assert.equal(loopStuck(noted([20, 21, 22, 23].map((i) => T + i * MIN), four), K, T + 23 * MIN), false);
  assert.equal(loopStuck(undefined, K, T), false);
});
test('loop.js: what is no longer needed is dropped, so the store cannot grow', () => {
  let loops = {};
  for (let i = 0; i < 1000; i++) loops = loopNote(loops, `site${i}.test _ga`, T + i * MIN);
  assert.ok(Object.keys(loops).length <= 11, String(Object.keys(loops).length));
  const stuck = noted([0, 0, 0, 0, 0].map(() => T));
  assert.deepEqual(Object.keys(loopNote(stuck, 'other.test x', T + LOOP_HOLD_MS + 11 * MIN)), ['other.test x']);
});

const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: T, ...o.storage } });
const put = (bg, name = '_ga') => bg.setCookie({ url: 'https://www.example.com/', name, value: 'secret-value' });
const queued = (bg, group) => ((bg.state.storage.pending || {})[group] || { items: [] }).items;
const loop5 = async (bg) => { for (let i = 0; i < 5; i++) { await put(bg); assert.deepEqual(await bg.names(), [], `removal ${i + 1}`); bg.now += MIN; } };

test('removed and set again 5 times within 10 minutes: the sixth time it stays, queued under its group with the reason', async () => {
  const bg = await load(on());
  await loop5(bg);
  await put(bg);
  assert.deepEqual(await bg.names(), ['_ga']); assert.equal(bg.called('cookies.remove').length, 5);
  assert.deepEqual(queued(bg, 'cookies').map((i) => [i.cap, i.kind, i.site, i.name, i.why]), [['C03', 'cookie', 'www.example.com', '_ga', 'this site keeps putting it back']]);
  assert.equal(bg.badge.text, '1');
  const row = (await bg.send({ type: 'state' })).groups.find((g) => g.id === 'cookies');
  assert.deepEqual([row.mode, row.pending, row.looping, row.items[0].why], ['auto', 1, 1, 'this site keeps putting it back']);
  await put(bg, '_gid');                                              // another cookie of the same site is cleaned as before
  assert.deepEqual(await bg.names(), ['_ga']);
  await bg.alarm('sweep');                                            // the sweep leaves it too, and it stays queued once
  assert.deepEqual(await bg.names(), ['_ga']); assert.equal(queued(bg, 'cookies').length, 1);
  assert.equal(JSON.stringify(bg.state.storage).includes('secret-value'), false);
});
test('the user can still remove it with Approve; when the site puts it back again it waits again', async () => {
  const bg = await load(on());
  await loop5(bg); await put(bg);
  assert.deepEqual(await bg.send({ type: 'approve', group: 'cookies' }), { ok: true, done: 1, of: 1 }); await bg.settle();
  assert.deepEqual(await bg.names(), []);
  await put(bg);
  assert.deepEqual(await bg.names(), ['_ga']); assert.equal(queued(bg, 'cookies').length, 1);
});
test('a Google identity cookie on Automatic is held the same way, in its own row', async () => {
  const bg = await load(on({ storage: { modes: { C04: 'auto' } } })), nid = () => bg.setCookie({ url: 'https://www.google.com/', domain: '.google.com', name: 'NID', value: 'secret-value' });
  for (let i = 0; i < 5; i++) { await nid(); bg.now += MIN; }
  assert.deepEqual(await bg.names(), []);
  await nid();
  assert.deepEqual(await bg.names(), ['NID']); assert.deepEqual(queued(bg, 'google').map((i) => [i.site, i.name, i.why]), [['google.com', 'NID', LOOP_WHY]]);
});
test('a cookie removed twice a day is unaffected', async () => {
  const bg = await load(on());
  for (let i = 0; i < 8; i++) { await put(bg); assert.deepEqual(await bg.names(), [], `removal ${i + 1}`); bg.now += 12 * HOUR; }
  assert.deepEqual(queued(bg, 'cookies'), []);
});
test('the breaker pauses for one hour, then deleting goes on: the cookie is removed again, by a new cookie event or by the sweep', async () => {
  const live = await load(on());
  await loop5(live); await put(live); live.now += HOUR;
  await put(live);
  assert.deepEqual(await live.names(), []);
  const swept = await load(on());
  await loop5(swept); await put(swept); swept.now += HOUR;
  await swept.alarm('sweep');
  assert.deepEqual(await swept.names(), []); assert.deepEqual(queued(swept, 'cookies'), []);
});
test('L8: the popup and the report say that it is left alone for an hour and then removed again', () => {
  const { renderPopup } = require('../extension/popup-view.js'), { buildReport } = require('../extension/report-view.js');
  const it = { cap: 'C03', kind: 'cookie', site: 'example.com', name: '_ga', why: 'this site keeps putting it back' }, g = { id: 'cookies', title: 'Trackers\' cookies', says: '', ask: true, mode: 'auto', pending: 1, items: [it], looping: 1 };
  assert.ok(renderPopup({ now: 1, master: true, hold: {}, groups: [g] }, null).includes('1 keeps coming back, so it waits an hour.'));
  assert.ok(buildReport({ now: 1, master: true, hold: {}, groups: [g] }, null).waiting[0].items[0].includes('keeps coming back, so it waits an hour'));
});
