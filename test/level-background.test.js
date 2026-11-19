// 1.30: the strength dial and "Clean now", end to end through background.js's messages.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { renderPopup } = require('../extension/popup-view.js'), { STOPS_HOUR } = require('../extension/learn.js');
const req = async (bg, host, page, path = '/px.gif') => { await bg.request({ url: `https://${host}${path}`, initiator: `https://www.${page}`, type: 'image' }); await bg.settle(); };
const two = async (bg, host = 'trk.example', pages = ['news.example', 'shop.example']) => { for (const p of pages) await req(bg, host, p); };
const ID = (domain = '.trk.example', name = 'uid') => ({ name, domain, value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' });
const fresh = async (o = {}) => { const bg = await load(o); await bg.chrome.runtime.onInstalled.fire({ reason: 'install' }); await bg.settle(); return bg; };
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const at = (level, o = {}) => on({ ...o, storage: { level, ...o.storage } });
const queued = (bg, group) => ((bg.state.storage.pending || {})[group] || { items: [] }).items;
const auto = (bg) => (bg.state.storage.log || []).filter((l) => l.auto).map((l) => [l.cap, l.kind, l.site, l.did].join(' '));
const HOP = (to) => ({ url: `https://hop.example/r?to=${encodeURIComponent(to)}`, redirectUrl: to + '?hid=h-77ab12cd34ef', type: 'main_frame' });
const hops = async (bg) => { for (const to of ['https://blog.example/post', 'https://shop.example/x']) { await bg.redirect(HOP(to)); await bg.settle(); } };
const ELSEWHERE = [{ id: 1, active: true, url: 'https://social.example/feed' }];

test('a new install starts at Strongest and says so; an update keeps what it had (Balanced, or its own rows)', async () => {
  const bg = await fresh();
  assert.equal(bg.state.storage.level, 'strong'); assert.equal(bg.state.storage.master, true);
  const s = await bg.send({ type: 'state' });
  assert.equal(s.level, 'strong'); assert.equal(s.groups.find((g) => g.id === 'unknown').mode, 'yes'); assert.equal(s.groups.find((g) => g.id === 'google').mode, 'auto');
  assert.match(renderPopup(s, null), /Tracker Cleaner is on, at Strongest\./);
  for (const was of [{ master: true }, { master: true, modes: { C03: 'ask' } }]) {
    const old = await load({ storage: { cacheClearedAt: 5, ...was } }); await old.chrome.runtime.onInstalled.fire({ reason: 'update', previousVersion: '1.29' }); await old.settle();
    assert.equal(old.state.storage.level, undefined, 'an update jumped to a level');
    assert.equal((await old.send({ type: 'state' })).level, was.modes ? 'custom' : 'balanced'); }
});
test('setLevel: sets every row on the dial and clears the hand-set ones; the own-switch rows keep theirs; a row set by hand makes it custom', async () => {
  const bg = await load(on({ storage: { modes: { C03: 'off', C04: 'auto', C14: 'auto', C13: 'ask', C24: 'ask' } } }));
  assert.equal((await bg.send({ type: 'state' })).level, 'custom');
  assert.deepEqual(await bg.send({ type: 'setLevel', level: 'ask' }), { ok: true, level: 'ask' }); await bg.settle();
  assert.deepEqual(bg.state.storage.modes, { C14: 'auto', C13: 'ask', C24: 'ask' }); assert.equal(bg.state.storage.level, 'ask');
  let s = await bg.send({ type: 'state' }); assert.equal(s.level, 'ask'); assert.equal(s.groups.find((g) => g.id === 'cookies').mode, 'ask');
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'auto' }); s = await bg.send({ type: 'state' });
  assert.equal(s.level, 'custom'); assert.equal(s.groups.find((g) => g.id === 'cookies').mode, 'auto');
  await bg.send({ type: 'setLevel', level: 'strong' }); s = await bg.send({ type: 'state' }); assert.equal(s.level, 'strong');
  for (const level of [undefined, 'custom', 'max', 7, '__proto__']) assert.deepEqual(await bg.send({ type: 'setLevel', level }), { ok: false });
  assert.equal(bg.state.storage.level, 'strong');
});
test("setMode 'yes' only for the two question rows", async () => {
  const bg = await load(on());
  assert.equal((await bg.send({ type: 'setMode', group: 'unknown', mode: 'yes' })).ok, true); assert.equal(bg.state.storage.modes.C25, 'yes');
  assert.equal((await bg.send({ type: 'setMode', group: 'bounce', mode: 'yes' })).ok, true);
  for (const group of ['cookies', 'wifi', 'tor', 'google']) assert.deepEqual(await bg.send({ type: 'setMode', group, mode: 'yes' }), { ok: false }, group);
});
test('Strongest, no press: a Google identity cookie goes, the sign-in cookies stay', async () => {
  const bg = await fresh({ cookies: [{ name: '_ga', domain: '.example.com', value: 'GA1.2.3' }, { name: 'NID', domain: '.google.com', value: 'n' }, { name: 'SID', domain: '.google.com', value: 's' }] });
  assert.deepEqual(await bg.names(), ['SID']); assert.deepEqual(queued(bg, 'google'), []);
});
test('Strongest, no press: a company on no list seen on two sites is blocked and what it saved removed, by itself, logged as done by itself', async () => {
  const bg = await fresh({ cookies: [ID()], tabs: ELSEWHERE });
  await two(bg);
  assert.deepEqual(bg.blockedHosts(), ['trk.example']); assert.deepEqual(await bg.names(), []);
  assert.deepEqual(queued(bg, 'unknown'), []);
  assert.deepEqual(auto(bg), ['C25 tracker trk.example removed', 'C25 used trk.example removed']);
  assert.ok(bg.state.storage.log.some((l) => l.cap === 'C25' && l.kind === 'cookie' && l.name === 'uid' && l.did === 'removed'));
});
test('Strongest: "Let it through again" undoes the block, and that host is never answered by itself again: it is asked', async () => {
  const bg = await fresh({ cookies: [ID()], tabs: ELSEWHERE });
  await two(bg); assert.deepEqual(bg.blockedHosts(), ['trk.example']);
  assert.equal((await bg.send({ type: 'restoreAll' })).restored, 1, 'the removed cookie is not in Undo');
  await bg.send({ type: 'unstop', site: 'trk.example' }); await bg.settle();
  assert.deepEqual(bg.blockedHosts(), []); assert.deepEqual(bg.state.storage.unauto, ['trk.example']);
  bg.now += 8 * 86400e3; await bg.alarm('sweep');
  assert.deepEqual(bg.blockedHosts(), []); assert.deepEqual(queued(bg, 'unknown').map((i) => [i.kind, i.site]), [['tracker', 'trk.example']]);
});
test('Strongest, no press: a site that passes you along is cleaned and skipped next time, by itself; "Let it through again" undoes the skip', async () => {
  const bg = await fresh({ cookies: [{ name: 'hop_id', domain: 'hop.example', value: 'h-99aa88bb77' }, { name: 'own', domain: 'blog.example', value: 'x' }], tabs: ELSEWHERE });
  await hops(bg);
  assert.deepEqual(await bg.names(), ['own']); assert.ok(bg.state.storage.skipok.includes('hop.example')); assert.ok(bg.state.storage.skip.sites.includes('hop.example'));
  assert.deepEqual(queued(bg, 'bounce'), []); assert.deepEqual(auto(bg), ['C27 bounce hop.example removed', 'C27 bounce hop.example removed', 'C27 skip hop.example removed'], 'each pass, then the skip');
  await bg.send({ type: 'unskip', site: 'hop.example' }); await bg.settle();
  assert.equal(bg.state.storage.skip.sites.includes('hop.example'), false); assert.ok(bg.state.storage.unauto.includes('hop.example'));
});
test('Balanced, no press: as 1.29, questions only', async () => {
  const bg = await load(at('balanced', { cookies: [ID(), { name: 'hop_id', domain: 'hop.example', value: 'h-99aa88bb77' }], tabs: ELSEWHERE }));
  await two(bg); await hops(bg);
  assert.deepEqual(bg.blockedHosts(), []); assert.deepEqual(await bg.names(), ['uid', 'hop_id']); assert.deepEqual(auto(bg), []);
  assert.deepEqual(queued(bg, 'unknown').map((i) => i.kind), ['tracker']); assert.deepEqual(queued(bg, 'bounce').map((i) => i.kind).sort(), ['bounce', 'skip']);
});
test('Clean now on one row: runs that row once as your press, also on Ask first; reports the count, which the row then shows', async () => {
  const bg = await load(at('ask', { cookies: [{ name: '_ga', domain: '.example.com', value: 'GA1.2.3' }, { name: '_gid', domain: '.other.test', value: 'GA1.2.3' }, { name: 'NID', domain: '.google.com', value: 'n' }] }));
  await bg.alarm('sweep'); assert.deepEqual(bg.destructive(), []);
  const r = await bg.send({ type: 'cleanNow', group: 'cookies' }); await bg.settle();
  assert.deepEqual([r.ok, r.cleaned], [true, 2]); assert.deepEqual(await bg.names(), ['NID']);
  const s = await bg.send({ type: 'state' }), row = s.groups.find((g) => g.id === 'cookies');
  assert.deepEqual(row.cleanedNow, { t: bg.now, n: 2 }); assert.equal(s.level, 'ask', 'a press is not a change of level');
  assert.match(renderPopup(s, null).split('data-group="cookies"')[1].split('data-group=')[0], /Cleaned at \d\d:\d\d: 2 removed/);
  assert.deepEqual(await bg.send({ type: 'cleanNow', group: 'google' }).then((x) => x.cleaned), 1); assert.deepEqual(await bg.names(), []);
  for (const group of ['blocking', 'wifi', 'tor', 'tabs', 'allowlist', 'nope', undefined]) assert.deepEqual(await bg.send({ type: 'cleanNow', group }), { ok: false }, String(group));
});
test('Clean now does nothing with the main switch off or never on, while paused, or when the row is off; it is held during a sign-in and says so', async () => {
  const cookies = [{ name: '_ga', domain: '.example.com', value: 'GA1.2.3' }];
  const off = await load({ cookies, storage: { master: false, level: 'ask' } }); assert.equal((await off.send({ type: 'cleanNow', group: 'cookies' })).why, 'off');
  const never = await load({ cookies, storage: { level: 'ask' } }); assert.equal((await never.send({ type: 'cleanNow', group: 'cookies' })).why, 'off');
  const paused = await load(at('ask', { cookies, storage: { pauseUntil: 1.8e12 + 60e3 } })); assert.equal((await paused.send({ type: 'cleanNow', group: 'cookies' })).why, 'paused');
  const rowOff = await load(at('ask', { cookies, storage: { modes: { C03: 'off' } } })); assert.equal((await rowOff.send({ type: 'cleanNow', group: 'cookies' })).why, 'rowOff');
  const signing = await load(at('ask', { cookies, tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/signin' }] }));
  assert.equal((await signing.send({ type: 'cleanNow', group: 'cookies' })).why, 'signin'); assert.equal((await signing.send({ type: 'cleanAll' })).why, 'signin');
  for (const bg of [off, never, paused, rowOff, signing]) { assert.deepEqual(bg.destructive(), []); assert.deepEqual(await bg.names(), ['_ga']); }
  const held = await load(at('ask', { cookies, storage: { sguard: { 'example.com': 1.8e12 - 60e3 } } })); await held.alarm('sweep');
  const r = await held.send({ type: 'cleanNow', group: 'cookies' }); assert.deepEqual([r.ok, r.cleaned], [true, 0]); assert.deepEqual(await held.names(), ['_ga'], 'deleted during that site\'s sign-in hold');
});
test('one press is one pass: a second press while the first runs is refused', async () => {
  const bg = await load(at('ask', { cookies: [{ name: '_ga', domain: '.example.com', value: 'GA1.2.3' }] }));
  const [a, b] = await Promise.all([bg.send({ type: 'cleanAll' }), bg.send({ type: 'cleanAll' })]);
  assert.deepEqual([a.ok, b.ok, b.why], [true, false, 'busy']);
  assert.equal((await bg.send({ type: 'cleanAll' })).ok, true, 'after the pass a press works again');
});
test('Clean now on the question rows answers their waiting questions yes: block, then remove what it saved; skip it', async () => {
  const bg = await load(at('ask', { cookies: [ID(), { name: 'hop_id', domain: 'hop.example', value: 'h-99aa88bb77' }], tabs: ELSEWHERE }));
  await two(bg); await hops(bg);
  let r = await bg.send({ type: 'cleanNow', group: 'unknown' }); await bg.settle();
  assert.equal(r.ok, true); assert.deepEqual(bg.blockedHosts(), ['trk.example']); assert.deepEqual(queued(bg, 'unknown'), []); assert.deepEqual(await bg.names(), ['hop_id']);
  r = await bg.send({ type: 'cleanNow', group: 'bounce' }); await bg.settle();
  assert.deepEqual(await bg.names(), []); assert.ok(bg.state.storage.skipok.includes('hop.example')); assert.deepEqual(queued(bg, 'bounce'), []);
  assert.deepEqual(auto(bg), [], 'a press is not logged as done by itself');
});
test('Clean everything now: every row in one press, the questions answered yes; Wi-Fi is not touched (it keeps its own confirm)', async () => {
  const native = (name, msg) => msg.type === 'list' ? { ok: true, canDelete: 'yes', candidates: [{ uuid: 'u1', name: 'Cafe', reason: 'unused' }] } : { ok: true, removed: [{ uuid: 'u1' }] };
  const bg = await load(at('ask', { native, storage: { cacheClearedAt: 1 }, cookies: [ID(), { name: '_ga', domain: '.example.com', value: 'GA1.2.3' }, { name: 'NID', domain: '.google.com', value: 'n' }, { name: 'SID', domain: '.google.com', value: 's' }], tabs: ELSEWHERE }));
  await two(bg); await bg.alarm('sweep'); assert.equal(queued(bg, 'wifi').length, 1);
  const r = await bg.send({ type: 'cleanAll' }); await bg.settle();
  assert.equal(r.ok, true); assert.deepEqual(await bg.names(), ['SID']); assert.deepEqual(bg.blockedHosts(), ['trk.example']);
  assert.ok(bg.called('browsingData.remove').some((c) => c.args[1].cache && c.args[0].since === 0), 'the saved copies were not cleared');
  assert.equal(bg.called('runtime.sendNativeMessage').some((c) => c.args[1].type === 'remove'), false, 'Wi-Fi removed without its confirm');
  assert.equal(queued(bg, 'wifi').length, 1);
  for (const g of ['cookies', 'google', 'unknown', 'cache']) assert.ok(r.groups[g] > 0, g);
});
test('the popup: the dial on top, its sentence, Custom, the top button and a Clean now on each row that has something to clean', async () => {
  const bg = await fresh();
  const html = renderPopup(await bg.send({ type: 'state' }), null), msgs = [...html.matchAll(/data-msg="([^"]*)"/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"')));
  assert.ok(html.indexOf('data-level') < html.indexOf('type="checkbox"'), 'the dial is not at the top');
  for (const level of ['ask', 'balanced', 'strong']) assert.ok(msgs.some((m) => m.type === 'setLevel' && m.level === level), level);
  assert.equal(msgs.filter((m) => m.type === 'cleanAll').length, 1);
  assert.deepEqual(msgs.filter((m) => m.type === 'cleanNow').map((m) => m.group), ['cookies', 'google', 'crossid', 'unknown', 'bounce', 'own', 'storage', 'permissions']);
  await bg.send({ type: 'setMode', group: 'google', mode: 'ask' });
  assert.match(renderPopup(await bg.send({ type: 'state' }), null), /Custom/);
});
