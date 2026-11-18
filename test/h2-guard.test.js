// H2 (second audit): a page must not be able to switch the sign-in pause on for everything by its own address.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { NET_BASE } = require('../extension/net-rules.js'), { GUARD_MS, isGuardSignIn, holdNow } = require('../extension/guard.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ga = (domain) => ({ url: `https://www.${domain}/`, domain: '.' + domain, name: '_ga', value: 'GA1.2.3' });
const header = (bg) => bg.state.rules.find((r) => r.id === NET_BASE);
const MIN = 60e3;

test('which hosts may hold everything: the shipped sign-in hosts, by exact name (1.25, J3)', () => {
  for (const h of ['accounts.google.com', 'login.live.com', 'appleid.apple.com', 'login.microsoftonline.com', 'accounts.youtube.com']) assert.equal(isGuardSignIn(`https://${h}/x`), true, h);
  for (const h of ['evil.example', 'accounts.google.com.evil.example', 'github.com', 'www.google.com', 'shop.example']) assert.equal(isGuardSignIn(`https://${h}/login`), false, h);
  assert.equal(holdNow({}, [{ id: 1, active: true, url: 'https://evil.example/login' }], 1).guard, false);
  assert.equal(holdNow({}, [{ id: 1, active: true, url: 'https://accounts.google.com/signin' }], 1).guard, true);
});
test('the audit scenario: a page that goes to its own /login every 4 minutes holds nothing but its own site, and that for 5 minutes in an hour', async () => {
  const bg = await load(on({ storage: { modes: { C32: 'auto' } }, tabs: [{ id: 1, active: true, url: 'https://evil.example/' }, { id: 2, url: 'https://shop.example/' }] })); await bg.alarm('sweep');
  let heldOwn = 0;
  for (let i = 0; i < 15; i++) { await bg.navigate(1, `https://evil.example/login?n=${i}`); await bg.settle();
    assert.equal(bg.state.storage.guardUntil > bg.now, false, 'the pause for everything was switched on'); assert.equal((await bg.send({ type: 'state' })).hold.guard, false);
    assert.equal('excludedTabIds' in header(bg).condition, false, 'the header rules skip its tab'); assert.ok(bg.state.scripts.some((x) => x.id === 'shield'), 'the page shield went off');
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
// (1.25, L4: a test of the old hold on everything stood here; what a sign-in holds now is in l4-hold.test.js)
