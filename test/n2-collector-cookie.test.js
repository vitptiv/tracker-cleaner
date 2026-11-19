'use strict';
// N2 (1.28, C33): the first-party ID cookie that a confirmed collector path set. A site's own reverse-proxy collector
// (Friendface 2) answers with Set-Cookie under the visited site's own name; C33 confirms and blocks that path (M2, M8),
// but the cookie it set stayed. Now the worker notes, in memory only, the NAMES of the cookies a first-party sub-resource
// answer sets, per endpoint (host + path prefix, as the detector keys it); once that endpoint is in a confirmed entry
// the sweep deletes exactly those cookies there. Never a sign-in cookie, a kept cookie, a site that is switched off, a
// third-party answer or the bare root; every deletion can be undone for 10 minutes.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const NOW = 1.8e12;
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: NOW, ...o.storage } });
const ID = 'xq7m2k9p4w1z8c3v';                       // the value both sites send: a confirmed cross-site code
const A = 'ledger.example', B = 'sundial.example';   // two sites the user opens; each has its own /f/ collector path
const SECRET = 'S3cr3tValue9x8y7z6w';                // what a cookie holds: must never be written anywhere
const send = async (bg, site, url, o = {}) => { await bg.request({ url, initiator: `https://${site}`, type: 'image', ...o }); await bg.settle(); };
// an answer to something a page of `site` asked for, with Set-Cookie headers
const sets = async (bg, site, url, cookies, o = {}) => { await bg.answer({ url, initiator: `https://${site}`, type: 'xmlhttprequest', responseHeaders: [{ name: 'Content-Type', value: 'application/json' }, ...cookies.map((value) => ({ name: 'Set-Cookie', value }))], ...o }); await bg.settle(); };
const confirm = async (bg, a = A, b = B) => {        // both opened as pages; both send the same value to their own /f/
  await bg.opens(`https://${a}/`); await bg.opens(`https://${b}/`);
  await send(bg, a, `https://${a}/f/hit?c=${ID}`); await send(bg, b, `https://${b}/f/hit?c=${ID}`);
  await bg.alarm('sweep');
};
const jar = async (bg) => (await bg.chrome.cookies.getAll({})).map((c) => `${c.domain} ${c.name}`).sort();
const c33 = (bg) => (bg.state.storage.log || []).filter((l) => l.cap === 'C33' && l.kind === 'cookie').map((l) => `${l.site} ${l.name} ${l.did}`);
const xset = (bg) => bg.state.session.xset || {}, noted = (bg, ep) => (xset(bg)[ep] || { names: [] }).names;   // xset: { '<host/prefix>': { t, names: [[name, domain]] } }

test('N2 #1: a cookie set by the confirmed first-party collector path is deleted at the sweep, logged once and counted; Undo restores it and it then stays', async () => {
  const bg = await load(on({ limits: {}, storage: { modes: { C15: 'auto' } }, cookies: [{ name: 'vis', domain: A, value: SECRET, secure: false }] }));
  await sets(bg, A, `https://${A}/f/hit?u=1`, [`vis=${SECRET}; Path=/; Max-Age=31536000; SameSite=Lax`]);
  assert.deepEqual(await jar(bg), [`${A} vis`], 'deleted before the path was confirmed');
  assert.deepEqual(bg.called('cookies.remove'), [], 'something was deleted before the path was confirmed');
  await confirm(bg);
  assert.ok(bg.blocks(`https://${A}/f/hit`), 'the collector path is not blocked (M2)');
  assert.deepEqual(await jar(bg), [], 'the cookie the collector path set is still there');
  assert.deepEqual(c33(bg), [`${A} vis removed`], 'not logged with exactly one line');
  assert.ok(bg.reports.some((r) => r.collectorCookies === 1), 'not counted in the sweep report');
  const undo = (await bg.send({ type: 'state' })).undo;
  assert.deepEqual(undo.map((u) => [u.site, u.name]), [[A, 'vis']], 'not in the undo buffer');
  assert.deepEqual(await bg.send({ type: 'restore', site: A, name: 'vis' }), { ok: true, restored: 1 });
  const back = (await bg.chrome.cookies.getAll({})).find((c) => c.name === 'vis');
  assert.equal(back.value, SECRET, 'Undo did not put the cookie back as it was');
  bg.now += 15 * 60e3; await bg.alarm('sweep'); bg.now += 15 * 60e3; await bg.alarm('sweep');
  assert.deepEqual(await jar(bg), [`${A} vis`], 'deleted again after Undo');
  assert.deepEqual(c33(bg), [`${A} vis removed`]);
});
test('N2 #1b: deleted once -- the same name back from somewhere else is kept; seen being set by the collector path again, it goes again', async () => {
  const bg = await load(on({ cookies: [{ name: 'vis', domain: A, value: 'v-1' }] }));
  await sets(bg, A, `https://${A}/f/hit`, ['vis=v-1; Path=/']);
  await confirm(bg);
  assert.deepEqual(await jar(bg), []);
  await bg.setCookie({ url: `https://${A}/`, name: 'vis', value: 'v-2' });   // the site's own page sets it (the collector path is blocked)
  bg.now += 15 * 60e3; await bg.alarm('sweep');
  assert.deepEqual(await jar(bg), [`${A} vis`], 'a cookie the collector path was not seen setting again was deleted');
  await sets(bg, A, `https://${A}/f/hit`, ['vis=v-3; Path=/']);              // the block was lifted or did not hold: it set it again
  bg.now += 15 * 60e3; await bg.alarm('sweep');
  assert.deepEqual(await jar(bg), [], 'set by the collector path again and not deleted');
});
test('N2 #2: a cookie of the same site set by a different path, or never seen being set, is kept; so is a same-named cookie on another host or for the whole site', async () => {
  const bg = await load(on({ cookies: [
    { name: 'vis', domain: A, value: 'v-1' },               // set by the collector path: goes
    { name: 'cart', domain: A, value: 'c-1' },              // set by /shop/, not the collector
    { name: 'theme', domain: A, value: 'dark' },            // never seen being set
    { name: 'vis', domain: `www.${A}`, value: 'v-2' },      // same name, another host of the site
    { name: 'vis', domain: `.${A}`, value: 'v-3' },         // same name, for the whole site (the collector set it for its host only)
    { name: 'vis', domain: 'third.example', value: 'v-4' }, // same name, an unrelated site
  ] }));
  await sets(bg, A, `https://${A}/f/hit`, ['vis=v-1; Path=/; SameSite=Lax']);
  await sets(bg, A, `https://${A}/shop/add`, ['cart=c-1; Path=/']);
  // a page address (main_frame) under /f/ that sets a cookie is not a collector answer
  await bg.answer({ url: `https://${A}/f/welcome`, tabId: bg.tabOf(`https://${A}/`), frameId: 0, type: 'main_frame', responseHeaders: [{ name: 'Set-Cookie', value: 'theme=dark; Path=/' }] }); await bg.settle();
  await confirm(bg);
  assert.deepEqual(await jar(bg), [`.${A} vis`, `${A} cart`, `${A} theme`, `third.example vis`, `www.${A} vis`]);
  assert.deepEqual(c33(bg), [`${A} vis removed`]);
});
test('N2 #2b: a cookie the collector set with Domain= is deleted where it was set (the whole site), not a same-named cookie of one host', async () => {
  const bg = await load(on({ cookies: [{ name: 'vis', domain: `.${A}`, value: 'v-1' }, { name: 'vis', domain: `www.${A}`, value: 'v-2' }] }));
  await bg.opens(`https://www.${A}/`); await bg.opens(`https://${B}/`);
  await bg.answer({ url: `https://www.${A}/f/hit`, initiator: `https://www.${A}`, type: 'xmlhttprequest', responseHeaders: [{ name: 'set-cookie', value: `vis=v-1; Domain=.${A}; Path=/` }] }); await bg.settle();
  await send(bg, `www.${A}`, `https://www.${A}/f/hit?c=${ID}`); await send(bg, B, `https://${B}/f/hit?c=${ID}`);
  await bg.alarm('sweep');
  assert.deepEqual(await jar(bg), [`www.${A} vis`]);
  assert.deepEqual(c33(bg), [`${A} vis removed`]);
});
test('N2 #3: a cookie the collector path sets that is HttpOnly+Secure, has a sign-in name, or is one the user keeps, stays', async () => {
  const bg = await load(on({ storage: { allow: [{ site: A, name: 'keepme' }] }, cookies: [
    { name: 'sess', domain: A, value: 's-1', httpOnly: true, secure: true },
    { name: 'SID', domain: A, value: 'sid-1' },
    { name: 'keepme', domain: A, value: 'k-1' },
    { name: 'later', domain: A, value: 'l-1', httpOnly: true, secure: true },   // set without the flags, but HttpOnly+Secure in the browser now
    { name: 'vis', domain: A, value: 'v-1' },                                    // the control: an ordinary one goes
  ] }));
  await sets(bg, A, `https://${A}/f/hit`, ['sess=s-1; Path=/; HttpOnly; Secure', 'SID=sid-1; Path=/', 'keepme=k-1; Path=/', 'later=l-1; Path=/', 'vis=v-1; Path=/']);
  assert.deepEqual(noted(bg, `${A}/f/`).map((x) => x[0]).sort(), ['keepme', 'later', 'vis'], 'a sign-in-like cookie was noted at all');
  await confirm(bg);
  assert.deepEqual(await jar(bg), [`${A} SID`, `${A} keepme`, `${A} later`, `${A} sess`]);
  assert.deepEqual(c33(bg), [`${A} vis removed`]);
});
test('N2 #1c: the note is used up by the one pass: a noted cookie that was not there then is not deleted when the name appears later', async () => {
  const bg = await load(on());
  await sets(bg, A, `https://${A}/f/hit`, ['vis=v-1; Path=/']);    // noted, but the cookie is gone before the path is confirmed
  await confirm(bg);
  assert.deepEqual(xset(bg), {}, 'the note outlived the pass');
  await bg.setCookie({ url: `https://${A}/`, name: 'vis', value: 'v-2' });
  bg.now += 15 * 60e3; await bg.alarm('sweep');
  assert.deepEqual(await jar(bg), [`${A} vis`]); assert.deepEqual(c33(bg), []);
});
test('N2 #3b: nothing is noted from a sign-in address, and nothing is deleted on a sign-in company', async () => {
  const bg = await load(on({ cookies: [{ name: 'vis', domain: A, value: 'v-1' }, { name: 'tok', domain: A, value: 't-1' }, { name: 'gv', domain: 'google.com', value: 'g-1' }] }));
  await sets(bg, A, `https://${A}/f/login`, ['vis=v-1; Path=/']);                                    // a /login segment
  await sets(bg, A, `https://${A}/f/hit?client_id=x&redirect_uri=y`, ['tok=t-1; Path=/']);           // an OAuth-shaped address
  assert.deepEqual(xset(bg), {}, 'a sign-in address was noted');
  await confirm(bg);
  assert.deepEqual(await jar(bg), ['google.com gv', `${A} tok`, `${A} vis`]);
  // a sign-in company as "collector": google.com and a second site send the value to their own /f/; google.com's cookie stays
  const g = await load(on({ cookies: [{ name: 'gv', domain: 'google.com', value: 'g-1' }] }));
  await sets(g, 'google.com', 'https://google.com/f/hit', ['gv=g-1; Path=/']);
  assert.deepEqual(xset(g), {}, 'an answer on a sign-in company was noted');
  g.state.session.xset = { 'google.com/f/': { t: NOW, names: [['gv', '']] } };   // even with a note forced into memory the sweep leaves it
  await confirm(g, 'google.com', B);
  assert.ok(Object.values(g.state.session.xsid || {}).some((e) => e.eps.includes('google.com/f/')), 'the endpoint is in the confirmed entry');
  assert.deepEqual(await jar(g), ['google.com gv']); assert.deepEqual(c33(g), []);
});
test('N2 #4: a site cleaning is switched off for loses nothing; the other site\'s collector cookie still goes', async () => {
  const bg = await load(on({ storage: { sitesOff: [A] }, cookies: [{ name: 'vis', domain: A, value: 'v-1' }, { name: 'vis', domain: B, value: 'v-2' }] }));
  await sets(bg, A, `https://${A}/f/hit`, ['vis=v-1; Path=/']); await sets(bg, B, `https://${B}/f/hit`, ['vis=v-2; Path=/']);
  await confirm(bg);
  assert.deepEqual(await jar(bg), [`${A} vis`]);
  assert.deepEqual(c33(bg), [`${B} vis removed`]);
});
test('N2 #4: the collector host itself switched off: a cookie it set for the whole site stays too', async () => {
  const C = `c.${A}`;
  const bg = await load(on({ storage: { sitesOff: [C] }, cookies: [{ name: 'vis', domain: `.${A}`, value: 'v-1' }] }));
  await bg.opens(`https://${C}/`); await bg.opens(`https://${B}/`);
  await sets(bg, C, `https://${C}/f/hit`, [`vis=v-1; Domain=${A}; Path=/`]);
  await send(bg, C, `https://${C}/f/hit?c=${ID}`); await send(bg, B, `https://${B}/f/hit?c=${ID}`);
  await bg.alarm('sweep');
  assert.ok(Object.values(bg.state.session.xsid || {}).some((e) => e.eps.includes(`${C}/f/`)), 'the endpoint is in the confirmed entry');
  assert.deepEqual(await jar(bg), [`.${A} vis`]); assert.deepEqual(c33(bg), []);
});
test('N2 #4: main switch off, or the row off: nothing is noted and nothing is deleted', async () => {
  for (const storage of [{ master: false }, { modes: { C33: 'off' } }]) {
    const bg = await load(on({ storage, cookies: [{ name: 'vis', domain: A, value: 'v-1' }] }));
    await sets(bg, A, `https://${A}/f/hit`, ['vis=v-1; Path=/']);
    assert.deepEqual(xset(bg), {}, 'noted: ' + JSON.stringify(storage));
    await confirm(bg);
    assert.deepEqual(await jar(bg), [`${A} vis`], JSON.stringify(storage));
    assert.deepEqual(bg.called('cookies.remove'), [], JSON.stringify(storage)); assert.deepEqual(c33(bg), []); }
});
test('N2 #4b: held while paused and while that site\'s sign-in page holds deleting; done afterwards', async () => {
  const p = await load(on({ storage: { pauseUntil: NOW + 3600e3 }, cookies: [{ name: 'vis', domain: A, value: 'v-1' }] }));
  await sets(p, A, `https://${A}/f/hit`, ['vis=v-1; Path=/']); await confirm(p);
  assert.deepEqual(await jar(p), [`${A} vis`], 'deleted while paused');
  const bg = await load(on({ storage: { sguard: { [A]: NOW - 60e3 } }, cookies: [{ name: 'vis', domain: A, value: 'v-1' }] }));
  await sets(bg, A, `https://${A}/f/hit`, ['vis=v-1; Path=/']); await confirm(bg);
  assert.deepEqual(await jar(bg), [`${A} vis`], 'deleted a minute after a sign-in page of that site');
  assert.deepEqual(noted(bg, `${A}/f/`), [['vis', '']], 'a held note was used up');
  bg.now += 5 * 60e3; await bg.alarm('unguard');
  assert.deepEqual(await jar(bg), [], 'not deleted when the hold was over');
});
test('N2 #5 ATTACK: an answer from another company that sets a cookie name never gets a same-named cookie deleted anywhere', async () => {
  const V = 'victim.example';
  const bg = await load(on({ cookies: [{ name: 'vis', domain: V, value: 'v-1' }, { name: 'vis', domain: A, value: 'v-2' }, { name: 'vis', domain: B, value: 'v-3' }, { name: 'cart', domain: V, value: 'c-1' }] }));
  await bg.opens(`https://${A}/`); await bg.opens(`https://${B}/`); await bg.opens(`https://${V}/`);
  // extends M8 pin #1: a script on two visited sites sends one token to victim.example, and victim.example's answers set cookies
  for (const s of [A, B]) { await send(bg, s, `https://${V}/f/hit?u=${ID}`); await sets(bg, s, `https://${V}/f/hit?u=${ID}`, ['vis=x; Path=/', 'cart=x; Path=/']); }
  assert.deepEqual(xset(bg), {}, 'a third-party answer was noted');
  await bg.alarm('sweep');
  assert.deepEqual(Object.values(bg.state.session.xsid || {}), [], 'Q-batch F4 (1.32): sent to another company only, so not confirmed');
  assert.deepEqual(bg.called('cookies.remove'), [], 'a cookie was deleted');
  assert.deepEqual(await jar(bg), [`${A} vis`, `${B} vis`, `${V} cart`, `${V} vis`]);
});
test('N2 #5 ATTACK: victim.example framed inside a hostile page is another company there: its answers are not noted, so its real collector being confirmed deletes nothing they named', async () => {
  const V = 'victim.example', E = 'evil.example';
  const bg = await load(on({ cookies: [{ name: 'cart', domain: V, value: 'c-1' }, { name: 'vis', domain: V, value: 'v-1' }] }));
  await bg.opens(`https://${E}/`);
  // a frame of victim.example in evil.example's tab asks victim.example/f/ and gets Set-Cookie: cart
  await bg.answer({ url: `https://${V}/f/hit`, tabId: bg.tabOf(`https://${E}/`), frameId: 7, initiator: `https://${V}`, type: 'xmlhttprequest', responseHeaders: [{ name: 'Set-Cookie', value: 'cart=x; Path=/' }] }); await bg.settle();
  assert.deepEqual(xset(bg), {}, 'an answer inside another site\'s tab was noted');
  // victim.example's own /f/ really is a confirmed collector (it and a second site send one value there) and set `vis`
  await sets(bg, V, `https://${V}/f/hit`, ['vis=v-1; Path=/']);
  await confirm(bg, V, B);
  assert.deepEqual(await jar(bg), [`${V} cart`], 'the cookie named from inside the hostile page was deleted');
  assert.deepEqual(c33(bg), [`${V} vis removed`]);
});
test('N2 #6 ATTACK: the bare root never qualifies -- nothing is noted for it and no cookie the site\'s root set is deleted', async () => {
  const bg = await load(on({ cookies: [{ name: 'vis', domain: A, value: 'v-1' }, { name: 'vis', domain: B, value: 'v-2' }] }));
  await bg.opens(`https://${A}/`); await bg.opens(`https://${B}/`);
  for (const s of [A, B]) { await sets(bg, s, `https://${s}/?u=${ID}`, ['vis=x; Path=/']); await send(bg, s, `https://${s}/?u=${ID}`); }
  assert.deepEqual(xset(bg), {}, 'the bare root was noted');
  await bg.alarm('sweep');
  assert.ok(Object.values(bg.state.session.xsid || {}).some((e) => e.eps.includes(`${A}/`)), 'the root endpoint is in the confirmed entry (and is never blocked: M8)');
  assert.equal(bg.blocks(`https://${A}/`), false);
  assert.deepEqual(bg.called('cookies.remove'), []);
  assert.deepEqual(await jar(bg), [`${A} vis`, `${B} vis`]);
  // even with a note forced into memory for the root, the sweep does not act on it
  bg.state.session.xset = { [`${A}/`]: { t: NOW, names: [['vis', '']] } };
  bg.now += 15 * 60e3; await bg.alarm('sweep');
  assert.deepEqual(await jar(bg), [`${A} vis`, `${B} vis`]);
});
test('N2 #7: the caps hold -- a flood of cookie names or of endpoints does not grow what is kept in memory', async () => {
  const bg = await load(on());
  await sets(bg, A, `https://${A}/f/hit`, Array.from({ length: 300 }, (_, i) => `n${i}=x; Path=/`));
  await sets(bg, A, `https://${A}/f/hit`, Array.from({ length: 300 }, (_, i) => `m${i}=x; Path=/`));
  assert.equal(noted(bg, `${A}/f/`).length, 10, 'more than 10 names for one endpoint');
  await sets(bg, A, `https://${A}/g/hit`, [`${'L'.repeat(101)}=x; Path=/`, 'bad name=x', '=x', 'novalue', 'ok=1']);
  assert.deepEqual(noted(bg, `${A}/g/`), [['ok', '']], 'an over-long or malformed name was noted');
  // one site, 300 directories: it keeps its 5 newest and pushes out nobody else's
  await sets(bg, B, `https://${B}/f/hit`, ['vis=1']);
  for (let i = 0; i < 300; i++) { bg.now += 1; await bg.answer({ url: `https://${A}/d${i}/hit`, initiator: `https://${A}`, type: 'image', responseHeaders: [{ name: 'Set-Cookie', value: 'a=1' }] }); }
  await bg.settle();
  assert.deepEqual(Object.keys(xset(bg)).filter((k) => k.startsWith(A)).sort(), [295, 296, 297, 298, 299].map((i) => `${A}/d${i}/`), 'one site holds more than its 5 newest endpoints');
  assert.deepEqual(noted(bg, `${B}/f/`), [['vis', '']], "one site's flood pushed out another site's note");
  // 40 sites, 5 directories each: 50 endpoints in all, the newest
  for (let s = 0; s < 40; s++) for (let i = 0; i < 5; i++) { bg.now += 1; await bg.answer({ url: `https://s${s}.example/d${i}/hit`, initiator: `https://s${s}.example`, type: 'image', responseHeaders: [{ name: 'Set-Cookie', value: 'a=1' }] }); }
  await bg.settle();
  assert.equal(Object.keys(xset(bg)).length, 50, 'more than 50 endpoints in all');
  assert.ok('s39.example/d4/' in xset(bg) && !('s0.example/d0/' in xset(bg)), 'not the newest that were kept');
  assert.ok(JSON.stringify(xset(bg)).length < 50 * (300 + 10 * 400), 'what is kept is not bounded');
});
test('N2 #8: storage.local, the log and the report never hold a cookie value or the noted names; the note itself holds no value', async () => {
  const bg = await load(on({ limits: {}, storage: { modes: { C15: 'auto' } }, cookies: [{ name: 'vis', domain: A, value: SECRET }, { name: 'onlynoted', domain: B, value: SECRET }] }));
  await sets(bg, A, `https://${A}/f/hit`, [`vis=${SECRET}; Path=/`]);
  await sets(bg, B, `https://${B}/other/x`, [`onlynoted=${SECRET}; Path=/`]);   // noted, never confirmed
  await confirm(bg);
  assert.deepEqual(c33(bg), [`${A} vis removed`]);
  const local = JSON.stringify(bg.state.storage), reports = JSON.stringify(bg.reports);
  assert.equal(local.includes(SECRET), false, 'a cookie value in storage.local');
  assert.equal('xset' in bg.state.storage, false, 'the note is in storage.local');
  assert.equal(local.includes('onlynoted'), false, 'a noted name in storage.local');
  assert.equal(reports.includes(SECRET), false, 'a cookie value in a report'); assert.equal(reports.includes('onlynoted'), false, 'a noted name in a report');
  assert.equal(JSON.stringify(bg.state.session.xset).includes(SECRET), false, 'a cookie value in the note');
  assert.deepEqual(Object.keys(xset(bg)), [`${B}/other/`], 'the used note was not taken out');
  assert.deepEqual(Object.keys(xset(bg)[`${B}/other/`]).sort(), ['names', 't']); assert.equal(typeof xset(bg)[`${B}/other/`].t, 'number');
  assert.deepEqual(noted(bg, `${B}/other/`), [['onlynoted', '']], 'the note is not names only');
  for (const c of bg.calls.filter((x) => x.api === 'storage.local.set' || x.api === 'storage.sync.set')) assert.equal(JSON.stringify(c.args).includes(SECRET), false, 'a cookie value was written');
  assert.deepEqual(bg.called('storage.sync.set'), []);
});
test('N2: the pure reader of Set-Cookie headers gives names, the Domain named and the two flags, never a value', () => {
  const { setCookies } = require('../extension/xsid.js');
  assert.deepEqual(setCookies([{ name: 'Set-Cookie', value: `a=${SECRET}; Path=/; HttpOnly; Secure` }, { name: 'SET-COOKIE', value: 'b=2; Domain=.Shop.Example; domain=shop.example' }, { name: 'ETag', value: '"x"' },
    { name: 'set-cookie', value: 'c=3\nd=4; httponly' }, { name: 'set-cookie', value: '=novalue' }, { name: 'set-cookie', value: 'justtext' }, { name: 'set-cookie' }]),
  [{ name: 'a', domain: '', httpOnly: true, secure: true }, { name: 'b', domain: 'shop.example', httpOnly: false, secure: false }, { name: 'c', domain: '', httpOnly: false, secure: false }, { name: 'd', domain: '', httpOnly: true, secure: false }]);
  assert.deepEqual(setCookies(undefined), []); assert.deepEqual(setCookies([null, {}, { name: 'set-cookie', value: 7 }]), []);
});
