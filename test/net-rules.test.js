// S4: the rules that give other companies less (net-rules.js), and how background.js installs them.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { NET_BASE, FAMILIES, netRules, GUARD_RULE, guardRule } = require('../extension/net-rules.js');
const { SIGNIN_HOSTS } = require('../extension/guard.js'), { NEEDED } = require('../extension/learn.js'), { cap, GROUPS, mayRun } = require('../extension/registry.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const net = (bg) => bg.state.dynamic.filter((r) => r.id >= NET_BASE && r.id < NET_BASE + 10);
const removed = (r, k) => (r.action[k] || []).map((h) => h.header);

test('S4: cookies only: every kind of request but the page itself, to another company, loses its cookie and may set none', () => {
  const [r, ...fam] = netRules({ cookies: true, exempt: ['accounts.google.com', 'off.example'] });
  assert.deepEqual([r.id, r.priority, r.action.type, r.condition.domainType], [NET_BASE, 1, 'modifyHeaders', 'thirdParty']);
  assert.deepEqual(removed(r, 'requestHeaders'), ['cookie']); assert.deepEqual(removed(r, 'responseHeaders'), ['set-cookie']);
  assert.equal(r.condition.resourceTypes.includes('main_frame'), false); assert.ok(['sub_frame', 'script', 'image', 'xmlhttprequest', 'ping', 'websocket'].every((t) => r.condition.resourceTypes.includes(t)));
  assert.deepEqual(r.condition.excludedRequestDomains, ['accounts.google.com', 'off.example']);
  assert.ok(['accounts.google.com', 'off.example', 'google.com', 'youtube.com', 'live.com', 'icloud.com'].every((d) => r.condition.excludedInitiatorDomains.includes(d)));
  assert.equal(fam.length, FAMILIES.length);
});
test('inside one company\'s family nothing is taken away, but a family page asking anyone else is treated like every page', () => {
  const g = netRules({ cookies: true, exempt: ['off.example'] })[1];
  assert.deepEqual(g.condition.initiatorDomains, FAMILIES[0]);
  assert.ok(['google.com', 'youtube.com', 'off.example'].every((d) => g.condition.excludedRequestDomains.includes(d)));
  assert.equal(g.condition.excludedRequestDomains.includes('doubleclick.net'), false);
});
test('one group with its own row and plain sentence; on by default, and nothing in it deletes', () => {
  assert.deepEqual([cap('C29').group, cap('C29').mode, cap('C29').destructive], ['othercookies', 'auto', false]);
  assert.equal(mayRun('C29', { master: true }), 'run'); assert.ok(GROUPS.find((g) => g.id === 'othercookies').says.length > 40);
});
test('installed as switched on; the exempt list is the sign-in hosts, the companies pages need, and the sites cleaning is off for', async () => {
  const bg = await load(on({ storage: { sitesOff: ['off.example'] } })); await bg.alarm('sweep');
  const rules = net(bg), ex = rules[0].condition.excludedRequestDomains;
  assert.deepEqual(rules.map((r) => r.id), [NET_BASE, NET_BASE + 1, NET_BASE + 2, NET_BASE + 3]);
  for (const h of [...SIGNIN_HOSTS, ...NEEDED, 'github.com', 'off.example']) assert.ok(ex.includes(h), h);
  assert.ok(removed(rules[0], 'requestHeaders').includes('cookie'));
  await bg.send({ type: 'setMode', group: 'othercookies', mode: 'off' }); await bg.settle();
  assert.equal(net(bg).some((r) => removed(r, 'requestHeaders').includes('cookie')), false);
});
test('none of it while paused or with cleaning switched off; back when resumed', async () => {
  const bg = await load(on()); await bg.alarm('sweep'); assert.equal(net(bg).length, 4);
  await bg.send({ type: 'pause', minutes: 5 }); await bg.settle(); assert.deepEqual(net(bg), []);
  await bg.send({ type: 'resume' }); await bg.settle(); assert.equal(net(bg).length, 4);
  await bg.send({ type: 'setMaster', on: false }); await bg.settle(); assert.deepEqual(net(bg), []);
});
test('sign-in guard: the tab a sign-in page is seen in, and the tab that opened it, are let through for the guard\'s time, then not', async () => {
  assert.deepEqual(guardRule([3, 3, 4]).condition.tabIds, [3, 4]); assert.deepEqual([guardRule([3]).action.type, guardRule([3]).priority], ['allow', 3]);
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://shop.example/' }] }));
  assert.deepEqual(bg.state.rules, []);
  await bg.openTab({ id: 2, active: false, openerTabId: 1, url: 'https://accounts.google.com/o/oauth2/auth?client_id=a&redirect_uri=b' }); await bg.settle();
  assert.deepEqual(bg.state.rules.map((r) => [r.id, r.condition.tabIds]), [[GUARD_RULE, [1, 2]]]);
  await bg.closeTab(2); bg.now += 5 * 60e3 + 2000; await bg.alarm('unguard');
  assert.deepEqual(bg.state.rules, []);
});
test('sign-in guard switched off: no tab is let through', async () => {
  const bg = await load(on({ storage: { modes: { C19: 'off' } }, tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/signin' }] })); await bg.alarm('sweep');
  assert.deepEqual(bg.state.rules, []);
});
