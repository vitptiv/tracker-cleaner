// H5 (second audit): more of this computer and the home network.
const test = require('node:test'), assert = require('node:assert');
const { NET_BASE, LOCAL_RES, LOCAL_NAMES, LOCAL_BOX, netRules } = require('../extension/net-rules.js'), { buildReport } = require('../extension/report-view.js');
const hit = (u) => LOCAL_RES.some((x) => new RegExp(x, 'i').test(u)), name = (u) => [LOCAL_NAMES, LOCAL_BOX].some((x) => new RegExp(x, 'i').test(u));

test('more addresses: the unspecified IPv6 address and the range providers share out to home routers (100.64 to 100.127)', () => {
  for (const u of ['http://[::]/', 'http://[::]:8080/x', 'http://100.64.0.1/', 'http://100.100.100.100/', 'http://100.127.255.255:8443/', 'ws://100.99.1.2/']) assert.ok(hit(u), u);
  for (const u of ['http://100.63.255.255/', 'http://100.128.0.1/', 'http://100.6.4.1/', 'http://1100.64.0.1/', 'http://100.64.0.1.evil.test/', 'http://[::2]/', 'http://[2001:db8::]/']) assert.equal(hit(u), false, u);
});
test('names of the home network: ending in .local, .lan, .internal, .home.arpa, and fritz.box; the whole host, nothing that only looks like it', () => {
  for (const u of ['http://printer.local/', 'http://nas.lan:5000/', 'https://db.corp.internal/x', 'http://router.home.arpa/', 'http://fritz.box/', 'http://www.fritz.box/login', 'ws://cam.local:81/s', 'http://PRINTER.LOCAL/', 'http://printer.local./']) assert.ok(name(u), u);
  for (const u of ['http://local/', 'http://lan/', 'http://example.com/printer.local', 'http://printer.local.evil.test/', 'http://notfritz.box/', 'http://fritz.box.evil.test/', 'http://evil.test/?x=http://nas.lan/', 'http://nas.lan@evil.test/',
    'http://localnews.com/', 'http://my.internal.example.com/', 'http://fritz.boxes/', 'http://x.localhost/']) assert.equal(name(u), false, u);
  const t = Date.now(); name('http://' + 'a.'.repeat(100000) + 'x'); assert.ok(Date.now() - t < 500, 'slow on a long name');
});
test('the rules: names are blocked for a page of another site; a name under localhost only when the asking page is not itself under localhost', () => {
  const rules = netRules({ local: true, self: 'abcdefghijklmnopabcdefghijklmnop' }), names = rules.find((r) => r.condition.regexFilter === LOCAL_NAMES), loc = rules.at(-1);
  assert.deepEqual([names.action.type, names.condition.domainType, names.condition.excludedInitiatorDomains], ['block', 'thirdParty', ['abcdefghijklmnopabcdefghijklmnop']]);
  assert.deepEqual(loc.condition.excludedInitiatorDomains, ['abcdefghijklmnopabcdefghijklmnop', 'localhost']);
  const re = new RegExp(loc.condition.regexFilter, 'i');
  for (const u of ['http://app.localhost/', 'http://a.b.localhost:3000/x']) assert.ok(re.test(u), u);
  for (const u of ['http://localhost/', 'http://app.localhost.evil.test/', 'http://notlocalhost/', 'http://evil.test/app.localhost']) assert.equal(re.test(u), false, u);
  assert.equal(new Set(rules.map((r) => r.id)).size, rules.length); assert.ok(rules.every((r) => r.id >= NET_BASE + 20 && r.id < NET_BASE + 80 && r.condition.regexFilter.length < 170));
});
test('said in the report: a name that leads to a device at home cannot be stopped', () => {
  const c = buildReport({ now: 1, groups: [] }, null).cannot.find((x) => /name that leads to/.test(x.what));
  assert.ok(c); assert.match(c.why, /^Tracker Cleaner cannot stop this: /);
});
