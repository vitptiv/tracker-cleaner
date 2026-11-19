'use strict';
// Friendface 2 (lab-only), F2-7: the coded trip with the SHIPPED cleaner FULLY ON (master on, the fingerprint shield
// C32 switched on too, every question answered yes) through the ff2 sites, and the parallel "What I know about you".
// It proves each ff2 kind is still tracked and tied to one browser although the cleaner is on, and that the structural
// rules never touched ff2 (nothing learned, nothing blocked). Results to lab/ff2-misses.json. The frozen Friendface 1
// files and the extension are never edited. node test/lab/ff2-trip.js
const assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const { start2 } = require('../../lab/ff2-server'), { launch, sleep, until } = require('./chrome');
const TRIP = require('../../lab/ff2-trip.json'), { TRACES2 } = require('../../lab/ff2-know');
const PORT = Number(process.env.FF2_PORT) || 8300, EXT = path.join(__dirname, '..', '..', 'extension');
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error('timeout: ' + what); })]);
let passed = 0; const ok = (c, w) => { assert.ok(c, w); passed++; };

(async () => {
  const lab = await start2({ port: PORT });
  const at = (s, p = '/') => lab.at2(s, p);
  // a second, extension-free browser for the cleaner-off fingerprint baseline (same machine -> same unshielded id)
  let base;
  const flags = ['--host-resolver-rules=MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1'];
  const b = await launch(undefined, [...flags, '--enable-unsafe-extension-debugging']);
  try {
    const { id } = await b.send('Extensions.loadUnpacked', { path: EXT });
    const popup = await b.tab(`chrome-extension://${id}/popup.html`);
    const msg = (m) => within(popup.ev(`chrome.runtime.sendMessage(${JSON.stringify(m)})`), 20000, m.type);
    await until(async () => (await msg({ type: 'state' })).groups, 10000);
    await msg({ type: 'setMaster', on: true });
    // the trip runs at the fresh-install default: the fingerprint shield (C32) is OFF. It is switched ON only later,
    // in the fingerprint reconciliation, so readPixels is measured both ways and the number is not run-dependent.
    // answer every question the extension raises (there should be none: ff2 is first-party and cookie-less)
    const answerAll = async () => { const st = await msg({ type: 'state' }); let did = 0;
      for (const g of st.groups || []) for (const it of (g.items || []).filter((x) => ['tracker', 'used', 'bounce', 'skip'].includes(x.kind))) { await msg({ type: 'approve', group: g.id, site: it.site, name: it.name }).catch(() => {}); did++; } return did; };

    const t = await b.tab();
    const fpOf = (tab) => tab.ev(`(window.ff2fp ? window.ff2fp() : Promise.resolve(null))`);
    const done = {};   // kind -> last step it was seen tracked
    const knows = () => t.ev(`fetch('/what-i-know.json').then((r) => r.json())`);
    const seeStep = async (s) => { const k = await until(async () => { const x = await knows().catch(() => null);
        return x && s.kinds.every((id) => (x.rows.find((r) => r.id === id) || {}).mark === 'tracked') && x; }, 12000);
      if (!k) { const x = await knows().catch(() => ({ rows: [] })); assert.fail(`ff2 step ${s.n} (${s.title}) missing ${s.kinds.filter((id) => (x.rows.find((r) => r.id === id) || {}).mark !== 'tracked').join(' ')}`); }
      for (const id of s.kinds) done[id] = s.n; passed++; console.log(`ok   ff2 step ${s.n}: ${s.title} -> ${s.kinds.join(' ')}`); return k; };
    const questions = [];

    // POSITIVE CONTROL (M7): the shipped cleaner MUST strip a genuine tracking parameter -- gclid, a real Google Ads
    // click id -- from a top-level navigation (C23). If the cleaner were silently off or broken, gclid/utm_source would
    // survive and the trip fails HERE, so a "stopped" result below cannot be a false pass from a disabled cleaner.
    await t.go(at('ledger', '/?gclid=Cj0KCQ2024abcd&utm_source=newsletter&keep=1')); await sleep(500);
    const control = await t.url();
    ok(!/gclid=|utm_source=/.test(control) && /keep=1/.test(control), `POSITIVE CONTROL: the cleaner stripped the tracking params gclid/utm_source (landed ${control})`);

    // step 1-2: open Ledger and its budget. Dwell on each site >3 s so it enters the cleaner's `mine` (a user reads the
    // page; a page passed straight on does not count), which is what lets the cross-site-id counter-repair (C33) confirm.
    await t.go(at('ledger')); await seeStep(TRIP[0]); questions.push(await answerAll());
    // F9 is a REAL server-side loopback probe (M7): call it with the lab's own probe ports and confirm it distinguishes
    // the OPEN port (the lab opens +2) from the CLOSED one (+3) -- a genuine open-vs-closed network probe, not a stub.
    // Done at step 1, before C33 blocks /f/; F9 is also stopped going forward (its /f/probe is under the blocked /f/).
    const probe = await t.ev(`fetch('/f/probe?ports=${lab.probe.join(',')}').then((r) => r.json()).catch(() => null)`);
    const states = probe && probe.probe ? probe.probe.map((x) => x[1]) : [];
    ok(states.includes('open') && states.includes('closed'), `F9 is a real loopback probe: open vs closed distinguished (${JSON.stringify(probe && probe.probe)})`);
    await sleep(3500);
    await t.clickAndLoad('#go-budget'); await seeStep(TRIP[1]);
    // step 3-4: scripted hand-off to Sundial (the link was rewritten by the kit to carry the id)
    await t.clickAndLoad('#to-sundial'); ok(new URL(await t.url()).host === `sundial.localhost:${PORT}`, 'landed on Sundial by a scripted jump'); await seeStep(TRIP[2]); await seeStep(TRIP[3]); await sleep(3500);
    await t.clickAndLoad('#to-atlas'); ok(new URL(await t.url()).host === `atlas.localhost:${PORT}`, 'landed on Atlas'); await seeStep(TRIP[4]); await seeStep(TRIP[5]); await sleep(3500);
    // step 7: meta-refresh hand-off back to Ledger
    await t.click('#to-ledger'); await until(async () => new URL(await t.url()).host === `ledger.localhost:${PORT}`, 8000);
    ok(/ledger\.localhost/.test(await t.url()), 'meta-refresh brought the browser back to Ledger'); await seeStep(TRIP[6]);
    // step 8: sign in on a client_id+redirect_uri page (arms the shipped hold; the SID cookie is KEEP_RE-spared)
    await t.go(at('ledger')); await t.clickAndLoad('#ff2-signin'); await seeStep(TRIP[7]);
    await t.clickAndLoad('#after-signin');
    // step 9: revisit the budget; the id is still there
    await t.go(at('ledger', '/budget')); await seeStep(TRIP[8]);
    questions.push(await answerAll());
    // The fingerprint join key (F6) is a shield/C32 concern, and the frozen window.ff2fp computes it via the site's own
    // /f/ path -- which the cross-site-id block (C33) would close. So measure the join key first with C33 held OFF (the
    // collector reachable), then below restore C33 and measure its forward effect. The two counter-repairs are separate.
    await msg({ type: 'setMode', group: 'crossid', mode: 'off' }); await sleep(800);
    // Fingerprint reconciliation. The F6 join key is built from fonts (measureText) and matchMedia/screen. Measure it
    // on each site with the shield OFF and ON, against a cleaner-off baseline. M4 makes the shield blur the font-measure
    // widths and the screen size (as well as readPixels and the WebGL vendor/renderer it already touched), so with the
    // shield ON -- the 1.26 default -- the join key no longer matches across the three sites or the cleaner-off
    // baseline: the fonts+screen join is broken. matchMedia and the pixel ratio are left alone (a page needs them), so
    // it is best effort, not perfect. (C33 is still held off here so the frozen ff2 kit can reach its own /f/.)
    const capture = async () => { const c = {}; for (const s of ['ledger', 'sundial', 'atlas']) { await t.go(at(s)); await sleep(300); c[s] = await fpOf(t); } return c; };
    await msg({ type: 'setMode', group: 'shield', mode: 'off' }); await sleep(400);
    const off = await capture();                                   // shield off: the unshielded join key
    await msg({ type: 'setMode', group: 'shield', mode: 'auto' }); await sleep(400);
    const onc = await capture();                                   // shield on (the 1.26 default): fonts + screen blurred
    base = await launch(undefined, flags); const bt = await base.tab(at('ledger')); await sleep(500);   // a cleaner-off browser: no extension
    const bfp = await bt.ev(`window.ff2fp ? window.ff2fp() : null`).catch(() => null);
    const keyStable = (c) => c.ledger && c.ledger.code && c.ledger.code === c.sundial.code && c.ledger.code === c.atlas.code;
    ok(keyStable(off), 'shield off: one fingerprint join key across all three sites (the unshielded baseline)');
    ok(bfp && off.ledger.code === bfp.code, `shield off: the join key equals the cleaner-off baseline (${off.ledger.code} vs ${bfp && bfp.code})`);
    const keyDefeated = !!(bfp && onc.ledger.code !== bfp.code && !keyStable(onc));
    ok(keyDefeated, `M4 win -- shield on (default): the fonts+screen join key no longer matches the baseline and differs across sites (ledger ${onc.ledger.code}, sundial ${onc.sundial.code}, atlas ${onc.atlas.code}; baseline ${bfp && bfp.code})`);
    const winOff = !!(bfp && off.ledger.readpx !== bfp.readpx), winOn = !!(bfp && onc.ledger.readpx !== bfp.readpx);
    ok(winOff === false, `shield off: readPixels unchanged (${off.ledger.readpx} vs baseline ${bfp && bfp.readpx})`);
    ok(winOn === true, `shield on: readPixels perturbed (${onc.ledger.readpx} vs baseline ${bfp && bfp.readpx})`);
    const glSpoofedOn = !!(bfp && onc.ledger.gl !== bfp.gl && off.ledger.gl === bfp.gl);
    const fingerprint = { baselineCode: bfp && bfp.code, joinKeyShieldOff: off.ledger.code, keyStableShieldOff: keyStable(off), keyStableShieldOn: keyStable(onc), keyDefeatedShieldOn: keyDefeated,
      keyEqualsBaselineShieldOff: bfp && off.ledger.code === bfp.code, keyEqualsBaselineShieldOn: bfp && onc.ledger.code === bfp.code, shieldOnCodes: { ledger: onc.ledger.code, sundial: onc.sundial.code, atlas: onc.atlas.code },
      readPixels: { shieldOff: { hash: off.ledger.readpx, perturbed: winOff }, shieldOn: { hash: onc.ledger.readpx, perturbed: winOn }, baseline: bfp && bfp.readpx },
      webglVendorRenderer: { shieldOff: off.ledger.gl, shieldOn: onc.ledger.gl, baseline: bfp && bfp.gl, spoofedWithShieldOn: glSpoofedOn } };

    // ---- What the cross-site-id counter-repair (C33, M2) does to ff2, measured forward-looking. A value detector only
    // learns a value is cross-site AFTER two sites have sent it, so the collector receives the id on first contact and
    // the cross-site JOIN happens once; that initial join cannot be undone. From then on the cleaner blocks the exact
    // collector path (/f/, never the site root) and strips confirmed ids from request URLs and links, so no FURTHER
    // send gets through. First confirm the join happened and the id was confirmed, then probe the forward state.
    // restore the cross-site-id counter-repair and force the sweep that confirms the id (the three sites are in `mine`)
    // and installs its block/strip rules, then measure the forward state.
    // The join is read first, while the counter-repair is still held off: "What I know" finds the browser by the fp_id
    // cookie this site's server receives, and N2 (1.28) deletes that cookie once the collector path is confirmed.
    const k = await knows();
    const f1Mark = lab.store.records.length, sites3 = ['ledger', 'sundial', 'atlas'];
    const fpIds = async () => (await b.cookies()).filter((c) => c.name === 'fp_id').map((c) => c.domain.replace(/^\./, '')).sort();
    const f1 = { cookiesBefore: await fpIds() };
    ok(f1.cookiesBefore.length === 3, `before the counter-repair acts, each of the three sites has its fp_id cookie (${f1.cookiesBefore.join(', ')})`);
    const restoredAt = Date.now();
    await msg({ type: 'setMode', group: 'crossid', mode: 'auto' }); await sleep(1800);
    const joined = TRACES2.filter((tr) => { const r = k.rows.find((x) => x.id === tr.id); return r && r.mark === 'tracked'; }).map((tr) => tr.id);
    ok(k.browser && /^ff2m-/.test(k.browser), 'the browser joined across sites on first contact (a value detector cannot prevent that)');
    const st = await msg({ type: 'state' });
    const xsid = await popup.ev(`chrome.storage.session.get('xsid').then((x) => Object.values(x.xsid || {}))`);
    ok(xsid.length >= 1, `the cross-site id was confirmed (xsid entries: ${xsid.length})`);
    ok((st.stopped || []).length === 0, `C33 does not use the learned-block list (stopped: ${JSON.stringify(st.stopped)})`);
    // forward-looking, objective: the page can no longer reach its own /f/ collector on any of the three sites, and the
    // ETag image /f/px.gif (which carries F10) sits under that same blocked /f/ path, so it cannot revalidate either.
    const reach = {}; for (const s of ['ledger', 'sundial', 'atlas']) { await t.go(at(s)); await sleep(300);
      reach[s] = await t.ev(`fetch('/f/hit?probe=1', { method: 'POST', body: 'm=probe' }).then(() => 'ok', () => 'blocked')`); }
    const collectorBlocked = ['ledger', 'sundial', 'atlas'].every((s) => reach[s] === 'blocked');
    ok(collectorBlocked, `the collector path is blocked on all three sites now (${JSON.stringify(reach)})`);
    await t.go(at('ledger')); await sleep(300);
    const etagBlocked = (await t.ev(`fetch('/f/px.gif', { cache: 'reload' }).then(() => 'ok', () => 'blocked')`)) === 'blocked';
    ok(etagBlocked, 'the ETag image /f/px.gif is blocked too (F10 cannot revalidate)');
    ok(questions.every((n) => n === 0), `C33 acts automatically; no question was raised (answered ${questions})`);
    const cookies = await b.cookies(); const ledgerCk = cookies.filter((c) => c.domain.replace(/^\./, '').endsWith('ledger.localhost'));
    // ---- F1 (N2), measured and not demanded: is the per-site cookie fp_id, which the confirmed collector path /f/ set,
    // still in the browser, and does the frozen ff2 server still receive it? Step 8 opened a sign-in-shaped page on
    // Ledger, and the cleaner holds deleting for that site for five minutes after it (the sign-in guard), so Ledger's
    // cookie can only go when that hold is over: the trip waits for it, as a user would have to (at most 6.5 minutes).
    f1.cookiesRightAfter = await fpIds();
    await until(async () => !(await fpIds()).length, 390000, 2000);
    f1.cookiesAfterWait = await fpIds(); f1.waitedSeconds = Math.round((Date.now() - restoredAt) / 1000);
    // every site again, as a visitor would: a page that set the cookie anew from somewhere else would show here
    f1.serverSees = {};
    for (const s of sites3) { await t.go(at(s)); await sleep(700); const x = await knows().catch(() => null);
      f1.serverSees[s] = x ? { browser: x.browser, kindsTied: x.tracked } : 'no answer'; }
    f1.cookiesAfterRevisit = await fpIds();
    f1.newRecordsAfterRestore = lab.store.records.slice(f1Mark).filter((r) => r.trace === 'F1').length;
    const log = (await msg({ type: 'state' })).log.filter((l) => l.cap === 'C33' && l.kind === 'cookie' && l.did === 'removed');
    f1.logged = log.map((l) => `${l.site} ${l.name}`).sort();
    // stopped going forward = no fp_id is left in the browser after the sites were opened again, the site's own server
    // (the frozen "What I know", which looks the browser up by the fp_id it receives) knows no browser on any of the
    // three sites, and the collector recorded no F1 since
    const f1Stopped = f1.cookiesAfterRevisit.length === 0 && sites3.every((s) => f1.serverSees[s] && f1.serverSees[s].browser === '' && f1.serverSees[s].kindsTied === 0) && f1.newRecordsAfterRestore === 0;
    console.log(`${f1Stopped ? 'ok  ' : 'NOTE'} F1 measured: ${JSON.stringify(f1)}`);
    const cookies2 = await b.cookies();
    ok(cookies2.some((c) => c.name === 'SID' && c.domain.replace(/^\./, '').endsWith('ledger.localhost')) && ledgerCk.some((c) => c.name === 'SID'), 'the sign-in-window SID cookie was left alone');

    // the collector receives F2/F6/F8/F9 over its /f/ path, and F10's ETag image /f/px.gif is under the same path, so
    // blocking the path stops all five going forward; the rest are the site's own first-party server (F4/F5), a
    // per-site cookie (F1), a sign-in cookie (F7) or a hand-off chain (F3), none stoppable here without breaking the site.
    const COLL = { F2: 'the master id reaches the collector', F6: 'the fingerprint code reaches the collector', F8: 'the address and referrer are posted to the collector', F9: 'the collector runs its loopback probe for the page' };
    const SURV = { F1: `the per-site first-party cookie (fp_id) is still in the browser or still reaches the site's server (${JSON.stringify(f1)})`,
      F3: 'M3 strips a CONFIRMED id from a scripted/meta/pushState hand-off, but ff2 gives each site its own master value at /f/ (ledger/sundial/atlas each send a different ff2m-...), so no single master value is seen on two sites and none is confirmed; the real cross-site link is the fingerprint, whose collector send is already blocked',
      F4: 'the from->to redirect log is the site\'s own server; cannot stop without breaking navigation',
      F5: 'a first-party click record on the site\'s own server; cannot stop without breaking the site',
      F7: 'a sign-in cookie (SID): kept on purpose, never touched', F10: 'a first-party ETag, per-site here; its image is under the blocked /f/ path so it cannot revalidate' };
    const rows = TRACES2.map((tr) => { const id = tr.id, r = k.rows.find((x) => x.id === id) || {};
      const stopped = (id in COLL && collectorBlocked) || (id === 'F10' && collectorBlocked && etagBlocked) || (id === 'F1' && f1Stopped);
      const why = id === 'F1' && stopped ? `stopped going forward: the cookie fp_id that the confirmed collector path /f/ set was deleted on all three sites (${f1.logged.join(', ')}; each can be put back for 10 minutes), the site's own server no longer receives it (its "What I know" finds no browser on any of the three sites), and /f/ is blocked so it is not set again. Ledger's went ${f1.waitedSeconds} s after the counter-repair was restored: deleting was held for that site for five minutes after its sign-in page (step 8)`
        : id === 'F10' ? (stopped ? 'stopped going forward: its ETag image /f/px.gif is under the blocked collector path, so the browser no longer revalidates it with If-None-Match (M5 also strips the conditional for a cross-site ETag on a resource that is not otherwise blocked)' : `survives: ${SURV.F10}`)
        : stopped ? `stopped going forward: ${COLL[id]} is blocked (collector-path block, host+/f/ prefix)` : `survives: ${SURV[id] || 'first-party, server-side'}`;
      return { id, type: tr.type, joinedOnFirstContact: r.mark === 'tracked', stoppedGoingForward: stopped, why }; });
    const stoppedN = rows.filter((r) => r.stoppedGoingForward).length, survN = rows.length - stoppedN;
    ok(stoppedN >= 5, `the four collector kinds and the ETag image are stopped going forward (stopped ${stoppedN})`);

    const survIds = rows.filter((r) => !r.stoppedGoingForward).map((r) => r.id).join(', ');
    const out = { what: 'Friendface 2 against Tracker Cleaner (the version is under "extension") with the cross-site-id counter-repair (C33) and the page shield (C32, on by default from 1.26) fully on. A value detector learns a value is cross-site only after two sites have sent it, so the collector receives the id on first contact and the initial cross-site JOIN happens once and cannot be undone; from then on the cleaner blocks the exact collector path (/f/, never the site root) and strips confirmed ids from URLs and links, so no further send gets through. Separately, M4 makes the shield blur the font-measure widths and screen size, so the F6 fingerprint join key no longer matches across sites or a cleaner-off baseline. The fingerprint is measured with the shield off (baseline) and on.',
      extension: JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version, browser: k.browser, sites: k.sites,
      joinedOnFirstContact: joined.length, stoppedGoingForward: stoppedN, survives: survN, of: TRACES2.length,
      headline: `${joined.length}/${TRACES2.length} kinds joined on first contact (a value detector cannot prevent that); going forward the cleaner stops ${stoppedN}/${TRACES2.length} (collector path blocked, incl. the ETag image under /f/${f1Stopped ? '; the per-site cookie F1 that the collector path set is deleted' : ''}) and ${survN}/${TRACES2.length} survive (${survIds}: first-party server-side F4/F5, sign-in F7, hand-off chain F3${f1Stopped ? '' : ', per-site cookie F1'}).`,
      collectorBlocked, crossIdConfirmed: xsid.length, nothingLearned: (st.stopped || []).length === 0, questionsRaised: questions.reduce((a, c) => a + c, 0),
      fingerprint, f1,
      caveats: ['Lab-only: loopback, made-up names, fake accounts; nothing leaves the machine.',
        'A value-based cross-site detector is reactive: the collector gets the id on first contact, before two sites reveal it is cross-site, so the initial join is not preventable; the cleaner stops every FURTHER send by blocking the exact collector path (never the site root) and stripping the id from request URLs and links.',
        'F4/F5 and F8-to-the-site\'s-own-server are first-party server-side; they cannot be stopped without breaking the site, so they are marked "cannot", not blocked.',
        (f1Stopped ? 'F1 (N2, 1.28): the per-site cookie fp_id is not a cross-site value itself, but it was SET by the path that is confirmed as a first-party collector of one, so it is deleted there (names noted in memory only; undoable for 10 minutes; never a sign-in cookie). Measured from the browser\'s cookies and from what the frozen ff2 server receives afterwards (see f1). F7 is a sign-in cookie: left alone on purpose.'
          : 'F1 is a per-site first-party cookie and F7 a sign-in cookie; F1 was NOT stopped in this run (see f1).') + ' F3 (the hand-off chain) is per-site here, not a confirmed cross-site value. F10 (ETag) is per-site here and its image /f/px.gif is under the blocked /f/ path, so it is stopped going forward; M5 additionally strips the If-None-Match conditional for a cross-site ETag id on a resource that is not otherwise blocked (not exercised by ff2, whose ETag is per-site).',
        'The shield (C32) is ON by default from 1.26 (M4). It now blurs the font-measure widths and screen size (not only canvas/WebGL/audio), so the F6 join key -- built from fonts and matchMedia/screen -- no longer matches across the three sites or the cleaner-off baseline when the shield is on. matchMedia and the pixel ratio are left alone (a page needs them), so it is best effort, detectable, not perfect. The collector-path block (C33) already stops the code reaching the collector as well.'],
      rows };
    fs.writeFileSync(path.join(__dirname, '..', '..', 'lab', 'ff2-misses.json'), JSON.stringify(out, null, 1) + '\n');
    console.log(`PASS: ${passed} checks; ${out.headline}; written lab/ff2-misses.json`);
  } finally { await b.close(); if (base) await base.close(); await lab.close(); }
})().catch((e) => { console.log('FAIL: ' + (e.stack || e)); process.exit(1); });
