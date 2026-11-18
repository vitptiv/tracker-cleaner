// L11 (fourth audit): more names and forms of this computer and the home network.
const test = require('node:test'), assert = require('node:assert');
const { LOCAL_ALL, NET_TYPES, netRules } = require('../extension/net-rules.js');
const hit = (u) => LOCAL_ALL.some((x) => new RegExp(x, 'i').test(u));

test('the audit\'s misses: localhost.localdomain, router.asus.com, tplinkwifi.net, o2.box, pi.hole, *.intranet, and a private address wrapped the 6to4 and NAT64 ways', () => {
  for (const u of ['http://localhost.localdomain/', 'http://router.asus.com/', 'http://tplinkwifi.net/', 'http://o2.box/', 'http://www.o2.box/', 'http://pi.hole/admin', 'http://wiki.intranet/', 'http://a.b.intranet:8080/',
    'http://[2002:7f00:1::]/', 'http://[2002:c0a8:101::1]/', 'http://[2002:a00:1::]/', 'http://[64:ff9b::7f00:1]/', 'http://[64:ff9b::c0a8:101]/', 'http://[64:ff9b::a9fe:a9fe]/']) assert.ok(hit(u), u);
  for (const u of ['http://asus.com/', 'http://www.asus.com/', 'http://router.asus.com.evil.test/', 'http://nottplinkwifi.net/', 'http://x.tplinkwifi.net.evil.test/', 'http://intranet.example.com/', 'http://o2.boxes/', 'http://api.hole/',
    'http://[2002:808:808::]/', 'http://[64:ff9b::808:808]/', 'http://[2002:b00:1::]/', 'http://evil.test/pi.hole']) assert.equal(hit(u), false, u);
  for (const x of LOCAL_ALL) assert.ok(x.length < 170, x);
});
test('WebTransport connections are covered like every other kind of request', () => {
  assert.ok(NET_TYPES.includes('webtransport'));
  assert.ok(netRules({ local: true }).filter((r) => !r.condition.resourceTypes.includes('main_frame')).every((r) => r.condition.resourceTypes.includes('webtransport')));
  assert.ok(netRules({ cookies: true })[0].condition.resourceTypes.includes('webtransport'));
});
