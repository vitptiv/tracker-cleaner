// Chunk 7 (C22): a removed cookie can be put back for 10 minutes. The whole cookie, value included, waits in
// chrome.storage.session (memory only); nowhere else is a value ever kept.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').asks;
const { UNDO_MS, UNDO_MAX, undoKeep, undoLive, cookieDetails } = require('../extension/undo.js'), { renderPopup } = require('../extension/popup-view.js');
const MIN = 60e3, T = 1.8e12, SECRET = 'secret-value-123';
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: T, ...o.storage } });
const full = (bg, o = {}) => ({ url: 'https://ad.doubleclick.net/x', domain: '.doubleclick.net', name: 'id', value: SECRET, path: '/x', secure: true, httpOnly: true,
  sameSite: 'no_restriction', expirationDate: bg.now / 1000 + 3600, storeId: '1', partitionKey: { topLevelSite: 'https://news.test' }, ...o });
// sets a cookie the cleaner removes at once; returns it as Chrome held it
const lose = async (bg, d) => { const c = await bg.chrome.cookies.set(d); await bg.settle(); return c; };
const all = (bg) => bg.chrome.cookies.getAll({});
const ck = (o = {}) => ({ name: 'a', value: 'v', domain: '.x.test', path: '/', secure: true, httpOnly: false, sameSite: 'lax', storeId: '0', hostOnly: false, session: true, ...o });

test('undoKeep / undoLive: 10 minutes, at most 300, the same cookie removed again replaces its older copy', () => {
  assert.equal(UNDO_MS, 10 * MIN); assert.equal(UNDO_MAX, 300);
  let buf = undoKeep(undefined, ck(), T); buf = undoKeep(buf, ck({ name: 'b' }), T + 1); buf = undoKeep(buf, ck({ value: 'v2' }), T + 2);
  assert.deepEqual(buf, [{ t: T + 1, c: ck({ name: 'b' }) }, { t: T + 2, c: ck({ value: 'v2' }) }]);
  assert.equal(undoKeep(buf, ck({ path: '/p' }), T + 3).length, 3); assert.equal(undoKeep(buf, ck({ partitionKey: { topLevelSite: 'https://a.test' } }), T + 3).length, 3);
  assert.deepEqual(undoLive(buf, T + 1 + UNDO_MS).map((e) => e.c.name), ['a']); assert.deepEqual(undoLive(buf, T + 2 + UNDO_MS), []);
  for (let i = 0; i < 305; i++) buf = undoKeep(buf, ck({ name: 'n' + i }), T + 3);
  assert.equal(buf.length, 300); assert.equal(buf[0].c.name, 'n5');
});
test('cookieDetails: every attribute goes back; host-only and __Host- cookies without a domain; session stays session; expired is skipped', () => {
  const c = ck({ httpOnly: true, sameSite: 'strict', session: false, expirationDate: T / 1000 + 60, storeId: '2', path: '/p', partitionKey: { topLevelSite: 'https://a.test' } });
  assert.deepEqual(cookieDetails(c, T), { url: 'https://x.test/p', name: 'a', value: 'v', domain: '.x.test', path: '/p', secure: true, httpOnly: true, sameSite: 'strict',
    expirationDate: T / 1000 + 60, storeId: '2', partitionKey: { topLevelSite: 'https://a.test' } });
  assert.deepEqual(cookieDetails(ck({ secure: false }), T), { url: 'http://x.test/', name: 'a', value: 'v', domain: '.x.test', path: '/', secure: false, httpOnly: false, sameSite: 'lax', storeId: '0' });
  assert.equal('domain' in cookieDetails(ck({ hostOnly: true, domain: 'x.test' }), T), false);
  assert.equal('domain' in cookieDetails(ck({ name: '__Host-sid' }), T), false);
  assert.equal(cookieDetails(ck({ session: false, expirationDate: T / 1000 }), T), null); assert.equal(cookieDetails(ck({ session: false, expirationDate: T / 1000 - 5 }), T), null);
});
test('restore within 10 minutes gives a cookie equal in every attribute; it is allowed from then on and survives the sweep', async () => {
  const bg = await load(on()), orig = await lose(bg, full(bg));
  assert.deepEqual(await all(bg), []);
  bg.now += 10 * MIN - 1;
  assert.deepEqual(await bg.send({ type: 'restore', site: 'doubleclick.net', name: 'id' }), { ok: true, restored: 1 }); await bg.settle();
  assert.deepEqual(await all(bg), [orig]); assert.equal(orig.value, SECRET); assert.equal(orig.hostOnly, false);
  assert.deepEqual(bg.state.storage.allow, [{ site: 'doubleclick.net', name: 'id' }]);
  await bg.alarm('sweep'); await bg.alarm('proxy'); assert.deepEqual(await all(bg), [orig]);
  assert.deepEqual(await bg.send({ type: 'restore', site: 'doubleclick.net', name: 'id' }), { ok: true, restored: 0 });   // taken out of the buffer
  await bg.send({ type: 'revertAllow', site: 'doubleclick.net', name: 'id' }); assert.deepEqual(await all(bg), []);    // the way back
});
test('the value is held in storage.session only: never in storage.local, the log, the queue, the state reply or a report', async () => {
  const bg = await load(on({ limits: {}, storage: { modes: { C15: 'auto', C04: 'ask' } }, cookies: [{ name: '_ga', domain: '.example.com', value: SECRET }, { name: 'NID', domain: '.google.com', value: SECRET }] }));
  await lose(bg, full(bg)); await bg.alarm('sweep'); for (const t of bg.timers) t(); await bg.settle();
  assert.deepEqual(bg.state.session.undo.map((e) => [e.c.name, e.c.value, e.t]), [['id', SECRET, bg.now], ['_ga', SECRET, bg.now]]);
  const s = await bg.send({ type: 'state' });
  assert.deepEqual(s.undo, [{ t: bg.now, site: 'doubleclick.net', name: 'id' }, { t: bg.now, site: 'example.com', name: '_ga' }]);
  assert.ok(bg.reports.length >= 2 && bg.state.storage.log.length === 3 && bg.state.storage.pending.google.items.length === 1);
  for (const [where, x] of Object.entries({ local: bg.state.storage, state: s, reports: bg.reports })) assert.equal(JSON.stringify(x).includes(SECRET), false, where);
});
test('after 10 minutes there is nothing to restore, and the sweep and the 1-minute alarm empty the buffer', async () => {
  for (const alarm of ['sweep', 'proxy']) {
    const bg = await load(on()); await lose(bg, full(bg));
    bg.now += 10 * MIN;
    assert.deepEqual(await bg.send({ type: 'restore', site: 'doubleclick.net', name: 'id' }), { ok: true, restored: 0 });
    assert.deepEqual(await bg.send({ type: 'restoreAll' }), { ok: true, restored: 0 }); assert.deepEqual((await bg.send({ type: 'state' })).undo, []);
    await lose(bg, full(bg, { name: 'late' })); bg.now += 10 * MIN; await bg.alarm(alarm);
    assert.deepEqual(bg.state.session.undo, [], alarm); assert.deepEqual(await all(bg), []);
  }
});
test('host-only, __Host- and session cookies come back as they were; one that expired meanwhile does not', async () => {
  const bg = await load(on());
  const host = await lose(bg, { url: 'https://sub.doubleclick.net/', name: 'h', value: '1' });
  const pref = await lose(bg, { url: 'https://ad.doubleclick.net/', name: '__Host-t', value: '2', secure: true });
  await lose(bg, full(bg, { name: 'soon', expirationDate: bg.now / 1000 + 60 }));
  assert.deepEqual([host.hostOnly, host.session, host.domain, pref.hostOnly], [true, true, 'sub.doubleclick.net', true]);
  bg.now += 2 * MIN;
  assert.deepEqual(await bg.send({ type: 'restoreAll' }), { ok: true, restored: 2 }); await bg.settle();
  assert.deepEqual(await all(bg), [host, pref]);
  assert.equal(bg.called('cookies.set').slice(-2).some((c) => 'domain' in c.args[0] || 'expirationDate' in c.args[0]), false);
  await bg.alarm('sweep'); assert.deepEqual(await all(bg), [host, pref]);
});
test('a cookie removed by approval can be restored too; bad input is refused', async () => {
  const bg = await load(on({ storage: { modes: { C03: 'ask' } } }));
  const c = await lose(bg, full(bg)); assert.deepEqual(await all(bg), [c]);
  await bg.send({ type: 'approve', group: 'cookies' }); assert.deepEqual(await all(bg), []);
  assert.deepEqual(await bg.send({ type: 'restore', site: 'doubleclick.net' }), { ok: false }); assert.deepEqual(await bg.send({ type: 'restore', name: 'id' }), { ok: false });
  assert.deepEqual(await bg.send({ type: 'restore', site: 'doubleclick.net', name: 'id' }), { ok: true, restored: 1 }); assert.deepEqual(await all(bg), [c]);
});
test('20 removals at once all reach the buffer', async () => {
  const bg = await load(on());
  for (let i = 0; i < 20; i++) bg.chrome.cookies.set({ url: 'https://ad.doubleclick.net/', name: 'c' + i, value: 'v' });
  await bg.settle(); await bg.settle();
  assert.equal(bg.state.session.undo.length, 20); assert.deepEqual(await bg.send({ type: 'restoreAll' }), { ok: true, restored: 20 });
});
test('popup: "Removed in the last 10 minutes: N" with Restore all only when N is above zero; Undo on the removed entries it covers', () => {
  const NOW = new Date(2026, 10, 10, 13, 0).getTime(), act = (name, did, t) => ({ t, cap: 'C03', kind: 'cookie', site: 'example.com', name, did });
  const s = { now: NOW, master: true, hold: {}, groups: [], allow: [], sitesOff: [], log: [act('_ga', 'removed', NOW - MIN), act('_gid', 'removed', NOW - 11 * MIN), act('_hj', 'queued', NOW)],
    undo: [{ t: NOW - MIN, site: 'example.com', name: '_ga' }, { t: NOW - 2 * MIN, site: 'other.test', name: 'x' }, { t: NOW - 10 * MIN, site: 'example.com', name: '_gid' }] };
  const html = renderPopup(s, { host: 'example.com', blocked: null });
  assert.match(html, /Removed in the last 10 minutes: 2 <button[^>]*restoreAll[^>]*>Restore all<\/button>/);
  assert.ok(html.indexOf('Removed in the last') < html.indexOf('This site'));
  assert.equal(html.split('>Undo</button>').length - 1, 1);
  assert.ok(html.includes('&quot;type&quot;:&quot;restore&quot;,&quot;site&quot;:&quot;example.com&quot;,&quot;name&quot;:&quot;_ga&quot;'));
  for (const undo of [[], undefined]) { const none = renderPopup({ ...s, undo }, { host: 'example.com', blocked: null });
    assert.equal(none.includes('Removed in the last'), false); assert.equal(none.includes('Undo'), false); assert.equal(none.includes('Restore all'), false); }
  assert.equal(renderPopup({ ...s, master: undefined }, null).includes('Restore all'), true);
});
