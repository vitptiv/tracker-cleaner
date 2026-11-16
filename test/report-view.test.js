// The report (1.23): buildReport(state, tab) on hand-built states and renderReport(report), with the exact sentences.
// No browser, no chrome.
const test = require('node:test'), assert = require('node:assert');
const { buildReport, renderReport } = require('../extension/report-view.js'), { GROUPS } = require('../extension/registry.js');
const NOW = new Date(2026, 10, 15, 14, 5).getTime();   // 15 Nov 2026, 14:05 local
const MODE = { signin: 'auto', blocking: 'auto', cookies: 'auto', google: 'ask', params: 'auto', storage: 'ask', wifi: 'ask', permissions: 'ask', cache: 'ask', allowlist: 'off', tabs: 'off', tor: 'off', server: 'off' };
const NO_ASK = ['signin', 'blocking', 'params', 'server'];
const groups = (over = {}) => GROUPS.map((g) => ({ id: g.id, title: g.title, says: g.says, ask: !NO_ASK.includes(g.id), mode: MODE[g.id], pending: 0, items: [], ...over[g.id] }));
const state = (o = {}, over = {}) => ({ now: NOW, master: true, hold: {}, groups: groups(over), allow: [], always: [], sitesOff: [], history: { days: {}, cookies: {} }, ...o });
const tab = (o = {}) => ({ id: 7, host: 'www.example.com', matched: [], ...o });
const row = (r, id) => r.features.find((f) => f.id === id);
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// ---- step 1: feature rows
const SAYS = {
  signin: 'While you sign in somewhere, and for five minutes after, nothing is cleaned so the sign-in cannot break.',
  blocking: 'Pages are stopped from calling the companies that follow you from site to site, and YouTube plays without its ads.',
  cookies: 'Small files that trackers save to recognise you are deleted, while the ones that keep you signed in stay.',
  google: 'Small files that Google and YouTube save to recognise you when you are not signed in are deleted, while the ones that keep you signed in stay.',
  params: 'The extra letters that advertisers add to a link to see where you came from are cut off before the page opens.',
  storage: 'Other things a site has saved in your browser are emptied, but only for the sites you chose yourself.',
  wifi: 'Wi-Fi networks this computer remembers but has not used for 30 days are forgotten.',
  permissions: 'Sites you chose yourself are stopped from doing things such as sending notifications or using the camera.',
  cache: 'The copies of pages that Chrome saves to load them faster are thrown away once a day.',
  allowlist: 'Every small file that sites save to recognise you is deleted, except the ones on your own list.',
  tabs: 'When more tabs are open than the number you set, the ones you used least are closed.',
  tor: 'Chrome reaches websites through the Tor network, so they cannot see where you are.',
  server: 'A summary of what was cleaned is sent to a program on this computer, and nowhere else.' };

test('every group has one plain sentence, and the row carries it with the title', () => {
  assert.deepEqual(Object.fromEntries(GROUPS.map((g) => [g.id, g.says])), SAYS);
  const r = buildReport(state(), tab());
  assert.equal(r.site, 'www.example.com');
  assert.deepEqual(r.features.map((f) => f.id), GROUPS.map((g) => g.id));
  for (const f of r.features) { assert.equal(f.says, SAYS[f.id]); assert.equal(f.title, GROUPS.find((g) => g.id === f.id).title); }
});
test('blocked: the matches of the two blocking rule files on this tab; cleaned links: the matches of the link rule', () => {
  const r = buildReport(state(), tab({ matched: ['trackers', 'google-paths', 'trackers', 'url-params', '_dynamic'] }));
  assert.equal(row(r, 'blocking').count, '3 blocked on this page');
  assert.equal(row(r, 'params').count, '1 link cleaned on this page');
  assert.equal(row(buildReport(state(), tab({ matched: ['url-params', 'url-params'] })), 'params').count, '2 links cleaned on this page');
});
test('a row with nothing says 0, never an empty cell', () => {
  const r = buildReport(state(), tab());
  assert.equal(row(r, 'blocking').count, '0 blocked on this page');
  assert.equal(row(r, 'params').count, '0 links cleaned on this page');
  assert.equal(row(r, 'cookies').count, '0 deleted today, 0 waiting');
  const html = renderReport(r);
  assert.ok(html.includes('0 blocked on this page')); assert.ok(html.includes('0 deleted today, 0 waiting'));
});
test('Chrome did not say what it blocked (it limits how often it may be asked): the row says so', () => {
  for (const t of [tab({ matched: null }), null]) { const r = buildReport(state(), t);
    assert.equal(row(r, 'blocking').count, 'Chrome did not say how many it blocked'); assert.equal(row(r, 'params').count, 'Chrome did not say how many links it cleaned'); }
});
test('deleted today comes from the history, waiting from the queue, each with the word that fits the group', () => {
  const history = { days: { '2026-11-15': { cookies: 4, google: 1, tabs: 2, cache: 1, permissions: 3, wifi: 1 }, '2026-11-14': { cookies: 9, storage: 5 } }, cookies: {} };
  const r = buildReport(state({ history }, { google: { pending: 1 }, cookies: { pending: 12 }, wifi: { pending: 2 } }), tab());
  assert.equal(row(r, 'cookies').count, '4 deleted today, 12 waiting');
  assert.equal(row(r, 'google').count, '1 deleted today, 1 waiting');
  assert.equal(row(r, 'storage').count, '0 emptied today, 0 waiting');
  assert.equal(row(r, 'allowlist').count, '0 deleted today, 0 waiting');
  assert.equal(row(r, 'tabs').count, '2 closed today, 0 waiting');
  assert.equal(row(r, 'cache').count, '1 cleared today, 0 waiting');
  assert.equal(row(r, 'permissions').count, '3 blocked today, 0 waiting');
  assert.equal(row(r, 'wifi').count, '1 forgotten today, 2 waiting');
  for (const id of ['signin', 'tor', 'server']) assert.equal(row(r, id).count, '', id);   // nothing to count
});
test('state words: on, asks first, off, paused, held while you sign in', () => {
  const words = (s) => Object.fromEntries(buildReport(s, tab()).features.map((f) => [f.id, f.state]));
  let w = words(state());
  assert.deepEqual([w.signin, w.blocking, w.cookies, w.google, w.params, w.tabs], ['on', 'on', 'on', 'asks first', 'on', 'off']);
  w = words(state({ master: false }));
  assert.deepEqual([...new Set(Object.values(w))], ['off']);
  w = words(state({ hold: { paused: true, pauseUntil: NOW + 6e5 } }));
  assert.deepEqual([w.blocking, w.cookies, w.google, w.tabs], ['paused', 'paused', 'paused', 'off']);
  // a sign-in is going on: what deletes by itself is held; what only asks still asks, what deletes nothing goes on
  w = words(state({ hold: { guard: true } }));
  assert.deepEqual([w.signin, w.blocking, w.cookies, w.google, w.params], ['on', 'on', 'held while you sign in', 'asks first', 'on']);
  // nothing chosen yet (a fresh install): nothing is deleted without asking
  w = words(state({ master: undefined }));
  assert.deepEqual([w.blocking, w.cookies, w.google], ['on', 'asks first', 'asks first']);
  // stored modes the group cannot have: a group with nothing to ask about is off, Wi-Fi never runs by itself
  w = words(state({}, { blocking: { mode: 'ask' }, wifi: { mode: 'auto', noAuto: true } }));
  assert.deepEqual([w.blocking, w.wifi], ['off', 'asks first']);
});
test('rendered: a heading, then per row the title, the state word, the count and the sentence; no capability code; hostile text escaped', () => {
  const html = renderReport(buildReport(state({}, { cookies: { title: '<img src=x>', says: '"><script>' } }), tab({ host: '<b>x' })));
  assert.match(html, /<h2>What Tracker Cleaner does for you<\/h2>/);
  const t = text(html);
  assert.ok(t.includes('Ads and trackers blocked as pages load' + 'on · 0 blocked on this page' + SAYS.blocking));
  assert.ok(t.includes('Pause cleaning while you sign in' + 'on' + SAYS.signin));
  assert.doesNotMatch(html, /\bC\d\d\b/); assert.doesNotMatch(html, /<img|<script|<b>x/);
});
