const test = require('node:test'), assert = require('node:assert');
const { QUEUE_MAX, queueAdd, queueKeep, queueKey, queuePostpone, queueRestart, queueCount, queueBadge, queueView } = require('../extension/queue.js');
const T = 1.8e12, item = (name, o = {}) => ({ cap: 'C03', kind: 'cookie', site: 'ad.test', name, why: 'host', t: T, ...o });

test('add: creates the group, does not duplicate, stores only the six fields (never a value)', () => {
  const p = {};
  assert.equal(queueAdd(p, 'cookies', { ...item('a'), value: 'secret', path: '/' }), true);
  assert.equal(queueAdd(p, 'cookies', item('a', { t: T + 5, why: 'name' })), false);
  assert.equal(queueAdd(p, 'cookies', item('a', { site: 'other.test' })), true);
  assert.deepEqual(p, { cookies: { items: [item('a'), item('a', { site: 'other.test' })], postponedUntil: 0 } });
});
test('add: a group holds at most 500 items, the oldest go first', () => {
  const p = {};
  for (let i = 0; i < QUEUE_MAX + 3; i++) queueAdd(p, 'cookies', item('n' + i));
  assert.equal(QUEUE_MAX, 500); assert.equal(p.cookies.items.length, 500);
  assert.equal(p.cookies.items[0].name, 'n3'); assert.equal(p.cookies.items[499].name, 'n502');
});
test('keep: filters every group and says whether anything changed', () => {
  const p = {}; queueAdd(p, 'cookies', item('a')); queueAdd(p, 'cookies', item('b')); queueAdd(p, 'tabs', item('7', { cap: 'C13', kind: 'tabs' }));
  assert.equal(queueKeep(p, () => true), false);
  assert.equal(queueKeep(p, (it) => queueKey(it) !== queueKey(item('a'))), true);
  assert.deepEqual(p.cookies.items.map((x) => x.name), ['b']); assert.equal(p.tabs.items.length, 1);
});
test('count and badge: postponed groups do not count until the time is up; restart; paused shows II', () => {
  const p = {}; queueAdd(p, 'cookies', item('a')); queueAdd(p, 'cookies', item('b')); queueAdd(p, 'google', item('NID', { cap: 'C04' }));
  assert.equal(queueCount(p, T), 3); assert.equal(queueBadge(p, false, T), '3');
  queuePostpone(p, 'cookies', T + 60);
  assert.equal(queueCount(p, T + 59), 1); assert.equal(queueCount(p, T + 60), 3);
  queueAdd(p, 'cookies', item('c')); assert.equal(queueCount(p, T), 1);     // items keep collecting
  queuePostpone(p, 'google', 'restart'); queuePostpone(p, 'tabs', 'restart');
  assert.equal(queueBadge(p, false, T), ''); assert.equal(queueCount(p, T + 1e12), 3);
  assert.equal(queueRestart(p), true); assert.equal(queueRestart(p), false);
  assert.equal(queueCount(p, T), 1); assert.equal(p.cookies.postponedUntil, T + 60);
  assert.equal(queueBadge(p, true, T), 'II');
  assert.equal(queueBadge(undefined, false, T), ''); assert.equal(queueBadge({}, false, T), '');
});
test('view: the count and the newest 20 items', () => {
  const p = {}; for (let i = 0; i < 25; i++) queueAdd(p, 'cookies', item('n' + i));
  const v = queueView(p.cookies);
  assert.equal(v.pending, 25); assert.equal(v.items.length, 20); assert.equal(v.items[19].name, 'n24'); assert.equal(v.postponedUntil, 0);
  assert.deepEqual(queueView(undefined), { pending: 0, postponedUntil: 0, items: [] });
});
test('logAdd: six fields per entry, did from the call or from the item, at most 200 kept (the oldest go)', () => {
  const { logAdd, LOG_MAX } = require('../extension/queue.js');
  assert.deepEqual(logAdd([], [{ ...item('a'), value: 'secret', did: 'held' }], undefined, 7), [{ t: 7, cap: 'C03', kind: 'cookie', site: 'ad.test', name: 'a', did: 'held' }]);
  const l = logAdd(Array.from({ length: LOG_MAX }, (_, i) => ({ t: i })), [item('b')], 'removed', 9);
  assert.equal(LOG_MAX, 200); assert.equal(l.length, 200); assert.equal(l[0].t, 1); assert.equal(l[199].did, 'removed');
});
