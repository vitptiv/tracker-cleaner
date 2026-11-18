// R1 (C25) end to end: a company on no list that is seen on three sites with an ID is offered, and stopped on Approve.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').asks;
const req = async (bg, host, page, path = '/px.gif') => { await bg.request({ url: `https://${host}${path}`, initiator: `https://www.${page}`, type: 'image' }); await bg.settle(); };
const three = async (bg, host = 'px.trk.example', path) => { for (const p of ['news.example', 'shop.example', 'blog.example']) await req(bg, host, p, path); };
const ID = { name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };
const on = (o = {}) => ({ cookies: [ID], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const queued = (bg, group = 'unknown') => ((bg.state.storage.pending || {})[group] || { items: [] }).items;
const rule = (bg) => bg.state.dynamic.find((r) => r.id === 100001);

test('two sites: nothing. The third: one question waits, nothing is blocked or deleted, and no site name is stored', async () => {
  const bg = await load(on());
  await req(bg, 'px.trk.example', 'news.example'); await req(bg, 'px.trk.example', 'shop.example'); await req(bg, 'px.trk.example', 'news.example');
  assert.deepEqual(queued(bg), []);
  await req(bg, 'px.trk.example', 'blog.example');
  assert.deepEqual(queued(bg).map((i) => [i.cap, i.kind, i.site, i.name]), [['C25', 'tracker', 'trk.example', 'followed you on 3 sites']]);
  assert.deepEqual(bg.destructive(), []); assert.equal(rule(bg), undefined);
  assert.equal(/news\.example|shop\.example|blog\.example|u-3fa9/.test(JSON.stringify(bg.state.storage)), false);
  assert.deepEqual(bg.called('storage.sync.set'), []); assert.deepEqual(bg.reports, []);
});
test('no ID, no question: a file server seen everywhere is left alone; an ID in the address alone is no evidence (1.25, F1), a cookie of that company is', async () => {
  const bg = await load(on({ cookies: [{ name: 'lang', domain: '.cdn.example', value: 'en-US', sameSite: 'no_restriction' }, { name: 'sid', domain: '.own.example', value: 'a1b2c3d4e5f6', sameSite: 'lax' }] }));
  await three(bg, 'static.cdn.example'); await three(bg, 'own.example');
  assert.deepEqual(queued(bg), []);
  await three(bg, 'c.quiet.example', '/c.gif?uid=3fa9c2d1e07b4a55aa01');
  assert.deepEqual(queued(bg), []);
  await bg.setCookie({ url: 'https://c.quiet.example/', domain: '.quiet.example', name: 'q', value: 'q-3fa9c2d1e0', sameSite: 'no_restriction', secure: true }); await bg.alarm('sweep');
  assert.deepEqual(queued(bg).map((i) => i.site), ['quiet.example']);
});
test('Approve stops that one: blocked from other sites, its cookies deleted, sign-in pages let through; the other question stays', async () => {
  const bg = await load(on({ cookies: [ID, { name: 'SID', domain: '.trk.example', value: 'keep-me-1234' }, { name: 'other', domain: '.else.example', value: 'x' }, { ...ID, name: 'q', domain: '.quiet.example' }] }));
  await three(bg); await three(bg, 'c.quiet.example', '/c.gif');
  assert.deepEqual(await bg.send({ type: 'approve', group: 'unknown', site: 'trk.example' }), { ok: true, done: 1, of: 1 }); await bg.settle();
  const r = rule(bg);
  assert.deepEqual([r.action.type, r.condition.requestDomains, r.condition.domainType, r.condition.resourceTypes.includes('main_frame')], ['block', ['trk.example'], 'thirdParty', false]);
  assert.ok(r.condition.excludedInitiatorDomains.includes('accounts.google.com'));
  assert.deepEqual(await bg.names(), ['SID', 'other', 'q']);
  assert.deepEqual(queued(bg).map((i) => i.site), ['quiet.example']);
  assert.deepEqual((await bg.send({ type: 'state' })).stopped, ['trk.example']);
});
test('automatic: stopped at the third site without a question; held while a sign-in is going on, done when it is over', async () => {
  let bg = await load(on({ storage: { modes: { C25: 'auto' } } }));
  await three(bg);
  assert.deepEqual(rule(bg).condition.requestDomains, ['trk.example']); assert.deepEqual(await bg.names(), []); assert.deepEqual(queued(bg), []);
  bg = await load(on({ storage: { modes: { C25: 'auto' } }, tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/' }] }));
  await three(bg);
  assert.equal(rule(bg), undefined); assert.deepEqual(bg.destructive(), []); assert.deepEqual(queued(bg).map((i) => i.site), ['trk.example']);
  await bg.navigate(1, 'https://www.news.example/'); bg.now += 6 * 60e3; await bg.alarm('sweep');
  assert.deepEqual(rule(bg).condition.requestDomains, ['trk.example']); assert.deepEqual(queued(bg), []);
});
test('never learned: a sign-in company, a sign-in address, a listed tracker, the site itself; nothing at all when switched off', async () => {
  const bg = await load(on({ cookies: [{ name: 'NID', domain: '.google.com', value: 'abc123def456', sameSite: 'no_restriction' }] }));
  await three(bg, 'www.google.com'); await three(bg, 'accounts.google.com'); await three(bg, 'id.trk.example', '/oauth/authorize'); await three(bg, 'ad.doubleclick.net');
  await req(bg, 'img.news.example', 'news.example');
  assert.deepEqual(bg.state.storage.follow, undefined); assert.deepEqual(queued(bg), []);
  const off = await load(on({ storage: { modes: { C25: 'off' } } }));
  await three(off);
  assert.deepEqual(off.state.storage.follow, undefined); assert.deepEqual(queued(off), []);
});
test('Not now: the question goes away for a week. "Let it through again" takes the block away', async () => {
  const bg = await load(on());
  await three(bg);
  assert.deepEqual(await bg.send({ type: 'notNow', group: 'unknown', site: 'trk.example' }), { ok: true }); await bg.settle();
  assert.deepEqual(queued(bg), []);
  bg.now += 6 * 86400e3; await bg.alarm('sweep'); assert.deepEqual(queued(bg), []);
  bg.now += 2 * 86400e3; await bg.alarm('sweep'); assert.deepEqual(queued(bg).map((i) => i.site), ['trk.example']);
  await bg.send({ type: 'approve', group: 'unknown', site: 'trk.example' }); await bg.settle(); assert.ok(rule(bg));
  assert.deepEqual(await bg.send({ type: 'unstop', site: 'trk.example' }), { ok: true, stopped: [] }); await bg.settle();
  assert.equal(rule(bg), undefined); assert.deepEqual(queued(bg), []);
});
test('a stopped company counts as a tracker from then on: its new cookie goes, but not while its own site is open; switching a site off keeps the block', async () => {
  const bg = await load(on({ storage: { stopped: ['trk.example'] }, cookies: [] }));
  await bg.alarm('sweep'); assert.ok(rule(bg));
  await bg.setCookie({ url: 'https://px.trk.example/', name: 'again', value: 'u-77aa88bb99' });
  assert.deepEqual(await bg.names(), []);
  await bg.openTab({ id: 5, active: true, url: 'https://www.trk.example/' });
  await bg.setCookie({ url: 'https://www.trk.example/', name: 'mine', value: 'u-77aa88bb99' });
  assert.deepEqual(await bg.names(), ['mine']);
  await bg.send({ type: 'siteOff', host: 'news.example', on: true }); await bg.settle();
  assert.ok(rule(bg)); assert.equal(bg.state.dynamic.length, 4);
  await bg.send({ type: 'setMaster', on: false }); await bg.settle(); assert.equal(rule(bg), undefined);
});
test('never learned: a company pages need to check that you are human or to take a payment', async () => {
  const bg = await load(on({ cookies: [{ name: 'hmt_id', domain: '.hcaptcha.com', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }, { name: 'm', domain: '.stripe.com', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }] }));
  await three(bg, 'newassets.hcaptcha.com'); await three(bg, 'js.stripe.com', '/v3/?uid=3fa9c2d1e07b4a55aa01');
  assert.deepEqual(bg.state.storage.follow, undefined); assert.deepEqual(queued(bg), []);
});
