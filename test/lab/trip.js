'use strict';
// The coded trip (Phase A, Tracker Cleaner NOT loaded): starts the lab, drives a throwaway headless Chrome through
// lab/trip.json as Mara Lindqvist, and demands that every row that can be created here is ticked on "What I know
// about you" with a real captured value, and that the reconstructed history is the trip. node test/lab/trip.js
const assert = require('node:assert'), http = require('node:http');
const { start } = require('../../lab/server'), { outside } = require('../../lab/outside'), { launch, sleep, until } = require('./chrome');
const TRACES = require('../../lab/traces.json'), TRIP = require('../../lab/trip.json'), EXPECT = require('./expect');
const PORT = Number(process.env.LAB_PORT) || 8200, MARA = { name: 'Mara Lindqvist', email: 'mara.lindqvist@example.test', password: 'lab-only-1' };
const at = (site, p = '/') => `http://${site}.localhost:${PORT}${p}`;
const row = (k, id) => k.rows.find((r) => r.id === id);
let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed++; };
const same = (a, b, what) => { assert.deepStrictEqual(a, b, what); passed++; };

(async () => {
  const lab = await start({ port: PORT }); let b = await launch(), b2;
  const visited = [], ticked = new Set();
  try {
    await b.send('Browser.grantPermissions', { origin: at('friendface', '').replace(/\/$/, ''), permissions: ['notifications'] });   // the press on "Allow"
    let kt = await b.tab(at('friendface', '/lab/check')), t = await b.tab();
    same(await kt.ev(`document.getElementById('canary').textContent`), 'cleaner seems off', 'canary');
    const know = () => kt.ev(`fetch('/what-i-know.json').then((r) => r.json())`);
    // a page of a content site was opened: Friendface must list it, as often as the trip opened it
    const landed = async (s = t) => { const url = await s.url(); visited.push(url); const n = visited.filter((u) => u === url).length;
      ok(await until(async () => (await know()).history.filter((h) => h.url === url).length >= n, 10000), `the visit to ${url} reached Friendface`); return url; };
    const cookie = async (name, host) => (await b.cookies()).find((c) => c.name === name && c.domain.replace(/^\./, '') === host + '.localhost');
    const step = async (n, fn) => { const s = TRIP.find((x) => x.n === n); await fn();
      const k = await until(async () => { const x = await know(); return s.traces.every((id) => row(x, id).mark === 'tracked') && x; }, 10000);
      if (!k) { const x = await know(); assert.fail(`step ${n} (${s.title}) did not tick ${s.traces.filter((id) => row(x, id).mark !== 'tracked').join(' ')}`); }
      passed++;
      for (const id of s.traces) ticked.add(id);
      console.log(`ok   step ${n}: ${s.title}${s.traces.length ? ' -> ' + s.traces.join(' ') : ''}`); return k; };

    await step(1, async () => { await t.go(at('gazette')); await landed(); await t.clickAndLoad('#a-harbour-bridge'); await landed();
      await t.ev('window.scrollTo(0, document.body.scrollHeight)'); });
    let k = await know(); same(k.who, null, 'no name before sign-in'); same(k.history.length, 2);
    same((await cookie('ff_uid', 'friendface')).value, row(k, 'T1').value.split('=')[1], 'T1 is the cookie Chrome holds');
    same((await cookie('_ffp', 'gazette')).value, row(k, 'T3').value.split('=')[1], 'T3 is the cookie Chrome holds');
    same(await t.ev(`localStorage.getItem('ff_copy')`), row(k, 'T9').value.split(' = ')[1], 'T9 is what local storage holds');
    same((await cookie('pn_uid', 'pennant')).value, row(k, 'T6').value.match(/pn_uid=(\S+)/)[1], 'T6 is Pennant\'s cookie'); same(lab.store.pennant.size, 1, 'Pennant\'s table has the pair');
    same(row(k, 'T36').value, `open: ${PORT + 1}; closed: ${PORT + 2}`, 'the probe found the lab\'s listener and missed the closed port');

    await step(2, async () => { await t.go(at('friendface')); await t.type('#join [name=name]', MARA.name, 5); await t.type('#join [name=email]', MARA.email, 5);
      await t.type('#join [name=password]', MARA.password, 5); await t.clickAndLoad('#join button'); });
    k = await know(); same(k.who.name, MARA.name); same(k.history.map((h) => h.beforeSignIn), [true, true], 'pages from before sign-in are under her name');
    same(await t.ev('Notification.permission'), 'granted', 'T22 is what the page reads');

    k = await step(3, async () => { await t.clickAndLoad('#post-1'); await landed(); });
    const landing = new URL(await t.url()); ok(landing.host === `tidewater.localhost:${PORT}` && landing.searchParams.get('ffclid'), 'arrived at Tidewater with a click ID');
    same(row(k, 'T4').value.split('.').pop(), landing.searchParams.get('ffclid'), 'T4 is the click ID of the address opened');
    same((await cookie('_ffc', 'tidewater')).value, row(k, 'T4').value.split('=')[1]); same((await cookie('ff_session', 'friendface')).value, row(k, 'T2').value.split(/[= ]/)[1]);

    k = await step(4, async () => { const f = await until(() => t.point('#like')); await t.mouse(f.x - 100, f.y - 10);
      await t.clickAndLoad('#signin-with'); await t.clickAndLoad('#approve'); await landed();
      await t.type('#comment', 'Nice post'); await t.clickAndLoad('#send'); await landed(); });
    same(await t.ev(`document.querySelector('.comment').textContent`), 'Mara Lindqvist: Nice post');
    const frameCookie = (await b.cookies()).find((c) => c.name === 'ff_frame'); same(frameCookie.value, row(k, 'T8').value.split('=')[1]);
    same(frameCookie.partitionKey.topLevelSite, 'http://tidewater.localhost', 'T8 is tied to the surrounding site');
    ok(row(k, 'T9').captures.some((c) => c.via.startsWith('Friendface frame') && c.site === 'tidewater.localhost'), 'the frame reported its own storage ID');
    const fsid = row(k, 'T9').captures.find((c) => c.via.startsWith('Friendface frame')).value;

    await step(5, async () => { const v = await b.tab(); await v.send('Network.setExtraHTTPHeaders', { headers: { 'X-Forwarded-For': '203.0.113.7' } });
      await v.go(at('loopreel')); await landed(v); await v.click('#play'); await sleep(2000); await v.send('Page.close'); });
    k = await until(async () => { const x = await know(); return row(x, 'T28').captures.some((c) => c.site === 'loopreel.localhost') && x; });
    ok(k, 'the beacon arrived after the Loopreel tab was closed');
    ok(row(k, 'T24').captures.some((c) => c.value.startsWith('address 203.0.113.7 (forwarded; simulated)') && c.site === 'loopreel.localhost'), 'the same browser from a second address is logged as a second address');

    k = await step(6, async () => { await t.go(at('gazette')); await landed(); await t.type('#search [name=q]', 'kite repair'); await t.clickAndLoad('#search button'); await landed();
      for (let i = 0; i < 12; i++) { await t.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: 200 + i * 25, y: 300 + (i % 3) * 20 }); await sleep(20); }
      await t.type('#nl', MARA.email, 60); await sleep(1200);
      await t.go(at('gazette', '/article/harbour-bridge')); await landed(); await t.click('#share');
      const share = await until(async () => (await b.send('Target.getTargets')).targetInfos.find((x) => x.url.includes('/share?u=')));
      ok(share, 'the share window opened'); await sleep(300); await b.send('Target.closeTarget', { targetId: share.targetId }); });
    ok(row(k, 'T27').captures.some((c) => c.site === 'gazette.localhost' && /typed into the field "email", not sent/.test(c.via)), 'the address typed and not sent was captured');
    ok(await until(async () => row(await know(), 'T31').captures.some((c) => c.value === `share page opened for ${at('gazette', '/article/harbour-bridge')}`)), 'the share page logged the article');
    ok(row(await know(), 'T16').captures.some((c) => c.site === 'gazette.localhost'), 'the cache tag came back');

    k = await step(7, async () => { await t.go(at('friendface')); await t.clickAndLoad('#post-2'); await landed(); await t.clickAndLoad('#add'); await landed();
      await t.clickAndLoad('#checkout'); await landed(); await t.type('#email', MARA.email, 5); await t.type('#name', MARA.name, 5); await t.type('#city', 'Nordhavn', 5); await t.type('#postcode', '00100', 5);
      await t.clickAndLoad('#buy'); await landed(); });
    k = await until(async () => { const x = await know(); return x.purchases.length && x.purchases[0].sources.length === 2 && row(x, 'T13').captures.length === 2 && x; });
    ok(k, 'the purchase came from the server and from the browser, and the shop\'s worker reported'); same(k.purchases.length, 1, 'reported twice, counted once');
    same((await cookie('hop_id', 'hop')).value, row(k, 'T5').value.split('=')[1]);
    const pp = await cookie('pp_sid', 'metrics.parcelpine'); same(pp.value, row(k, 'T7').value.split('=')[1]); same(pp.httpOnly, true, 'T7 is hidden from scripts');
    ok(!(await t.ev('document.cookie')).includes('pp_sid'), 'the page cannot see pp_sid');
    const fp = row(k, 'T25'); same(new Set(fp.captures.map((c) => c.value)).size, 1, 'one fingerprint code everywhere'); same(fp.sites.sort(), ['gazette.localhost', 'parcelpine.localhost', 'tidewater.localhost']);
    const uid = (await cookie('ff_uid', 'friendface')).value, tab1 = row(k, 'T10').captures.map((c) => c.value.split(',')[0]);

    await step(8, async () => { const dir = b.dir; await b.close(true); const found = outside(dir, PORT);
      // the outside result is handed to the lab under this browser's cookie
      await new Promise((done, fail) => http.request({ host: '127.0.0.1', port: PORT, path: '/lab/outside', method: 'POST', headers: { Host: `friendface.localhost:${PORT}`, Cookie: `ff_uid=${uid}` } }, (r) => { r.resume(); r.on('end', done); }).on('error', fail).end(JSON.stringify({ rows: found })));
      b = await launch(dir); kt = await b.tab(at('friendface', '/what-i-know')); t = await b.tab(); });
    same((await know()).who.name, MARA.name, 'still signed in after the restart');

    await step(9, async () => { await t.go(at('gazette', '/article/harbour-bridge')); await landed(); });
    k = await know(); same(new Set(row(k, 'T25').captures.map((c) => c.value)).size, 1, 'the same fingerprint code after the restart');
    ok(row(k, 'T16').captures.find((c) => c.site === 'gazette.localhost').times >= 2 && row(k, 'T16').captures.filter((c) => c.site === 'gazette.localhost').length === 1, 'the same cache tag came back after the restart');
    ok(row(k, 'T10').captures.some((c) => !tab1.includes(c.value.split(',')[0])), 'a new tab number after the restart');

    await step(10, async () => { const before = (await cookie('_ffp', 'gazette')).value; await t.go(at('gazette', '/lab/delete-id')); same(await cookie('_ffp', 'gazette'), undefined, 'the ID cookie is gone');
      await t.go(at('gazette')); await landed(); same((await cookie('_ffp', 'gazette')).value, before, 'the same ID is back'); });
    ok(row(await know(), 'T3').captures.some((c) => c.via === 'the cookie was gone; put back from local storage, IndexedDB, cache storage'), 'the report names where the ID came back from');

    await step(11, async () => { await t.go(at('tidewater', '/post/mending-a-kite')); await landed(); });
    k = await until(async () => { const x = await know(); return row(x, 'T9').captures.find((c) => c.value === fsid).times >= 2 && x; }); ok(k, 'the frame reported the same storage ID after the restart');
    same(row(k, 'T9').captures.filter((c) => c.via.startsWith('Friendface frame') && c.site === 'tidewater.localhost').length, 1);

    // the whole checklist, before the last step deletes the cookies it is compared with
    k = await know();
    for (const tr of TRACES) { const r = row(k, tr.id);
      if (tr.status !== 'built') { same([r.mark, r.value], [tr.status, ''], `${tr.id} is not ticked`); ok(r.reason, `${tr.id} says why`); continue; }
      same(r.mark, 'tracked', `${tr.id} ${tr.type}`); ok(ticked.has(tr.id), `${tr.id} belongs to a step of the trip`);
      ok(EXPECT[tr.id].test(r.value), `${tr.id} value "${r.value}"`); ok(r.sites.length && r.captures[0].when, `${tr.id} has a site and a time`); }
    same(k.tracked, k.buildable, 'every row that can be created here is ticked'); same(k.of, 36);
    const html = await kt.ev(`fetch('/what-i-know').then((r) => r.text())`);
    for (const r of k.rows) ok(html.includes(`data-row="${r.id}" data-mark="${r.mark}"`) && (!r.value || html.includes(lab.esc(r.value))), `${r.id} is shown on the page`);
    same(k.history.map((h) => h.url), visited, 'the reconstructed history is the trip');

    await step(12, async () => { await b.send('Storage.clearCookies'); same((await b.cookies()).length, 0); await t.go(at('gazette')); await landed(); });
    k = await know(); same(k.who.name, MARA.name, 'every cookie deleted, and Friendface still knows who this is'); same(k.history.map((h) => h.url), visited);
    ok((await cookie('ff_uid', 'friendface')).value !== uid, 'under a new browser cookie');

    // a second person in a second profile stays apart, although the machine and so the fingerprint are the same
    b2 = await launch(); const j = await b2.tab(at('friendface'));
    await j.type('#join [name=name]', 'Jonas Weller', 5); await j.type('#join [name=email]', 'jonas.weller@example.test', 5); await j.type('#join [name=password]', 'lab-only-2', 5); await j.clickAndLoad('#join button');
    await j.go(at('gazette')); const kj = await until(async () => { await j.go(at('friendface', '/what-i-know')); const x = await j.ev(`fetch('/what-i-know.json').then((r) => r.json())`); return x.history.length && row(x, 'T25').value && x; });
    same([kj.who.name, kj.history.map((h) => h.url)], ['Jonas Weller', [at('gazette')]], 'Jonas has his own short history'); same(row(kj, 'T25').value, row(k, 'T25').value, 'same machine, same fingerprint');
    same((await know()).history.map((h) => h.url), visited, 'and Mara\'s is untouched');

    if (process.argv.includes('--rows')) for (const r of k.rows) console.log(`${r.id.padEnd(4)} ${r.mark.padEnd(19)} ${r.value || r.reason}  [${r.sites.join(', ')}]`);
    const open = k.rows.filter((r) => r.mark !== 'tracked').map((r) => `${r.id} ${r.mark}`);
    console.log(`PASS: ${passed} checks; ${k.tracked} of ${k.of} rows tracked, all ${k.buildable} that can be created here; history of ${visited.length} pages matches; not ticked: ${open.join(', ')}`);
  } finally { await b.close(); if (b2) await b2.close(); await lab.close(); }
})().catch((e) => { console.log(`FAIL: ${e.stack || e}`); process.exit(1); });
