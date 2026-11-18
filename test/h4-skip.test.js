// H4 (second audit): one redirect must not make a site "passing", and a link that does something (sign out, pay) is never skipped.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { skipTo } = require('../extension/skip.js');
const enc = encodeURIComponent, PAGE = 'https://mail.example/inbox', SITES = ['hop.example'];
const on = (o = {}) => ({ tabs: [{ id: 1, active: true, url: PAGE }], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const pass = async (bg, to, added = '', from = 'https://go.hop.example/r') => { await bg.redirect({ url: `${from}?to=${enc(to)}`, redirectUrl: to + added, type: 'main_frame' }); await bg.settle(); };
const sites = (bg) => (bg.state.storage.skip || { sites: [] }).sites;

test('the audit scenario: a mail service\'s safe-link redirect, once or many times without an added ID, never makes it a passing site', async () => {
  const bg = await load(on());
  await pass(bg, 'https://shop.example/offer', '', 'https://safelinks.protect.example/'); assert.deepEqual(sites(bg), []);
  await pass(bg, 'https://news.example/story', '', 'https://safelinks.protect.example/'); await pass(bg, 'https://blog.example/post', '', 'https://safelinks.protect.example/');
  assert.deepEqual(sites(bg), [], 'three destinations but nothing added');
});
test('passing: it sent the browser to two different sites and added an ID; one destination twice is not enough', async () => {
  const bg = await load(on());
  await pass(bg, 'https://blog.example/post', '?hid=h-77ab12cd34ef'); await pass(bg, 'https://blog.example/other', '?hid=h-77ab12cd34ef'); assert.deepEqual(sites(bg), []);
  await pass(bg, 'https://shop.example/x', '?hid=h-77ab12cd34ef'); assert.deepEqual(sites(bg), ['hop.example']);
  assert.equal(/blog\.example|shop\.example/.test(JSON.stringify(bg.state.storage.bounce)), false, 'a destination is stored by name');
});
test('never a site the user opens as a page', async () => {
  const bg = await load(on()); await bg.opens('https://hop.example/home'); await bg.closeTab(bg.tabOf('https://hop.example/home'));
  await pass(bg, 'https://blog.example/post', '?hid=h-77ab12cd34ef'); await pass(bg, 'https://shop.example/x', '?hid=h-77ab12cd34ef');
  assert.deepEqual(sites(bg), []);
});
test('at the press: never when the address is a return address by its name, or the link is one that does something', () => {
  const to = enc('https://shop.example/done');
  for (const name of ['returnTo', 'return_url', 'redirect_uri', 'continue', 'next', 'callback', 'back', 'success_url', 'cancel_url', 'return', 'ReturnUrl', 'redirect'])
    assert.equal(skipTo(`https://go.hop.example/r?${name}=${to}`, PAGE, SITES), null, name);
  for (const path of ['/logout', '/account/logout', '/signout', '/pay', '/pay/123', '/checkout', '/checkout/step2', '/auth/x', '/verify', '/verify-email', '/Logout', '/api/payment/start', '/unsubscribe', '/confirm'])
    assert.equal(skipTo(`https://go.hop.example${path}?to=${to}`, PAGE, SITES), null, path);
  assert.equal(skipTo(`https://go.hop.example/r?to=${to}`, PAGE, SITES), 'https://shop.example/done');
  assert.equal(skipTo(`https://go.hop.example/paypal-news?u=${to}`, PAGE, SITES), 'https://shop.example/done', 'a word that only contains "pay"');
});
