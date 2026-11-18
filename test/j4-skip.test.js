// J4 (third audit): a link is rewritten only for redirectors on the shipped list, or after the user's press on a question.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { skipTo } = require('../extension/skip.js'), { PASSERS } = require('../extension/learn.js'), { buildReport, renderReport } = require('../extension/report-view.js');
const enc = encodeURIComponent, PAGE = 'https://mail.example/inbox';
const on = (o = {}) => ({ tabs: [{ id: 1, active: true, url: PAGE }], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const pass = async (bg, to) => { await bg.redirect({ url: `https://hop.example/r?to=${enc(to)}`, redirectUrl: to + '?hid=h-77ab12cd34ef', type: 'main_frame' }); await bg.settle(); };
const sites = (bg) => bg.state.storage.skip.sites, asks = (bg) => ((bg.state.storage.pending || {}).bounce || { items: [] }).items.filter((i) => i.kind === 'skip').map((i) => i.site);

test('learned from behaviour, nothing is skipped by itself: two destinations and an added ID give one question; Skip adds it, the group button does not', async () => {
  const bg = await load(on()); await pass(bg, 'https://blog.example/post'); await pass(bg, 'https://shop.example/x');
  assert.deepEqual(sites(bg), PASSERS); assert.deepEqual(asks(bg), ['hop.example']);
  assert.ok(renderReport(buildReport(await bg.send({ type: 'state' }), null)).includes('hop.example only passes you along and adds a tag. Skip it next time?'));
  await bg.send({ type: 'approve', group: 'bounce' }); await bg.settle(); assert.equal(sites(bg).includes('hop.example'), false);
  assert.deepEqual(await bg.send({ type: 'approve', group: 'bounce', site: 'hop.example', name: 'skip it next time' }), { ok: true, done: 1, of: 1 }); await bg.settle();
  assert.ok(sites(bg).includes('hop.example')); assert.deepEqual(asks(bg), []);
  await bg.send({ type: 'unskip', site: 'hop.example' }); await bg.settle(); assert.equal(sites(bg).includes('hop.example'), false); assert.deepEqual(asks(bg), []);
});
test('one destination, or no added ID, or a site the user opens: no question', async () => {
  const one = await load(on()); await pass(one, 'https://blog.example/post'); await pass(one, 'https://blog.example/other'); assert.deepEqual(asks(one), []);
  const used = await load(on()); await used.opens('https://hop.example/home'); await used.closeTab(used.tabOf('https://hop.example/home')); await pass(used, 'https://blog.example/post'); await pass(used, 'https://shop.example/x'); assert.deepEqual(asks(used), []);
});
test('the shipped redirectors are skipped from the start, by exact host; each can be let through again', async () => {
  const bg = await load(on()); await bg.alarm('sweep');
  assert.deepEqual(sites(bg), PASSERS); assert.ok(PASSERS.includes('l.facebook.com') && PASSERS.every((h) => /^[a-z0-9-]+(\.[a-z0-9-]+)+$/.test(h)));
  assert.equal(skipTo(`https://l.facebook.com/l.php?u=${enc('https://blog.example/post')}&h=abc`, PAGE, PASSERS), 'https://blog.example/post');
  for (const h of ['facebook.com', 'www.facebook.com', 'evil-l.facebook.com', 'l.facebook.com.evil.test', 'x.l.facebook.com']) assert.equal(skipTo(`https://${h}/l.php?u=${enc('https://blog.example/post')}`, PAGE, PASSERS), null, h);
  await bg.send({ type: 'unskip', site: 'l.facebook.com' }); await bg.settle(); assert.equal(sites(bg).includes('l.facebook.com'), false);
});
test('never skipped: more words for signing out, paying and signing in, in the path or in what is handed over', () => {
  const to = enc('https://shop.example/done'), S = ['hop.example'];
  for (const path of ['/sign_out', '/signout', '/logout', '/logoff', '/account/logoff', '/wsignout', '/unsub', '/unsub/123', '/cart', '/cart/add', '/checkout', '/pay', '/wp-login.php', '/adfs/ls', '/Sign_Out', '/users/sign_out'])
    assert.equal(skipTo(`https://hop.example${path}?to=${to}`, PAGE, S), null, path);
  assert.equal(skipTo(`https://hop.example/ls?wa=wsignout1.0&wreply=${to}`, PAGE, S), null, 'wsignout as a value');
  assert.equal(skipTo(`https://hop.example/r?action=logout&to=${to}`, PAGE, S), null, 'logout as a value');
  assert.equal(skipTo(`https://hop.example/r?to=${to}`, PAGE, S), 'https://shop.example/done');
  assert.equal(skipTo(`https://hop.example/cartoon/r?to=${to}`, PAGE, S), 'https://shop.example/done', 'a word that only begins like "cart"');
});
