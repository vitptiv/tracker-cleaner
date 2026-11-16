// What the popup needs from background.js, end to end: the action log, per-cookie allow, per-site off.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { renderPopup } = require('../extension/popup-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ask = (o = {}) => on({ ...o, storage: { ...o.storage, modes: { C03: 'ask', ...(o.storage || {}).modes } } });
const set = (bg, host, name) => bg.setCookie({ url: `https://${host}/`, name, value: 'secret-value' });
const log = (bg) => (bg.state.storage.log || []).map((l) => [l.cap, l.kind, l.site, l.name, l.did].join(' '));
const queued = (bg) => Object.values(bg.state.storage.pending || {}).flatMap((g) => g.items.map((i) => `${i.site} ${i.name}`));
const ga = () => [{ name: '_ga', domain: '.example.com' }, { name: '_ga', domain: '.other.test' }];

test('action log: a removed cookie is written as { t, cap, kind, site, name, did }, never its value', async () => {
  const bg = await load(on({ cookies: ga() }));
  await set(bg, 'ad.doubleclick.net', 'x'); await bg.alarm('sweep');
  assert.deepEqual(bg.state.storage.log[0], { t: bg.now, cap: 'C03', kind: 'cookie', site: 'ad.doubleclick.net', name: 'x', did: 'removed' });
  assert.deepEqual(log(bg).slice(1), ['C03 cookie example.com _ga removed', 'C03 cookie other.test _ga removed']);
  assert.equal(JSON.stringify(bg.state.storage).includes('secret-value'), false);
});
test('action log: queued once (not again at every sweep), held while paused, removed on approve', async () => {
  const bg = await load(ask({ cookies: ga().slice(0, 1) }));
  await bg.alarm('sweep'); await bg.alarm('sweep');
  assert.deepEqual(log(bg), ['C03 cookie example.com _ga queued']);
  await bg.send({ type: 'pause' }); await bg.settle(); await bg.send({ type: 'setMode', group: 'cookies', mode: 'auto' });
  await set(bg, 'ad.doubleclick.net', 'x'); await bg.alarm('sweep');
  assert.deepEqual(log(bg).slice(1), ['C03 cookie ad.doubleclick.net x held']);                // _ga stays queued: logged once
  await bg.send({ type: 'resume' }); await bg.send({ type: 'approve', group: 'cookies' }); await bg.settle();
  assert.deepEqual(log(bg).slice(2), ['C03 cookie example.com _ga removed', 'C03 cookie ad.doubleclick.net x removed']);
});
test('action log: other kinds are written too (cache clear queued, then removed)', async () => {
  const bg = await load({ storage: { master: true } });
  await bg.alarm('sweep'); await bg.send({ type: 'approve', group: 'cache' }); await bg.settle();
  assert.deepEqual(log(bg), ['C11 cache * http-cache queued', 'C11 cache * http-cache removed']);
});
test('action log: a ring of 200, and 20 changes at once all arrive', async () => {
  const old = Array.from({ length: 195 }, (_, i) => ({ t: i, cap: 'C03', kind: 'cookie', site: 'old.test', name: 'o' + i, did: 'removed' }));
  const bg = await load(on({ storage: { log: old } }));
  for (let i = 0; i < 20; i++) bg.chrome.cookies.set({ url: 'https://ad.doubleclick.net/', name: 'c' + i });
  await bg.settle(); await bg.settle();
  const l = bg.state.storage.log;
  assert.equal(l.length, 200); assert.equal(l[0].name, 'o15');
  assert.deepEqual(l.slice(-20).map((x) => x.name).sort(), Array.from({ length: 20 }, (_, i) => 'c' + i).sort());
});
test('allow: the cookie leaves the queue and is never removed or queued again; revertAllow undoes it', async () => {
  const bg = await load(ask({ cookies: ga() }));
  await bg.alarm('sweep'); assert.deepEqual(queued(bg), ['example.com _ga', 'other.test _ga']);
  assert.deepEqual(await bg.send({ type: 'allow', site: 'example.com', name: '_ga' }), { ok: true, allow: [{ site: 'example.com', name: '_ga' }] });
  await bg.send({ type: 'allow', site: 'example.com', name: '_ga' }); await bg.settle();   // twice: still one entry
  assert.deepEqual(bg.state.storage.allow, [{ site: 'example.com', name: '_ga' }]); assert.deepEqual(queued(bg), ['other.test _ga']);
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'auto' }); await bg.alarm('sweep');
  await bg.setCookie({ url: 'https://example.com/', domain: '.example.com', name: '_ga' }); await set(bg, 'example.com', '_gid');
  assert.deepEqual((await bg.chrome.cookies.getAll({})).map((c) => `${c.domain} ${c.name}`), ['.example.com _ga']);
  assert.deepEqual(queued(bg), []);
  assert.deepEqual(await bg.send({ type: 'revertAllow', site: 'example.com', name: '_ga' }), { ok: true, allow: [] });
  await bg.alarm('sweep'); assert.deepEqual(await bg.names(), []);
  for (const m of [{}, { site: 'example.com' }, { site: 5, name: 'x' }, { site: 'a b', name: 'x' }]) assert.deepEqual(await bg.send({ type: 'allow', ...m }), { ok: false });
});
test('allow does not protect a blacklisted cookie', async () => {
  const bg = await load(on({ limits: { cookieBlacklist: [{ h: 'example.com', n: '_ga' }] }, cookies: ga(),
    storage: { modes: { C07: 'auto' }, allow: [{ site: 'example.com', name: '_ga' }, { site: 'other.test', name: '_ga' }] } }));
  await bg.alarm('sweep');
  assert.deepEqual((await bg.chrome.cookies.getAll({})).map((c) => c.domain), ['.other.test']);
});
test('siteOff: an allowAllRequests and an allow rule per host above the block rules; cookies of the host and its subdomains survive', async () => {
  const bg = await load(ask({ cookies: ga() }));
  await bg.alarm('sweep');
  assert.deepEqual(await bg.send({ type: 'siteOff', host: 'Example.com', on: true }), { ok: true, sitesOff: ['example.com'] });
  await bg.send({ type: 'siteOff', host: 'example.com', on: true }); await bg.send({ type: 'siteOff', host: 'b.test', on: true }); await bg.settle();
  assert.deepEqual(bg.state.storage.sitesOff, ['example.com', 'b.test']); assert.deepEqual(queued(bg), ['other.test _ga']);
  // two rules per host: allowAllRequests for pages loaded from now on, and allow for what the page already open requests
  assert.deepEqual(bg.state.dynamic, ['example.com', 'b.test'].flatMap((h, i) => [{ id: 2 * i + 1, priority: 2, action: { type: 'allowAllRequests' },
    condition: { requestDomains: [h], resourceTypes: ['main_frame', 'sub_frame'] } }, { id: 2 * i + 2, priority: 2, action: { type: 'allow' }, condition: { initiatorDomains: [h] } }]));
  // found in the browser run: the page that was open when the box was ticked must get its requests through without a reload
  assert.equal(bg.passes('example.com'), true); assert.equal(bg.passes('www.example.com'), true); assert.equal(bg.passes('other.test'), false);
  assert.equal(bg.passes('other.test', { reloaded: true }), false);
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'auto' }); await bg.alarm('sweep'); await set(bg, 'shop.example.com', '_gid');
  assert.deepEqual(await bg.names(), ['_ga', '_gid']); assert.deepEqual(queued(bg), []);
  assert.deepEqual(await bg.send({ type: 'siteOff', host: 'example.com', on: false }), { ok: true, sitesOff: ['b.test'] });
  assert.deepEqual(bg.state.dynamic.map((r) => [r.id, (r.condition.requestDomains || r.condition.initiatorDomains)[0]]), [[1, 'b.test'], [2, 'b.test']]);
  assert.equal(bg.passes('example.com'), false); assert.equal(bg.passes('example.com', { reloaded: true }), false);
  await bg.alarm('sweep'); assert.deepEqual(await bg.names(), []);
  for (const host of [undefined, '', 'a b', '<x>', 7]) assert.deepEqual(await bg.send({ type: 'siteOff', host, on: true }), { ok: false });
});
test('the state reply carries what the view needs, and renders: fresh install, then with a site panel', async () => {
  const bg = await load({ cookies: ga(), storage: { cacheClearedAt: 1.8e12 } });
  await bg.alarm('sweep');
  let s = await bg.send({ type: 'state' });
  assert.deepEqual([s.now, s.log.length, s.allow, s.sitesOff], [bg.now, 2, [], []]);
  assert.match(renderPopup(s, null), /Cleaning is off until you turn it on\..*Turn on.*Remove 2 cookies/s);
  await bg.send({ type: 'setMaster', on: true }); await bg.send({ type: 'siteOff', host: 'example.com', on: true });
  s = await bg.send({ type: 'state' });
  const html = renderPopup(s, { host: 'www.example.com', blocked: 4 });
  assert.match(html, /This site: www\.example\.com.*4 requests blocked on this tab.*_ga.*Allow/s); assert.match(html, /siteOff[^>]* checked/);
});
test('Turn on, a mode change, allow, revert and site-off sweep at once: the next state reply is current', async () => {
  const bg = await load({ cookies: ga(), storage: { cacheClearedAt: 1.8e12 } });
  const pending = async () => (await bg.send({ type: 'state' })).groups.find((g) => g.id === 'cookies').pending;
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'ask' }); assert.equal(await pending(), 2); assert.deepEqual(bg.destructive(), []);
  await bg.send({ type: 'allow', site: 'example.com', name: '_ga' }); assert.equal(await pending(), 1);
  await bg.send({ type: 'siteOff', host: 'other.test', on: true }); assert.equal(await pending(), 0);
  await bg.send({ type: 'siteOff', host: 'other.test', on: false }); await bg.send({ type: 'revertAllow', site: 'example.com', name: '_ga' }); assert.equal(await pending(), 2);
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'auto' }); assert.equal(await pending(), 2);   // nothing stored for master: auto still asks
  assert.deepEqual(await bg.send({ type: 'setMaster', on: true }), { master: true });
  assert.equal(await pending(), 0); assert.deepEqual(await bg.names(), []);
});
test('a group that cannot ask (nothing destructive in it) says so in the state: sign-in guard, blocking, parameters, server', async () => {
  const s = await (await load()).send({ type: 'state' });
  assert.deepEqual(s.groups.filter((g) => !g.ask).map((g) => g.id), ['signin', 'blocking', 'params', 'server']);
});
test('a live cookie action records the page: the host of the active tab of the last-focused window; a sweep does not guess', async () => {
  const tabs = [{ id: 1, active: true, windowId: 2, url: 'https://elsewhere.test/' }, { id: 2, active: false, url: 'https://shop.test/' }, { id: 3, active: true, url: 'https://www.news.test/a?b' }];
  const bg = await load(ask({ tabs, cookies: ga().slice(0, 1), storage: { modes: { C04: 'auto', C03: 'auto' } } }));
  await set(bg, 'ad.doubleclick.net', 'x'); await bg.send({ type: 'setMode', group: 'cookies', mode: 'ask' }); await set(bg, 'ad.doubleclick.net', 'y');
  await bg.alarm('sweep');
  const l = bg.state.storage.log;
  assert.deepEqual(l.map((e) => [e.name, e.did, e.page]), [['x', 'removed', 'www.news.test'], ['_ga', 'queued', undefined], ['y', 'queued', 'www.news.test']]);
  assert.equal('page' in l[1], false); assert.equal(JSON.stringify(bg.state.storage.pending).includes('news.test'), false);
  const html = renderPopup(await bg.send({ type: 'state' }), { host: 'www.news.test', blocked: null });
  assert.equal(html.split('set while you were on this site').length - 1, 2); assert.ok(html.includes('ad.doubleclick.net · x'));
});

// ---- 1.22
test('state: whether the 8088 server answered, and when the cache is next due; never a size (Chrome does not tell)', async () => {
  const down = await (await load({ storage: { master: true, cacheClearedAt: 1.8e12 - 3600e3 } })).send({ type: 'state' });
  assert.equal(down.server, false);
  const cache = down.groups.find((g) => g.id === 'cache');
  assert.equal(cache.nextAt, 1.8e12 + 23 * 3600e3); assert.equal('size' in cache, false);
  assert.equal(down.groups.filter((g) => 'nextAt' in g).length, 1);
  assert.equal((await (await load({ limits: {} })).send({ type: 'state' })).server, true);
});
