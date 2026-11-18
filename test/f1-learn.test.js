// F1 (audit): a hostile page must not be able to get a domain stopped.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { siteOf } = require('../extension/learn.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const cookie = (domain, o = {}) => ({ name: 'uid', domain, value: 'u-3fa9c2d1e0', sameSite: 'no_restriction', ...o });
const req = async (bg, url, page, o = {}) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script', ...o }); await bg.settle(); };
const three = async (bg, url) => { for (const p of ['news.example', 'shop.example', 'blog.example']) await req(bg, url, p); };
const asked = (bg) => ((bg.state.storage.pending || {}).unknown || { items: [] }).items.filter((i) => i.kind === 'tracker').map((i) => i.site);   // "Stop it?" questions
const CF = 'https://d111.cloudfront.net/a.js?u=3fa9c2d1e07b4a55aa01';

test('the audit scenario: one page with three frames of other origins asks a shared host with an ID in the address: nothing is stopped or asked', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://evil.example/' }], cookies: [cookie('d111.cloudfront.net')] }));   // even with a cookie of its own there
  for (const frame of ['https://a.one.example', 'https://b.two.example', 'https://c.three.example']) { await bg.request({ url: CF, initiator: frame, type: 'script', tabId: 1, frameId: 5 }); await bg.settle(); }
  await bg.alarm('sweep');
  assert.deepEqual(bg.state.storage.stopped || [], []); assert.deepEqual(asked(bg), []); assert.deepEqual(bg.called('cookies.remove'), []); assert.equal(bg.state.dynamic.some((r) => r.id === 100001), false);
});
test('a request that belongs to no tab is not counted', async () => {
  const bg = await load(on({ cookies: [cookie('.trk.example')] }));
  for (const p of ['news.example', 'shop.example', 'blog.example']) { await bg.request({ url: 'https://trk.example/p.gif', initiator: `https://www.${p}`, type: 'image', tabId: -1 }); await bg.settle(); }
  assert.deepEqual(bg.state.storage.stopped || [], []); assert.deepEqual(bg.state.storage.follow || {}, {});
});
test('three visited sites and an ID in the address, but no cookie of that host: no evidence, nothing happens', async () => {
  const bg = await load(on()); await three(bg, CF); await three(bg, 'https://quiet.example/c.gif?uid=3fa9c2d1e07b4a55aa01'); await bg.alarm('sweep');
  assert.deepEqual(bg.state.storage.stopped || [], []); assert.deepEqual(asked(bg), []); assert.deepEqual(bg.called('cookies.remove'), []);
});
test('a shared host is learned by its full name: only that host is stopped, its neighbours and the shared name are not', async () => {
  const bg = await load(on({ cookies: [cookie('d111.cloudfront.net'), cookie('d222.cloudfront.net', { name: 'other' })] }));
  await three(bg, CF);
  assert.deepEqual(bg.state.storage.stopped, ['d111.cloudfront.net']);
  assert.deepEqual(bg.state.dynamic.find((r) => r.id === 100001).condition.requestDomains, ['d111.cloudfront.net']);
  assert.deepEqual(await bg.names(), ['uid', 'other']);   // blocked only (1.25, J1)
});
test('siteOf: country suffixes of two parts and shared hosts', () => {
  for (const [h, s] of [['a.b.example.com', 'example.com'], ['www.bbc.co.uk', 'bbc.co.uk'], ['x.y.or.jp', 'y.or.jp'], ['shop.foo.com.au', 'foo.com.au'], ['a.b.gov.uk', 'b.gov.uk'], ['a.foo.com.br', 'foo.com.br'],
    ['d111.cloudfront.net', 'd111.cloudfront.net'], ['cloudfront.net', 'cloudfront.net'], ['bucket.s3.eu-west-1.amazonaws.com', 'bucket.s3.eu-west-1.amazonaws.com'], ['me.github.io', 'me.github.io'],
    ['app.herokuapp.com', 'app.herokuapp.com'], ['x.azurewebsites.net', 'x.azurewebsites.net'], ['x.appspot.com', 'x.appspot.com'], ['x.pages.dev', 'x.pages.dev'], ['x.netlify.app', 'x.netlify.app'],
    ['x.vercel.app', 'x.vercel.app'], ['x.web.app', 'x.web.app'], ['x.firebaseapp.com', 'x.firebaseapp.com'], ['me.blogspot.com', 'me.blogspot.com'],
    ['notcloudfront.net', 'notcloudfront.net'], ['a.notcloudfront.net', 'notcloudfront.net'], ['gazette.localhost:8200', 'gazette.localhost'], ['127.0.0.1', '127.0.0.1']]) assert.equal(siteOf(h), s, h);
});
test("Google's own sites in any country are never learned", async () => {
  const bg = await load(on({ cookies: [cookie('.google.de'), cookie('.google.co.uk'), cookie('.youtube.com')] }));
  for (const u of ['https://www.google.de/x.gif', 'https://www.google.co.uk/x.gif', 'https://www.youtube.com/x.gif']) await three(bg, u);
  await bg.alarm('sweep');
  assert.deepEqual(bg.state.storage.stopped || [], []); assert.deepEqual(asked(bg), []); assert.deepEqual(await bg.names(), ['uid', 'uid', 'uid']);
});
test('at most 10 are stopped by itself in an hour: the eleventh becomes a question; an hour later it is stopped', async () => {
  const sites = Array.from({ length: 11 }, (_, i) => `trk${i}.example`);
  const bg = await load(on({ cookies: sites.map((s) => cookie('.' + s)) }));
  for (const s of sites) await three(bg, `https://${s}/p.gif`);
  assert.equal(bg.state.storage.stopped.length, 10); assert.deepEqual(asked(bg), ['trk10.example']);
  bg.now += 61 * 60e3; await bg.alarm('sweep');
  assert.equal(bg.state.storage.stopped.length, 11); assert.deepEqual(asked(bg), []);
});
test('never more than 300 stopped companies, and what is kept about them is bounded with the list', async () => {
  const stopped = Array.from({ length: 300 }, (_, i) => `old${i}.example`);
  const bg = await load(on({ cookies: [cookie('.trk.example')], storage: { stopped, own: { 'gone.example': { ok: true, at: 1 } } } }));
  await three(bg, 'https://trk.example/p.gif'); await bg.alarm('sweep');
  assert.equal(bg.state.storage.stopped.length, 300); assert.equal(bg.state.storage.stopped.includes('trk.example'), true);   // 1.25, J6: the oldest block makes room
  assert.equal(bg.state.storage.stopped.includes('old0.example'), false);
  assert.deepEqual(await bg.names(), ['uid']); assert.equal('gone.example' in (bg.state.storage.own || {}), false);
});
