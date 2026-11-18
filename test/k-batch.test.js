// Batch K. K1: the user's own press on Remove clears the saved copies whatever the hourly budget says.
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
