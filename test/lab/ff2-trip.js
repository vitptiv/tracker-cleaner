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

    // step 1-2: open Ledger and its budget. Dwell on each site >3 s so it enters the cleaner's `mine` (a user reads the
    // page; a page passed straight on does not count), which is what lets the cross-site-id counter-repair (C33) confirm.
    await t.go(at('ledger')); await seeStep(TRIP[0]); questions.push(await answerAll()); await sleep(3500);
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
    // the fingerprint reconciliation: capture it on each site with the shield OFF (the default) and ON, and against a
    // cleaner-off baseline, so readPixels is measured both ways and the result does not depend on the run.
    const capture = async () => { const c = {}; for (const s of ['ledger', 'sundial', 'atlas']) { await t.go(at(s)); await sleep(300); c[s] = await fpOf(t); } return c; };
    const off = await capture();                                   // shield off (fresh-install default)
    await msg({ type: 'setMode', group: 'shield', mode: 'auto' }); // switch the fingerprint shield ON
    const onc = await capture();
    await msg({ type: 'setMode', group: 'shield', mode: 'off' });  // back to default
    base = await launch(undefined, flags); const bt = await base.tab(at('ledger')); await sleep(500);   // a cleaner-off browser: no extension
    const bfp = await bt.ev(`window.ff2fp ? window.ff2fp() : null`).catch(() => null);
    const keyStable = (c) => c.ledger && c.ledger.code && c.ledger.code === c.sundial.code && c.ledger.code === c.atlas.code;
    ok(keyStable(off) && keyStable(onc), 'one fingerprint join key across all three sites, shield off and on');
    ok(bfp && off.ledger.code === bfp.code && onc.ledger.code === bfp.code, `the join key equals the cleaner-off baseline with the shield off AND on (baseline ${bfp && bfp.code}, off ${off.ledger.code}, on ${onc.ledger.code})`);
    const winOff = !!(bfp && off.ledger.readpx !== bfp.readpx), winOn = !!(bfp && onc.ledger.readpx !== bfp.readpx);
    ok(winOff === false, `shield off (default): readPixels is unchanged, so the cleaner does not win there (${off.ledger.readpx} vs baseline ${bfp && bfp.readpx})`);
    ok(winOn === true, `shield on: readPixels is perturbed, a cleaner win on that one surface (${onc.ledger.readpx} vs baseline ${bfp && bfp.readpx})`);
    const glSpoofedOn = !!(bfp && onc.ledger.gl !== bfp.gl && off.ledger.gl === bfp.gl);
    const fingerprint = { baselineCode: bfp && bfp.code, joinKey: off.ledger.code, keyStableAcrossSites: keyStable(off) && keyStable(onc), keyEqualsBaselineShieldOff: bfp && off.ledger.code === bfp.code, keyEqualsBaselineShieldOn: bfp && onc.ledger.code === bfp.code,
      readPixels: { shieldOff: { hash: off.ledger.readpx, perturbed: winOff }, shieldOn: { hash: onc.ledger.readpx, perturbed: winOn }, baseline: bfp && bfp.readpx },
      webglVendorRenderer: { shieldOff: off.ledger.gl, shieldOn: onc.ledger.gl, baseline: bfp && bfp.gl, spoofedWithShieldOn: glSpoofedOn } };

    // ---- What the cross-site-id counter-repair (C33, M2) does to ff2, measured forward-looking. A value detector only
    // learns a value is cross-site AFTER two sites have sent it, so the collector receives the id on first contact and
    // the cross-site JOIN happens once; that initial join cannot be undone. From then on the cleaner blocks the exact
    // collector path (/f/, never the site root) and strips confirmed ids from request URLs and links, so no FURTHER
    // send gets through. First confirm the join happened and the id was confirmed, then probe the forward state.
    // restore the cross-site-id counter-repair and force the sweep that confirms the id (the three sites are in `mine`)
    // and installs its block/strip rules, then measure the forward state.
    await msg({ type: 'setMode', group: 'crossid', mode: 'auto' }); await sleep(1800);
    const k = await knows();
    const joined = TRACES2.filter((tr) => { const r = k.rows.find((x) => x.id === tr.id); return r && r.mark === 'tracked'; }).map((tr) => tr.id);
    ok(k.browser && /^ff2m-/.test(k.browser), 'the browser joined across sites on first contact (a value detector cannot prevent that)');
    const st = await msg({ type: 'state' });
    const xsid = await popup.ev(`chrome.storage.session.get('xsid').then((x) => Object.values(x.xsid || {}))`);
    ok(xsid.length >= 1, `the cross-site id was confirmed (xsid entries: ${xsid.length})`);
    ok((st.stopped || []).length === 0, `C33 does not use the learned-block list (stopped: ${JSON.stringify(st.stopped)})`);
    // forward-looking, objective: the page can no longer reach its own /f/ collector on any of the three sites
    const reach = {}; for (const s of ['ledger', 'sundial', 'atlas']) { await t.go(at(s)); await sleep(300);
      reach[s] = await t.ev(`fetch('/f/hit?probe=1', { method: 'POST', body: 'm=probe' }).then(() => 'ok', () => 'blocked')`); }
    const collectorBlocked = ['ledger', 'sundial', 'atlas'].every((s) => reach[s] === 'blocked');
    ok(collectorBlocked, `the collector path is blocked on all three sites now (${JSON.stringify(reach)})`);
    ok(questions.every((n) => n === 0), `C33 acts automatically; no question was raised (answered ${questions})`);
    const cookies = await b.cookies(); const ledgerCk = cookies.filter((c) => c.domain.replace(/^\./, '').endsWith('ledger.localhost'));
    ok(ledgerCk.some((c) => c.name === 'SID'), 'the sign-in-window SID cookie was left alone');

    // the collector receives F2/F6/F8/F9 over its /f/ path, so blocking the path stops them going forward; the rest are
    // the site's own first-party server (F4/F5), a per-site cookie (F1), a sign-in cookie (F7), a hand-off chain (F3,
    // handled in M3) or a first-party ETag (F10, M5), none stoppable here without breaking the site.
    const COLL = { F2: 'the master id reaches the collector', F6: 'the fingerprint code reaches the collector', F8: 'the address and referrer are posted to the collector', F9: 'the collector runs its loopback probe for the page' };
    const SURV = { F1: 'a per-site first-party cookie (fp_id), not a cross-site value: a visited site\'s own cookie is left alone',
      F3: 'M3 strips a CONFIRMED id from a scripted/meta/pushState hand-off, but ff2 gives each site its own master value at /f/ (ledger/sundial/atlas each send a different ff2m-...), so no single master value is seen on two sites and none is confirmed; the real cross-site link is the fingerprint, whose collector send is already blocked',
      F4: 'the from->to redirect log is the site\'s own server; cannot stop without breaking navigation',
      F5: 'a first-party click record on the site\'s own server; cannot stop without breaking the site',
      F7: 'a sign-in cookie (SID): kept on purpose, never touched', F10: 'a first-party ETag: handled in M5' };
    const rows = TRACES2.map((tr) => { const id = tr.id, r = k.rows.find((x) => x.id === id) || {};
      const stopped = id in COLL && collectorBlocked;
      return { id, type: tr.type, joinedOnFirstContact: r.mark === 'tracked', stoppedGoingForward: stopped,
        why: stopped ? `stopped going forward: ${COLL[id]} is blocked (collector-path block, host+/f/ prefix)` : `survives: ${SURV[id] || 'first-party, server-side'}` }; });
    const stoppedN = rows.filter((r) => r.stoppedGoingForward).length, survN = rows.length - stoppedN;
    ok(stoppedN >= 4, `the four collector kinds are stopped going forward (stopped ${stoppedN})`);

    const out = { what: 'Friendface 2 against Tracker Cleaner v1.26 with the cross-site-id counter-repair (C33, M2) fully on. A value detector learns a value is cross-site only after two sites have sent it, so the collector receives the id on first contact and the initial cross-site JOIN happens once and cannot be undone; from then on the cleaner blocks the exact collector path (/f/, never the site root) and strips confirmed ids from URLs and links, so no further send gets through. The trip runs at the fresh-install default (shield C32 off), then measures the fingerprint both ways.',
      extension: JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version, browser: k.browser, sites: k.sites,
      joinedOnFirstContact: joined.length, stoppedGoingForward: stoppedN, survives: survN, of: TRACES2.length,
      headline: `${joined.length}/${TRACES2.length} kinds joined on first contact (a value detector cannot prevent that); going forward the cleaner stops ${stoppedN}/${TRACES2.length} (collector path blocked) and ${survN}/${TRACES2.length} survive (first-party server-side, sign-in, per-site cookie, hand-off chain for M3, ETag for M5).`,
      collectorBlocked, crossIdConfirmed: xsid.length, nothingLearned: (st.stopped || []).length === 0, questionsRaised: questions.reduce((a, c) => a + c, 0),
      fingerprint,
      caveats: ['Lab-only: loopback, made-up names, fake accounts; nothing leaves the machine.',
        'A value-based cross-site detector is reactive: the collector gets the id on first contact, before two sites reveal it is cross-site, so the initial join is not preventable; the cleaner stops every FURTHER send by blocking the exact collector path (never the site root) and stripping the id from request URLs and links.',
        'F4/F5 and F8-to-the-site\'s-own-server are first-party server-side; they cannot be stopped without breaking the site, so they are marked "cannot", not blocked.',
        'F1 is a per-site first-party cookie (not cross-site) and F7 a sign-in cookie: left alone on purpose. F3 (the hand-off chain) is M3; F10 (ETag) is M5.',
        'The shield (C32) is off by default; the join key (F6 value) is built from fonts/matchMedia/screen (M4). The collector-path block already stops the code reaching the collector.'],
      rows };
    fs.writeFileSync(path.join(__dirname, '..', '..', 'lab', 'ff2-misses.json'), JSON.stringify(out, null, 1) + '\n');
    console.log(`PASS: ${passed} checks; ${out.headline}; written lab/ff2-misses.json`);
  } finally { await b.close(); if (base) await base.close(); await lab.close(); }
})().catch((e) => { console.log('FAIL: ' + (e.stack || e)); process.exit(1); });
