// R3: the sign-in guard ends five minutes after the last sign-in page, and what it held is done then, not at the next
// quarter-hour sweep. (Found with the lab: the guard itself was right, the held work waited for the sweep.)
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const MIN = 60e3;
const start = async () => { const bg = await load({ storage: { master: true }, tabs: [{ id: 1, active: true, url: 'https://example.com/' }] });
  await bg.navigate(1, 'https://login.microsoftonline.com/common/oauth2/authorize?client_id=a&redirect_uri=b'); await bg.navigate(1, 'https://example.com/app'); await bg.settle(); return bg; };

test('a sign-in sets a wake-up for the moment the guard ends; what was held is done at that wake-up', async () => {
  const bg = await start();
  assert.deepEqual(bg.state.alarms.unguard, { when: bg.now + 5 * MIN + 1000 });
  await bg.setCookie({ url: 'https://ad.doubleclick.net/', name: 'x' }); assert.deepEqual(await bg.names(), ['x']);
  bg.now += 5 * MIN + 1000; await bg.alarm('unguard');
  assert.deepEqual(await bg.names(), []); assert.equal((await bg.send({ type: 'state' })).hold.guard, false);
});
test('a further sign-in step moves the wake-up; one that comes too early changes nothing', async () => {
  const bg = await start();
  await bg.setCookie({ url: 'https://ad.doubleclick.net/', name: 'x' });
  bg.now += 3 * MIN; await bg.navigate(1, 'https://github.com/login'); await bg.navigate(1, 'https://example.com/app'); await bg.settle();
  assert.deepEqual(bg.state.alarms.unguard, { when: bg.now + 5 * MIN + 1000 });
  bg.now += 2 * MIN; await bg.alarm('unguard'); assert.deepEqual(await bg.names(), ['x']);
  bg.now += 3 * MIN + 1000; await bg.alarm('unguard'); assert.deepEqual(await bg.names(), []);
});
test('the sign-in page still in front when the wake-up comes: the guard goes on and wakes up again later', async () => {
  const bg = await load({ storage: { master: true }, tabs: [{ id: 1, active: true, url: 'https://example.com/' }] });
  await bg.navigate(1, 'https://accounts.google.com/'); await bg.settle();
  await bg.setCookie({ url: 'https://ad.doubleclick.net/', name: 'x' });
  bg.now += 5 * MIN + 1000; await bg.alarm('unguard');
  assert.deepEqual(await bg.names(), ['x']); assert.deepEqual(bg.state.alarms.unguard, { when: bg.now + 5 * MIN + 1000 });
});
