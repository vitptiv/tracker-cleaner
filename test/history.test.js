// Private history: what was removed, counted per day and per cookie, kept 30 days in chrome.storage.local and
// nowhere else. Only the extension's own pages may ask for it.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').asks;
const { HISTORY_DAYS, HISTORY_COOKIES, historyDay, historyAdd, historyTrim } = require('../extension/history.js');
const DAY = 86400e3, HOUR = 3600e3, at = (d, h, m = 0) => new Date(2026, 10, d, h, m).getTime();   // November 2026, local time
const gone = (site, name, group = 'cookies') => ({ group, kind: 'cookie', site, name });

test('history.js: counts per day and group, and per cookie first seen, last removed and times removed', () => {
  let h = historyAdd(undefined, [gone('example.com', '_ga'), gone('google.com', 'NID', 'google'), { group: 'cache', kind: 'cache', site: '*', name: 'http-cache' }], at(10, 9));
  h = historyAdd(h, [gone('example.com', '_ga')], at(10, 23, 59));
  h = historyAdd(h, [gone('example.com', '_ga')], at(11, 0, 1));
  assert.deepEqual(h, { days: { '2026-11-10': { cookies: 2, google: 1, cache: 1 }, '2026-11-11': { cookies: 1 } },
    cookies: { 'example.com _ga': { first: at(10, 9), last: at(11, 0, 1), n: 3, d: 1, g: 'cookies' }, 'google.com NID': { first: at(10, 9), last: at(10, 9), n: 1, d: 1, g: 'google' } } });
  assert.equal(historyDay(at(3, 0)), '2026-11-03');
});
test('history.js: per cookie, how often it was removed on the day it was last removed (d) and by which group (g)', () => {
  let h = historyAdd(undefined, [gone('example.com', '_ga')], at(10, 9));
  h = historyAdd(h, [gone('example.com', '_ga')], at(10, 23, 59));
  assert.deepEqual(h.cookies['example.com _ga'], { first: at(10, 9), last: at(10, 23, 59), n: 2, d: 2, g: 'cookies' });
  h = historyAdd(h, [gone('example.com', '_ga', 'storage')], at(11, 0, 1));   // a new day starts at 1
  assert.deepEqual(h.cookies['example.com _ga'], { first: at(10, 9), last: at(11, 0, 1), n: 3, d: 1, g: 'storage' });
  // an entry written before 1.23 has neither: counting starts now
  h = historyAdd({ days: {}, cookies: { 'a.test x': { first: at(11, 8), last: at(11, 8), n: 5 } } }, [gone('a.test', 'x')], at(11, 9));
  assert.deepEqual(h.cookies['a.test x'], { first: at(11, 8), last: at(11, 9), n: 6, d: 1, g: 'cookies' });
});
test('history.js: the given store is not changed; a broken one counts as empty', () => {
  const h = historyAdd(undefined, [gone('a.test', 'x')], at(10, 9)), copy = JSON.stringify(h);
  historyAdd(h, [gone('a.test', 'x')], at(10, 10));
  assert.equal(JSON.stringify(h), copy);
  assert.deepEqual(historyTrim('nonsense', at(10, 9)), { days: {}, cookies: {} });
});
test('history.js: entries older than 30 days go', () => {
  assert.equal(HISTORY_DAYS, 30);
  let h = historyAdd(undefined, [gone('old.test', 'x')], at(1, 12));
  h = historyAdd(h, [gone('new.test', 'y')], at(20, 12));
  const later = historyTrim(h, at(1, 12) + 29 * DAY);
  assert.deepEqual(Object.keys(later.days), ['2026-11-01', '2026-11-20']); assert.equal(Object.keys(later.cookies).length, 2);
  const gone30 = historyAdd(h, [gone('new.test', 'y')], at(1, 12) + 30 * DAY + HOUR);
  assert.deepEqual(Object.keys(gone30.days), ['2026-11-20', '2026-12-01']); assert.deepEqual(Object.keys(gone30.cookies), ['new.test y']);
  assert.deepEqual(historyTrim(h, at(20, 12) + 31 * DAY), { days: {}, cookies: {} });
});
test('history.js: the store stays under a fixed size after 10,000 removals, whatever the names', () => {
  let h, t = at(1, 0);
  for (let i = 0; i < 10000; i++) h = historyAdd(h, [gone(`site-${i}.example.com`, '_ga_' + 'X'.repeat(i % 300))], t += 4 * 60e3);   // 27 days
  assert.equal(Object.keys(h.cookies).length, HISTORY_COOKIES);
  assert.ok(JSON.stringify(h).length < 100e3, String(JSON.stringify(h).length));
  assert.ok(Object.keys(h.cookies).some((k) => k.startsWith('site-9999.example.com _ga_')), 'the newest are the ones kept');
  assert.ok(Object.keys(h.cookies).every((k) => k.length <= 120));
  assert.equal(Object.values(h.days).reduce((n, d) => n + d.cookies, 0), 10000);
});

// ---- in background.js
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 4e12, ...o.storage } });   // the daily cache clear is never due here
const put = (bg, host, name, domain) => bg.setCookie({ url: `https://${host}/`, name, value: 'secret-value', ...(domain ? { domain } : {}) });
test('a scripted day: every removal is counted under its day and group, and per cookie; what only waits is not', async () => {
  const bg = await load(on({ storage: { modes: { C04: 'auto' } } }));
  bg.now = at(10, 9); await put(bg, 'www.example.com', '_ga'); await put(bg, 'ad.doubleclick.net', 'id'); await put(bg, 'www.example.com', 'session');
  bg.now = at(10, 12); await put(bg, 'www.example.com', '_ga'); await put(bg, 'www.google.com', 'NID', '.google.com');
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'ask' }); await put(bg, 'www.example.com', '_gid');   // asked first: waits, not counted
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'auto' }); await bg.settle();                          // now it goes, in the sweep
  bg.now = at(10, 23, 59); await put(bg, 'www.example.com', '_ga');
  bg.now = at(11, 0, 1); await put(bg, 'www.example.com', '_ga');
  assert.deepEqual(await bg.names(), ['session']);
  const want = { days: { '2026-11-10': { cookies: 5, google: 1 }, '2026-11-11': { cookies: 1 } }, cookies: {
    'www.example.com _ga': { first: at(10, 9), last: at(11, 0, 1), n: 4, d: 1, g: 'cookies' }, 'ad.doubleclick.net id': { first: at(10, 9), last: at(10, 9), n: 1, d: 1, g: 'cookies' },
    'google.com NID': { first: at(10, 12), last: at(10, 12), n: 1, d: 1, g: 'google' }, 'www.example.com _gid': { first: at(10, 12), last: at(10, 12), n: 1, d: 1, g: 'cookies' } } };
  assert.deepEqual(bg.state.storage.history, want);
  assert.deepEqual(await bg.send({ type: 'history' }), { ok: true, ...want });
  bg.now = at(11, 0, 1) + 31 * DAY;                                   // a month on: asked for, the old entries are no longer given
  assert.deepEqual(await bg.send({ type: 'history' }), { ok: true, days: {}, cookies: {} });
});
test('an approved removal and a cache clear are counted too; nothing else of them is kept', async () => {
  const bg = await load({ storage: { master: true, cacheClearedAt: 0, modes: { C03: 'ask' } }, cookies: [{ name: '_ga', domain: '.example.com' }] });
  bg.now = at(10, 9); await bg.alarm('sweep');
  assert.equal(bg.state.storage.history, undefined);
  await bg.send({ type: 'approve', group: 'cookies' }); await bg.send({ type: 'approve', group: 'cache' }); await bg.settle();
  assert.deepEqual(bg.state.storage.history, { days: { '2026-11-10': { cookies: 1, cache: 1 } }, cookies: { 'example.com _ga': { first: at(10, 9), last: at(10, 9), n: 1, d: 1, g: 'cookies' } } });
});
test('no cookie value anywhere in storage, nothing in storage.sync, and the report to the 8088 server holds no history', async () => {
  const bg = await load(on({ limits: {}, storage: { modes: { C15: 'auto' } }, cookies: [{ name: 'id', domain: '.doubleclick.net', value: 'secret-value' }] }));
  await put(bg, 'www.example.com', '_ga'); await bg.alarm('sweep'); for (const f of bg.timers.splice(0)) f(); await bg.settle();
  assert.equal(Object.keys(bg.state.storage.history.cookies).length, 2);
  assert.equal(JSON.stringify(bg.state.storage).includes('secret-value'), false);
  assert.deepEqual(bg.calls.filter((c) => c.api.startsWith('storage.sync')), []); assert.deepEqual(bg.state.sync, {});
  assert.ok(bg.reports.length >= 2, 'the sweep and the live removal were reported');
  for (const r of bg.reports) { const text = JSON.stringify(r);
    for (const k of ['history', 'days', 'first', 'last']) assert.equal(text.includes(`"${k}"`), false, k);
    assert.equal(/"n":/.test(text), false); }
});
test('the manifest opens no door to web pages or other extensions', () => {
  const m = require('../extension/manifest.json');
  for (const k of ['web_accessible_resources', 'externally_connectable']) assert.equal(k in m, false, k);
  assert.equal(require('node:fs').readFileSync(require.resolve('../extension/background.js'), 'utf8').includes('onMessageExternal'), false);
});
test('a message from a content script or from another extension is refused: no answer, nothing done', async () => {
  const bg = await load(on()), id = bg.chrome.runtime.id;
  await put(bg, 'www.example.com', '_ga');
  const before = JSON.stringify(bg.state.storage);
  const strangers = [{ id, tab: { id: 5 }, url: 'https://www.youtube.com/watch?v=1', origin: 'https://www.youtube.com' },                       // a content script of ours on a page
    { id: 'a'.repeat(32), url: `chrome-extension://${'a'.repeat(32)}/page.html` }, { id }, {}, null,
    { id, url: `https://evil.test/chrome-extension://${id}/popup.html` }];
  for (const from of strangers) for (const type of ['history', 'clearHistory', 'state', 'setMaster', 'restoreAll'])
    assert.equal(await bg.send({ type, on: false }, from), undefined, `${type} from ${JSON.stringify(from)}`);
  await bg.settle();
  assert.equal(JSON.stringify(bg.state.storage), before);
  // the popup, and the history page open in a tab, are the extension's own pages
  assert.equal((await bg.send({ type: 'history' })).ok, true);
  assert.equal((await bg.send({ type: 'history' }, { id, tab: { id: 9 }, url: `chrome-extension://${id}/history.html` })).ok, true);
});
test('"Clear history" empties it; counting starts again with the next removal', async () => {
  const bg = await load(on());
  bg.now = at(10, 9); await put(bg, 'www.example.com', '_ga');
  assert.deepEqual(await bg.send({ type: 'clearHistory' }), { ok: true }); await bg.settle();
  assert.equal('history' in bg.state.storage, false);
  assert.deepEqual(await bg.send({ type: 'history' }), { ok: true, days: {}, cookies: {} });
  assert.ok(bg.state.storage.log.length > 0, 'the popup\'s own short log is not part of it');
  bg.now = at(10, 10); await put(bg, 'www.example.com', '_ga');
  assert.deepEqual(bg.state.storage.history.cookies, { 'www.example.com _ga': { first: at(10, 10), last: at(10, 10), n: 1, d: 1, g: 'cookies' } });
});
