// L3 (fourth audit): no learned "cut this off addresses" questions at all. Only the shipped list of tracking tags is cut.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), load = require('./load-background.js');
const { buildReport, renderReport } = require('../extension/report-view.js');
const enc = encodeURIComponent, ID = 'h-77ab12cd34ef';
const on = (o = {}) => ({ tabs: [{ id: 1, active: true, url: 'https://mail.example/inbox' }], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });

test('the audit scenario: a redirect that adds SAMLRequest, otp and a name made of page text: no question, nothing stored of the names, no rule', async () => {
  const bg = await load(on());
  const names = ['SAMLRequest', 'otp', 'hid', '<img src=x onerror=alert(1)>', 'Press Approve to continue'];
  await bg.redirect({ url: `https://hop.example/r?to=${enc('https://blog.example/post')}`, redirectUrl: `https://blog.example/post?${names.map((n) => `${enc(n)}=${ID}`).join('&')}`, type: 'main_frame' }); await bg.settle(); await bg.alarm('sweep');
  const items = ((bg.state.storage.pending || {}).bounce || { items: [] }).items;
  assert.equal(items.some((i) => i.kind === 'param'), false);
  const stored = JSON.stringify(bg.state.storage); for (const n of names) assert.equal(stored.includes(n), false, n);
  assert.equal(bg.state.dynamic.some((r) => r.action.type === 'redirect'), false);
  assert.equal(renderReport(buildReport(await bg.send({ type: 'state' }), null)).includes('Cut it off'), false);
});
test('the messages and the list for learned tags are gone; a list an older version stored is not used', async () => {
  const bg = await load(on({ storage: { params: ['v', 'client_id'] } })); await bg.alarm('sweep');
  assert.equal(bg.state.dynamic.some((r) => r.action.type === 'redirect'), false);
  assert.equal(await bg.send({ type: 'unparam', name: 'v' }), undefined); assert.equal('params' in (await bg.send({ type: 'state' })), false);
  const src = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');
  assert.equal(/stripParam|unparam|removeParams/.test(src), false);
  assert.deepEqual(bg.state.rulesets.includes('url-params'), true, 'the shipped list is still cut');
});
