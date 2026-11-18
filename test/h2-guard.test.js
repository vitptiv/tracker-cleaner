// H2 (second audit): a page must not be able to switch the sign-in pause on for everything by its own address.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { NET_BASE } = require('../extension/net-rules.js'), { GUARD_MS, isGuardHost, holdNow } = require('../extension/guard.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ga = (domain) => ({ url: `https://www.${domain}/`, domain: '.' + domain, name: '_ga', value: 'GA1.2.3' });
const header = (bg) => bg.state.rules.find((r) => r.id === NET_BASE);
const MIN = 60e3;

test('which hosts may hold everything: the shipped sign-in hosts and the big families, by whole name', () => {
  for (const h of ['accounts.google.com', 'login.live.com', 'appleid.apple.com', 'github.com', 'www.google.com', 'login.microsoftonline.com']) assert.equal(isGuardHost(h), true, h);
  for (const h of ['evil.example', 'accounts.google.com.evil.example', 'notgithub.com', 'google.com.evil.test', 'shop.example']) assert.equal(isGuardHost(h), false, h);
  assert.equal(holdNow({}, [{ id: 1, active: true, url: 'https://evil.example/login' }], 1).guard, false);
  assert.equal(holdNow({}, [{ id: 1, active: true, url: 'https://accounts.google.com/signin' }], 1).guard, true);
});
test('the audit scenario: a page that goes to its own /login every 4 minutes holds nothing but its own site, and that for 5 minutes in an hour', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://evil.example/' }, { id: 2, url: 'https://shop.example/' }] })); await bg.alarm('sweep');
  let heldOwn = 0;
  for (let i = 0; i < 15; i++) { await bg.navigate(1, `https://evil.example/login?n=${i}`); await bg.settle();
    assert.equal(bg.state.storage.guardUntil > bg.now, false, 'the pause for everything was switched on'); assert.equal((await bg.send({ type: 'state' })).hold.guard, false);
    assert.equal('excludedTabIds' in header(bg).condition, false, 'the header rules skip its tab'); assert.equal(bg.state.storage.shield.off, false, 'the page shield went off');
    await bg.setCookie(ga('shop.example')); assert.equal((await bg.names()).includes('_ga'), false, `another site's tracker cookie was kept (minute ${i * 4})`);
    await bg.setCookie({ ...ga('evil.example'), name: '_gid' }); if ((await bg.names()).includes('_gid')) heldOwn++;
    await bg.chrome.cookies.remove({ url: 'https://www.evil.example/', name: '_gid' }); bg.now += 4 * MIN; await bg.alarm('sweep'); }
  assert.ok(heldOwn >= 1 && heldOwn <= 2, `its own site was held ${heldOwn} times in the hour`);
});
test('a sign-in page of any site holds deleting for that site only, and it is done when the five minutes are over', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://shop.example/' }] }));
  await bg.navigate(1, 'https://shop.example/login'); await bg.settle();
  await bg.setCookie(ga('shop.example')); await bg.setCookie({ ...ga('other.example'), name: '_gid' });
  assert.deepEqual(await bg.names(), ['_ga']);
  assert.deepEqual(bg.state.storage.pending.cookies.items.map((i) => [i.site, i.name]), [['shop.example', '_ga']]);
  await bg.navigate(1, 'https://shop.example/account'); bg.now += GUARD_MS + 2000; await bg.alarm('unguard');
  assert.deepEqual(await bg.names(), []);
});
test('a shipped sign-in host still holds everything; the tab that opened it is skipped by the header rules only when it is the same site', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://shop.example/' }, { id: 3, url: 'https://accounts.google.com/x' }] })); await bg.alarm('sweep');
  await bg.openTab({ id: 2, active: false, openerTabId: 1, url: 'https://accounts.google.com/o/oauth2/auth?client_id=a&redirect_uri=b' }); await bg.settle();
  assert.ok(bg.state.storage.guardUntil > bg.now); assert.deepEqual(header(bg).condition.excludedTabIds, [2, 3]);
  await bg.setCookie(ga('shop.example')); assert.deepEqual(await bg.names(), ['_ga'], 'not held');
  await bg.openTab({ id: 4, active: false, openerTabId: 3, url: 'https://accounts.google.com/signin/v2' }); await bg.settle();
  assert.deepEqual(header(bg).condition.excludedTabIds, [2, 3, 4]);
});
