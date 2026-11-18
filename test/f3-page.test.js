// F3 (audit): the cookies of a company whose site the user opens as a page must survive every deleting path, not only the stop.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const req = async (bg, host, page) => { await bg.request({ url: `https://${host}/px.gif`, initiator: `https://www.${page}`, type: 'image' }); await bg.settle(); };
const three = async (bg) => { for (const p of ['news.example', 'shop.example', 'blog.example']) await req(bg, 'trk.example', p); };
const USER = { name: 'c_user', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };
const on = (o = {}) => ({ cookies: [USER], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });

test('opened as a page, then stopped: its cookie is still there after the next sweeps, and one set later is kept too', async () => {
  const bg = await load(on());
  await bg.opens('https://www.trk.example/home'); await bg.closeTab(bg.tabOf('https://www.trk.example/home')); await three(bg);
  assert.deepEqual(bg.state.storage.stopped, ['trk.example']);
  await bg.alarm('sweep'); await bg.alarm('sweep'); await bg.alarm('proxy');
  assert.deepEqual(await bg.names(), ['c_user']);
  await bg.setCookie({ url: 'https://www.trk.example/', domain: '.trk.example', name: 'xs', value: 'x-77ab12cd34ef', sameSite: 'no_restriction', secure: true }); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['c_user', 'xs']); assert.deepEqual(bg.called('cookies.remove'), []);
  assert.equal(bg.state.dynamic.some((r) => r.id === 100001 && r.condition.requestDomains.includes('trk.example')), true, 'it is still blocked on other sites');
});
test('never opened as a page: its cookies go when the user presses Remove (1.25, J1), and from then on whenever they come back', async () => {
  const bg = await load(on()); await three(bg);
  assert.deepEqual(await bg.names(), ['c_user']); await bg.send({ type: 'approve', group: 'unknown', site: 'trk.example', name: 'what it keeps to follow you' }); await bg.settle();
  assert.deepEqual(await bg.names(), []);
  await bg.setCookie({ url: 'https://trk.example/', domain: '.trk.example', name: 'uid2', value: 'x-77ab12cd34ef', sameSite: 'no_restriction', secure: true });
  assert.deepEqual(await bg.names(), []);
});
test('a tracker on the built-in list is judged as before, also when its site was opened as a page', async () => {
  const bg = await load(on({ cookies: [{ name: 'IDE', domain: '.doubleclick.net', value: 'x' }] }));
  await bg.opens('https://doubleclick.net/'); await bg.closeTab(bg.tabOf('https://doubleclick.net/')); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), []);
});
