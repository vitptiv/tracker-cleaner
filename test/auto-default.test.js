// S2: what follows you is cleaned without a question on a fresh install; what may keep you signed in is left alone.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { cap, mayRun } = require('../extension/registry.js'), { renderPopup } = require('../extension/popup-view.js');
const req = async (bg, host, page, path = '/px.gif') => { await bg.request({ url: `https://${host}${path}`, initiator: `https://www.${page}`, type: 'image' }); await bg.settle(); };
const three = async (bg, host = 'px.trk.example') => { for (const p of ['news.example', 'shop.example', 'blog.example']) await req(bg, host, p); };
const ID = { name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };
const fresh = async (o = {}) => { const bg = await load(o); await bg.chrome.runtime.onInstalled.fire({ reason: 'install' }); await bg.settle(); return bg; };
const rule = (bg) => bg.state.dynamic.find((r) => r.id === 100001);
const emptied = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].serviceWorkers).flatMap((c) => c.args[0].origins);

test('the groups that only touch what follows you run by themselves; Google identity cookies and your own lists still ask', () => {
  for (const id of ['C03', 'C11', 'C25', 'C27', 'C28']) assert.equal(cap(id).mode, 'auto', id);
  for (const id of ['C04', 'C06', 'C07', 'C09', 'C24']) assert.equal(cap(id).mode, 'ask', id);
  assert.equal(mayRun('C25', {}), 'ask', 'nothing stored: still nothing destructive');
});
test('a fresh install is switched on and says so once; an update changes nothing', async () => {
  const bg = await fresh();
  assert.equal(bg.state.storage.master, true); assert.equal((await bg.send({ type: 'state' })).firstRun, true);
  const html = renderPopup(await bg.send({ type: 'state' }), null);
  assert.match(html, /Tracker Cleaner is on\. By itself it now stops companies that follow you from site to site and deletes what they saved\. To turn it off, untick .On. above\./);
  await bg.send({ type: 'seen' });
  assert.equal((await bg.send({ type: 'state' })).firstRun, undefined);
  const old = await load({ storage: { cacheClearedAt: 5 } }); await old.chrome.runtime.onInstalled.fire({ reason: 'update' }); await old.settle();
  assert.equal(old.state.storage.master, undefined); assert.deepEqual(old.destructive(), []);
  const off = await load({ storage: { master: false } }); await off.chrome.runtime.onInstalled.fire({ reason: 'install' }); await off.settle();
  assert.equal(off.state.storage.master, false);
});
test('fresh install: a tracker cookie goes, a Google identity cookie waits for an answer, sign-in cookies stay', async () => {
  const bg = await fresh({ cookies: [{ name: '_ga', domain: '.example.com', value: 'GA1.2.3' }, { name: 'NID', domain: '.google.com', value: 'n' }, { name: 'SID', domain: '.google.com', value: 's' }] });
  assert.deepEqual(await bg.names(), ['NID', 'SID']);
  assert.deepEqual(bg.state.storage.pending.google.items.map((i) => i.name), ['NID']);
});
test('fresh install: a company seen on three sites is stopped at once; what it saved on its own site and its saved copies go too', async () => {
  const bg = await fresh({ cookies: [ID] });
  await three(bg);
  assert.deepEqual(rule(bg).condition.requestDomains, ['trk.example']); assert.deepEqual(await bg.names(), []);
  assert.ok(emptied(bg).includes('https://trk.example') && emptied(bg).includes('https://px.trk.example'), 'its own storage was not emptied');
  assert.ok(bg.called('browsingData.remove').some((c) => c.args[1].cache && c.args[0].since === 0), 'the saved copies were not cleared after the stop');
  assert.equal(bg.called('contentSettings.set').filter((c) => c.args[0].primaryPattern.includes('trk.example')).length, 1);
  assert.deepEqual(((bg.state.storage.pending || {}).unknown || { items: [] }).items, []);
});
test('a company whose own site you open as a page is blocked on other sites, but its cookies and what it saved stay: you may be signed in there', async () => {
  const bg = await fresh({ cookies: [ID] });
  await bg.visit('https://www.trk.example/home'); await three(bg);
  assert.deepEqual(rule(bg).condition.requestDomains, ['trk.example']);
  assert.deepEqual(await bg.names(), ['uid']); assert.equal(emptied(bg).some((o) => o.includes('trk.example')), false);
  assert.equal(/trk\.example\/home/.test(JSON.stringify(bg.state.storage)), false, 'the address of a visited page is stored');
});
test('a site that passes you along is cleaned by itself, but not one you also open as a page', async () => {
  const hop = { url: 'https://go.hop.example/r?to=https%3A%2F%2Fblog.example%2Fpost', redirectUrl: 'https://blog.example/post?hid=h-77ab12cd34ef', type: 'main_frame' };
  const cookies = [{ name: 'hop_id', domain: '.hop.example', value: 'h-77ab12cd34ef' }];
  let bg = await fresh({ cookies, tabs: [{ id: 1, active: true, url: 'https://social.example/feed' }] });
  await bg.redirect(hop); await bg.settle();
  assert.deepEqual(await bg.names(), []); assert.deepEqual(bg.state.storage.params, ['hid']);
  bg = await fresh({ cookies, tabs: [{ id: 1, active: true, url: 'https://social.example/feed' }] });
  await bg.visit('https://hop.example/account'); await bg.redirect(hop); await bg.settle();
  assert.deepEqual(await bg.names(), ['hop_id']); assert.deepEqual(bg.state.storage.params, ['hid']);
});
test('fresh install, a sign-in page in front: nothing is deleted or stopped', async () => {
  const bg = await fresh({ cookies: [ID, { name: '_ga', domain: '.example.com', value: 'GA1.2.3' }], tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/signin' }] });
  await three(bg);
  assert.deepEqual(bg.destructive(), []); assert.equal(rule(bg), undefined);
});
test("when a tracker's cookie is deleted, the saved copies of that site go too, at most once an hour per site", async () => {
  const bg = await fresh();
  const copies = () => bg.called('browsingData.remove').filter((c) => c.args[1].cache && c.args[0].origins).map((c) => c.args[0].origins.join());
  await bg.setCookie({ url: 'https://www.example.com/', domain: '.example.com', name: '_ga', value: 'GA1.2.3' });
  await bg.setCookie({ url: 'https://www.example.com/', domain: '.example.com', name: '_ga', value: 'GA1.2.4' });
  assert.deepEqual(copies(), ['https://example.com,http://example.com']);
  bg.now += 61 * 60e3; await bg.setCookie({ url: 'https://www.example.com/', domain: '.example.com', name: '_ga', value: 'GA1.2.5' });
  assert.equal(copies().length, 2);
});
