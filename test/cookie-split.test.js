// Chunk 5: Google's and YouTube's own identity cookies are their own group (C04, asks by default), the
// LinkedIn and Mixpanel prefixes no longer catch login cookies. Compare characterization.test.js (1.20).
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const L = require('../extension/lists.js'), core = require('../extension/core.js')(L);
const ck = (name, domain = '.example.com') => ({ name, domain, path: '/', secure: true, storeId: '0' });
const GOOGLE = ['NID', 'OTZ', '1P_JAR', 'YSC', 'VISITOR_INFO1_LIVE', 'VISITOR_PRIVACY_METADATA', '__Secure-YNID', '__Secure-YEC', 'GPS'];
const MIN = 60e3, queued = (bg, group) => ((bg.state.storage.pending || {})[group] || { items: [] }).items.map((i) => i.name);
const set = (bg, name, domain, host = 'www.google.com') => bg.setCookie({ url: `https://${host}/`, name, ...(domain ? { domain } : {}) });
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });

test('GOOGLE_RE holds exactly the nine identity names, whole-name; COOKIE_RE no longer has them', () => {
  for (const n of GOOGLE) { assert.equal(L.GOOGLE_RE.test(n), true, n); assert.equal(L.COOKIE_RE.test(n), false, n);
    for (const x of [n + 'x', 'x' + n, n.toLowerCase() === n ? n.toUpperCase() : n.toLowerCase()]) assert.equal(L.GOOGLE_RE.test(x), false, x); }
  assert.equal(L.GOOGLE_RE.source.split('|').length, GOOGLE.length);
});
test("reason is 'google' for those names on google.<tld>, youtube.com and their subdomains", () => {
  for (const n of GOOGLE) for (const d of ['.google.com', 'www.google.com', '.google.de', '.google.co.uk', '.google.com.au', '.youtube.com', 'm.youtube.com', '.GOOGLE.com', 'www.google.com.localhost'])
    assert.equal(core.reason(ck(n, d)), 'google', `${n} @ ${d}`);
});
test('the same names on any other host are not matched at all', () => {
  for (const n of GOOGLE) for (const d of ['.example.com', 'notgoogle.com', '.google.com.evil.example', 'google.example.com', 'youtube.com.evil.test', '.linkedin.com'])
    assert.equal(core.reason(ck(n, d)), null, `${n} @ ${d}`);
});
test('on a tracker host it stays a tracker cookie (C03): IDE and NID on doubleclick.net, NID on adservice.google.com', () => {
  assert.equal(core.reason(ck('IDE', '.doubleclick.net')), 'name'); assert.equal(core.reason(ck('NID', '.doubleclick.net')), 'host');
  assert.equal(core.reason(ck('NID', 'adservice.google.com')), 'host'); assert.equal(core.reason(ck('IDE', '.google.com')), 'name');
});
test('KEEP_RE still wins over everything except the blacklist', () => {
  for (const n of ['SID', '__Host-GAPS', 'PREF', '__Secure-1PSID']) for (const d of ['.google.com', '.youtube.com', '.doubleclick.net']) assert.equal(core.reason(ck(n, d)), null, `${n} @ ${d}`);
  const c = require('../extension/core.js')(L); c.S.BLACK = [{ h: 'google.com', n: 'SID' }, { h: '*', n: 'NID' }];
  assert.equal(c.reason(ck('SID', '.google.com')), 'blacklist'); assert.equal(c.reason(ck('NID', '.google.com')), 'blacklist');
  assert.equal(c.reason(ck('NID', '.google.com'), true), 'google');
});
test('LinkedIn: the login cookies are kept, the tracking names still go', () => {
  for (const n of ['li_at', 'li_rm', 'li_mc', 'li_gc', 'li_theme', 'li_a']) assert.equal(core.reason(ck(n, '.www.linkedin.com')), null, n);
  for (const n of ['li_sugr', 'li_fat_id', 'li_giant', 'bcookie', 'lidc', 'AnalyticsSyncHistory', '_li_dcdm_c']) assert.equal(core.reason(ck(n, '.linkedin.com')), 'name', n);
  assert.equal(core.reason(ck('li_sugr2', '.linkedin.com')), null);
});
test('Mixpanel: only mp_<token>_mixpanel, not every mp_ cookie', () => {
  assert.equal(core.reason(ck('mp_52e5e0805583e8a410f1ed50d8e0c049_mixpanel')), 'name'); assert.equal(core.reason(ck('mp_mixpanel__c')), null);
  for (const n of ['mp_session', 'mp_token', 'mp_']) assert.equal(core.reason(ck(n)), null, n);
});
test('the rest of the list is as in 1.20: every other 1.20 entry still matches', () => {
  for (const n of ['_ga', '_ga_ABC', '_gid', '_gat', '_gcl_au', '__utma', '_fbp', '_fbc', 'fr', '_hjid', '_uetsid', 'MUID', 'IDE', 'DSID', 'test_cookie', '_pin_unauth', '_tt_x', '_ttp',
    '_scid', 'ajs_user_id', '_clck', 'amplitude_id', 'AMP_x', '__qca', 'hubspotutk', '__hstc', 'bcookie', '_pk_id', '_ym_uid', 'cto_bundle', 'uuid2', 'anj', 'sp_gaid',
    'eyeo-x', 'ttcsid', 'intercom-id-abc', '_dd_s', 'WMF-Uniq', 'GeoIP']) assert.equal(core.reason(ck(n)), 'name', n);
});

test('master on, default modes: NID on .google.com is queued under google (C04), not removed, live and at the sweep', async () => {
  const bg = await load(on({ cookies: [{ name: 'OTZ', domain: 'www.google.com' }, { name: 'YSC', domain: '.youtube.com' }] }));
  await set(bg, 'NID', '.google.com'); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['OTZ', 'YSC', 'NID']); assert.deepEqual(bg.destructive(), []);
  assert.deepEqual(queued(bg, 'google'), ['NID', 'OTZ', 'YSC']); assert.deepEqual(queued(bg, 'cookies'), []);
  assert.deepEqual(bg.state.storage.pending.google.items.map((i) => [i.cap, i.why]), [['C04', 'google'], ['C04', 'google'], ['C04', 'google']]);
});
test('NID on example.com and li_at are untouched and not queued', async () => {
  const bg = await load(on());
  await set(bg, 'NID', '.example.com', 'www.example.com'); await set(bg, 'li_at', '.www.linkedin.com', 'www.linkedin.com'); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['NID', 'li_at']); assert.equal(bg.state.storage.pending, undefined); assert.deepEqual(bg.destructive(), []);
});
test('_ga on any site and any cookie on doubleclick.net are still removed automatically', async () => {
  const bg = await load(on({ cookies: [{ name: '_ga', domain: '.shop.example' }, { name: 'anything', domain: '.doubleclick.net' }, { name: '_ga', domain: '.google.com' }] }));
  await set(bg, '_ga', '.example.com', 'www.example.com'); await set(bg, 'whatever', null, 'ad.doubleclick.net'); await set(bg, 'IDE', '.doubleclick.net', 'ad.doubleclick.net');
  assert.deepEqual(await bg.names(), ['_ga', 'anything', '_ga']);     // the live ones went at once
  await bg.alarm('sweep'); assert.deepEqual(await bg.names(), []);
});
test('approving the google group removes NID; SID stays', async () => {
  const bg = await load(on({ cookies: [{ name: 'NID', domain: '.google.com' }, { name: 'SID', domain: '.google.com' }] }));
  await bg.alarm('sweep'); assert.deepEqual(await bg.send({ type: 'approve', group: 'google' }), { ok: true, done: 1, of: 1 });
  assert.deepEqual(await bg.names(), ['SID']);
});
test('with C04 set to auto NID is removed, but not during the sign-in guard', async () => {
  const bg = await load(on({ storage: { modes: { C04: 'auto' } }, tabs: [{ id: 1, active: true, url: 'https://example.com/' }] }));
  await set(bg, 'NID', '.google.com'); assert.deepEqual(await bg.names(), []);
  await bg.navigate(1, 'https://accounts.google.com/v3/signin/identifier'); await bg.settle();
  await set(bg, 'NID', '.google.com'); await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['NID']); assert.deepEqual(queued(bg, 'google'), ['NID']);
  await bg.navigate(1, 'https://example.com/'); bg.now += 6 * MIN; await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), []); assert.deepEqual(queued(bg, 'google'), []);
});
test('the sequence behind this rebuild: a Google sign-in keeps NID, SID and __Host-GAPS through 20 minutes of sweeps', async () => {
  const bg = await load({ storage: { master: true }, tabs: [{ id: 1, active: false, url: 'https://example.com/' }] });
  await bg.openTab({ id: 2, active: true, url: 'https://accounts.google.com/v3/signin/identifier' }); await bg.settle();
  await set(bg, 'NID', '.google.com', 'accounts.google.com'); await set(bg, 'SID', '.google.com', 'accounts.google.com'); await set(bg, '__Host-GAPS', null, 'accounts.google.com');
  await set(bg, 'x', null, 'ad.doubleclick.net');                    // a tracker cookie set during the sign-in waits too
  await bg.alarm('sweep'); await bg.closeTab(2);
  for (let i = 0; i < 20; i++) { bg.now += MIN; await bg.alarm('proxy'); if (i % 5 === 4) await bg.alarm('sweep'); }
  assert.deepEqual(await bg.names(), ['NID', 'SID', '__Host-GAPS']);
  assert.deepEqual(bg.called('cookies.remove').map((c) => c.args[0].name), ['x']);
  assert.deepEqual(queued(bg, 'google'), ['NID']); assert.deepEqual(queued(bg, 'cookies'), []);
});
