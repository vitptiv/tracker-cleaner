// L2 (fourth audit): Remove is one-off and says so; keeping on removing is a separate switch per host, off by default.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').pressing;
const { buildReport, renderReport } = require('../extension/report-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const req = async (bg, url, page) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script' }); await bg.settle(); };
const UID = { name: 'uid', domain: 'trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };
const blockIt = async (bg) => { await req(bg, 'https://trk.example/a.js', 'news.example'); await req(bg, 'https://trk.example/a.js', 'shop.example'); };
const REMOVE = { type: 'approve', group: 'unknown', site: 'trk.example', name: 'what it keeps to follow you' };
const again = { url: 'https://trk.example/', name: 'uid2', value: 'u-77ab12cd34ef', sameSite: 'no_restriction', secure: true };
const noti = (bg) => bg.called('contentSettings.set').filter((c) => c.args[0].primaryPattern.includes('trk.example')).map((c) => c.args[0].setting);

test('the question says it is once; Remove removes what is there now and nothing later: a cookie set afterwards stays, nothing is emptied daily, no notification block', async () => {
  const bg = await load(on({ cookies: [UID] })); await blockIt(bg);
  assert.ok(renderReport(buildReport(await bg.send({ type: 'state' }), null)).includes('trk.example is blocked on other sites. Also remove what it has saved here? This removes what is there now, once; nothing later.'));
  await bg.send(REMOVE); await bg.settle(); assert.deepEqual(await bg.names(), []); assert.deepEqual(bg.state.storage.hard || [], []);
  const emptied = bg.called('browsingData.remove').filter((c) => (c.args[0].origins || []).includes('https://trk.example')).length; assert.ok(emptied >= 1);
  await bg.setCookie(again); for (let i = 0; i < 100; i++) { bg.now += 15 * 60e3; await bg.alarm('sweep'); }
  assert.deepEqual(await bg.names(), ['uid2']); assert.deepEqual(noti(bg), []);
  assert.equal(bg.called('browsingData.remove').filter((c) => (c.args[0].origins || []).includes('https://trk.example')).length, emptied, 'emptied again later');
  assert.deepEqual(((bg.state.storage.pending || {}).unknown || { items: [] }).items, [], 'asked again');
});
test('the switch "Keep removing what X saves": off by default, per blocked host; on: its cookies go when they come back, its storage daily, its notifications are blocked; off again: all of that ends', async () => {
  const bg = await load(on({ cookies: [UID] })); await blockIt(bg);
  const html = renderReport(buildReport(await bg.send({ type: 'state' }), null));
  assert.match(html, /<label><input type="checkbox" data-msg="[^"]*keepRemoving[^"]*trk\.example[^"]*"> Keep removing what trk\.example saves<\/label>/);
  assert.deepEqual(await bg.send({ type: 'keepRemoving', site: 'trk.example', on: true }), { ok: true }); await bg.settle(); await bg.alarm('sweep');
  assert.deepEqual(bg.state.storage.hard, ['trk.example']); assert.deepEqual(await bg.names(), []); assert.deepEqual(noti(bg), ['block']);
  await bg.setCookie(again); assert.deepEqual(await bg.names(), []);
  assert.match(renderReport(buildReport(await bg.send({ type: 'state' }), null)), /keepRemoving[^>]*checked> Keep removing what trk\.example saves/);
  await bg.send({ type: 'keepRemoving', site: 'trk.example', on: false }); await bg.settle();
  assert.deepEqual(bg.state.storage.hard, []); assert.deepEqual(noti(bg), ['block', 'ask']); await bg.setCookie(again); assert.deepEqual(await bg.names(), ['uid2']);
});
test('never offered, and refused, for a host whose site the user opens as a page, for a host that is not blocked, and for anything that is not a host name', async () => {
  const bg = await load(on({ cookies: [UID] })); await bg.opens('https://trk.example/home'); await bg.closeTab(bg.tabOf('https://trk.example/home')); await blockIt(bg);
  assert.equal(renderReport(buildReport(await bg.send({ type: 'state' }), null)).includes('Keep removing what trk.example saves'), false);
  for (const site of ['trk.example', 'other.example', '<b>', undefined]) assert.deepEqual(await bg.send({ type: 'keepRemoving', site, on: true }), { ok: false }, String(site));
  assert.deepEqual(bg.state.storage.hard || [], []);
});
