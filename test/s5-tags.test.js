// S5: other companies get no cache tags and no referring page: the same rules as S4 (net-rules.js), one more row.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { NET_BASE, netRules } = require('../extension/net-rules.js'), { cap, GROUPS, mayRun } = require('../extension/registry.js');
const removed = (r, k) => (r.action[k] || []).map((h) => h.header);
const net = (bg) => bg.state.rules.filter((r) => r.id >= NET_BASE && r.id < NET_BASE + 10);   // the header rules are session rules

test('S5: cache tags and the referring page go with the same rules; both switched on share them', () => {
  const all = (rules, k) => [...new Set(rules.flatMap((r) => removed(r, k)))];   // 1.25, H6: the referring page has rules of its own (not for embedded frames)
  const t = netRules({ tags: true }), both = netRules({ cookies: true, tags: true });
  assert.deepEqual(all(t, 'requestHeaders'), ['if-none-match', 'if-modified-since', 'referer']); assert.deepEqual(all(t, 'responseHeaders'), ['etag']);
  assert.deepEqual(all(both, 'requestHeaders'), ['cookie', 'if-none-match', 'if-modified-since', 'referer']); assert.deepEqual(all(both, 'responseHeaders'), ['set-cookie', 'etag']);
  assert.deepEqual(netRules({}), []);
});
test('its own row, on by default, deletes nothing; each of the two rows can be switched off alone', async () => {
  assert.deepEqual([cap('C30').group, cap('C30').mode, cap('C30').destructive], ['othertags', 'auto', false]);
  assert.equal(mayRun('C30', { master: true }), 'run'); assert.ok(GROUPS.find((g) => g.id === 'othertags').says.length > 40);
  const bg = await load({ storage: { master: true, cacheClearedAt: 1.8e12 } }); await bg.alarm('sweep');
  const all = () => [...new Set(net(bg).flatMap((r) => removed(r, 'requestHeaders')))];
  assert.deepEqual(all(), ['cookie', 'if-none-match', 'if-modified-since', 'referer']); assert.deepEqual(removed(net(bg)[0], 'responseHeaders'), ['set-cookie', 'etag']);
  await bg.send({ type: 'setMode', group: 'othercookies', mode: 'off' }); await bg.settle();
  assert.deepEqual(all(), ['if-none-match', 'if-modified-since', 'referer']);
  await bg.send({ type: 'setMode', group: 'othertags', mode: 'off' }); await bg.settle();
  assert.deepEqual(net(bg), []);
});
