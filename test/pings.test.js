// R4 (C26): pings that tell someone which link you followed. Requests of the kind "ping" to another company are
// blocked (one dynamic rule), and a link's own ping address is taken off as it is pressed (no-ping.js).
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('node:vm');
const load = require('./load-background.js'), { cap, mayRun, GROUPS } = require('../extension/registry.js');
const rule = (bg) => bg.state.dynamic.find((r) => r.id === 100003), script = (bg) => bg.state.scripts.find((s) => s.id === 'no-ping');

test('C26 is part of blocking: automatic, harmless, working before anything is turned on', () => {
  assert.deepEqual([cap('C26').group, cap('C26').mode, cap('C26').destructive], ['blocking', 'auto', false]);
  assert.equal(mayRun('C26', {}), 'run'); assert.ok(GROUPS.find((g) => g.id === 'blocking').caps.includes('C26'));
});
test('fresh install: pings to other companies are blocked, never on a sign-in page, and the link script runs everywhere but there', async () => {
  const bg = await load(), r = rule(bg), s = script(bg);
  assert.deepEqual([r.action.type, r.condition.resourceTypes, r.condition.domainType], ['block', ['ping'], 'thirdParty']);
  for (const k of ['excludedInitiatorDomains', 'excludedRequestDomains']) assert.ok(r.condition[k].includes('accounts.google.com'), k);
  assert.deepEqual([s.js, s.matches, s.allFrames, s.runAt], [['no-ping.js'], ['http://*/*', 'https://*/*'], true, 'document_start']);
  assert.ok(s.excludeMatches.includes('*://accounts.google.com/*'));
  assert.deepEqual(bg.destructive(), []);
});
test('off with its group, with the main switch and while paused; back on afterwards', async () => {
  const bg = await load({ storage: { master: true } });
  await bg.send({ type: 'setMode', group: 'blocking', mode: 'off' }); await bg.settle(); assert.equal(rule(bg), undefined); assert.equal(script(bg), undefined);
  await bg.send({ type: 'setMode', group: 'blocking', mode: 'auto' }); await bg.settle(); assert.ok(rule(bg)); assert.ok(script(bg));
  await bg.send({ type: 'pause' }); await bg.settle(); assert.equal(rule(bg), undefined); assert.equal(script(bg), undefined);
  await bg.send({ type: 'resume' }); await bg.settle(); assert.ok(rule(bg)); assert.ok(script(bg));
  await bg.send({ type: 'setMaster', on: false }); await bg.settle(); assert.equal(rule(bg), undefined); assert.equal(script(bg), undefined);
});
test('no-ping.js: a pressed link loses its ping address before the browser follows it; nothing else is touched', () => {
  const on = {}, link = { ping: '/ping?c=1', removeAttribute(n) { delete this[n]; } }, plain = { removeAttribute() { throw new Error('touched'); } };
  vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../extension/no-ping.js'), 'utf8'), { addEventListener: (ev, f, capture) => { assert.equal(capture, true); on[ev] = f; } });
  assert.deepEqual(Object.keys(on), ['pointerdown', 'mousedown', 'click', 'auxclick', 'contextmenu', 'keydown']);
  on.click({ target: { closest: (sel) => { assert.equal(sel, 'a[ping], area[ping]'); return null; } } }); on.keydown({ target: {} }); on.click({});
  on.pointerdown({ target: { closest: () => link } });
  assert.equal('ping' in link, false);
});
