// L10 (fourth audit): what the settings program on this computer sends is shown as text only and checked before use.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { cleanLimits } = require('../extension/registry.js'), { renderBaddies } = require('../extension/popup-audit.js');
const EVIL = '<button data-msg=\'{"type":"setMaster","on":false}\'>Free prize</button>';

test('the audit scenario: numbers that are really page code are never put into the popup as code', () => {
  const html = renderBaddies({ cookies: [], suspicious: EVIL, total: EVIL, t: 1, servers: { count: EVIL, hosts: [], tracking: [] }, recentlyRemoved: [{ site: 'a.example', name: 'x', count: EVIL }] });
  assert.equal(html.includes('<button data-msg'), false); assert.equal(html.includes('Free prize'), false);
  assert.ok(html.includes('0 of 0 look suspicious')); assert.ok(html.includes('0 servers')); assert.ok(html.includes('removed 0×'));
  assert.ok(renderBaddies({ cookies: [], suspicious: 3, total: '12', t: 1 }).includes('3 of 12 look suspicious'));
});
test('the limits file is checked: no wildcard site, no switching off of JavaScript and the like, sizes bounded, only the known fields', () => {
  const l = cleanLimits({ enabled: false, cookieClean: 'no', chromeTabs: 5, preferSites: ['a.example', 7, '<x>'], cookieMode: 'allowlist', evil: 'x',
    cookieBlacklist: [{ h: '*', n: 'SID' }, { h: 'shop.example', n: 'cart' }, { h: 'a b', n: 'x' }, { h: 'ok.example' }, 'junk', { h: 'x.example', n: 'n'.repeat(500) }],
    storageBlacklist: ['shop.example', '*', 'https://x', 5, 'ok.example:8443'],
    permissionBlacklist: [{ site: 'https://shop.example', perm: 'notifications' }, { site: 'https://shop.example', perm: 'javascript' }, { site: '*', perm: 'camera' }, { site: 'https://*.example', perm: 'camera' }, { site: 'https://a.example', perm: 'cookies' }],
    cookieAllow: [{ site: 'music.example', names: ['sid', '*'] }, { site: '*', names: ['*'] }, { site: 'x.example', names: 'all' }] });
  assert.deepEqual(l, { enabled: false, cookieClean: true, chromeTabs: 5, preferSites: ['a.example'], cookieMode: 'allowlist', cookieBlacklist: [{ h: 'shop.example', n: 'cart' }],
    storageBlacklist: ['shop.example', 'ok.example:8443'], permissionBlacklist: [{ site: 'https://shop.example', perm: 'notifications' }], cookieAllow: [{ site: 'music.example', names: ['sid', '*'] }] });
  assert.equal(cleanLimits({ cookieBlacklist: Array.from({ length: 5000 }, (_, i) => ({ h: `s${i}.example`, n: 'x' })) }).cookieBlacklist.length, 500);
  assert.equal(cleanLimits({ chromeTabs: 1e9 }).chromeTabs, 0); assert.equal(cleanLimits({ chromeTabs: -3 }).chromeTabs, 0);
  for (const bad of [null, 'x', 7, []]) assert.deepEqual(cleanLimits(bad), null);
});
test('in use: a wildcard always-delete entry and a JavaScript block from the file change nothing', async () => {
  const limits = { cookieBlacklist: [{ h: '*', n: 'SID' }, { h: 'shop.example', n: 'cart' }], permissionBlacklist: [{ site: 'https://shop.example', perm: 'javascript' }] };
  const bg = await load({ limits, cookies: [{ name: 'SID', domain: '.google.com', value: 's' }, { name: 'cart', domain: 'shop.example', value: 'c' }], storage: { master: true, cacheClearedAt: 1.8e12, modes: { C15: 'auto', C07: 'auto', C09: 'auto' } } });
  await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['SID']); assert.equal(bg.called('contentSettings.set').some((c) => /shop\.example/.test(c.args[0].primaryPattern)), false);
});
