// J3 (third audit): only the shipped sign-in hosts, by exact name, hold everything.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { isGuardSignIn, holdNow, SIGNIN_HOSTS } = require('../extension/guard.js'), { NET_BASE } = require('../extension/net-rules.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ga = (domain, name = '_ga') => ({ url: `https://www.${domain}/`, domain: '.' + domain, name, value: 'GA1.2.3' });

test('the audit scenario: github.com/login, a youtube.com address with client_id and redirect_uri, google.com/signin and look-alikes do not hold everything', async () => {
  const urls = ['https://github.com/login', 'https://www.youtube.com/watch?client_id=a&redirect_uri=b', 'https://www.google.com/signin', 'https://sub.accounts.google.com/', 'https://accounts.google.com.evil.test/',
    'https://evil.test/accounts.google.com/login', 'https://login.live.com.evil.test/oauth', 'https://microsoft.com/login', 'https://www.apple.com/oauth/authorize'];
  for (const u of urls) { assert.equal(isGuardSignIn(u), false, u); assert.equal(holdNow({}, [{ id: 1, active: true, url: u }], 1).guard, false, u); }
  for (const h of SIGNIN_HOSTS) assert.equal(isGuardSignIn(`https://${h}/anything?x=1`), true, h);
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://shop.example/' }] })); await bg.alarm('sweep');
  for (const u of urls.slice(0, 3)) { await bg.navigate(1, u); await bg.settle();
    assert.equal(bg.state.storage.guardUntil > bg.now, false, u); assert.equal('excludedTabIds' in bg.state.rules.find((r) => r.id === NET_BASE).condition, false, u);
    await bg.setCookie(ga('shop.example')); assert.deepEqual(await bg.names(), [], u); }
});
test('the five minutes an hour of a site\'s own sign-in page cannot be had again by going there again, nor by filling the list with other sites', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://evil.example/' }] }));
  await bg.navigate(1, 'https://evil.example/login'); await bg.settle(); const began = bg.state.storage.sguard['evil.example'];
  for (let i = 0; i < 300; i++) { await bg.navigate(1, `https://s${i}.example/login`); await bg.navigate(1, 'https://evil.example/login?again=' + i); }
  await bg.settle();
  assert.equal(bg.state.storage.sguard['evil.example'], began, 'its hold began anew'); assert.ok(Object.keys(bg.state.storage.sguard).length <= 200);
  bg.now += 6 * 60e3; await bg.navigate(1, 'https://evil.example/login?later'); await bg.settle();
  await bg.setCookie(ga('evil.example', '_gid')); assert.equal((await bg.names()).includes('_gid'), false, 'held again within the hour');
});
