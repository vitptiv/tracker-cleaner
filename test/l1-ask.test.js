// L1 (fourth audit). The extended principle: evidence a page can stage triggers nothing by itself but a question.
// Blocking too. Only the shipped lists and the rules that need no evidence act by themselves.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { buildReport, renderReport } = require('../extension/report-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const req = async (bg, url, page) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script' }); await bg.settle(); };
const answer = async (bg, url, page) => { await bg.answer({ url, initiator: `https://www.${page}`, type: 'script', responseHeaders: [{ name: 'Set-Cookie', value: 'tid=t-77ab12cd34ef; SameSite=None; Secure' }] }); await bg.settle(); };
const cookie = (domain, name = 'uid') => ({ name, domain, value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' });
const asks = (bg) => ((bg.state.storage.pending || {}).unknown || { items: [] }).items.map((i) => [i.kind, i.site]);

test('the audit scenario: one visit to a page that stages every kind of evidence for a payment check, a captcha, a social site and a bank: nothing is blocked, nothing is deleted', async () => {
  const hosts = ['centinelapi.cardinalcommerce.com', 'client-api.arkoselabs.com', 'geo.captcha-delivery.com', 'www.facebook.com', 'api.bank.example'];
  const bg = await load(on({ cookies: [{ name: 'x', domain: 'evil.example', value: 'k9x2m4q8r1t7' }, ...hosts.map((h, i) => cookie(h, 'c' + i))] }));
  for (const h of hosts) { await answer(bg, `https://${h}/a`, 'evil.example'); await req(bg, `https://${h}/a?u=k9x2m4q8r1t7`, 'evil.example'); await req(bg, `https://${h}/a`, 'evil2.example'); }
  for (let i = 0; i < 6; i++) { bg.now += 15 * 60e3; await bg.alarm('sweep'); }
  assert.deepEqual(bg.state.storage.stopped || [], []); assert.deepEqual(bg.blockedHosts(), []); assert.deepEqual(bg.called('cookies.remove'), []);
  assert.equal(bg.called('browsingData.remove').some((c) => c.args[1].cache && c.args[0].since === 0), false, 'the saved copies were cleared');
  assert.ok(asks(bg).length >= 1 && asks(bg).every(([k]) => k === 'tracker'));
});
test('the question, and Block: that exact host is blocked on other sites, not its subdomains or neighbours; then the second question', async () => {
  const bg = await load(on({ cookies: [cookie('t.trk.example')] }));
  await req(bg, 'https://t.trk.example/a.js', 'news.example'); await req(bg, 'https://t.trk.example/a.js', 'shop.example');
  const html = renderReport(buildReport(await bg.send({ type: 'state' }), null));
  assert.ok(html.includes('t.trk.example follows you on 2 sites. Block it on other sites?')); assert.match(html, />Block<\/button>.*>Not now<\/button>/);
  await bg.block('t.trk.example');
  assert.deepEqual(bg.state.storage.stopped, ['t.trk.example']); assert.deepEqual(bg.blockedHosts(), ['t.trk.example']);
  for (const u of ['https://t.trk.example/x', 'http://t.trk.example:8080/', 'wss://t.trk.example/s', 'https://T.TRK.EXAMPLE/']) assert.ok(bg.blocks(u), u);
  for (const u of ['https://sub.t.trk.example/', 'https://trk.example/', 'https://xt.trk.example/', 'https://t.trk.example.evil.test/', 'https://evil.test/t.trk.example', 'https://evil.test/?u=https://t.trk.example/', 'https://t-trk.example/', 'https://tXtrk.example/']) assert.equal(bg.blocks(u), false, u);
  assert.deepEqual(asks(bg), [['used', 't.trk.example']]);
  assert.deepEqual(await bg.names(), ['uid'], 'Block deleted something');
});
test('the group button never blocks; Not now puts the question off for a week', async () => {
  const bg = await load(on({ cookies: [cookie('trk.example')] }));
  await req(bg, 'https://trk.example/a.js', 'news.example'); await req(bg, 'https://trk.example/a.js', 'shop.example');
  await bg.send({ type: 'approve', group: 'unknown' }); await bg.settle(); assert.deepEqual(bg.state.storage.stopped || [], []);
  await bg.send({ type: 'notNow', group: 'unknown', site: 'trk.example' }); assert.deepEqual(asks(bg), []);
  bg.now += 8 * 86400e3; await bg.alarm('sweep'); assert.deepEqual(asks(bg), [['tracker', 'trk.example']]);
});
test('a cookie set for a whole shared name is no evidence against a host under it', async () => {
  const bg = await load(on({ cookies: [cookie('.tumblr.com'), cookie('.b-cdn.net')] }));
  for (const h of ['evil.tumblr.com', 'x.b-cdn.net']) { await req(bg, `https://${h}/a.js`, 'news.example'); await req(bg, `https://${h}/a.js`, 'shop.example'); }
  await bg.alarm('sweep'); assert.deepEqual(asks(bg), []);
});
