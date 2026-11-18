// Batch I. I1: one clearing of all saved copies after a stop that only blocks, at most once an hour in total.
// I2: the question about a company the user also uses comes at once, also during that site's five-minute hold.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js').pressing;
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const SET = 'tid=t-77ab12cd34ef; Path=/; SameSite=None; Secure', FP = { name: '_fp', domain: 'news.example', value: 'k9x2m4q8r1t7' };
const req = async (bg, url, page) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script' }); await bg.settle(); };
const answer = async (bg, url, page) => { await bg.answer({ url, initiator: `https://www.${page}`, type: 'script', responseHeaders: [{ name: 'Set-Cookie', value: SET }] }); await bg.settle(); };
const soft = async (bg, site) => { await answer(bg, `https://${site}/kit.js`, 'news.example'); await req(bg, `https://${site}/e?fp=k9x2m4q8r1t7`, 'news.example'); };
const clears = (bg) => bg.called('browsingData.remove').filter((c) => c.args[1].cache && c.args[0].since === 0).length;
const asks = (bg) => ((bg.state.storage.pending || {}).unknown || { items: [] }).items.map((i) => [i.kind, i.site]);

test('I1: a stop that only blocks clears all saved copies once; further stops within the hour do not; never at a start of Chrome', async () => {
  const bg = await load(on({ cookies: [FP] }));
  await soft(bg, 'trk1.example'); assert.deepEqual(bg.state.storage.stopped, ['trk1.example']); assert.deepEqual(bg.state.storage.hard || [], []); assert.equal(clears(bg), 1);
  await soft(bg, 'trk2.example'); await soft(bg, 'trk3.example'); assert.equal(bg.state.storage.stopped.length, 3); assert.equal(clears(bg), 1);
  await bg.chrome.runtime.onStartup.fire(); await bg.settle(); assert.equal(clears(bg), 1);
  bg.now += 61 * 60e3; await soft(bg, 'trk4.example'); assert.equal(clears(bg), 2);
  assert.match(require('../extension/registry.js').GROUPS.find((g) => g.id === 'cache').says, /once a day, once more when a tracker is cleaned out, and at most once an hour when a new tracker is blocked/);
});
test('I1: not when the saved-copies row is off or asks first, and nothing but saved copies goes', async () => {
  for (const mode of ['off', 'ask']) { const bg = await load(on({ cookies: [FP], storage: { modes: { C11: mode } } })); await soft(bg, 'trk1.example'); assert.equal(clears(bg), 0, mode); }
  const bg = await load(on({ cookies: [FP, { name: 'uid', domain: '.trk1.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }] })); await soft(bg, 'trk1.example');
  assert.deepEqual(bg.called('cookies.remove'), []); assert.equal(bg.called('browsingData.remove').some((c) => (c.args[0].origins || []).some((o) => o.includes('trk1'))), false); assert.deepEqual(bg.called('contentSettings.set').filter((c) => c.args[0].primaryPattern.includes('trk1')), []);
});
test('I2: a company the user also uses is asked about as soon as it is blocked, at one sighting and while its own sign-in page holds its site; Remove acts at once and keeps what looks like a sign-in', async () => {
  const cookies = [FP, { name: 'prefs', domain: '.used.example', value: 'p-3fa9c2d1e0', sameSite: 'no_restriction' }, { name: 'sess', domain: '.used.example', value: 's-3fa9c2d1e0', httpOnly: true, secure: true }];
  const bg = await load(on({ cookies, tabs: [{ id: 1, active: true, url: 'https://www.used.example/' }] }));
  await bg.opens('https://www.used.example/home'); await bg.navigate(1, 'https://www.used.example/login'); await bg.settle(); await bg.navigate(1, 'https://other.example/'); await bg.settle();
  assert.ok(bg.state.storage.sguard['used.example'] > 0, 'its site is not held');
  await soft(bg, 'used.example');
  assert.deepEqual(bg.state.storage.stopped, ['used.example']); assert.deepEqual(asks(bg), [['used', 'used.example']]); assert.deepEqual(bg.called('cookies.remove'), []);
  assert.deepEqual(await bg.send({ type: 'approve', group: 'unknown', site: 'used.example', name: 'what it keeps to follow you' }), { ok: true, done: 1, of: 1 }); await bg.settle();
  assert.deepEqual((await bg.names()).sort(), ['_fp', 'sess']); assert.deepEqual(bg.state.storage.hard || [], []);
});
test('I2 as changed by J1: a company the user does not use is asked about in the same way; nothing of it is cleaned out by itself', async () => {
  const bg = await load(on({ cookies: [FP, { name: 'uid', domain: '.trk1.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }] })); await soft(bg, 'trk1.example');
  assert.deepEqual(asks(bg), [['used', 'trk1.example']]); assert.deepEqual(bg.state.storage.hard || [], []); assert.ok((await bg.names()).includes('uid'));
});
