// S11: pages on trackers' own addresses are taken out of Chrome's history, only after the user allowed it with a press.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { renderPopup } = require('../extension/popup-view.js'), manifest = require('../extension/manifest.json');
const PAGES = ['https://www.trk.example/feed', 'https://trk.example/a?b=1', 'https://news.example/story?from=trk.example', 'https://nottrk.example/', 'https://trk.example.evil.test/', 'https://ad.doubleclick.net/x', 'https://used.example/home'];
const on = (o = {}) => ({ history: PAGES, granted: ['history'], ...o, storage: { master: true, cacheClearedAt: 1.8e12, stopped: ['trk.example'], hard: ['trk.example'], histOn: true, ...o.storage } });
const left = (bg) => bg.state.history.map((h) => h.url);

test('the permission is optional: Chrome does not ask for it at install', () => {
  assert.deepEqual(manifest.optional_permissions, ['history']); assert.equal(manifest.permissions.includes('history'), false);
});
test('allowed and switched on: pages on stopped and listed trackers\' own addresses go, every other page stays', async () => {
  const bg = await load(on()); await bg.alarm('sweep');
  assert.deepEqual(left(bg), ['https://news.example/story?from=trk.example', 'https://nottrk.example/', 'https://trk.example.evil.test/', 'https://used.example/home']);
  assert.equal(JSON.stringify(bg.state.storage).includes('/feed'), false, 'an address from the history is stored'); assert.deepEqual(bg.reports, []);
  const n = bg.called('history.search').length; await bg.alarm('sweep');
  assert.equal(bg.called('history.search').length, n, 'asked again within a day');
});
test('nothing is read or removed: not switched on, not allowed by Chrome, cleaning off, paused, or a sign-in in front', async () => {
  for (const o of [on({ storage: { histOn: false } }), on({ granted: [] }), on({ storage: { master: false } }), on({ storage: { pauseUntil: 1.8e12 + 60e3 } }), on({ tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/signin' }] })]) {
    const bg = await load(o); await bg.alarm('sweep');
    assert.deepEqual(left(bg), PAGES); assert.deepEqual(bg.called('history.search'), []); assert.deepEqual(bg.called('history.deleteUrl'), []); }
});
test('a stopped company whose site the user opens as a page keeps its history', async () => {
  const bg = await load(on({ storage: { stopped: ['used.example'], hard: ['used.example'] } }));
  await bg.opens('https://used.example/home'); await bg.alarm('sweep');
  assert.ok(left(bg).includes('https://used.example/home'));
});
test('the switch: only true or false is taken; the popup offers it with what Chrome will ask, and says when it is on', async () => {
  const bg = await load(on({ storage: { histOn: false } }));
  for (const v of [undefined, 'yes', 1]) assert.deepEqual(await bg.send({ type: 'histOn', on: v }), { ok: false });
  let html = renderPopup(await bg.send({ type: 'state' }), null);
  assert.match(html, /<button data-perm="history"[^>]*>Also remove trackers&#39; pages from my history<\/button>/);
  assert.ok(html.includes('Chrome will ask you to let Tracker Cleaner read your history. Only pages on trackers&#39; own addresses are removed; nothing of your history is kept or sent anywhere.'));
  assert.deepEqual(await bg.send({ type: 'histOn', on: true }), { ok: true }); await bg.settle();
  html = renderPopup(await bg.send({ type: 'state' }), null);
  assert.ok(html.includes('Pages on trackers&#39; own addresses are taken out of your history once a day.')); assert.match(html, /<button data-perm-off="history"/);
  assert.equal(left(bg).includes('https://trk.example/a?b=1'), false, 'switching it on did not clean at once');
});
test('carried over, as changed by J6: with 300 companies blocked the popup says that the oldest block makes room for a new one', () => {
  const s = { now: 1, master: true, hold: {}, groups: [], stopped: Array.from({ length: 300 }, (_, i) => `t${i}.example`) };
  assert.ok(renderPopup(s, null).includes('300 companies are blocked, the most Tracker Cleaner keeps: when a new one is blocked, the one blocked longest ago is let through again.'));
  assert.equal(renderPopup({ ...s, stopped: s.stopped.slice(1) }, null).includes('300 companies are blocked'), false);
});
test('carried over: the report does not say "deleted automatically" for a cookie of a stopped company that is kept', async () => {
  const { buildReport } = require('../extension/report-view.js');
  const bg = await load(on({ cookies: [{ name: 'sess', domain: '.trk.example', value: 's-77ab12cd34ef', httpOnly: true, secure: true, sameSite: 'no_restriction' }, { name: 'uid', domain: '.trk.example', value: 'u-77ab12cd34ef', sameSite: 'no_restriction' }] }));
  const got = await bg.send({ type: 'cookies', host: 'trk.example' });
  assert.deepEqual(got.cookies.map((c) => [c.name, c.used === true]), [['sess', true], ['uid', false]]);
  const rows = buildReport(await bg.send({ type: 'state' }), { id: 1, host: 'news.example', cookies: got.cookies }).cookies.rows;
  assert.equal(rows[0].what, 'comes from a company that was stopped, kept because you may be signed in there');
  assert.match(rows[1].what, /deleted automatically$/);
});
