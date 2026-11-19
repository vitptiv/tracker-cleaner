// C24 end to end: background.js (in the vm loader) talks through the fake chrome.runtime.sendNativeMessage to the
// real host.js `handle`, which runs on a fake nmcli. Nothing here can reach the system's networks.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').asks;
const { handle } = require('../wifi-helper/host.js'), { renderPopup } = require('../extension/popup-view.js');
const { mayRun, gate } = require('../extension/registry.js');

const NOW = 1.8e12, S = NOW / 1000, DAY = 86400, U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const ROW = (name, n, ago, active = 'no') => `${name}:${U(n)}:802-11-wireless:${ago === null ? 0 : S - ago}:${active}`;
const ROWS = [ROW('Home', 1, 60, 'yes'), ROW('Cafe', 2, 40 * DAY), ROW('Office', 3, 5 * DAY), ROW('Hotel', 4, null)];
// The helper as Chrome would start it: native(hostName, message) -> answer. rows and perm can be changed later.
function helper(perm = 'yes') {
  const h = (name, msg) => { h.asked.push([name, msg]); return handle(msg, run, NOW); };
  const run = (cmd, args) => { const line = args.join(' ');
    if (args[1] === 'delete') h.deleted.push(args[3]);
    return args[0] === 'general' ? `org.freedesktop.NetworkManager.settings.modify.system  ${h.perm} \n` : line.endsWith('show') ? h.rows.join('\n') + '\n' : ''; };
  return Object.assign(h, { asked: [], deleted: [], rows: [...ROWS], perm });
}
const on = (native, storage = {}) => ({ native, storage: { master: true, cacheClearedAt: NOW, ...storage } });
const queued = (bg) => ((bg.state.storage.pending || {}).wifi || { items: [] }).items;
const log = (bg) => (bg.state.storage.log || []).map((l) => [l.cap, l.kind, l.site, l.name, l.did].join(' '));
const row = (state) => renderPopup(state, null).split('data-group="wifi"')[1].split('data-group=')[0];
const wifi = async (bg) => (await bg.send({ type: 'state' })).groups.find((g) => g.id === 'wifi');
const HINT = 'The Wi-Fi helper is not installed';

test('registry: C24 never runs by itself, whatever is stored, so it is never held either', () => {
  for (const master of [true, undefined]) assert.equal(mayRun('C24', { master, modes: { C24: 'auto' } }), 'ask');
  assert.equal(gate('C24', { master: true, modes: { C24: 'auto' } }, { paused: true, guard: true }), 'ask');
  assert.equal(mayRun('C24', { master: true, modes: { C24: 'off' } }), 'no');
  assert.equal(mayRun('C13', { master: true, modes: { C13: 'auto' } }), 'run');   // the others are unchanged
});
test('sweep: the stale networks are queued under wifi and nothing is removed without approval', async () => {
  const h = helper(), bg = await load(on(h));
  await bg.alarm('sweep'); await bg.alarm('sweep');
  assert.deepEqual(queued(bg).map((i) => [i.cap, i.kind, i.site, i.name, i.why]), [['C24', 'wifi', 'Cafe', U(2), 'not used for 40 days'], ['C24', 'wifi', 'Hotel', U(4), 'never used']]);
  assert.ok(h.asked.length >= 2);
  for (const a of h.asked) assert.deepEqual(a, ['com.tracker_cleaner.wifi', { type: 'list' }]);
  assert.deepEqual(h.deleted, []); assert.deepEqual(bg.destructive(), []);
  assert.equal(bg.badge.text, '2'); assert.deepEqual(log(bg), [`C24 wifi Cafe ${U(2)} queued`, `C24 wifi Hotel ${U(4)} queued`]);
  const g = await wifi(bg);
  assert.deepEqual([g.pending, g.helper, g.canDelete, g.noAuto], [2, 'ok', 'yes', true]);
});
test('sweep: a network used again, or gone, leaves the queue', async () => {
  const h = helper(), bg = await load(on(h));
  await bg.alarm('sweep');
  h.rows = [ROWS[0], ROW('Cafe', 2, 60)]; await bg.alarm('sweep');
  assert.deepEqual(queued(bg), []); assert.equal(bg.badge.text, '');
});
test('approve sends exactly the queued UUIDs to the helper and logs each result', async () => {
  const h = helper(), bg = await load(on(h));
  await bg.alarm('sweep');
  h.rows.push(ROW('Later', 5, 90 * DAY));                           // stale, but found after the queue was shown
  h.asked.length = 0;
  assert.deepEqual(await bg.send({ type: 'approve', group: 'wifi' }), { ok: true, done: 2, of: 2 }); await bg.settle();
  assert.deepEqual(h.asked, [['com.tracker_cleaner.wifi', { type: 'remove', uuids: [U(2), U(4)] }]]);
  assert.deepEqual(h.deleted, [U(2), U(4)]);
  assert.deepEqual(queued(bg), []);
  assert.deepEqual(log(bg).slice(2), [`C24 wifi Cafe ${U(2)} removed`, `C24 wifi Hotel ${U(4)} removed`]);
  assert.deepEqual(bg.destructive(), []);                           // no cookie, tab or cache was touched
});
test('approve: what the helper refuses is logged as kept, with its reason; a helper that vanished removes nothing', async () => {
  const h = helper(), bg = await load(on(h));
  await bg.alarm('sweep');
  h.rows[1] = ROW('Cafe', 2, 5, 'yes');                             // in use again since it was queued
  assert.deepEqual(await bg.send({ type: 'approve', group: 'wifi' }), { ok: true, done: 1, of: 2 });
  assert.deepEqual(h.deleted, [U(4)]);
  assert.deepEqual(log(bg).slice(2), [`C24 wifi Cafe ${U(2)} kept: in use now`, `C24 wifi Hotel ${U(4)} removed`]);
  const bg2 = await load(on(helper())); await bg2.alarm('sweep'); bg2.native = null;
  assert.deepEqual(await bg2.send({ type: 'approve', group: 'wifi' }), { ok: true, done: 0, of: 2 });
  assert.deepEqual(log(bg2).slice(2), [`C24 wifi Cafe ${U(2)} kept: the helper did not answer`, `C24 wifi Hotel ${U(4)} kept: the helper did not answer`]);
});
test('approve is refused while paused; the queue stays', async () => {
  const h = helper(), bg = await load(on(h));
  await bg.alarm('sweep'); await bg.send({ type: 'pause' }); await bg.settle();
  assert.deepEqual(await bg.send({ type: 'approve', group: 'wifi' }), { ok: false, why: 'paused' });
  assert.equal(queued(bg).length, 2); assert.deepEqual(h.deleted, []);
});
test('helper missing or answering with an error: nothing queued, the row gives the hint, nothing else notices', async () => {
  const broken = () => ({ ok: false, error: 'nmcli not found' });
  for (const native of [undefined, broken, () => 'nonsense', () => { throw new Error('Native host has exited.'); }]) {
    const bg = await load({ ...on(native, { modes: { C03: 'ask' } }), cookies: [{ name: '_ga', domain: '.example.com' }] });
    await bg.alarm('sweep');
    assert.deepEqual(queued(bg), []); assert.equal(bg.called('runtime.sendNativeMessage').length > 0, true);
    const s = await bg.send({ type: 'state' });
    assert.equal(s.groups.find((g) => g.id === 'wifi').helper, 'missing');
    assert.ok(row(s).includes(HINT)); assert.equal(row(s).includes('saved network'), false);
    assert.equal(renderPopup(s, null).split(HINT).length, 2);        // in that one row only
    assert.deepEqual(log(bg), ['C03 cookie example.com _ga queued']); assert.equal(bg.badge.text, '1');   // the cookie group works as ever
  }
});
test('helper installed later: the hint goes and the networks are queued', async () => {
  const bg = await load(on(undefined));
  await bg.alarm('sweep'); bg.native = helper(); await bg.alarm('sweep');
  assert.equal(queued(bg).length, 2); assert.equal(row(await bg.send({ type: 'state' })).includes(HINT), false);
});
test("a stored 'auto' still asks: queued, not removed, and the row shows Ask first", async () => {
  const h = helper(), bg = await load(on(h, { modes: { C24: 'auto' } }));
  await bg.alarm('sweep'); await bg.send({ type: 'setMode', group: 'wifi', mode: 'auto' }); await bg.settle();
  assert.equal(queued(bg).length, 2); assert.deepEqual(h.deleted, []);
  assert.equal(h.asked.every(([, m]) => m.type === 'list'), true);
  const html = row(await bg.send({ type: 'state' }));
  assert.ok(html.includes('<option value="off">Off</option><option value="ask" selected>Ask first</option></select>'));
  assert.equal(html.includes('Automatic'), false);
});
test('nothing is asked of the helper while paused, and what was queued before stays queued', async () => {
  const h = helper(), bg = await load(on(h, { pauseUntil: NOW + 600e3 }));
  await bg.alarm('sweep'); await bg.alarm('proxy');
  assert.deepEqual(bg.called('runtime.sendNativeMessage'), []); assert.deepEqual(queued(bg), []);
  const h2 = helper(), bg2 = await load(on(h2));
  await bg2.alarm('sweep'); await bg2.send({ type: 'pause' }); await bg2.settle();
  const n = h2.asked.length;
  await bg2.alarm('sweep');
  assert.equal(h2.asked.length, n); assert.equal(queued(bg2).length, 2);
  assert.deepEqual(log(bg2).length, 2);                               // not logged a second time
});
test('off, or the master switch off: the helper is not asked, the queue is emptied, no hint', async () => {
  const h = helper(), bg = await load(on(h));
  await bg.alarm('sweep'); const n = h.asked.length;
  await bg.send({ type: 'setMode', group: 'wifi', mode: 'off' }); await bg.settle();
  assert.equal(h.asked.length, n); assert.deepEqual(queued(bg), []);
  const off = await load(on(undefined, { master: false })); await off.alarm('sweep');
  assert.deepEqual(off.called('runtime.sendNativeMessage'), []);
  assert.equal(row(await off.send({ type: 'state' })).includes(HINT), false);
});
test('deletion not permitted for this user: the row says so and has no Approve button', async () => {
  for (const perm of ['auth', 'no']) {
    const h = helper(perm), bg = await load(on(h));
    await bg.alarm('sweep');
    const s = await bg.send({ type: 'state' }), html = row(s);
    assert.equal(s.groups.find((g) => g.id === 'wifi').canDelete, perm);
    assert.ok(html.includes('2 pending')); assert.ok(html.includes('may not remove networks without a password'));
    assert.equal(html.includes('"approve'), false); assert.equal(html.includes('Remove 2'), false);
    assert.ok(html.includes('>Postpone 1 h</button>'));
  }
});
test('the row: "Remove N saved networks", the warning under it, and each network with its reason', async () => {
  const h = helper(), bg = await load(on(h));
  await bg.alarm('sweep');
  const html = row(await bg.send({ type: 'state' }));
  assert.match(html, /<button data-msg="[^"]*approve[^"]*wifi[^"]*" class="go">Remove 2 saved networks<\/button>/);
  assert.ok(html.indexOf('This cannot be undone') > html.indexOf('Remove 2 saved networks'));
  assert.ok(html.includes('Cafe · not used for 40 days') && html.includes('Hotel · never used'));
  assert.equal(html.split('class="go"').length, 2); assert.equal(html.includes(U(2)), false);
  h.rows.pop(); await bg.alarm('sweep');
  assert.ok(row(await bg.send({ type: 'state' })).includes('>Remove 1 saved network</button>'));
  assert.equal(renderPopup(await bg.send({ type: 'state' }), null).split('This cannot be undone<').length, 2);
});
test('"This site" never lists a Wi-Fi entry, even for a network named like the site', async () => {
  const h = helper(); h.rows.push(`example.com:${U(6)}:802-11-wireless:0:no`);
  const bg = await load(on(h)); await bg.alarm('sweep');
  const html = renderPopup(await bg.send({ type: 'state' }), { host: 'example.com', blocked: null });
  assert.ok(html.includes('Nothing cleaned here yet.'));
});
test('the manifest asks for nativeMessaging', () => assert.ok(require('../extension/manifest.json').permissions.includes('nativeMessaging')));
