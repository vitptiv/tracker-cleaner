// H9 (second audit): questions and limits.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { bounceAdded, followNote, FOLLOW_MAX } = require('../extension/learn.js'), { renderPopup } = require('../extension/popup-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const enc = encodeURIComponent, ID = 'h-77ab12cd34ef';
const req = async (bg, url, page) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script' }); await bg.settle(); };

test('the group button never answers a "cut this off addresses" question; its own button does', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://social.example/feed' }] }));
  await bg.redirect({ url: `https://hop.example/r?to=${enc('https://blog.example/post')}`, redirectUrl: `https://blog.example/post?hid=${ID}`, type: 'main_frame' }); await bg.settle();
  const waiting = () => ((bg.state.storage.pending || {}).bounce || { items: [] }).items.map((i) => [i.kind, i.name]);
  const BOTH = [['bounce', 'passed you on without showing a page'], ['param', 'hid']];
  assert.deepEqual(waiting(), BOTH);
  await bg.send({ type: 'approve', group: 'bounce' }); await bg.settle();
  assert.deepEqual(bg.state.storage.params || [], []); assert.deepEqual(waiting(), BOTH);
  await bg.send({ type: 'approve', group: 'bounce', site: 'hop.example', name: 'hid' }); assert.deepEqual(bg.state.storage.params, ['hid']);
});
test('names that sound like a sign-in or a key are never offered: token, reset, code, key, auth, session, sig, anywhere in the name', () => {
  const names = ['resetToken', 'reset_code', 'apikey', 'auth_id', 'sessionId', 'sig2', 'pwd_reset', 'x_token_y', 'KEY', 'signature', 'authcode'];
  assert.deepEqual(bounceAdded(`https://hop.example/r?to=${enc('https://blog.example/p')}`, `https://blog.example/p?${names.map((n) => `${n}=${ID}`).join('&')}&hid=${ID}`), ['hid']);
});
test('the marks of the sites a company was seen on are made with this install\'s random value', async () => {
  const one = await load(on()), two = await load(on());
  await req(one, 'https://trk.example/p.gif', 'news.example'); await req(two, 'https://trk.example/p.gif', 'news.example');
  assert.equal(one.state.storage.follow['trk.example'].on.length, 1); assert.notDeepEqual(one.state.storage.follow['trk.example'].on, two.state.storage.follow['trk.example'].on);
});
test('300 junk requests do not push out what was really learned: the least evidence goes first', () => {
  let s = followNote(undefined, 'real.example', 'px.real.example', 'a', true, 1, true);
  s = followNote(s, 'two.example', 'px.two.example', 'a', false, 2); s = followNote(s, 'two.example', 'px.two.example', 'b', true, 3);
  for (let i = 0; i < FOLLOW_MAX + 50; i++) s = followNote(s, `junk${i}.example`, `junk${i}.example`, 'a', false, 10 + i);
  assert.equal(Object.keys(s).length, FOLLOW_MAX); assert.ok(s['real.example'] && s['two.example']);
});
test('at most 20 new companies are noted per visited site in an hour', async () => {
  const bg = await load(on());
  for (let i = 0; i < 60; i++) await req(bg, `https://junk${i}.example/a.js`, 'news.example');
  assert.equal(Object.keys(bg.state.storage.follow).length, 20);
  await req(bg, 'https://junk0.example/b.js', 'shop.example'); assert.equal(bg.state.storage.follow['junk0.example'].on.length, 2, 'a company already noted is still counted');
  bg.now += 61 * 60e3; await req(bg, 'https://late.example/a.js', 'news.example'); assert.ok(bg.state.storage.follow['late.example']);
});
test('"Clear my browsing history": the press shows a second, separate button that can be pressed only after a second; the popup says the list of sites you use is kept', () => {
  const html = renderPopup({ now: 1, master: true, hold: {}, groups: [] }, null);
  assert.match(html, /<button data-reveal="confirm-browsing">Clear my browsing history<\/button>/);
  assert.match(html, /<span id="confirm-browsing" hidden>[^<]*<button data-wait="1000" disabled data-msg="[^"]*clearBrowsing[^"]*">Yes, clear all of my browsing history<\/button><\/span>/);
  assert.equal(html.includes('data-twice'), false);
  assert.ok(html.includes('The list of sites you use, which keeps their cookies safe from cleaning, is not cleared.'));
});
test('clearing either history leaves the list of sites the user opens as pages alone', async () => {
  const bg = await load(on()); await bg.opens('https://a.example/');
  await bg.send({ type: 'clearHistory' }); await bg.send({ type: 'clearBrowsing' });
  assert.equal(bg.state.storage.mine.length, 1);
});
test('a cleaned-out tracker\'s background program is removed even while its own site is open', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://www.trk.example/feed' }], cookies: [{ name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }] }));
  await req(bg, 'https://trk.example/p.gif', 'news.example'); await req(bg, 'https://trk.example/p.gif', 'shop.example');
  await bg.send({ type: 'approve', group: 'unknown', site: 'trk.example', name: 'what it keeps to follow you' }); await bg.settle();
  assert.deepEqual(bg.state.storage.hard, ['trk.example']);
  const workers = bg.called('browsingData.remove').filter((c) => c.args[1].serviceWorkers && (c.args[0].origins || []).includes('https://trk.example'));
  assert.equal(workers.length, 1); assert.deepEqual(Object.keys(workers[0].args[1]), ['serviceWorkers'], 'more than the background program was removed while the site is open');
});
