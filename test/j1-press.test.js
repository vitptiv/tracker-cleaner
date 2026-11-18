// J1 (third audit). The principle: what is learned from page behaviour may only block that host on other sites, which can
// be undone. Deleting anything of a learned host needs the user's press on one question; shipped-list hosts are as before.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { buildReport, renderReport } = require('../extension/report-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const req = async (bg, url, page) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script' }); await bg.settle(); };
const deleted = (bg) => ({ cookies: bg.called('cookies.remove').length, storage: bg.called('browsingData.remove').filter((c) => c.args[1].localStorage || c.args[1].serviceWorkers).filter((c) => (c.args[0].origins || []).some((o) => /trk|bank/.test(o))).length,
  notifications: bg.called('contentSettings.set').filter((c) => /trk|bank/.test(c.args[0].primaryPattern)).length });
const asks = (bg, group = 'unknown') => ((bg.state.storage.pending || {})[group] || { items: [] }).items.map((i) => [i.kind, i.site]);
const UID = { name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };

test('a company on no list seen on many visited sites, one the user never opens: blocked, and nothing of it is deleted without a press', async () => {
  const bg = await load(on({ cookies: [UID] }));
  for (const p of ['news.example', 'shop.example', 'blog.example', 'mail.example']) await req(bg, 'https://trk.example/p.gif', p);
  for (let i = 0; i < 8; i++) { bg.now += 15 * 60e3; await bg.alarm('sweep'); }
  assert.deepEqual(bg.state.storage.stopped, ['trk.example']); assert.deepEqual(bg.state.storage.hard || [], []);
  assert.deepEqual(deleted(bg), { cookies: 0, storage: 0, notifications: 0 }); assert.deepEqual(await bg.names(), ['uid']);
  assert.deepEqual(asks(bg), [['used', 'trk.example']]);
  const html = renderReport(buildReport(await bg.send({ type: 'state' }), null));
  assert.ok(html.includes('trk.example follows you on 2 sites. It is already blocked on other sites. Also remove what it saved here?')); assert.match(html, />Remove<\/button>.*>Keep<\/button>/);
});
test('Remove: its cookies but the sign-in-looking ones, its storage and worker, its notifications; Keep: never asked again', async () => {
  const bg = await load(on({ cookies: [UID, { name: 'sess', domain: '.trk.example', value: 's-3fa9c2d1e0', httpOnly: true, secure: true }] }));
  await req(bg, 'https://trk.example/p.gif', 'news.example'); await req(bg, 'https://trk.example/p.gif', 'shop.example');
  assert.deepEqual(await bg.send({ type: 'approve', group: 'unknown', site: 'trk.example', name: 'what it keeps to follow you' }), { ok: true, done: 1, of: 1 }); await bg.settle(); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['sess']); const d = deleted(bg); assert.ok(d.cookies === 1 && d.storage >= 1 && d.notifications === 1, JSON.stringify(d));
  const keep = await load(on({ cookies: [UID] })); await req(keep, 'https://trk.example/p.gif', 'news.example'); await req(keep, 'https://trk.example/p.gif', 'shop.example');
  await keep.send({ type: 'notNow', group: 'unknown', site: 'trk.example', name: 'what it keeps to follow you' }); keep.now += 60 * 86400e3; await keep.alarm('sweep');
  assert.deepEqual(asks(keep), []); assert.deepEqual(await keep.names(), ['uid']);
});
test('the audit scenario: one visit through a redirecting address of a bank: nothing of the bank is deleted; one question', async () => {
  const bg = await load(on({ tabs: [{ id: 1, active: true, url: 'https://mail.example/inbox' }], cookies: [{ name: 'prefs', domain: 'go.bank.example', value: 'p-3fa9c2d1e0' }] }));
  await bg.redirect({ url: 'https://go.bank.example/r?to=https%3A%2F%2Fshop.example%2Fx', redirectUrl: 'https://shop.example/x?bid=b-77ab12cd34ef', type: 'main_frame' }); await bg.settle(); await bg.alarm('sweep');
  assert.deepEqual(deleted(bg), { cookies: 0, storage: 0, notifications: 0 }); assert.deepEqual(await bg.names(), ['prefs']);
  assert.ok(asks(bg, 'bounce').some(([k]) => k === 'bounce'));
  await bg.send({ type: 'approve', group: 'bounce' }); await bg.settle();
  assert.deepEqual(await bg.names(), ['prefs'], 'the group button answered the question');
});
test('a tracker on the shipped list is cleaned by itself as before', async () => {
  const bg = await load(on({ cookies: [{ name: 'IDE', domain: '.doubleclick.net', value: 'x' }, { name: '_ga', domain: '.shop.example', value: 'GA1.2.3' }] })); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), []);
  assert.ok(bg.called('browsingData.remove').some((c) => (c.args[0].origins || []).includes('https://doubleclick.net') && c.args[1].serviceWorkers));
});
