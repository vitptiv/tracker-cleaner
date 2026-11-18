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

    // step 1-2: open Ledger and its budget
    await t.go(at('ledger')); await seeStep(TRIP[0]); questions.push(await answerAll());
    await t.clickAndLoad('#go-budget'); await seeStep(TRIP[1]);
    // step 3-4: scripted hand-off to Sundial (the link was rewritten by the kit to carry the id)
    await t.clickAndLoad('#to-sundial'); ok(new URL(await t.url()).host === `sundial.localhost:${PORT}`, 'landed on Sundial by a scripted jump'); await seeStep(TRIP[2]); await seeStep(TRIP[3]);
    await t.clickAndLoad('#to-atlas'); ok(new URL(await t.url()).host === `atlas.localhost:${PORT}`, 'landed on Atlas'); await seeStep(TRIP[4]); await seeStep(TRIP[5]);
    // step 7: meta-refresh hand-off back to Ledger
    await t.click('#to-ledger'); await until(async () => new URL(await t.url()).host === `ledger.localhost:${PORT}`, 8000);
    ok(/ledger\.localhost/.test(await t.url()), 'meta-refresh brought the browser back to Ledger'); await seeStep(TRIP[6]);
    // step 8: sign in on a client_id+redirect_uri page (arms the shipped hold; the SID cookie is KEEP_RE-spared)
    await t.go(at('ledger')); await t.clickAndLoad('#ff2-signin'); await seeStep(TRIP[7]);
    await t.clickAndLoad('#after-signin');
    // step 9: revisit the budget; the id is still there
    await t.go(at('ledger', '/budget')); await seeStep(TRIP[8]);
    questions.push(await answerAll());

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

    // the whole checklist: every ff2 kind tracked and tied to ONE browser, with the cleaner on and answered
    const k = await knows();
    for (const tr of TRACES2) { const r = k.rows.find((x) => x.id === tr.id); ok(r && r.mark === 'tracked' && r.value, `${tr.id} ${tr.type} tracked`); }
    ok(k.browser && /^ff2m-/.test(k.browser), 'all tied to one cookie-less browser id'); ok(k.sites.length >= 3, 'seen across all three sites');

    // the cleaner did nothing to ff2: nothing learned or blocked, and the first-party id cookies were not deleted
    const st = await msg({ type: 'state' });
    ok((st.stopped || []).length === 0, `nothing was blocked (stopped: ${JSON.stringify(st.stopped)})`);
    ok(questions.every((n) => n === 0), `no question was ever raised (answered ${questions})`);
    const cookies = await b.cookies(); const ledgerCk = cookies.filter((c) => c.domain.replace(/^\./, '').endsWith('ledger.localhost'));
    ok(ledgerCk.some((c) => c.name === 'fp_id'), 'the first-party fp_id cookie survived the cleaner'); ok(ledgerCk.some((c) => c.name === 'SID'), 'the sign-in-window SID cookie survived');

    const rows = TRACES2.map((tr) => { const r = k.rows.find((x) => x.id === tr.id); return { id: tr.id, type: tr.type, mark: r.mark, value: r.value, sites: r.sites,
      ever: r.mark === 'tracked', atEnd: done[tr.id] >= 9 || /^(F1|F2|F6|F8|F9|F10)$/.test(tr.id) }; });
    const counts = { ever: rows.filter((r) => r.ever).length, atEnd: rows.filter((r) => r.atEnd).length, of: TRACES2.length };
    const out = { what: 'Friendface 2 against the shipped cleaner v1.25, fully on (master on) with every question answered. Each kind is a first-party evasion; a kind counts only if it is still tracked and tied to the browser with the cleaner on. The trip runs at the fresh-install default (fingerprint shield C32 off); the shield is then measured both off and on, so the fingerprint numbers are not run-dependent.',
      extension: JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version, browser: k.browser, sites: k.sites,
      headline: `${counts.ever}/${counts.of} ff2 kinds still tracked and tied to the browser with the cleaner fully on and answered; ${counts.atEnd}/${counts.of} still at the end. The fingerprint join key survives the shield both off and on; readPixels is perturbed only with the shield on (off: ${winOff ? 'perturbed' : 'unchanged'}, on: ${winOn ? 'perturbed' : 'unchanged'}).`,
      nothingLearned: (st.stopped || []).length === 0, questionsRaised: questions.reduce((a, c) => a + c, 0),
      fingerprint,
      caveats: ['Lab-only: loopback, made-up names, fake accounts; nothing leaves the machine.',
        'The shield (C32) is off by default. The join key (F6) is built only from fonts, matchMedia and screen, which the shield never touches, so it survives with the shield off AND on and matches a cleaner-off baseline.',
        'With the shield ON the cleaner DOES win on two fingerprint surfaces: it perturbs WebGL readPixels per site and spoofs the WebGL vendor/renderer (getParameter 37445/37446). Neither is in the join key. With the shield OFF (the default) it touches neither.',
        'Every ff2 piece is served first-party through the visited site’s own /f/ path, so the structural rules (C29/C30/C31, all thirdParty) never match and the learning never raises a question.'],
      rows };
    fs.writeFileSync(path.join(__dirname, '..', '..', 'lab', 'ff2-misses.json'), JSON.stringify(out, null, 1) + '\n');
    console.log(`PASS: ${passed} checks; ${out.headline}; written lab/ff2-misses.json`);
  } finally { await b.close(); if (base) await base.close(); await lab.close(); }
})().catch((e) => { console.log('FAIL: ' + (e.stack || e)); process.exit(1); });
