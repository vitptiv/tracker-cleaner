// Batch K. K1: the user's own press on Remove clears the saved copies whatever the hourly budget says.
// K3: which site a request is counted for must not depend on the order in which Chrome's events arrive.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const UID = { name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };
const req = async (bg, url, page, o = {}) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script', ...o }); await bg.settle(); };
const clears = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].cache && c.args[0].since === 0).length;

test('K1: the block uses the hour\'s one clearing; Remove pressed a minute later clears the saved copies all the same; the budget still holds for what a page can cause', async () => {
  const bg = await load(on({ cookies: [UID, { ...UID, domain: '.trk2.example' }] }));
  await req(bg, 'https://trk.example/p.gif', 'news.example'); await req(bg, 'https://trk.example/p.gif', 'shop.example'); assert.equal(clears(bg), 1);
  bg.now += 60e3; await bg.send({ type: 'approve', group: 'unknown', site: 'trk.example', name: 'what it keeps to follow you' }); await bg.settle();
  assert.equal(clears(bg), 2, 'the press did not clear the saved copies');
  await req(bg, 'https://trk2.example/p.gif', 'news.example'); await req(bg, 'https://trk2.example/p.gif', 'shop.example');
  assert.deepEqual(bg.state.storage.stopped, ['trk.example', 'trk2.example']); assert.equal(clears(bg), 2, 'a second block within the hour cleared them again');
});
test('K1: not when the saved-copies row is switched off', async () => {
  const bg = await load(on({ cookies: [UID], storage: { modes: { C11: 'off' } } }));
  await req(bg, 'https://trk.example/p.gif', 'news.example'); await req(bg, 'https://trk.example/p.gif', 'shop.example');
  await bg.send({ type: 'approve', group: 'unknown', site: 'trk.example', name: 'what it keeps to follow you' }); await bg.settle();
  assert.equal(clears(bg), 0);
});
test('K3: a request of the page itself is counted for the page that asked, also when Chrome still reports the tab at its old address or at none', async () => {
  const bg = await load(on({ cookies: [UID], tabs: [{ id: 1, active: true, url: 'about:blank' }] }));
  await req(bg, 'https://trk.example/p.gif', 'news.example', { tabId: 1, frameId: 0 });   // the tab's address has not arrived yet
  assert.equal(bg.state.storage.follow['trk.example'].on.length, 1, 'not counted while the tab still said about:blank');
  await bg.navigate(1, 'https://www.news.example/');
  bg.state.tabs[0].url = 'https://www.news.example/';   // Chrome has not yet told of the next address
  await req(bg, 'https://trk.example/p.gif', 'shop.example', { tabId: 1, frameId: 0 });
  assert.deepEqual(bg.state.storage.stopped, ['trk.example'], 'the second site was counted as the first again');
});
test('K3: a site\'s own request is never taken for another company\'s because the tab was elsewhere a moment ago', async () => {
  const bg = await load(on({ cookies: [{ ...UID, domain: '.news.example' }], tabs: [{ id: 1, active: true, url: 'https://old.example/' }] }));
  await req(bg, 'https://cdn.news.example/a.js', 'news.example', { tabId: 1, frameId: 0 });
  assert.deepEqual(bg.state.storage.follow || {}, {});
});
test('K3: a frame\'s request is still counted for the site in the address bar, read from Chrome at that moment', async () => {
  const bg = await load(on({ cookies: [UID], tabs: [{ id: 1, active: true, url: 'https://www.news.example/' }] }));
  await bg.request({ url: 'https://trk.example/p.gif', initiator: 'https://frame.one.example', type: 'image', tabId: 1, frameId: 7 }); await bg.settle();
  bg.state.tabs[0].url = 'https://www.shop.example/';   // the tab moved on; no event has been seen yet
  await bg.request({ url: 'https://trk.example/p.gif', initiator: 'https://frame.two.example', type: 'image', tabId: 1, frameId: 9 }); await bg.settle();
  assert.deepEqual(bg.state.storage.stopped, ['trk.example']);
});
