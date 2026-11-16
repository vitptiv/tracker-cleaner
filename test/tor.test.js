// The Tor row (1.23 step 7): the extension's own switch decides, with no 8088 server. Before anything is routed the
// Tor port (127.0.0.1:9050) must answer; otherwise Chrome is left alone and the row says so.
// The "running" case is covered here only, by the stand-in: Tor is not installed on this machine.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { buildReport, renderReport } = require('../extension/report-view.js'), { renderPopup } = require('../extension/popup-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const row = async (bg) => { const s = await bg.send({ type: 'state' }), f = buildReport(s, null).features.find((x) => x.id === 'tor'); return [f.state, f.count, s.tor]; };
const NO = 'Routed over Tor: no', YES = 'Routed over Tor: yes, websites see an address of the Tor network, not yours';
const NOT_RUNNING = 'Tor is not running on this computer; nothing is routed';
const STOPPED = 'Routed over Tor: yes, but Tor has stopped answering. Pages will not load until Tor runs again or you switch this off';

test('switched off (as it comes): nothing is routed, the port is not even asked, and the row says "no"', async () => {
  const bg = await load(on());
  await bg.alarm('proxy');
  assert.deepEqual(await row(bg), ['off', NO, { wanted: false, running: null, routed: false }]);
  assert.equal(bg.asked.some((u) => u.includes(':9050')), false); assert.equal(bg.called('proxy.settings.set').length, 0);
});
test('switched on, Tor not running: Chrome is left alone and the row says so; no 8088 server anywhere', async () => {
  const bg = await load(on());
  assert.deepEqual((await bg.send({ type: 'setMode', group: 'tor', mode: 'auto' })).ok, true);
  await bg.alarm('proxy');
  assert.equal(bg.state.proxy, null); assert.equal(bg.called('proxy.settings.set').length, 0);
  assert.deepEqual(await row(bg), ['on', NOT_RUNNING, { wanted: true, running: false, routed: false }]);
  assert.ok(bg.asked.includes('http://127.0.0.1:9050/'));
});
test('switched on, Tor running: Chrome is routed through it at once, and the row says what websites see', async () => {
  const bg = await load(on({ tor: true }));
  await bg.send({ type: 'setMode', group: 'tor', mode: 'auto' });   // routed before the answer, so the row is right when it is drawn
  assert.deepEqual(bg.state.proxy.rules.singleProxy, { scheme: 'socks5', host: '127.0.0.1', port: 9050 });
  assert.deepEqual(bg.state.proxy.rules.bypassList, ['127.0.0.1', 'localhost', '*.localhost', '[::1]']);
  assert.deepEqual(await row(bg), ['on', YES, { wanted: true, running: true, routed: true }]);
  await bg.alarm('proxy'); assert.equal(bg.called('proxy.settings.set').length, 1);   // not set again every minute
});
test('switched off again: the routing is taken away at once and the row says "no"', async () => {
  const bg = await load(on({ tor: true, storage: { modes: { C14: 'auto' } } }));
  await bg.alarm('proxy'); assert.ok(bg.state.proxy);
  await bg.send({ type: 'setMode', group: 'tor', mode: 'off' });
  assert.equal(bg.state.proxy, null);
  assert.deepEqual(await row(bg), ['off', NO, { wanted: false, running: null, routed: false }]);
});
test('Tor starts later: routed at the next minute; Tor stops while routed: it stays routed, so the real address is never shown by accident, and the row says so', async () => {
  const bg = await load(on({ storage: { modes: { C14: 'auto' } } }));
  await bg.alarm('proxy'); assert.equal(bg.state.proxy, null);
  bg.tor = true; await bg.alarm('proxy');
  assert.equal(bg.state.proxy.rules.singleProxy.port, 9050); assert.equal((await row(bg))[1], YES);
  bg.tor = undefined; await bg.alarm('proxy');
  assert.equal(bg.state.proxy.rules.singleProxy.port, 9050); assert.equal(bg.called('proxy.settings.clear').length, 0);
  assert.deepEqual(await row(bg), ['on', STOPPED, { wanted: true, running: false, routed: true }]);
});
test('another program answering on that port is not Tor: nothing is routed', async () => {
  const bg = await load(on({ tor: 'other', storage: { modes: { C14: 'auto' } } }));
  await bg.alarm('proxy');
  assert.equal(bg.state.proxy, null); assert.equal((await row(bg))[1], NOT_RUNNING);
});
test('the 8088 server no longer decides: its torChrome is not looked at', async () => {
  let bg = await load(on({ tor: true, limits: { torChrome: false }, storage: { modes: { C14: 'auto' } } }));
  await bg.alarm('proxy'); assert.ok(bg.state.proxy);
  bg = await load(on({ tor: true, limits: { torChrome: true } }));
  await bg.alarm('proxy'); assert.equal(bg.state.proxy, null);
});
test('the main switch, a pause and cleaning never turned on: not routed; turned off or paused while routed: taken away before the answer', async () => {
  let bg = await load({ tor: true, storage: { modes: { C14: 'auto' } } });   // never turned on
  await bg.alarm('proxy'); assert.equal(bg.state.proxy, null); assert.equal((await row(bg))[1], NO);
  bg = await load(on({ tor: true, storage: { modes: { C14: 'auto' } } }));
  await bg.alarm('proxy'); assert.ok(bg.state.proxy);
  await bg.send({ type: 'pause' }); assert.equal(bg.state.proxy, null);
  assert.deepEqual((await row(bg)).slice(0, 2), ['paused', NO]);
  await bg.send({ type: 'resume' }); assert.ok(bg.state.proxy);
  await bg.send({ type: 'setMaster', on: false }); assert.equal(bg.state.proxy, null);
  assert.deepEqual((await row(bg)).slice(0, 2), ['off', NO]);
});
test('drawn: the row in the report and the row in the popup say the same sentence', async () => {
  for (const [tor, want] of [[{ wanted: true, running: false, routed: false }, NOT_RUNNING], [{ wanted: true, running: true, routed: true }, YES], [{ wanted: true, running: false, routed: true }, STOPPED],
    [{ wanted: false, running: null, routed: false }, NO]]) {
    const s = { now: 1.8e12, master: true, hold: {}, tor, groups: [{ id: 'tor', title: 'Hiding your address from websites (Tor)', says: 'x', ask: true, mode: 'auto', pending: 0, items: [] }] };
    assert.ok(renderReport(buildReport(s, null)).includes(`on · ${want}</span>`), want);
    assert.ok(renderPopup(s, null).includes(`<span>${want}</span>`), want);
  }
  // a state without the answer (an older background script): the row has no sentence, the popup its usual line
  const old = { now: 1.8e12, master: true, hold: {}, groups: [{ id: 'tor', title: 'T', says: 'x', ask: true, mode: 'auto', pending: 0, items: [] }] };
  assert.equal(buildReport(old, null).features[0].count, ''); assert.ok(renderPopup(old, null).includes('Nothing waiting'));
});
test('nothing about Tor is kept or reported: no storage entry, and the port check is the only request', async () => {
  const bg = await load(on({ tor: true, storage: { modes: { C14: 'auto' } } }));
  await bg.alarm('proxy'); await bg.send({ type: 'state' });
  assert.equal(JSON.stringify(bg.state.storage).includes('9050'), false);
  assert.deepEqual([...new Set(bg.asked)].sort(), ['http://127.0.0.1:8088/audit/limits.json', 'http://127.0.0.1:9050/']);
});
