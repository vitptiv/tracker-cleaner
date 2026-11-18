// Follow-ups on chunks 7 and 8: blacklist removals are not offered for undo; the audit view's Drop goes through the
// background worker (pause, action log, undo buffer); only one sweep runs at a time.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), load = require('./load-background.js').asks;
const { renderPopup } = require('../extension/popup-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const log = (bg) => (bg.state.storage.log || []).map((l) => [l.cap, l.kind, l.site, l.name, l.did].join(' '));
const kept = (bg) => (bg.state.session.undo || []).map((e) => e.c.name);

test('a cookie removed because of the blacklist is not kept for undo: no count, nothing in Restore all', async () => {
  const cookies = [{ name: 'sid', domain: '.example.com' }, { name: '_ga', domain: '.example.com' }];
  const bg = await load(on({ limits: { cookieBlacklist: [{ h: 'example.com', n: 'sid' }, { h: 'a.test', n: 'live' }] }, cookies, storage: { modes: { C07: 'auto', C15: 'auto' } } }));
  await bg.alarm('sweep'); await bg.setCookie({ url: 'https://a.test/', name: 'live' });
  assert.deepEqual(await bg.names(), []); assert.deepEqual(kept(bg), ['_ga']);
  assert.deepEqual(log(bg), ['C07 cookie example.com sid removed', 'C03 cookie example.com _ga removed', 'C07 cookie a.test live removed']);
  assert.deepEqual((await bg.send({ type: 'state' })).undo.map((u) => u.name), ['_ga']);
  assert.deepEqual(await bg.send({ type: 'restore', site: 'example.com', name: 'sid' }), { ok: true, restored: 0 });
  assert.deepEqual(await bg.send({ type: 'restoreAll' }), { ok: true, restored: 1 }); assert.deepEqual(await bg.names(), ['_ga']);
});
test('a blacklisted cookie removed on approval is not kept either', async () => {
  const bg = await load(on({ limits: { cookieBlacklist: [{ h: 'example.com', n: 'sid' }] }, cookies: [{ name: 'sid', domain: '.example.com' }], storage: { modes: { C15: 'auto' } } }));
  await bg.alarm('sweep'); assert.deepEqual(await bg.send({ type: 'approve', group: 'storage' }), { ok: true, done: 1, of: 1 });
  assert.deepEqual(await bg.names(), []); assert.deepEqual(kept(bg), []);
});
test('popup: such a log entry says "on your always-drop list" and has neither Undo nor Allow', () => {
  const NOW = 1.8e12, e = (cap, name) => ({ t: NOW, cap, kind: 'cookie', site: 'example.com', name, did: 'removed' });
  const html = renderPopup({ now: NOW, master: true, hold: {}, groups: [], allow: [], sitesOff: [], log: [e('C07', 'sid'), e('C03', '_ga')],
    undo: [{ t: NOW, site: 'example.com', name: 'sid' }, { t: NOW, site: 'example.com', name: '_ga' }] }, { host: 'example.com', blocked: null });
  const row = (name) => html.split(`· ${name}</span>`)[1].split('</div>')[0];
  assert.ok(row('sid').includes('on your always-drop list')); assert.equal(/Undo|Allow/.test(row('sid')), false);
  assert.ok(row('_ga').includes('>Undo</button>') && row('_ga').includes('>Allow</button>')); assert.equal(row('_ga').includes('always-drop'), false);
});

test('drop message: a cookie is removed by the worker, logged, and kept for undo', async () => {
  const bg = await load(on({ cookies: [{ name: 'sid', domain: '.example.com', value: 'v1' }, { name: 'sid', domain: 'www.example.com' }, { name: 'other', domain: '.example.com' }] }));
  assert.deepEqual(await bg.send({ type: 'drop', kind: 'cookie', site: '.example.com', name: 'sid' }), { ok: true, verified: true });
  assert.deepEqual((await bg.chrome.cookies.getAll({})).map((c) => `${c.domain} ${c.name}`), ['www.example.com sid', '.example.com other']);
  assert.deepEqual(bg.state.storage.log, [{ t: bg.now, cap: 'C10', kind: 'cookie', site: 'example.com', name: 'sid', did: 'removed' }]);
  assert.deepEqual(kept(bg), ['sid']); assert.equal(JSON.stringify(bg.state.storage).includes('v1'), false);
  assert.deepEqual(await bg.send({ type: 'restore', site: 'example.com', name: 'sid' }), { ok: true, restored: 1 });
  assert.deepEqual(await bg.send({ type: 'drop', kind: 'cookie', site: 'gone.test', name: 'x' }), { ok: true, verified: true });   // nothing there: nothing logged
  assert.equal(bg.state.storage.log.length, 1);
});
test('drop message: storage, permission and the server list use the same calls as before and are logged', async () => {
  const bg = await load(on());
  for (const m of [{ kind: 'storage', site: 'bad.test' }, { kind: 'permission', site: 'https://bad.test:443', perm: 'camera' }, { kind: 'servers' }])
    assert.deepEqual(await bg.send({ type: 'drop', ...m }), { ok: true }, m.kind);
  const [st, cache] = bg.called('browsingData.remove');
  assert.deepEqual(st.args[0], { origins: ['https://bad.test', 'http://bad.test'] }); assert.equal(st.args[1].localStorage, true); assert.deepEqual(cache.args, [{ since: 0 }, { cache: true }]);
  assert.deepEqual(bg.called('contentSettings.set')[0].args, [{ primaryPattern: 'https://bad.test:443/*', setting: 'block' }]);
  assert.deepEqual(log(bg), ['C06 storage bad.test storage removed', 'C09 permission https://bad.test:443 camera removed', 'C11 cache * http-cache removed']);
  for (const m of [{}, { kind: 'nonsense', site: 'a.test' }, { kind: 'cookie', site: 5, name: 'x' }, { kind: 'cookie', site: 'a.test' }, { kind: 'storage' }, { kind: 'permission', site: 'a.test' }])
    assert.equal((await bg.send({ type: 'drop', ...m })).ok, false, JSON.stringify(m));
});
test('drop message: refused while paused and while switched off; nothing is touched', async () => {
  const bg = await load(on({ cookies: [{ name: 'sid', domain: '.example.com' }] }));
  await bg.send({ type: 'pause' }); await bg.settle();
  for (const m of [{ kind: 'cookie', site: 'example.com', name: 'sid' }, { kind: 'storage', site: 'bad.test' }, { kind: 'servers' }])
    assert.deepEqual(await bg.send({ type: 'drop', ...m }), { ok: false, why: 'paused', error: 'cleaning is paused' });
  await bg.send({ type: 'resume' }); await bg.send({ type: 'setMaster', on: false });
  assert.deepEqual(await bg.send({ type: 'drop', kind: 'servers' }), { ok: false, why: 'off', error: 'cleaning is switched off' });
  assert.deepEqual(bg.destructive(), []); assert.equal(bg.state.storage.log, undefined);
});
test('popup-audit.js: Drop sends the drop message and reports the result to 8088; it calls no destructive Chrome API itself', async () => {
  const src = fs.readFileSync(path.join(__dirname, '../extension/popup-audit.js'), 'utf8');
  for (const api of ['chrome.cookies', 'chrome.browsingData', 'chrome.contentSettings']) assert.equal(src.includes(api), false, api);
  const sent = [], posts = [], replies = [{ ok: true, verified: true }, { ok: false, why: 'paused', error: 'cleaning is paused' }];
  global.chrome = { runtime: { sendMessage: async (m) => { sent.push(m); return replies.shift(); } } };
  global.fetch = async (url, o) => { posts.push([url, JSON.parse(o.body)]); return {}; };
  try { const { drop, dropsFor } = require('../extension/popup-audit.js');
    assert.deepEqual(await drop({ kind: 'cookie', site: '.bad.test', name: 'trk', perm: undefined }), { ok: true, error: undefined, verified: true });
    assert.deepEqual(await drop({ kind: 'servers' }), { ok: false, error: 'cleaning is paused', verified: undefined });
    assert.deepEqual(sent, [{ type: 'drop', kind: 'cookie', site: '.bad.test', name: 'trk', perm: undefined }, { type: 'drop', kind: 'servers' }]);
    assert.deepEqual(posts.map(([u, b]) => [u, b.kind, b.ok]), [['http://127.0.0.1:8088/audit/drops', 'cookie', true], ['http://127.0.0.1:8088/audit/drops', 'servers', false]]);
    assert.deepEqual(dropsFor({ cookies: [{ site: 'a.test', name: 'x' }], servers: { tracking: ['t'] } }), [{ kind: 'cookie', site: 'a.test', name: 'x' }, { kind: 'servers' }]);   // "Drop all" feeds these to drop()
  } finally { delete global.chrome; delete global.fetch; }
  assert.match(fs.readFileSync(path.join(__dirname, '../extension/popup.js'), 'utf8'), /for \(const x of all\) if \(\(await drop\(x\)\)\.ok\)/);
});

const runs = (bg) => bg.called('cookies.getAll').length;
test('one sweep at a time: three requests while the first is still running give exactly two runs', async () => {
  const bg = await load(on()), before = runs(bg);
  bg.fireAlarm('sweep'); bg.fireAlarm('sweep'); bg.fireAlarm('sweep');
  await bg.settle(); await bg.settle();
  assert.equal(runs(bg) - before, 2);
  await bg.alarm('sweep'); assert.equal(runs(bg) - before, 3);       // idle again: a request runs at once
});
test('a setting changed during a sweep is still followed by a sweep of its own before the reply', async () => {
  const bg = await load(on({ storage: { modes: { C03: 'ask' } }, cookies: [{ name: '_ga', domain: '.example.com' }] }));
  bg.fireAlarm('sweep');
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'auto' });
  assert.deepEqual(await bg.names(), []);
});
