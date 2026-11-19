// Q-batch (1.32): the sixth adversarial audit's findings, each pinned as the SAFE behaviour (PLAN.md "Q-batch").
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const strong = (o = {}) => ({ tabs: [{ id: 1, active: true, url: 'https://news1.example/a' }, { id: 2, url: 'https://news2.example/b' }], ...o,
  storage: { master: true, cacheClearedAt: 1.8e12, level: 'strong', ...o.storage } });
const emptied = (bg, host) => bg.called('browsingData.remove').filter((c) => !c.args[1].cache && (c.args[0].origins || []).includes(`https://${host}`));
const auto = (bg) => (bg.state.storage.log || []).filter((l) => l.auto);
const pend = (bg, g) => ((bg.state.storage.pending || {})[g] || { items: [] }).items;
// a third-party ad frame (frameId 5) inside a tab the user reads asks the victim host for an image
const adHit = async (bg, tabId, host, path = '/favicon.ico') => { await bg.request({ url: `https://${host}${path}`, tabId, frameId: 5, initiator: 'https://ads.evil.example', type: 'image' }); await bg.settle(); };
// an ID cookie of the whole bank site that other sites can use (not infrastructure, not a sign-in)
const UID = { name: 'uid', domain: '.bank.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' };

// ---- F2: "Let it through again" holds for the whole registrable site, not one exact host
test('F2: after "Let it through again" on one host of a site, no other host of that site (nor its root) is answered by itself; they are asked', async () => {
  const bg = await load(strong({ cookies: [UID, { name: 'prefs', domain: '.bank.example', value: 'p-55aa44bb33' }] }));
  await adHit(bg, 1, 'app.bank.example'); await adHit(bg, 2, 'app.bank.example');
  assert.ok(bg.blockedHosts().includes('app.bank.example'), 'the first host is answered by itself (Strongest)');
  await bg.send({ type: 'unstop', site: 'app.bank.example' }); await bg.settle();
  assert.deepEqual(bg.state.storage.unauto, ['bank.example'], 'unauto is keyed on the registrable site');
  bg.now += 61 * 60e3;
  for (const h of ['bank.example', 'www.bank.example']) { await adHit(bg, 1, h); await adHit(bg, 2, h); }
  assert.deepEqual(bg.blockedHosts(), [], 'another host of the same site was answered by itself');
  assert.equal(emptied(bg, 'bank.example').length + emptied(bg, 'www.bank.example').length, 0, 'the root clean-out ran');
  assert.deepEqual((await bg.names()).sort(), ['prefs', 'uid']);
  assert.deepEqual(pend(bg, 'unknown').filter((i) => i.kind === 'tracker').map((i) => i.site).sort(), ['bank.example', 'www.bank.example'], 'they wait as questions');
  // the user's own press still answers them
  await bg.send({ type: 'approve', group: 'unknown', site: 'www.bank.example', name: pend(bg, 'unknown').find((i) => i.site === 'www.bank.example').name }); await bg.settle();
  assert.ok(bg.blockedHosts().includes('www.bank.example'));
});
test('F2: an unauto entry stored per exact host by 1.31 still covers its whole site', async () => {
  const bg = await load(strong({ cookies: [UID], storage: { unauto: ['app.bank.example'] } }));
  await adHit(bg, 1, 'bank.example'); await adHit(bg, 2, 'bank.example');
  assert.deepEqual(bg.blockedHosts(), []); assert.equal(emptied(bg, 'bank.example').length, 0);
});

// ---- F9: load-balancer and bot-protection cookies are infrastructure, not evidence of tracking
const { INFRA_COOKIE_RE } = require('../extension/lists.js');
test('F9: the infrastructure cookie names are a shipped list; ordinary ID cookies are not on it', () => {
  for (const n of ['AWSALB', 'AWSALBCORS', 'AWSALBTG', 'AWSALBTGCORS', '__cf_bm', '_cfuvid', 'cf_clearance', 'incap_ses_123_456', 'visid_incap_789', 'nlbi_42', 'ak_bmsc', 'bm_sv', 'bm_sz', '_abck', '__cflb', 'ARRAffinity', 'ARRAffinitySameSite', 'TS01a2b3c4d'])
    assert.ok(INFRA_COOKIE_RE.test(n), n);
  for (const n of ['uid', 'AWSALBX', 'session', '_ga', 'cf', 'TS02abc', 'xbm_sv']) assert.equal(INFRA_COOKIE_RE.test(n), false, n);
});
test('F9: a SameSite=None load-balancer cookie in the jar is no evidence: no block, no clean-out, no question', async () => {
  const bg = await load(strong({ cookies: [{ name: 'AWSALBCORS', domain: 'app.bank.example', value: 'k3J9xQ2mZp8vR4tL0aBcD7eF', sameSite: 'no_restriction', secure: true },
    { name: '_cfuvid', domain: '.bank.example', value: 'q9W8e7R6t5Y4u3I2', sameSite: 'no_restriction' }] }));
  await adHit(bg, 1, 'app.bank.example'); await adHit(bg, 2, 'app.bank.example');
  assert.deepEqual(bg.blockedHosts(), []); assert.equal(emptied(bg, 'app.bank.example').length, 0);
  assert.equal(pend(bg, 'unknown').length, 0, 'asked about on infrastructure evidence alone');
});
test('F9: a Set-Cookie answer of a load-balancer or bot-protection cookie is no evidence either; a real ID cookie in the answer still is', async () => {
  for (const [cookie, evidence] of [['AWSALBCORS=k3J9xQ2mZp8vR4tL0aBcD7eF; Path=/; SameSite=None; Secure', false], ['__cf_bm=Ab12Cd34Ef56Gh78; Path=/; HttpOnly; Secure; SameSite=None', false],
    ['uid=u-3fa9c2d1e0; Path=/; SameSite=None; Secure', true]]) {
    const bg = await load(strong());
    for (const t of [1, 2]) { await adHit(bg, t, 'app.bank.example');
      await bg.answer({ url: 'https://app.bank.example/favicon.ico', tabId: t, frameId: 5, type: 'image', responseHeaders: [{ name: 'Set-Cookie', value: cookie }] }); await bg.settle(); }
    assert.equal(bg.blockedHosts().includes('app.bank.example'), evidence, cookie);
    assert.equal(!!((bg.state.storage.follow || {})['app.bank.example'] || {}).ck, evidence, cookie);
  }
});

// ---- F8: what trackers saved on their own sites (cleanOwn) and the queued site-storage drop skip a site the user turned off
const dropped = (bg, host) => bg.called('browsingData.remove').filter((c) => (c.args[0].origins || []).includes(`https://${host}`));
test('F8: cleanOwn never empties or mutes a site turned off: a blocked, cleaned-out company and a built-in list entry', async () => {
  const bg = await load(strong({ storage: { stopped: ['trk.example'], hard: ['trk.example'], sitesOff: ['trk.example', 'hotjar.com'] } }));
  await bg.alarm('sweep');
  assert.equal(dropped(bg, 'trk.example').length + dropped(bg, 'www.trk.example').length, 0, 'the off site was emptied');
  assert.equal(dropped(bg, 'hotjar.com').length, 0, 'a listed tracker turned off was emptied');
  assert.ok(bg.called('browsingData.remove').some((c) => (c.args[0].origins || []).includes('https://doubleclick.net')), 'the other listed ones are still emptied');
  assert.equal(bg.called('contentSettings.set').some((c) => /trk\.example|hotjar\.com/.test(c.args[0].primaryPattern)), false, 'its notifications were blocked');
  // the press on Clean now on that row as well
  await bg.send({ type: 'cleanNow', group: 'own' }); await bg.settle();
  assert.equal(dropped(bg, 'trk.example').length + dropped(bg, 'hotjar.com').length, 0);
});
test('F8: an approved site-storage drop of a site turned off is not carried out', async () => {
  const bg = await load(strong({ storage: { sitesOff: ['off.example'], pending: { storage: { items: [{ cap: 'C07', kind: 'storage', site: 'off.example', name: 'storage', why: 'permanent drop', t: 1 },
    { cap: 'C07', kind: 'storage', site: 'on.example', name: 'storage', why: 'permanent drop', t: 1 }], postponedUntil: 0 } } } }));
  await bg.send({ type: 'approve', group: 'storage' }); await bg.settle();
  assert.equal(dropped(bg, 'off.example').length, 0); assert.equal(dropped(bg, 'on.example').length, 1);
});

// ---- F7: every log line written inside an automatic answer says so (auto: true), like the answer's own line
test('F7: the per-cookie deletions and the cache clearing of an automatic block and clean-out, and of an automatic pass-through clean, are logged as done by itself', async () => {
  const bg = await load(strong({ storage: { cacheClearedAt: 1.8e12, modes: {} }, cookies: [{ name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }, { name: 'hop_id', domain: 'hop.example', value: 'h-99aa88bb77' }] }));
  await adHit(bg, 1, 'trk.example'); await adHit(bg, 2, 'trk.example');
  for (const to of ['https://blog.example/post', 'https://shop.example/x']) { await bg.redirect({ url: `https://hop.example/r?to=${encodeURIComponent(to)}`, redirectUrl: to + '?hid=h-77ab12cd34ef', type: 'main_frame' }); await bg.settle(); }
  const log = bg.state.storage.log || [];
  const of = (pred) => log.filter(pred).map((l) => `${l.cap} ${l.kind} ${l.site} ${l.name} ${l.auto === true}`);
  assert.deepEqual(of((l) => l.kind === 'cookie'), ['C25 cookie trk.example uid true', 'C27 cookie hop.example hop_id true']);
  assert.deepEqual(of((l) => l.kind === 'cache'), ['C11 cache * http-cache true']);
  assert.equal(log.filter((l) => !l.auto && l.cap !== 'C28').length, 0, JSON.stringify(log.filter((l) => !l.auto)));   // C28: the row's own daily emptying, no answer
});
test('F7: the same deletions at the user\'s own press are not marked as done by itself', async () => {
  const bg = await load(strong({ storage: { level: 'balanced' }, cookies: [{ name: 'uid', domain: '.trk.example', value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }] }));
  await adHit(bg, 1, 'trk.example'); await adHit(bg, 2, 'trk.example');
  await bg.send({ type: 'cleanNow', group: 'unknown' }); await bg.settle();
  assert.ok((bg.state.storage.log || []).some((l) => l.kind === 'cookie' && l.name === 'uid'));
  assert.equal((bg.state.storage.log || []).some((l) => l.auto), false);
});

// ---- F6: the per-page hourly caps hold across a sleep of the worker (they live in chrome.storage.session)
// the worker sleeps and wakes: a new run of background.js with the same stored settings and the same session memory
const restart = (bg, o = {}) => load({ ...o, storage: JSON.parse(JSON.stringify(bg.state.storage)), session: JSON.parse(JSON.stringify(bg.state.session)) });
const bal = (o = {}) => ({ tabs: [{ id: 1, active: true, url: 'https://elsewhere.example/' }], ...o, storage: { master: true, cacheClearedAt: 1.8e12, level: 'balanced', ...o.storage } });
const req2 = async (bg, host, page) => { await bg.request({ url: `https://${host}/px.gif`, initiator: `https://www.${page}`, type: 'image' }); await bg.settle(); };
const trackerCookies = (hosts) => hosts.map((h) => ({ name: 'uid', domain: '.' + h, value: 'u-3fa9c2d1e0', sameSite: 'no_restriction' }));
test('F6: ASK_HOUR: a page that has used its two questions of the hour gets no third after the worker slept', async () => {
  const hosts = ['t1.example', 't2.example', 't3.example'], cookies = trackerCookies(hosts);
  const bg = await load(bal({ cookies }));
  for (const h of hosts.slice(0, 2)) { await req2(bg, h, 'news.example'); await req2(bg, h, 'shop.example'); }
  assert.equal(pend(bg, 'unknown').length, 2);
  const bg2 = await restart(bg, { cookies, tabs: [{ id: 1, active: true, url: 'https://elsewhere.example/' }] });
  await req2(bg2, 't3.example', 'news.example'); await req2(bg2, 't3.example', 'shop.example'); await bg2.alarm('sweep');
  assert.deepEqual(pend(bg2, 'unknown').map((i) => i.site).sort(), ['t1.example', 't2.example'], 'the cap was reset by the restart');
  bg2.now += 61 * 60e3; await req2(bg2, 't4.example', 'news.example');
  assert.ok(bg2.state.session.asked, 'kept in chrome.storage.session');
});
test('F6: NEW_HOUR: the companies a page may note for the first time in an hour stay counted across a restart', async () => {
  const bg = await load(bal());
  for (let i = 0; i < 20; i++) await req2(bg, `n${i}.example`, 'news.example');
  assert.equal(Object.keys(bg.state.storage.follow).length, 20);
  const bg2 = await restart(bg, { tabs: [{ id: 1, active: true, url: 'https://elsewhere.example/' }] });
  await req2(bg2, 'n20.example', 'news.example');
  assert.equal(Object.keys(bg2.state.storage.follow).length, 20, 'a 21st was noted after the restart');
});
test('F6: XNEW_HOUR: the new cross-site tokens a page may add in an hour stay counted across a restart', async () => {
  const tok = (i) => `Tk${i}x9Qm2Lp7Vz${i}r`;
  const bg = await load(bal({ tabs: [{ id: 1, active: true, url: 'https://news.example/' }] }));
  for (let i = 0; i < 10; i++) { await bg.request({ url: `https://news.example/api/x?v=${tok(i)}`, initiator: 'https://news.example', type: 'xmlhttprequest' }); await bg.settle(); }
  assert.equal(Object.keys(bg.state.session.xseen).length, 10);
  const bg2 = await restart(bg, { tabs: [{ id: 1, active: true, url: 'https://news.example/' }] });
  await bg2.request({ url: `https://news.example/api/x?v=${tok(10)}`, initiator: 'https://news.example', type: 'xmlhttprequest' }); await bg2.settle();
  assert.equal(Object.keys(bg2.state.session.xseen).length, 10, 'an 11th new token was taken after the restart');
});
