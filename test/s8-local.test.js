// S8: a page may not ask this computer or the home network (net-rules.js LOCAL_RE, one block rule, its own row).
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { NET_BASE, LOCAL_RES, netRules } = require('../extension/net-rules.js'), { cap, GROUPS, mayRun } = require('../extension/registry.js');
const local = (bg) => bg.state.dynamic.find((r) => r.id === NET_BASE + 10);

test('S8: this computer and the home network by address, the whole host and nothing that only looks like it', () => {
  const rules = netRules({ local: true, self: 'abcdefghijklmnopabcdefghijklmnop' }), [r] = rules, re = { test: (u) => LOCAL_RES.some((x) => new RegExp(x, 'i').test(u)) };
  assert.deepEqual(rules.map((x) => [x.id, x.action.type, x.condition.domainType, x.condition.regexFilter]), LOCAL_RES.map((x, i) => [NET_BASE + 10 + i, 'block', 'thirdParty', x]));
  for (const x of LOCAL_RES) assert.ok(x.length < 160, 'a pattern Chrome may refuse for its size: ' + x);
  assert.deepEqual(r.condition.excludedInitiatorDomains, ['abcdefghijklmnopabcdefghijklmnop']); assert.equal(r.condition.resourceTypes.includes('main_frame'), false);
  for (const u of ['http://localhost/', 'http://localhost:8080/x', 'https://127.0.0.1:8443/', 'http://127.1.2.3', 'ws://127.0.0.1:9222/devtools', 'wss://localhost:1/', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://172.31.255.255:81/a',
    'http://192.168.1.1/admin', 'http://169.254.169.254/latest/meta-data', 'http://[::1]/', 'http://[::1]:8080/x', 'http://[::ffff:7f00:1]/', 'http://[fd12:3456::1]/', 'http://[fe80::1]/', 'http://0.0.0.0:8000/', 'http://localhost./', 'http://user:pw@127.0.0.1/',
    'http://LOCALHOST/', 'http://localhost?x', 'http://localhost#x']) assert.ok(re.test(u), u);
  for (const u of ['http://gazette.localhost:8200/', 'http://x.localhost/', 'http://localhost.example/', 'http://notlocalhost/', 'http://localhost-evil.test/', 'http://127.0.0.1.example.com/', 'http://example.com/127.0.0.1', 'http://example.com/?u=http://localhost/',
    'http://localhost@evil.test/', 'http://127.0.0.1@evil.test/', 'http://evil.test/#http://localhost/', 'http://172.15.0.1/', 'http://172.32.0.1/', 'http://11.0.0.1/', 'http://192.169.1.1/', 'http://8.8.8.8/', 'http://1127.0.0.1/', 'http://10.0.0.1.evil.test/',
    'http://[2001:db8::1]/', 'ftp://localhost/', 'https://example.com/']) assert.equal(re.test(u), false, u);
  const t = Date.now(); re.test('http://' + 'a'.repeat(200000) + '@'.repeat(5) + 'x'); assert.ok(Date.now() - t < 500, 'the pattern is slow on a long address');
});
test('its own row, on by default; what the extension itself asks is no page\'s request; a site cleaning is off for is let through; off when switched off or paused', async () => {
  assert.deepEqual([cap('C31').group, cap('C31').mode, cap('C31').destructive], ['local', 'auto', false]);
  assert.equal(mayRun('C31', { master: true }), 'run'); assert.ok(GROUPS.find((g) => g.id === 'local').says.length > 40);
  const bg = await load({ storage: { master: true, cacheClearedAt: 1.8e12 } }); await bg.alarm('sweep');
  assert.deepEqual(local(bg).condition.excludedInitiatorDomains, [bg.chrome.runtime.id]); assert.equal(local(bg).priority, 1);
  await bg.send({ type: 'siteOff', host: 'router.example', on: true }); await bg.settle();
  assert.ok(bg.state.dynamic.some((r) => r.action.type === 'allow' && r.priority > local(bg).priority && (r.condition.initiatorDomains || []).includes('router.example')));
  await bg.send({ type: 'pause', minutes: 5 }); await bg.settle(); assert.equal(local(bg), undefined);
  await bg.send({ type: 'resume' }); await bg.settle(); assert.ok(local(bg));
  await bg.send({ type: 'setMode', group: 'local', mode: 'off' }); await bg.settle(); assert.equal(local(bg), undefined);
});
test('one rule Chrome refuses does not take the other rules down', async () => {
  const bg = await load({ storage: { master: true, cacheClearedAt: 1.8e12, stopped: ['trk.example'] } });
  bg.refuse = (r) => r.id === NET_BASE + 12; await bg.send({ type: 'setMode', group: 'local', mode: 'off' }); await bg.send({ type: 'setMode', group: 'local', mode: 'auto' }); await bg.settle();
  const ids = bg.state.dynamic.map((r) => r.id);
  assert.equal(ids.includes(NET_BASE + 12), false);
  for (const id of [100001, 100003, NET_BASE + 10, NET_BASE + 11, NET_BASE + 13]) assert.ok(ids.includes(id), 'missing rule ' + id);
});
