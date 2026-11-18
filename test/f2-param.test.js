// F2 (audit): one redirect must not be able to add a name of its choosing to the rule that cuts tags off every address.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { bounceAdded } = require('../extension/learn.js');
const ID = 'h-77ab12cd34ef', enc = encodeURIComponent;
const on = (o = {}) => ({ cookies: [{ name: 'hop_id', domain: '.hop.example', value: ID }], tabs: [{ id: 1, active: true, url: 'https://social.example/feed' }], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const pass = async (bg, added) => { await bg.redirect({ url: `https://go.hop.example/r?to=${enc('https://blog.example/post')}`, redirectUrl: `https://blog.example/post?${added}`, type: 'main_frame' }); await bg.settle(); };
const asked = (bg) => ((bg.state.storage.pending || {}).bounce || { items: [] }).items.filter((i) => i.kind === 'param').map((i) => [i.site, i.name]);
const cutRule = (bg) => bg.state.dynamic.find((r) => r.id === 100002);

test('everything automatic: an added tag is never cut by itself, it becomes one question; nor is the passing site cleaned by itself (1.25, J1)', async () => {
  const bg = await load(on()); await pass(bg, `hid=${ID}`);
  assert.deepEqual(bg.state.storage.params || [], []); assert.equal(cutRule(bg), undefined);
  assert.deepEqual(asked(bg), [['hop.example', 'hid']]); assert.deepEqual(await bg.names(), ['hop_id']);
  assert.deepEqual(await bg.send({ type: 'approve', group: 'bounce', site: 'hop.example', name: 'hid' }), { ok: true, done: 1, of: 1 }); await bg.settle();
  assert.deepEqual(bg.state.storage.params, ['hid']); assert.deepEqual(cutRule(bg).action.redirect.transform.queryTransform.removeParams, ['hid']);
});
test('the audit scenario: names pages need (v, client_id, list and the like) are never offered, whatever value they carry', async () => {
  const names = ['v', 'client_id', 'list', 'id', 'q', 'p', 's', 't', 'code', 'state', 'redirect_uri', 'token', 'key', 'lang', 'page', 'url', 'next', 'search', 'query', 'user', 'email', 'session', 'sid', 'ID', 'Page'];
  const bg = await load(on()); await pass(bg, names.map((n) => `${n}=${ID}`).join('&'));
  assert.deepEqual(asked(bg), []); assert.deepEqual(bg.state.storage.params || [], []);
  assert.deepEqual(bounceAdded(`https://go.hop.example/r?to=${enc('https://blog.example/post')}`, `https://blog.example/post?${names.map((n) => `${n}=${ID}`).join('&')}`), []);
});
test('a value that does not look like an ID is not offered either; at most 10 names per site are remembered', async () => {
  const bg = await load(on()); await pass(bg, 'ref=newsletter&color=blue&n=12');
  assert.deepEqual(asked(bg), []);
  await pass(bg, Array.from({ length: 30 }, (_, i) => `tag${i}=${ID}`).join('&'));
  assert.equal(asked(bg).length, 10);
});
