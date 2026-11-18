// R5 (C27): a site that passes the user straight on to another site (a redirect, no page shown). What it saved is
// deleted and the ID it added to the address is cut off, each after one question.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').asks;
const { bounceAdded } = require('../extension/learn.js');
const DEST = 'https://blog.example/post?id=7', HOP = `https://hop.example/r?c=c-1a2b3c4d5e&to=${encodeURIComponent(DEST)}`;
const pass = async (bg, from = HOP, to = DEST + '&xclid=c-1a2b3c4d5e', type = 'main_frame') => { await bg.redirect({ url: from, redirectUrl: to, type }); await bg.settle(); };
const on = (o = {}) => ({ cookies: [{ name: 'hop_id', domain: 'hop.example', value: 'h-99aa88bb77' }, { name: 'SID', domain: 'hop.example', value: 'signed-in' }, { name: 'own', domain: 'blog.example', value: 'x' }],
  tabs: [{ id: 1, active: true, url: 'https://social.example/feed' }], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const queued = (bg) => ((bg.state.storage.pending || {}).bounce || { items: [] }).items.map((i) => [i.kind, i.site, i.name]);
const rule = (bg) => bg.state.dynamic.find((r) => r.id === 100002);
const ASK = [['bounce', 'hop.example', 'passed you on without showing a page'], ['param', 'hop.example', 'xclid']];

test('what a passing site added: only what was not in the address it was asked to open, only ID-like values, never a sign-in answer', () => {
  assert.deepEqual(bounceAdded(HOP, DEST + '&xclid=c-1a2b3c4d5e&lang=en&code=c-1a2b3c4d5e&state=s-1a2b3c4d5e'), ['xclid']);
  assert.deepEqual(bounceAdded('https://youtu.be/dQw4w9WgXcQ', 'https://www.youtube.com/watch?v=dQw4w9WgXcQ&feature=youtu.be'), []);
  assert.deepEqual(bounceAdded(HOP, 'https://elsewhere.example/?xclid=c-1a2b3c4d5e'), []);
  assert.deepEqual(bounceAdded('nonsense', DEST), []);
});
test('passed through once: one question waits, nothing is deleted or changed; no question about what it added to the address (1.25, L3)', async () => {
  const bg = await load(on()); await pass(bg);
  assert.deepEqual(queued(bg), [ASK[0]]); assert.deepEqual(bg.destructive(), []); assert.equal(rule(bg), undefined);
});
test('Remove: its cookies and storage go, the sign-in cookie stays; the next pass asks again about what it saved this time', async () => {
  const bg = await load(on()); await pass(bg);
  assert.deepEqual(await bg.send({ type: 'approve', group: 'bounce', site: 'hop.example', name: ASK[0][2] }), { ok: true, done: 1, of: 1 }); await bg.settle();
  assert.deepEqual(await bg.names(), ['SID', 'own']);
  assert.deepEqual(bg.called('browsingData.remove').map((c) => c.args[0].origins), [['https://hop.example', 'http://hop.example']]);
  assert.deepEqual(queued(bg), []); assert.equal(rule(bg), undefined);
  await pass(bg); assert.deepEqual(queued(bg), [ASK[0]]);
});
test('automatic: still nothing by itself (1.25, J1): a question', async () => {
  const bg = await load(on({ storage: { modes: { C27: 'auto' } } })); await pass(bg);
  assert.deepEqual(await bg.names(), ['hop_id', 'SID', 'own']); assert.equal(rule(bg), undefined); assert.deepEqual(queued(bg), [['bounce', 'hop.example', 'passed you on without showing a page']]);
});
test('left alone: a sign-in on the way, a sign-in going on, a site open in a tab, the same site, a frame, the group off', async () => {
  const bg = await load(on());
  await pass(bg, 'https://hop.example/oauth/authorize?client_id=a&redirect_uri=b', 'https://blog.example/cb?code=c-1a2b3c4d5e');
  await pass(bg, 'https://accounts.google.com/x', DEST); await pass(bg, HOP, 'https://blog.example/login?next=1');
  await pass(bg, 'https://social.example/out?u=1', DEST); await pass(bg, 'https://hop.example/a', 'https://www.hop.example/b'); await pass(bg, HOP, DEST, 'sub_frame');
  assert.equal(bg.state.storage.bounce, undefined); assert.deepEqual(queued(bg), []);
  const signing = await load(on({ storage: { guardUntil: 1.8e12 + 60e3 } })); await pass(signing);
  assert.equal(signing.state.storage.bounce, undefined);
  const off = await load(on({ storage: { modes: { C27: 'off' } } })); await pass(off);
  assert.equal(off.state.storage.bounce, undefined);
});
test('Not now on one question leaves the other', async () => {
  const bg = await load(on()); await pass(bg);
  await bg.send({ type: 'notNow', group: 'bounce', site: 'hop.example', name: 'xclid' }); await bg.settle();
  assert.deepEqual(queued(bg), [ASK[0]]);
});
