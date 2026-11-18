// J7 (third audit): the local-network rule also stops forms posted to private targets, and knows more names and ranges.
const test = require('node:test'), assert = require('node:assert');
const { NET_BASE, LOCAL_ALL, LOCAL_SUB, netRules } = require('../extension/net-rules.js');
const hit = (u) => LOCAL_ALL.some((x) => new RegExp(x, 'i').test(u));

test('the audit\'s misses: one-word names, .home, .corp, easy.box, the old IPv6 forms and 198.18/15', () => {
  for (const u of ['http://router/', 'http://nas:5000/x', 'http://intranet/', 'http://printer.home/', 'http://wiki.corp/', 'http://db.dept.corp:8080/', 'http://easy.box/', 'http://www.easy.box/', 'http://[::7f00:1]/', 'http://[::a00:1]:8080/',
    'http://[fec0::1]/', 'http://[feff::1]/', 'http://198.18.0.1/', 'http://198.19.255.255/', 'ws://router/', 'http://ROUTER/']) assert.ok(hit(u), u);
  for (const u of ['http://example.com/', 'http://router.example.com/', 'http://home.example/', 'http://corp.example/', 'http://my-home.net/', 'http://noteasy.box/', 'http://easy.box.evil.test/', 'http://198.17.0.1/', 'http://198.20.0.1/', 'http://[2001:db8::7f00:1]/',
    'http://[ff02::1]/', 'http://evil.test/router', 'http://evil.test/?h=router', 'http://router@evil.test/', 'http://x.localhost/']) assert.equal(hit(u), false, u);
  const t = Date.now(); hit('http://' + 'a'.repeat(200000) + '.' + 'b'.repeat(200000)); assert.ok(Date.now() - t < 1000, 'slow on a long name');
});
test('a form posted from a page of another site to a private target is stopped; following a link there is not', () => {
  const rules = netRules({ local: true, self: 'abcdefghijklmnopabcdefghijklmnop' }), nav = rules.filter((r) => r.condition.resourceTypes.includes('main_frame')), sub = rules.filter((r) => !r.condition.resourceTypes.includes('main_frame'));
  assert.equal(nav.length, LOCAL_ALL.length + 1); assert.equal(sub.length, LOCAL_ALL.length + 1);
  for (const r of nav) { assert.deepEqual(r.condition.resourceTypes, ['main_frame']); assert.deepEqual(r.condition.requestMethods, ['post', 'put', 'patch', 'delete']);
    assert.deepEqual([r.action.type, r.condition.domainType], ['block', 'thirdParty']); assert.ok(r.condition.excludedInitiatorDomains.includes('abcdefghijklmnopabcdefghijklmnop')); }
  for (const r of sub) assert.equal('requestMethods' in r.condition, false);
  for (const r of rules.filter((x) => x.condition.regexFilter === LOCAL_SUB)) assert.ok(r.condition.excludedInitiatorDomains.includes('localhost'));
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length); assert.ok(rules.every((r) => r.id >= NET_BASE + 20 && r.id < NET_BASE + 80 && r.condition.regexFilter.length < 170));
});
