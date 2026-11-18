// L4 (fourth audit): the sign-in hold. A bounce through the real sign-in host armed a hold on everything for an hour.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { NET_BASE } = require('../extension/net-rules.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ga = (domain, name = '_ga') => ({ url: `https://www.${domain}/`, domain: '.' + domain, name, value: 'GA1.2.3' });
const stay = async (bg) => { for (const t of bg.timers.splice(0)) t(); await bg.settle(); };   // the three seconds pass
const header = (bg) => bg.state.rules.find((r) => r.id === NET_BASE);
const NID = { url: 'https://www.google.com/', domain: '.google.com', name: 'NID', value: 'n-1' };

test('the audit scenario: a page bounces the tab through accounts.google.com and back, again and again: nothing is held, for nobody', async () => {
  const bg = await load(on({ storage: { modes: { C04: 'auto' } }, tabs: [{ id: 1, active: true, url: 'https://evil.example/' }] })); await bg.alarm('sweep');
  for (let i = 0; i < 20; i++) { await bg.navigate(1, 'https://accounts.google.com/o/oauth2/auth?client_id=x'); await bg.navigate(1, 'https://evil.example/back'); await stay(bg);
    await bg.setCookie(ga('shop.example')); await bg.setCookie(ga('evil.example', '_gid')); await bg.setCookie(NID);
    assert.deepEqual(await bg.names(), [], `round ${i}`); assert.equal('excludedTabIds' in header(bg).condition, false); bg.now += 3 * 60e3; }
  assert.equal((await bg.send({ type: 'state' })).hold.guard, false);
});
test('three seconds on the sign-in host: that sign-in family\'s cookies and the site the tab came from are held for five minutes; every other site is cleaned as always', async () => {
  const bg = await load(on({ storage: { modes: { C04: 'auto' } }, tabs: [{ id: 1, active: true, url: 'https://shop.example/' }] })); await bg.alarm('sweep');
  await bg.navigate(1, 'https://shop.example/cart'); await bg.navigate(1, 'https://accounts.google.com/signin'); await stay(bg);
  await bg.setCookie(NID); await bg.setCookie({ ...NID, url: 'https://www.youtube.com/', domain: '.youtube.com', name: 'YSC' }); await bg.setCookie(ga('shop.example')); await bg.setCookie(ga('other.example', '_gid'));
  assert.deepEqual((await bg.names()).sort(), ['NID', 'YSC', '_ga']);
  assert.deepEqual(header(bg).condition.excludedTabIds, [1], 'the tab on the sign-in host is not skipped by the header rules');
  await bg.navigate(1, 'https://shop.example/account'); await bg.settle();
  assert.equal('excludedTabIds' in header(bg).condition, false, 'still skipped after the tab left the sign-in host');
  assert.deepEqual((await bg.names()).sort(), ['NID', 'YSC', '_ga'], 'the five minutes ended when the tab left');
  bg.now += 5 * 60e3 + 2000; await bg.alarm('unguard'); assert.deepEqual(await bg.names(), []);
});
test('at most ten minutes in an hour, however often a sign-in page is really stayed on', async () => {
  const bg = await load(on({ storage: { modes: { C04: 'auto' } }, tabs: [{ id: 1, active: true, url: 'https://shop.example/' }] }));
  let held = 0;
  for (let i = 0; i < 12; i++) { await bg.navigate(1, 'https://accounts.google.com/signin?' + i); await stay(bg); await bg.navigate(1, 'https://shop.example/'); await bg.settle();
    await bg.setCookie(NID); if ((await bg.names()).includes('NID')) held++; await bg.chrome.cookies.remove({ url: 'https://www.google.com/', name: 'NID' }); bg.now += 5 * 60e3; await bg.alarm('sweep'); }
  assert.ok(held >= 1 && held <= 2, `held in ${held} of 12 five-minute windows`);
});
test('sign-in cookies are never deleted, hold or no hold; and tenants\' /login pages cannot use up the room for real sign-in hosts', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://shop.example/' }], cookies: [{ name: 'SID', domain: '.google.com', value: 's' }, { name: '__Secure-1PSID', domain: '.google.com', value: 's' }] }));
  for (let i = 0; i < 300; i++) await bg.navigate(1, `https://t${i}.pages.dev/login`);
  await bg.settle(); await bg.navigate(1, 'https://accounts.google.com/signin'); await stay(bg);
  await bg.setCookie({ ...NID, name: '1P_JAR' }); bg.now += 60e3; await bg.alarm('sweep');
  assert.deepEqual((await bg.names()).sort(), ['1P_JAR', 'SID', '__Secure-1PSID']);
});
