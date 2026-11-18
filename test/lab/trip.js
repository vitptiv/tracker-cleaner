'use strict';
// The coded trip (Phase A, Tracker Cleaner NOT loaded): starts the lab, drives a throwaway headless Chrome through
// lab/trip.json as Mara Lindqvist, and demands that every row that can be created here is ticked on "What I know
// about you" with a real captured value, and that the reconstructed history is the trip. node test/lab/trip.js
const assert = require('node:assert');
const fs = require('node:fs');
const { start } = require('../../lab/server'), { launch, until, newProfile, labCert } = require('./chrome'), { makeWalk, MARA } = require('./walk');
const TRACES = require('../../lab/traces.json'), TRIP = require('../../lab/trip.json'), EXPECT = require('./expect');
const PORT = Number(process.env.LAB_PORT) || 8200;
const at = (site, p = '/') => `http://${site}.localhost:${PORT}${p}`;
const row = (k, id) => k.rows.find((r) => r.id === id);
let passed = 0;
const ok = (cond, what) => { assert.ok(cond, what); passed++; };
const same = (a, b, what) => { assert.deepStrictEqual(a, b, what); passed++; };

(async () => {
  // a certificate made for this run in a throwaway folder; only this Chrome accepts it, and only it resolves *.test, to this computer
  const certDir = newProfile(), cert = labCert(certDir); fs.rmSync(certDir, { recursive: true, force: true });
  const flags = [cert.flag, '--host-resolver-rules=MAP *.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1'];
  const lab = await start({ port: PORT, tls: cert }); let b2;
  const W = makeWalk({ lab, port: PORT, launch: (dir) => launch(dir, flags) }), visited = W.E.visited, ticked = new Set();
  try {
    await W.E.open(); let { b, t, kt } = W.E;
    same(await kt.ev(`document.getElementById('canary').textContent`), 'cleaner seems off', 'canary');
    const { know, cookie } = W.E;
    const step = async (n) => { const s = TRIP.find((x) => x.n === n); await W.steps[n](); ({ b, t, kt } = W.E);
      const k = await until(async () => { const x = await know(); return s.traces.every((id) => row(x, id).mark === 'tracked') && x; }, 10000);
      if (!k) { const x = await know(); assert.fail(`step ${n} (${s.title}) did not tick ${s.traces.filter((id) => row(x, id).mark !== 'tracked').join(' ')}`); }
      passed++;
      for (const id of s.traces) ticked.add(id);
      console.log(`ok   step ${n}: ${s.title}${s.traces.length ? ' -> ' + s.traces.join(' ') : ''}`); return k; };

    await step(1);
    let k = await know(); same(k.who, null, 'no name before sign-in'); same(k.history.length, 2);
    same((await cookie('ff_uid', 'friendface')).value, row(k, 'T1').value.split('=')[1], 'T1 is the cookie Chrome holds');
    same((await cookie('_ffp', 'gazette')).value, row(k, 'T3').value.split('=')[1], 'T3 is the cookie Chrome holds');
    same(await t.ev(`localStorage.getItem('ff_copy')`), row(k, 'T9').value.split(' = ')[1], 'T9 is what local storage holds');
    same((await cookie('pn_uid', 'pennant')).value, row(k, 'T6').value.match(/pn_uid=(\S+)/)[1], 'T6 is Pennant\'s cookie'); same(lab.store.pennant.size, 1, 'Pennant\'s table has the pair');
    same(row(k, 'T36').value, `open: ${PORT + 1}; closed: ${PORT + 2}`, 'the probe found the lab\'s listener and missed the closed port');

    await step(2);
    k = await know(); same(k.who.name, MARA.name); same(k.history.map((h) => h.beforeSignIn), [true, true], 'pages from before sign-in are under her name');
    same(await t.ev('Notification.permission'), 'granted', 'T22 is what the page reads');

    k = await step(3);
    const landing = new URL(await t.url()); ok(landing.host === `tidewater.localhost:${PORT}` && landing.searchParams.get('ffclid'), 'arrived at Tidewater with a click ID');
    same(row(k, 'T4').value.split('.').pop(), landing.searchParams.get('ffclid'), 'T4 is the click ID of the address opened');
    same((await cookie('_ffc', 'tidewater')).value, row(k, 'T4').value.split('=')[1]); same((await cookie('ff_session', 'friendface')).value, row(k, 'T2').value.split(/[= ]/)[1]);

    k = await step(4);
    same(await t.ev(`document.querySelector('.comment').textContent`), 'Mara Lindqvist: Nice post');
    const frameCookie = (await b.cookies()).find((c) => c.name === 'ff_frame'); same(frameCookie.value, row(k, 'T8').value.split('=')[1]);
    same(frameCookie.partitionKey.topLevelSite, 'http://tidewater.localhost', 'T8 is tied to the surrounding site');
    ok(row(k, 'T9').captures.some((c) => c.via.startsWith('Friendface frame') && c.site === 'tidewater.localhost'), 'the frame reported its own storage ID');
    const fsid = row(k, 'T9').captures.find((c) => c.via.startsWith('Friendface frame')).value;

    await step(5);
    k = await until(async () => { const x = await know(); return row(x, 'T28').captures.some((c) => c.site === 'loopreel.localhost') && x; });
    ok(k, 'the beacon arrived after the Loopreel tab was closed');
    ok(row(k, 'T24').captures.some((c) => c.value.startsWith('address 203.0.113.7 (forwarded; simulated)') && c.site === 'loopreel.localhost'), 'the same browser from a second address is logged as a second address');

    k = await step(6); ok(W.E.notes.shareOpened, 'the share window opened');
    ok(row(k, 'T27').captures.some((c) => c.site === 'gazette.localhost' && /typed into the field "email", not sent/.test(c.via)), 'the address typed and not sent was captured');
    ok(await until(async () => row(await know(), 'T31').captures.some((c) => c.value === `share page opened for ${at('gazette', '/article/harbour-bridge')}`)), 'the share page logged the article');
    ok(row(await know(), 'T16').captures.some((c) => c.site === 'gazette.localhost'), 'the cache tag came back');

    k = await step(7);
    k = await until(async () => { const x = await know(); return x.purchases.length && x.purchases[0].sources.length === 2 && row(x, 'T13').captures.length === 2 && x; });
    ok(k, 'the purchase came from the server and from the browser, and the shop\'s worker reported'); same(k.purchases.length, 1, 'reported twice, counted once');
    same((await cookie('hop_id', 'hop')).value, row(k, 'T5').value.split('=')[1]);
    const pp = await cookie('pp_sid', 'metrics.parcelpine'); same(pp.value, row(k, 'T7').value.split('=')[1]); same(pp.httpOnly, true, 'T7 is hidden from scripts');
    ok(!(await t.ev('document.cookie')).includes('pp_sid'), 'the page cannot see pp_sid');
    const fp = row(k, 'T25'); same(new Set(fp.captures.map((c) => c.value)).size, 1, 'one fingerprint code everywhere'); same(fp.sites.sort(), ['gazette.localhost', 'parcelpine.localhost', 'tidewater.localhost']);
    const uid = (await cookie('ff_uid', 'friendface')).value, tab1 = row(k, 'T10').captures.map((c) => c.value.split(',')[0]);

    await step(8);
    same((await know()).who.name, MARA.name, 'still signed in after the restart');

    await step(9);
    k = await know(); same(new Set(row(k, 'T25').captures.map((c) => c.value)).size, 1, 'the same fingerprint code after the restart');
    ok(row(k, 'T16').captures.find((c) => c.site === 'gazette.localhost').times >= 2 && row(k, 'T16').captures.filter((c) => c.site === 'gazette.localhost').length === 1, 'the same cache tag came back after the restart');
    ok(row(k, 'T10').captures.some((c) => !tab1.includes(c.value.split(',')[0])), 'a new tab number after the restart');

    await step(10); ok(W.E.notes.ffpDeleted, 'the ID cookie is gone'); same(W.E.notes.ffpAfter, W.E.notes.ffpBefore, 'the same ID is back');
    ok(row(await know(), 'T3').captures.some((c) => c.via === 'the cookie was gone; put back from local storage, IndexedDB, cache storage'), 'the report names where the ID came back from');

    await step(11);
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

    await step(12); same(W.E.notes.cookiesLeft, 0, 'every cookie deleted');
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
  } finally { if (W.E.b) await W.E.b.close(); if (b2) await b2.close(); await lab.close(); }
})().catch((e) => { console.log(`FAIL: ${e.stack || e}`); process.exit(1); });
