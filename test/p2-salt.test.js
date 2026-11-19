'use strict';
// P2 (1.29): the random value of this install (`salt`) is made exactly once. Before, saltNow() read storage, found
// nothing and wrote a new value without waiting its turn: on a fresh install the first requests of a page each made a
// salt of their own, the marks they left for the SAME visited site differed, and one site counted as two -- "followed
// you on 2 sites" after a single site (seen in about half of the lab's fresh starts).
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const SET = 'tid=t-77ab12cd34ef; Path=/; SameSite=None; Secure';
const salts = (bg) => bg.called('storage.local.set').filter((c) => 'salt' in c.args[0]).map((c) => c.args[0].salt);

test('P2: many first requests at once on an empty store make one salt, and one visited site is one mark', async () => {
  const bg = await load(on());
  assert.equal(bg.state.storage.salt, undefined, 'a salt before anything asked for one');
  const page = 'https://www.news.example';
  // one page, twenty requests to the same outside company at the same moment, none waited for: requests, answers and an ID sent
  await Promise.all(Array.from({ length: 20 }, (_, i) => [
    bg.request({ url: `https://trk.example/px${i}.gif?u=k9x2m4q8r1t7z${i}abcd`, initiator: page, type: 'image' }),
    bg.answer({ url: `https://trk.example/px${i}.gif`, initiator: page, type: 'image', responseHeaders: [{ name: 'Set-Cookie', value: SET }] })]).flat());
  await bg.settle();
  assert.equal(salts(bg).length, 1, 'more than one salt was written');
  assert.equal(new Set(salts(bg)).size, 1); assert.equal(bg.state.storage.salt, salts(bg)[0]); assert.match(bg.state.storage.salt, /^[0-9a-f]{32}$/);
  const e = bg.state.storage.follow['trk.example'];
  assert.equal(e.on.length, 1, 'one visited site was counted as ' + e.on.length);
  assert.deepEqual(((bg.state.storage.pending || {}).unknown || { items: [] }).items.filter((i) => i.kind === 'tracker'), [], 'a question after one site');
});
test('P2: the same when the first uses come from different places at once (a page opened, a request, a redirect, a value sent)', async () => {
  const bg = await load(on());
  await Promise.all([bg.visit('https://www.news.example/'), bg.request({ url: 'https://trk.example/a.gif?c=xq7m2k9p4w1z8c3v', initiator: 'https://www.news.example', type: 'image' }),
    bg.redirect({ url: 'https://hop.example/r?to=x', redirectUrl: 'https://shop.example/', type: 'main_frame', tabId: 5, frameId: 0 }),
    bg.request({ url: 'https://www.news.example/f/hit?c=xq7m2k9p4w1z8c3v', initiator: 'https://www.news.example', type: 'image' })]);
  await bg.settle(); for (const t of bg.timers.splice(0)) t(); await bg.settle();
  assert.equal(salts(bg).length, 1, 'more than one salt was written');
});
test('P2: a stored salt is used as it is and never written again', async () => {
  const bg = await load(on({ storage: { salt: 'aa'.repeat(16) } }));
  await Promise.all(Array.from({ length: 5 }, (_, i) => bg.request({ url: `https://trk.example/px${i}.gif`, initiator: 'https://www.news.example', type: 'image' })));
  await bg.settle();
  assert.deepEqual(salts(bg), []); assert.equal(bg.state.storage.salt, 'aa'.repeat(16));
});
test('P2: a failed first read of storage is not remembered -- the next request makes the salt', async (t) => {
  const bg = await load(on()), local = bg.chrome.storage.local, get = local.get;
  // the very first read throws at once (not a rejected promise): the one-in-flight promise must not stay that failure
  // the failure surfaces in the worker as an unhandled rejection of that one listener call, as it would in Chrome: kept out of the runner
  const keep = process.listeners('unhandledRejection'), seen = []; process.removeAllListeners('unhandledRejection'); process.on('unhandledRejection', (e) => seen.push(String(e && e.message)));
  t.after(() => { process.removeAllListeners('unhandledRejection'); keep.forEach((f) => process.on('unhandledRejection', f)); });
  let once = true; local.get = function (...a) { if (once && a[0] === 'salt') { once = false; throw new Error('storage gone'); } return get.apply(this, a); };
  await bg.request({ url: 'https://trk.example/a.gif', initiator: 'https://www.news.example', type: 'image' }).catch(() => {}); await bg.settle();
  assert.equal(once, false, 'the salt was never asked for'); assert.deepEqual(seen, ['storage gone']);
  local.get = get;
  await bg.request({ url: 'https://trk2.example/a.gif', initiator: 'https://www.news.example', type: 'image' }); await bg.settle();
  assert.equal(salts(bg).length, 1, 'no salt after the first read failed'); assert.ok(bg.state.storage.follow['trk2.example']);
});
