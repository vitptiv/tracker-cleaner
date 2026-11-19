// 1.30 ATTACK: at Strongest, evidence a web page can stage leads to a block or a removal without a press. These pin how
// far a page can take that. Evidence for C25 (followNote/followFull/followSweep): a host seen from FOLLOW_N sites (the
// site in the tab's address bar, one page can navigate the tab through two of its own sites) or handed a page's own ID,
// and the host's own cookie that other sites can use. For C27 (noteRedirect/bounceSweep): any page can send the browser
// through another site's open redirect.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { STOPS_HOUR } = require('../extension/learn.js'), { SIGNIN_HOSTS } = require('../extension/guard.js');
const req = async (bg, host, page, path = '/px.gif') => { await bg.request({ url: `https://${host}${path}`, initiator: `https://www.${page}`, type: 'image' }); await bg.settle(); };
const ID = (domain, name = 'uid', o = {}) => ({ name, domain, value: 'u-3fa9c2d1e0', sameSite: 'no_restriction', ...o });
const strong = (o = {}) => ({ tabs: [{ id: 1, active: true, url: 'https://social.example/feed' }], ...o, storage: { master: true, cacheClearedAt: 1.8e12, level: 'strong', ...o.storage } });
const queued = (bg, group) => ((bg.state.storage.pending || {})[group] || { items: [] }).items;
const hop = async (bg, host = 'hop.example') => { for (const to of ['https://blog.example/post', 'https://shop.example/x']) {
  await bg.redirect({ url: `https://${host}/r?to=${encodeURIComponent(to)}`, redirectUrl: to + '?hid=h-77ab12cd34ef', type: 'main_frame' }); await bg.settle(); } };
const auto = (bg) => (bg.state.storage.log || []).filter((l) => l.auto);
// what was emptied of these hosts (the daily clean-out of the listed trackers' own sites, C28, is not about them)
const emptied = (bg, hosts) => bg.called('browsingData.remove').filter((c) => !c.args[1].cache && (c.args[0].origins || []).some((o) => hosts.some((h) => o.includes(h))));

// 1.31 (the owner's decision, "make strongest work the strongest"): at Strongest a site the user opens, has open, or seems
// signed in to is answered yes by itself too. What stays absolute at every level is pinned here.
test('ATTACK (a, 1.31): a staged sign-in host or company is never noted, blocked or emptied, a site turned off is never touched; a site you open, one with a kept cookie and one you seem signed in to ARE blocked and cleaned, but their sign-in-like and kept cookies stay', async () => {
  const cookies = [ID('.accounts.google.com'), ID('.login.microsoftonline.com'), ID('.okta.com'), ID('.github.com'), ID('.off.example'), ID('.mine.example'), ID('.kept.example'),
    ID('.bank.example'), { name: 'session', domain: 'bank.example', value: 'b-1234abcd5678', httpOnly: true, secure: true }, { name: 'SID', domain: 'mine.example', value: 'signed-in' }];
  const bg = await load(strong({ cookies, storage: { sitesOff: ['off.example'], allow: [{ site: 'kept.example', name: 'uid' }] } }));
  await bg.opens('https://mine.example/home'); await bg.closeTab(bg.tabOf('https://mine.example/home'));
  const pages = [['a1.example', 'a2.example'], ['b1.example', 'b2.example'], ['c1.example', 'c2.example'], ['d1.example', 'd2.example']];
  for (const [i, host] of [...SIGNIN_HOSTS, 'okta.com', 'github.com', 'off.example', 'mine.example', 'kept.example', 'bank.example'].entries())
    for (const p of pages[i % 4]) { await req(bg, host, p); bg.now += 1; }
  bg.now += 61 * 60e3; await bg.alarm('sweep');
  assert.deepEqual(bg.blockedHosts().sort(), ['bank.example', 'kept.example', 'mine.example']);
  assert.deepEqual(auto(bg).filter((l) => l.kind === 'tracker').map((l) => l.site).sort(), ['bank.example', 'kept.example', 'mine.example']);
  for (const h of [...SIGNIN_HOSTS, 'okta.com', 'github.com']) assert.equal(h in (bg.state.storage.follow || {}), false, h);
  assert.deepEqual(emptied(bg, ['off.example', ...SIGNIN_HOSTS, 'okta.com', 'github.com']), [], 'a sign-in host or a site turned off was emptied');
  const left = (await bg.chrome.cookies.getAll({})).map((c) => `${c.domain} ${c.name}`).sort();
  assert.deepEqual(left, ['.accounts.google.com uid', '.github.com uid', '.kept.example uid', '.login.microsoftonline.com uid', '.off.example uid', '.okta.com uid', 'bank.example session', 'mine.example SID'].sort(),
    'gone: the plain ID cookies of the three; kept: sign-in hosts and companies, the site turned off, the allowed cookie, the sign-in-like cookies');
  assert.deepEqual(queued(bg, 'unknown').map((i) => i.site), ['off.example'], 'a site turned off is asked about, never answered by itself');
});
test('ATTACK (a, 1.31): a staged pass-through via a site you open or seem signed in to is cleaned by itself (its sign-in cookie stays); a site turned off never is', async () => {
  const cookies = [{ name: 'hop_id', domain: 'used.example', value: 'h-99aa88bb77' }, { name: 'hop_id', domain: 'bank.example', value: 'h-99aa88bb77' }, { name: 'SID', domain: 'bank.example', value: 'signed-in' },
    { name: 'hop_id', domain: 'off.example', value: 'h-99aa88bb77' }];
  const bg = await load(strong({ cookies, storage: { sitesOff: ['off.example'] } }));
  await bg.opens('https://used.example/home'); await bg.closeTab(bg.tabOf('https://used.example/home'));
  for (const h of ['used.example', 'bank.example', 'off.example']) await hop(bg, h);
  assert.deepEqual((await bg.chrome.cookies.getAll({})).map((c) => `${c.domain} ${c.name}`), ['bank.example SID', 'off.example hop_id']);
  assert.deepEqual(emptied(bg, ['off.example']), []); assert.ok(emptied(bg, ['used.example']).length && emptied(bg, ['bank.example']).length);
  // the skip question is asked only of a site the user does not open (J4), so only bank.example can be skipped
  assert.deepEqual(bg.state.storage.skipok, ['bank.example']);
  assert.ok(queued(bg, 'bounce').length >= 1 && queued(bg, 'bounce').every((i) => i.site === 'off.example'));
});
test('ATTACK (1.31): what the removal of a site you use deletes: plain and storage-held sign-ins go, HttpOnly+Secure, KEEP_RE and allowed cookies stay; with its tab open only the background program goes', async () => {
  const cookies = [ID('.used.example'), { name: 'plain_session', domain: 'used.example', value: 'p-1234abcd5678' }, { name: 'auth', domain: 'used.example', value: 'a-1234abcd5678', httpOnly: true, secure: true },
    { name: 'SID', domain: 'used.example', value: 'keep-1234' }, { name: 'pref', domain: 'used.example', value: 'x' }];
  const bg = await load(strong({ cookies, storage: { allow: [{ site: 'used.example', name: 'pref' }] } }));
  await bg.opens('https://used.example/home'); await bg.closeTab(bg.tabOf('https://used.example/home'));
  for (const p of ['a.example', 'b.example']) await req(bg, 'used.example', p);
  assert.deepEqual((await bg.chrome.cookies.getAll({})).map((c) => c.name).sort(), ['SID', 'auth', 'pref']);
  const kinds = emptied(bg, ['used.example']).map((c) => c.args[1]);
  assert.deepEqual(kinds, [{ localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true, fileSystems: true, webSQL: true }], 'storage of a site you use was not emptied as it is for any other');
  const open = await load(strong({ cookies, tabs: [{ id: 1, active: true, url: 'https://used.example/home' }, { id: 2, url: 'https://social.example/' }] }));
  for (const p of ['a.example', 'b.example']) await req(open, 'used.example', p);
  assert.deepEqual(emptied(open, ['used.example']).map((c) => c.args[1]), [{ serviceWorkers: true }], 'with its tab open only the background program');
  assert.ok(open.blockedHosts().includes('used.example'));
});
test('ATTACK (1.31): during a sign-in hold nothing is deleted; the automatic answer waits and is given once the hold is over', async () => {
  const bg = await load(strong({ cookies: [ID('.trk.example')], storage: { sguard: { 'trk.example': 1.8e12 - 60e3 } } }));
  for (const p of ['a.example', 'b.example']) await req(bg, 'trk.example', p);
  assert.deepEqual(auto(bg), []); assert.deepEqual(await bg.names(), ['uid']); assert.equal(queued(bg, 'unknown').length, 1);
  bg.now += 5 * 60e3; await bg.alarm('unguard');
  assert.deepEqual(bg.blockedHosts(), ['trk.example']); assert.deepEqual(await bg.names(), []);
});
test(`ATTACK (b): pages cannot get more than STOPS_HOUR (${STOPS_HOUR}) hosts answered by itself in an hour; the rest wait as questions; one pair of pages gets at most ASK_HOUR`, async () => {
  const hosts = Array.from({ length: 15 }, (_, i) => `t${i}.example`);
  const bg = await load(strong({ cookies: hosts.map((h) => ID('.' + h)) }));
  for (const [i, h] of hosts.entries()) for (const p of [`p${i}a.example`, `p${i}b.example`]) await req(bg, h, p);
  assert.equal(bg.blockedHosts().length, STOPS_HOUR); assert.equal(auto(bg).filter((l) => l.kind === 'tracker').length, STOPS_HOUR);
  assert.equal(queued(bg, 'unknown').filter((i) => i.kind === 'tracker').length, hosts.length - STOPS_HOUR);
  bg.now += 59 * 60e3; await bg.alarm('sweep'); assert.equal(bg.blockedHosts().length, STOPS_HOUR, 'within the hour');
  bg.now += 2 * 60e3; await bg.alarm('sweep'); assert.equal(bg.blockedHosts().length, hosts.length, 'the next hour');
  const pair = await load(strong({ cookies: ['x0', 'x1', 'x2', 'x3', 'x4'].map((h) => ID(`.${h}.example`)) }));
  for (const h of ['x0', 'x1', 'x2', 'x3', 'x4']) for (const p of ['evil-a.example', 'evil-b.example']) await req(pair, `${h}.example`, p);
  assert.equal(pair.blockedHosts().length, 2, 'one pair of pages: ASK_HOUR marks an hour');
});
test('ATTACK (b): a pass-through costs from the same budget', async () => {
  const hosts = Array.from({ length: STOPS_HOUR + 3 }, (_, i) => `h${i}.example`);
  const bg = await load(strong({ cookies: hosts.map((h) => ({ name: 'hid', domain: h, value: 'h-99aa88bb77' })) }));
  for (const h of hosts) { await bg.redirect({ url: `https://${h}/r?to=${encodeURIComponent('https://blog.example/post')}`, redirectUrl: 'https://blog.example/post', type: 'main_frame' }); await bg.settle(); }
  assert.equal(new Set(auto(bg).map((l) => l.site)).size, STOPS_HOUR); assert.equal(bg.state.storage.autoAt.length, STOPS_HOUR);
  assert.equal(queued(bg, 'bounce').length, 3, 'the rest are asked');
});
test('ATTACK (c): "blocked" is a block on what OTHER sites ask of that host; a page of the host itself, opened directly, is not blocked', async () => {
  const bg = await load(strong({ cookies: [ID('.victim.example')] }));
  for (const p of ['evil-a.example', 'evil-b.example']) await req(bg, 'victim.example', p);
  const r = bg.state.dynamic.find((x) => x.id === 101000);
  assert.deepEqual([r.action.type, r.condition.domainType, r.condition.resourceTypes.includes('main_frame')], ['block', 'thirdParty', false]);
  assert.ok(SIGNIN_HOSTS.every((h) => r.condition.excludedInitiatorDomains.includes(h)));
  assert.ok(new RegExp(r.condition.regexFilter).test('https://victim.example/a.js')); assert.equal(new RegExp(r.condition.regexFilter).test('https://www.victim.example/a.js'), false, 'only the exact host');
});
test('ATTACK (d): every automatic answer is in the log, marked as done by itself, and undone the way your own press is', async () => {
  const bg = await load(strong({ cookies: [ID('.trk.example'), { name: 'hop_id', domain: 'hop.example', value: 'h-99aa88bb77' }] }));
  for (const p of ['a.example', 'b.example']) await req(bg, 'trk.example', p);
  await hop(bg);
  assert.deepEqual(auto(bg).map((l) => [l.cap, l.kind, l.site]), [['C25', 'cookie', 'trk.example'], ['C11', 'cache', '*'], ['C25', 'tracker', 'trk.example'], ['C25', 'used', 'trk.example'], ['C27', 'cookie', 'hop.example'], ['C27', 'bounce', 'hop.example'], ['C27', 'bounce', 'hop.example'], ['C27', 'skip', 'hop.example']]);   // F7 (1.32): the cookie and cache lines inside an answer too   // each pass through it saved something anew
  assert.equal((await bg.send({ type: 'restoreAll' })).restored, 2);
  await bg.send({ type: 'unstop', site: 'trk.example' }); await bg.send({ type: 'unskip', site: 'hop.example' }); await bg.settle();
  assert.deepEqual(bg.blockedHosts(), []); assert.equal(bg.state.storage.skip.sites.includes('hop.example'), false);
  bg.now += 8 * 86400e3; for (const p of ['c.example', 'd.example']) await req(bg, 'trk.example', p); await hop(bg); await bg.alarm('sweep');
  assert.deepEqual(bg.blockedHosts(), [], 'answered by itself again after you let it through'); assert.equal(bg.state.storage.skip.sites.includes('hop.example'), false);
});
test('ATTACK (d): never while a sign-in is going on, never during that site\'s sign-in hold, never while paused', async () => {
  for (const o of [{ tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/' }] }, { storage: { sguard: { 'trk.example': 1.8e12 - 60e3 } } }, { storage: { pauseUntil: 1.8e12 + 600e3 } }]) {
    const bg = await load(strong({ cookies: [ID('.trk.example')], ...o, storage: { ...o.storage } }));
    for (const p of ['a.example', 'b.example']) await req(bg, 'trk.example', p);
    assert.deepEqual(auto(bg), [], JSON.stringify(o)); assert.deepEqual(await bg.names(), ['uid']); }
});
test('ATTACK (e): Ask first does nothing by itself: learning, pass-throughs, tracker and Google cookies, saved copies due, stopped companies; nothing is deleted, closed or blocked', async () => {
  const cookies = [ID('.trk.example'), { name: '_ga', domain: '.example.com', value: 'GA1.2.3' }, { name: 'NID', domain: '.google.com', value: 'n' }, { name: 'IDE', domain: '.doubleclick.net', value: 'x' },
    { name: 'hop_id', domain: 'hop.example', value: 'h-99aa88bb77' }];
  const bg = await load(strong({ cookies, storage: { level: 'ask', cacheClearedAt: 1, stopped: ['old.example'], hard: ['old.example'], own: { 'old.example': { ok: true, at: 1 } } } }));
  for (const p of ['a.example', 'b.example']) await req(bg, 'trk.example', p);
  await hop(bg); await bg.chrome.runtime.onStartup.fire(); await bg.settle(); bg.now += 25 * 3600e3; await bg.alarm('sweep');
  assert.deepEqual(bg.destructive(), []); assert.deepEqual(await bg.names(), cookies.map((c) => c.name));
  assert.deepEqual(bg.blockedHosts(), ['old.example'], 'only the block you pressed before'); assert.deepEqual(bg.state.storage.skipok || [], []);
  assert.ok(queued(bg, 'cookies').length && queued(bg, 'google').length && queued(bg, 'unknown').length && queued(bg, 'bounce').length && queued(bg, 'cache').length && queued(bg, 'own').length);
});
