// H1 (second audit): a stop on thin evidence must not be a weapon. Stopping by itself only blocks the company on other
// sites; cleaning out what it keeps needs two visited sites and a site the user does not use, or one answer.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { buildReport, renderReport } = require('../extension/report-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const SET = 'tid=t-77ab12cd34ef; Path=/; SameSite=None; Secure', FP = { name: 'x', domain: 'evil.example', value: 'k9x2m4q8r1t7' };
const bank = () => [{ name: 'prefs', domain: '.bank.example', value: 'p-3fa9c2d1e0', sameSite: 'no_restriction' }, { name: 'sess', domain: '.bank.example', value: 's-3fa9c2d1e0', httpOnly: true, secure: true }];
const req = async (bg, url, page, o = {}) => { await bg.request({ url, initiator: `https://www.${page}`, type: 'script', ...o }); await bg.settle(); };
const answer = async (bg, url, page) => { await bg.answer({ url, initiator: `https://www.${page}`, type: 'script', responseHeaders: [{ name: 'Set-Cookie', value: SET }] }); await bg.settle(); };
const blockedSites = (bg) => (bg.state.dynamic.find((r) => r.id === 100001) || { condition: { requestDomains: [] } }).condition.requestDomains;
const hardCalls = (bg, site) => ({ cookies: bg.called('cookies.remove').length, storage: bg.called('browsingData.remove').filter((c) => (c.args[0].origins || []).some((o) => o.includes(site))).length,
  cache: bg.called('browsingData.remove').filter((c) => c.args[1].cache && c.args[0].since === 0).length, notifications: bg.called('contentSettings.set').filter((c) => c.args[0].primaryPattern.includes(site)).length });
const asks = (bg) => ((bg.state.storage.pending || {}).unknown || { items: [] }).items.map((i) => [i.kind, i.site]);

test('the audit scenario: a page hands its own ID to the bank and the bank answers with a cookie: the bank is blocked on other sites and nothing else happens to it', async () => {
  const bg = await load(on({ cookies: [FP, ...bank()] }));
  await answer(bg, 'https://www.bank.example/f', 'evil.example'); await req(bg, 'https://www.bank.example/f?u=k9x2m4q8r1t7', 'evil.example');
  await bg.alarm('sweep'); await bg.alarm('sweep');
  assert.deepEqual(bg.state.storage.stopped, ['bank.example']); assert.deepEqual(blockedSites(bg), ['bank.example']);
  assert.deepEqual(hardCalls(bg, 'bank.example'), { cookies: 0, storage: 0, cache: 0, notifications: 0 });
  assert.deepEqual((await bg.names()).sort(), ['prefs', 'sess', 'x']); assert.deepEqual(bg.state.storage.hard || [], []);
});
test('seen on two visited sites and not a site the user opens: what it keeps is cleaned out by itself (cookies, its own storage and worker, notifications, saved copies once)', async () => {
  const bg = await load(on({ cookies: [{ name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }] }));
  await req(bg, 'https://px.trk.example/p.gif', 'news.example'); assert.deepEqual(bg.state.storage.stopped || [], []);
  await req(bg, 'https://px.trk.example/p.gif', 'shop.example');
  assert.deepEqual([bg.state.storage.stopped, bg.state.storage.hard], [['trk.example'], ['trk.example']]); assert.deepEqual(await bg.names(), []);
  const h = hardCalls(bg, 'trk.example'); assert.ok(h.storage >= 1 && h.notifications === 1 && h.cache === 1, JSON.stringify(h));
});
test('stopped at one sighting, then seen on a second site: cleaned out then', async () => {
  const bg = await load(on({ cookies: [{ ...FP, domain: 'news.example' }, { name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }] }));
  await answer(bg, 'https://px.trk.example/kit.js', 'news.example'); await req(bg, 'https://px.trk.example/e?fp=k9x2m4q8r1t7', 'news.example');
  assert.deepEqual(bg.state.storage.stopped, ['trk.example']); assert.deepEqual(bg.state.storage.hard || [], []); assert.ok((await bg.names()).includes('uid'));
  await req(bg, 'https://px.trk.example/kit.js', 'shop.example');
  assert.deepEqual(bg.state.storage.hard, ['trk.example']); assert.equal((await bg.names()).includes('uid'), false);
});
test('a company the user also uses: blocked elsewhere, and one question once; Remove cleans it out but keeps what looks like a sign-in, Keep ends the matter', async () => {
  for (const answerIs of ['Remove', 'Keep']) {
    const bg = await load(on({ cookies: bank() })); await bg.opens('https://www.bank.example/home'); await bg.closeTab(bg.tabOf('https://www.bank.example/home'));
    await req(bg, 'https://www.bank.example/w.js', 'news.example'); await req(bg, 'https://www.bank.example/w.js', 'shop.example'); await bg.alarm('sweep');
    assert.deepEqual(bg.state.storage.stopped, ['bank.example']); assert.deepEqual(hardCalls(bg, 'bank.example'), { cookies: 0, storage: 0, cache: 0, notifications: 0 });
    assert.deepEqual(asks(bg), [['used', 'bank.example']]);
    const html = renderReport(buildReport(await bg.send({ type: 'state' }), null));
    assert.ok(html.includes('You use bank.example, and it follows you on other sites. Remove what it keeps to do that?')); assert.match(html, />Remove<\/button>.*>Keep<\/button>/);
    if (answerIs === 'Remove') { assert.deepEqual(await bg.send({ type: 'approve', group: 'unknown', site: 'bank.example', name: 'what it keeps to follow you' }), { ok: true, done: 1, of: 1 }); await bg.settle();
      assert.deepEqual(await bg.names(), ['sess']); assert.deepEqual(bg.state.storage.hard, ['bank.example']); }
    else { await bg.send({ type: 'notNow', group: 'unknown', site: 'bank.example', name: 'what it keeps to follow you' }); bg.now += 30 * 86400e3; await bg.alarm('sweep');
      assert.deepEqual(asks(bg), []); assert.deepEqual((await bg.names()).sort(), ['prefs', 'sess']); }
  }
});
test('the group button never answers that question', async () => {
  const bg = await load(on({ cookies: bank() })); await bg.opens('https://www.bank.example/home'); await bg.closeTab(bg.tabOf('https://www.bank.example/home'));
  await req(bg, 'https://www.bank.example/w.js', 'news.example'); await req(bg, 'https://www.bank.example/w.js', 'shop.example'); await bg.alarm('sweep');
  await bg.send({ type: 'approve', group: 'unknown' }); await bg.settle();
  assert.deepEqual((await bg.names()).sort(), ['prefs', 'sess']); assert.deepEqual(asks(bg), [['used', 'bank.example']]);
});
test('the hourly limit holds inside one sweep: fifteen ready at once, ten stopped, five asked about', async () => {
  const sites = Array.from({ length: 15 }, (_, i) => `trk${i}.example`), follow = Object.fromEntries(sites.map((s) => [s, { on: ['a', 'b'], ck: true, sent: false, hosts: [], t: 1 }]));
  const bg = await load(on({ storage: { follow } })); await bg.alarm('sweep');
  assert.equal(bg.state.storage.stopped.length, 10); assert.equal(asks(bg).length, 5);
});
test('two tenants of one shared host count as one visited site', async () => {
  const bg = await load(on({ cookies: [{ name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }] }));
  await bg.request({ url: 'https://px.trk.example/p.gif', initiator: 'https://one.github.io', type: 'image' }); await bg.settle();
  await bg.request({ url: 'https://px.trk.example/p.gif', initiator: 'https://two.github.io', type: 'image' }); await bg.settle(); await bg.alarm('sweep');
  assert.deepEqual(bg.state.storage.stopped || [], []);
});
test('"Let it through again" takes a company off both lists', async () => {
  const bg = await load(on({ storage: { stopped: ['trk.example'], hard: ['trk.example'] } }));
  await bg.send({ type: 'unstop', site: 'trk.example' });
  assert.deepEqual([bg.state.storage.stopped, bg.state.storage.hard], [[], []]);
});
