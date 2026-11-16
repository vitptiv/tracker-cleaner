// The report (1.23) end to end: what background.js answers, built and rendered by report-view.js.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { buildReport, renderReport } = require('../extension/report-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const TAB = { id: 1, active: true, url: 'https://www.example.com/' };
const row = (r, id) => r.features.find((f) => f.id === id);

// ---- step 1
test('feature rows from the real state: sentences, state words, deleted today and waiting', async () => {
  const bg = await load(on({ tabs: [TAB], cookies: [{ name: '_ga', domain: '.example.com' }, { name: 'NID', domain: '.google.com' }] }));
  await bg.alarm('sweep');
  const state = { ...(await bg.send({ type: 'state' })), history: await bg.send({ type: 'history' }) };
  const r = buildReport(state, { id: 1, host: 'www.example.com', matched: ['trackers'] });
  assert.equal(row(r, 'cookies').says, 'Small files that trackers save to recognise you are deleted, while the ones that keep you signed in stay.');
  assert.deepEqual([row(r, 'cookies').state, row(r, 'cookies').count], ['on', '1 deleted today, 0 waiting']);
  assert.deepEqual([row(r, 'google').state, row(r, 'google').count], ['asks first', '0 deleted today, 1 waiting']);
  assert.deepEqual([row(r, 'blocking').state, row(r, 'blocking').count], ['on', '1 blocked on this page']);
  await bg.send({ type: 'pause' });
  assert.equal(row(buildReport(await bg.send({ type: 'state' }), null), 'cookies').state, 'paused');
  assert.match(renderReport(r), /Cookies Google uses to recognise you.*asks first · 0 deleted today, 1 waiting/s);
});

// ---- step 2
const SECRET = 'SECRET-0123456789-abcdefghijklmnopqrstuvwxyz', SHOWN = SECRET.slice(0, 24);
const site = (bg, host = 'www.example.com') => bg.send({ type: 'cookies', host });
const jar = () => [{ name: 'SID', domain: '.example.com', value: SECRET }, { name: 'theme', domain: 'www.example.com', value: 'dark' },
  { name: 'cart', domain: 'shop.example.com', value: SECRET }, { name: 'other', domain: '.other.test', value: SECRET }];
test('cookies of the tab\'s site, read live: the site itself, the sites above and below it, values cut to 24 characters', async () => {
  const bg = await load(on({ tabs: [TAB], cookies: jar() }));
  const r = await site(bg);
  assert.deepEqual(r.cookies.map((c) => [c.domain, c.name, c.value, c.long]), [['.example.com', 'SID', SHOWN, true], ['www.example.com', 'theme', 'dark', false]]);
  assert.deepEqual((await site(bg, 'example.com')).cookies.map((c) => c.name), ['SID', 'theme', 'cart']);
  assert.equal(JSON.stringify(r).includes(SECRET), false);
  for (const host of [undefined, '', 'a b', '<x>', 7]) assert.deepEqual(await bg.send({ type: 'cookies', host }), { ok: false });
});
test('after a report is built and drawn, no value is anywhere in storage, in the report to 8088, or whole in the page', async () => {
  const bg = await load(on({ limits: {}, tabs: [TAB], cookies: jar(), storage: { modes: { C15: 'auto' } } }));
  const state = { ...(await bg.send({ type: 'state' })), history: await bg.send({ type: 'history' }) };
  const html = renderReport(buildReport(state, { id: 1, host: 'www.example.com', matched: [], cookies: (await site(bg)).cookies }));
  await bg.alarm('sweep');
  assert.ok(html.includes(SHOWN)); assert.equal(html.includes(SECRET), false);
  for (const kept of [bg.state.storage, bg.state.session, bg.state.sync, bg.reports]) assert.equal(JSON.stringify(kept).includes(SHOWN), false);
  assert.ok(bg.reports.length > 0);
});
test('the cookies message is answered to the extension\'s own pages only', async () => {
  const bg = await load(on({ cookies: jar() }));
  assert.equal(await bg.send({ type: 'cookies', host: 'www.example.com' }, { id: bg.chrome.runtime.id, url: 'https://www.example.com/', tab: { id: 1 } }), undefined);
});
