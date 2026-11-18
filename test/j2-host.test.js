// J2 (third audit): learning and blocking are per exact host, never per site.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { siteOf } = require('../extension/learn.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const req = async (bg, url, page) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script' }); await bg.settle(); };
const cookie = (domain, name = 'uid') => ({ name, domain, value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' });
const blocked = (bg) => (bg.state.dynamic.find((r) => r.id === 100001) || { condition: { requestDomains: [] } }).condition.requestDomains;

test('the audit scenario: a tenant of a file-serving name is learned; only that exact host is blocked, never the name it sits under or a neighbour', async () => {
  for (const [host, parent, neighbour] of [['evil.b-cdn.net', 'b-cdn.net', 'good.b-cdn.net'], ['abcd.supabase.co', 'supabase.co', 'wxyz.supabase.co'], ['stats.ville.gouv.fr', 'gouv.fr', 'impots.gouv.fr'], ['t.trk.example', 'trk.example', 'cdn.trk.example']]) {
    const bg = await load(on({ cookies: [cookie(host), cookie(neighbour, 'other')] }));
    await req(bg, `https://${host}/a.js`, 'news.example'); await req(bg, `https://${host}/a.js`, 'shop.example'); await bg.alarm('sweep');
    assert.deepEqual(bg.state.storage.stopped, [host], host); assert.deepEqual(blocked(bg), [host]);
    assert.equal(Object.keys(bg.state.storage.follow).some((k) => k === parent || k === neighbour), false, `${host}: something was noted under ${parent} or ${neighbour}`);
  }
});
test('two hosts of one company are counted apart: neither is blocked for what the other did', async () => {
  const bg = await load(on({ cookies: [cookie('.trk.example')] }));
  await req(bg, 'https://a.trk.example/a.js', 'news.example'); await req(bg, 'https://b.trk.example/a.js', 'shop.example'); await bg.alarm('sweep');
  assert.deepEqual(bg.state.storage.stopped || [], []);
});
test('"another company" is still decided by site: a site\'s own other hosts are never noted; the suffix table knows the audit\'s examples', async () => {
  const bg = await load(on({ cookies: [cookie('.news.example')] }));
  await req(bg, 'https://cdn.news.example/a.js', 'news.example'); await req(bg, 'https://img.news.example/a.js', 'news.example');
  assert.deepEqual(bg.state.storage.follow || {}, {});
  for (const [h, s] of [['www.impots.gouv.fr', 'impots.gouv.fr'], ['impots.gouv.fr', 'impots.gouv.fr'], ['evil.b-cdn.net', 'evil.b-cdn.net'], ['a.evil.b-cdn.net', 'a.evil.b-cdn.net'], ['abcd.supabase.co', 'abcd.supabase.co'], ['www.example.co.uk', 'example.co.uk']]) assert.equal(siteOf(h), s, h);
});
test('Remove deletes the cookies of that host and below it, not those of the company\'s other hosts', async () => {
  const bg = await load(on({ cookies: [cookie('t.trk.example'), cookie('sub.t.trk.example', 'below'), cookie('shop.trk.example', 'elsewhere')] }));
  await req(bg, 'https://t.trk.example/a.js', 'news.example'); await req(bg, 'https://t.trk.example/a.js', 'shop.example');
  await bg.send({ type: 'approve', group: 'unknown', site: 't.trk.example', name: 'what it keeps to follow you' }); await bg.settle();
  assert.deepEqual(await bg.names(), ['elsewhere']);
});
