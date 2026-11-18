// F5 (audit): the list of sites the user opens as pages (`mine`), and sign-ins that are older than that list.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const req = async (bg, host, page) => { await bg.request({ url: `https://${host}/px.gif`, initiator: `https://www.${page}`, type: 'image' }); await bg.settle(); };
const three = async (bg) => { for (const p of ['news.example', 'shop.example', 'blog.example']) await req(bg, 'px.trk.example', p); };
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const c = (name, o = {}) => ({ name, domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction', ...o });

test('a site opened again moves to the fresh end of the list; the list holds at most 2000', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/'); const [a, b] = bg.state.storage.mine;
  await bg.opens('https://a.example/again');
  assert.deepEqual(bg.state.storage.mine, [b, a]);
  const full = await load(on({ storage: { mine: Array.from({ length: 2000 }, (_, i) => 'm' + i) } })); await full.opens('https://a.example/');
  assert.equal(full.state.storage.mine.length, 2000); assert.equal(full.state.storage.mine.includes('m0'), false); assert.equal(full.state.storage.mine.includes('m1'), true);
});
test('each install hashes with its own random salt, and no site name or address is stored', async () => {
  const one = await load(on()), two = await load(on());
  await one.opens('https://a.example/x?y=1'); await two.opens('https://a.example/x?y=1');
  assert.match(one.state.storage.salt, /^[0-9a-f]{32}$/); assert.notEqual(one.state.storage.salt, two.state.storage.salt);
  assert.notDeepEqual(one.state.storage.mine, two.state.storage.mine);
  assert.equal(JSON.stringify(one.state.storage).includes('a.example'), false);
});
test('"Clear history" also empties the list of sites opened as pages', async () => {
  const bg = await load(on()); await bg.opens('https://a.example/');
  assert.equal(bg.state.storage.mine.length, 1);
  await bg.send({ type: 'clearHistory' }); assert.equal('mine' in bg.state.storage, false);
});
test('a page that passes the browser on to another site within 3 seconds is not counted as opened', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://trk.example/interstitial' }] }));
  await bg.visit('https://trk.example/interstitial', 1); await bg.settle();
  await bg.navigate(1, 'https://blog.example/post');   // within the 3 seconds
  for (const t of bg.timers.splice(0)) t(); await bg.settle();
  assert.deepEqual(bg.state.storage.mine || [], []);
  const closed = await load(on({ tabs: [{ id: 1, active: true, url: 'https://trk.example/' }] }));
  await closed.visit('https://trk.example/', 1); await closed.closeTab(1); for (const t of closed.timers.splice(0)) t(); await closed.settle();
  assert.deepEqual(closed.state.storage.mine || [], []);
});
test('a stop without a question never deletes a cookie that looks like a sign-in (HttpOnly and Secure, or a sign-in name), at the stop or later', async () => {
  const bg = await load(on({ cookies: [c('uid'), c('sess', { httpOnly: true, secure: true }), c('SID'), c('half', { httpOnly: true, secure: false })] }));
  await three(bg);
  assert.deepEqual(bg.state.storage.stopped, ['trk.example']); assert.deepEqual(await bg.names(), ['sess', 'SID']);
  await bg.alarm('sweep'); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['sess', 'SID']);
});
test('the same holds when a passing site is cleaned by itself', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://social.example/feed' }], cookies: [{ name: 'hop_id', domain: '.hop.example', value: 'h-77ab12cd34ef' }, { name: 'sess', domain: '.hop.example', value: 's-77ab12cd34ef', httpOnly: true, secure: true }] }));
  await bg.redirect({ url: 'https://go.hop.example/r?to=https%3A%2F%2Fblog.example%2Fpost', redirectUrl: 'https://blog.example/post', type: 'main_frame' }); await bg.settle();
  assert.deepEqual(await bg.names(), ['sess']);
});
