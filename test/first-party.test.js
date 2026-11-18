// Review follow-ups on chunk 5. Several tracker domains are also products people log in to (segment.com,
// mixpanel.com ...): a first-party visit must work. And a fresh install does not offer the cache clear at once.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), load = require('./load-background.js').asks;
const core = require('../extension/core.js')(require('../extension/lists.js'));
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const visit = (url, o = {}) => on({ tabs: [{ id: 1, active: false, url }], ...o });
const set = (bg, host, name) => bg.setCookie({ url: `https://${host}/`, name });
const queued = (bg) => Object.values(bg.state.storage.pending || {}).flatMap((g) => g.items.map((i) => i.name));

test('C01 is two rules: registrable domains are blocked from other sites only, subdomain entries everywhere', () => {
  const [site, sub, ...more] = JSON.parse(fs.readFileSync(path.join(__dirname, '../extension/rules.json'), 'utf8')), { DOMAINS } = require('../extension/lists.js');
  assert.deepEqual(more, []); assert.equal(site.condition.domainType, 'thirdParty'); assert.equal('domainType' in sub.condition, false);
  assert.deepEqual([site.id, sub.id], [1, 2]);
  assert.deepEqual(sub.condition.requestDomains, ['adservice.google.com', 'bat.bing.com', 'analytics.tiktok.com', 'analytics.twitter.com', 'px.ads.linkedin.com',
    'snap.licdn.com', 'ct.pinterest.com', 'mc.yandex.ru', 'ingest.sentry.io', 'tr.snapchat.com', 'stats.wp.com']);
  for (const d of site.condition.requestDomains) assert.equal(d.split('.').length, 2, d);
  assert.deepEqual([...site.condition.requestDomains, ...sub.condition.requestDomains].sort(), [...DOMAINS].sort());
  const { requestDomains: a, domainType, ...restA } = site.condition, { requestDomains: b, ...restB } = sub.condition;
  assert.deepEqual(restA, restB); assert.deepEqual([site.action, sub.action, site.priority, sub.priority], [{ type: 'block' }, { type: 'block' }, 1, 1]);
});
test('firstParty: some open tab is on the site of the tracker domain the cookie falls under', () => {
  const c = { name: 'sid', domain: '.app.segment.com' };
  for (const h of ['segment.com', 'app.segment.com', 'docs.segment.com']) assert.equal(core.firstParty(c, [h]), true, h);
  for (const h of ['segment.io', 'evilsegment.com', 'segment.com.evil.test', 'example.com', '']) assert.equal(core.firstParty(c, [h]), false, h);
  assert.equal(core.firstParty({ name: 'sid', domain: '.example.com' }, ['example.com']), false);
});
test('a host-only cookie survives live and in the sweep while a tab is on that tracker site, and goes once the tab is closed', async () => {
  const bg = await load(visit('https://app.segment.com/workspace', { cookies: [{ name: 'login', domain: '.segment.com' }] }));
  await set(bg, 'app.segment.com', 'csrf'); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['login', 'csrf']); assert.deepEqual(bg.destructive(), []); assert.deepEqual(queued(bg), []);
  await set(bg, 'app.segment.com', '_ga'); await set(bg, 'ad.doubleclick.net', 'id'); await set(bg, 'api.segment.io', 'x');
  assert.deepEqual(await bg.names(), ['login', 'csrf']);              // a tracker name, or another tracker's host, still goes
  await bg.closeTab(1); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), []);
});
test('ask mode: such a cookie is not queued, and one queued before the visit is skipped by approve', async () => {
  const bg = await load(on({ storage: { modes: { C03: 'ask' } }, cookies: [{ name: 'login', domain: '.mixpanel.com' }] }));
  await bg.alarm('sweep'); assert.deepEqual(queued(bg), ['login']);
  await bg.openTab({ id: 1, active: true, url: 'https://mixpanel.com/report' });
  assert.deepEqual(await bg.send({ type: 'approve', group: 'cookies' }), { ok: true, done: 0, of: 1 });
  await set(bg, 'mixpanel.com', 'other'); await bg.alarm('sweep');
  assert.deepEqual(queued(bg), []); assert.deepEqual(await bg.names(), ['login', 'other']); assert.deepEqual(bg.destructive(), []);
});
test('fresh install: the cache clear is not offered at the first sweep, but 24 hours later', async () => {
  const bg = await load();
  await bg.chrome.runtime.onInstalled.fire({ reason: 'install' }); await bg.settle();
  assert.equal(bg.state.storage.cacheClearedAt, bg.now); assert.equal(bg.badge.text, ''); assert.deepEqual(queued(bg), []);
  bg.now += 24 * 3600e3 - 1; await bg.alarm('sweep'); assert.equal(bg.badge.text, '');
  bg.now += 1; await bg.alarm('sweep'); assert.equal(bg.badge.text, '1'); assert.deepEqual(queued(bg), ['http-cache']);
});
test('an update keeps the stored time of the last cache clear', async () => {
  const bg = await load({ storage: { cacheClearedAt: 5 } });
  await bg.chrome.runtime.onInstalled.fire({ reason: 'update' }); await bg.settle();
  assert.equal(bg.state.storage.cacheClearedAt, 5); assert.equal(bg.badge.text, '1');
});
