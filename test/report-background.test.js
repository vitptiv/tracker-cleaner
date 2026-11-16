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
