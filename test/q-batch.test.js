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
