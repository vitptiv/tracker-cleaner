// J6 (third audit): limits.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').pressing;
const { followNote, FOLLOW_MAX } = require('../extension/learn.js'), { renderPopup } = require('../extension/popup-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const req = async (bg, url, page) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script' }); await bg.settle(); };
const cookie = (domain) => ({ name: 'uid', domain, value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' });
const clears = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].cache && c.args[0].since === 0).length;

test('junk never pushes out a candidate with more evidence, however much newer it is', () => {
  let s = {};
  for (const [site, ck, sent, pages] of [['two.example', false, false, ['a', 'b']], ['ck.example', true, false, ['a']], ['sent.example', true, true, ['a']]]) for (const p of pages) s = followNote(s, site, site, p, ck, 1, sent);
  for (let i = 0; i < 3 * FOLLOW_MAX; i++) s = followNote(s, `junk${i}.example`, `junk${i}.example`, 'a', false, 1000 + i);
  assert.equal(Object.keys(s).length, FOLLOW_MAX); for (const k of ['two.example', 'ck.example', 'sent.example']) assert.ok(s[k], k);
});
test('at 300 blocked companies learning goes on: the oldest block is dropped for the new one, with what was kept about it', async () => {
  const stopped = Array.from({ length: 300 }, (_, i) => `old${i}.example`);
  const bg = await load(on({ cookies: [cookie('.trk.example')], storage: { stopped, hard: ['old0.example', 'old1.example'], own: { 'old0.example': { ok: true, at: 1, mute: true } } } }));
  await req(bg, 'https://trk.example/p.gif', 'news.example'); await req(bg, 'https://trk.example/p.gif', 'shop.example'); await bg.alarm('sweep');
  const s = bg.state.storage.stopped; assert.equal(s.length, 300); assert.ok(s.includes('trk.example')); assert.equal(s.includes('old0.example'), false); assert.ok(s.includes('old1.example'));
  assert.deepEqual(bg.state.storage.hard, ['old1.example']); assert.equal('old0.example' in bg.state.storage.own, false);
  assert.ok(renderPopup(await bg.send({ type: 'state' }), null).includes('300 companies are blocked, the most Tracker Cleaner keeps: when a new one is blocked, the one blocked longest ago is let through again.'));
});
test('ten blocks in a row clear all saved copies once, not ten times: every clearing a page can cause shares one hour; the daily one and your own presses (Remove, Clean now) do not count (K1)', async () => {
  const hosts = Array.from({ length: 10 }, (_, i) => `trk${i}.example`);
  const bg = await load(on({ cookies: hosts.map((h) => cookie('.' + h)) }));
  for (const h of hosts) { await req(bg, `https://${h}/p.gif`, 'news.example'); await req(bg, `https://${h}/p.gif`, 'shop.example'); }
  assert.equal(bg.state.storage.stopped.length, 10); assert.equal(clears(bg), 1);
  for (const h of hosts) { await bg.send({ type: 'approve', group: 'unknown', site: h, name: 'what it keeps to follow you' }); await bg.settle(); }
  assert.equal(clears(bg), 11, 'one for the blocks, one for each press on Remove');
  bg.now += 61 * 60e3; await req(bg, 'https://late.example/p.gif', 'news.example'); await bg.setCookie({ url: 'https://late.example/', name: 'uid', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction', secure: true }); await req(bg, 'https://late.example/p.gif', 'shop.example');
  assert.equal(clears(bg), 12);
  await bg.send({ type: 'drop', kind: 'servers' }); assert.equal(clears(bg), 13, '"Clean now" is your own press: not counted against the hour');
});
test('a page reached by a number instead of a name is not put on the list of sites you use, and cannot push a real one out', async () => {
  const bg = await load(on()); await bg.opens('https://real.example/');
  for (const u of ['http://192.168.1.1/', 'http://127.0.0.1:8080/x', 'http://[::1]/', 'http://10.0.0.7/']) await bg.opens(u);
  assert.equal(bg.state.storage.mine.length, 1);
});
