'use strict';
// Phase B, part 1: what does Tracker Cleaner miss? The same trip as trip.js, in a throwaway headless Chrome with
// extension/ loaded, in several settings. It measures only: nothing here demands "cleaned". The table goes to
// lab/misses.json and to the screen.  node test/lab/trip-cleaner.js [A B0 B C]
const fs = require('node:fs'), path = require('node:path');
const { start } = require('../../lab/server'), { outside } = require('../../lab/outside'), { launch, sleep, until, newProfile, labCert } = require('./chrome'), { makeWalk, MARA } = require('./walk'), { RESTART, stepOf, atEnd } = require('./count');
const TRACES = require('../../lab/traces.json'), TRIP = require('../../lab/trip.json');
const PORT = Number(process.env.LAB_PORT) || 8200, EXT = path.join(__dirname, '..', '..', 'extension');
const within = (p, ms, what) => Promise.race([p, sleep(ms).then(() => { throw new Error(`timeout: ${what}`); })]);
const HOSTS = ['friendface', 'hop', 'pennant', 'gazette', 'parcelpine', 'metrics.parcelpine', 'tidewater', 'loopreel'].map((h) => h + '.localhost');
const AUTO = ['signin', 'blocking', 'cookies', 'google', 'params', 'unknown', 'bounce', 'own', 'storage', 'permissions', 'cache'];

// ---- the lab's test-only entries. None of them is in a shipped list; they exist only while this script runs.
// 1. Two session rules, added through the extension's own popup page, shaped like the shipped ones (rules.json rule 1, rules-params.json).
const TRACKER_NAMES = ['friendface.localhost', 'hop.localhost', 'pennant.localhost', 'metrics.parcelpine.localhost', 'friendface.test'];
const RULES = [
  { id: 9001, priority: 1, action: { type: 'block' }, condition: { requestDomains: TRACKER_NAMES, domainType: 'thirdParty',
    resourceTypes: ['script', 'xmlhttprequest', 'image', 'ping', 'sub_frame', 'media', 'other', 'websocket', 'font', 'stylesheet'] } },
  { id: 9002, priority: 1, action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: ['ffclid'] } } } }, condition: { resourceTypes: ['main_frame'] } }];
// 2. The lab's ID cookies on the user's own always-delete list, entered the way the popup does it (message "always", one per site and name).
//    The sign-in cookie ff_session is left out on purpose: the cleaner keeps sign-ins.
const ALWAYS = [['friendface', 'ff_uid'], ['friendface', 'ff_frame'], ['hop', 'hop_id'], ['pennant', 'pn_uid'], ['metrics.parcelpine', 'pp_sid'],
  ...['gazette', 'tidewater', 'parcelpine'].flatMap((s) => [[s, '_ffp'], [s, '_ffc']])].map(([s, name]) => ({ site: s + '.localhost', name }));
const SETTINGS = {
  A: { says: 'fresh install defaults, nothing approved, no lab entries', entries: false, auto: false, manual: false },
  B0: { says: 'main switch on, every group that can run here on Automatic, no lab entries (the lab is on no list)', entries: false, auto: true, manual: false },
  B: { says: 'as B0, with the lab\'s test-only entries', entries: true, auto: true, manual: false },
  C: { says: 'as B, then every manual action at the end (approve all, drop each lab site\'s cookies and storage, block the permission, clear the cache), then the sites again', entries: true, auto: true, manual: true } };
// not a setting: the same trip with the main switch off, to learn in which step the trip makes each kind for the last time
const OFF = { says: 'the main switch off (reference)', off: true, entries: false, auto: false, manual: false };
const NOT_SET = { tor: 'would send requests off this computer', tabs: 'would close the trip\'s own tabs', allowlist: 'needs a list from the settings program; would delete every cookie',
  server: 'only reports and self-update', wifi: 'never automatic; touches this computer\'s saved networks, so it is not approved either' };

// ---- which capability is aimed at each kind (journal page, chapter 4), and the thing it would have to remove
const COVER = { T1: ['C01', 'C07'], T2: [], T3: ['C07'], T4: ['C23', 'C07', 'C27'], T5: ['C07', 'C27'], T6: ['C01', 'C07'], T7: ['C07'], T8: ['C01', 'C07'], T9: ['C06'], T10: [], T11: ['C06'], T12: ['C06'], T13: ['C06', 'C28'],
  T14: [], T15: ['C11'], T16: ['C11'], T17: ['C11'], T18: [], T19: [], T20: ['C11'], T21: ['C11'], T22: ['C09', 'C28'], T23: ['C01'], T24: ['C01'], T25: ['C01'], T26: ['C01'], T27: ['C01'], T28: ['C01', 'C26'],
  T29: ['C26'], T30: [], T31: ['C01'], T32: [], T33: [], T35: ['C01'], T36: ['C01'] };
const WHY_NONE = { T2: 'kept on purpose: a sign-in cookie', T32: 'kept on purpose: a sign-in', T33: 'the browser is not involved', T10: 'storage under the visited site\'s own name', T14: 'an answer the browser gives',
  T18: 'icons go only with the history', T19: 'history is left alone by decision', T29: 'first-party ping on the network\'s own page', T30: 'the redirector is the page in front' };
const LIST_BASED = ['C01', 'C03', 'C06', 'C07', 'C09', 'C23'];
const COOKIE = { T1: 'ff_uid', T2: 'ff_session', T3: '_ffp', T4: '_ffc', T5: 'hop_id', T6: 'pn_uid', T7: 'pp_sid', T8: 'ff_frame' };
const KIND = { T9: 'storage', T11: 'storage', T12: 'storage', T13: 'storage', T15: 'cache', T16: 'cache', T17: 'cache', T20: 'cache', T21: 'cache', T22: 'permission' };
const OUTSIDE = ['T17', 'T18', 'T19', 'T20'];
// rows the second look after cleaning can create again by just opening pages
const REVISITED = ['T1', 'T2', 'T3', 'T4', 'T6', 'T7', 'T8', 'T9', 'T10', 'T11', 'T12', 'T13', 'T14', 'T15', 'T16', 'T21', 'T22', 'T23', 'T24', 'T25', 'T26', 'T28', 'T36'];
// what the report names as out of reach (report-view.js CANNOT), per row
const SAID = { T18: 'cannot clean', T19: 'cannot clean', T27: 'cannot stop', T31: 'cannot stop', T32: 'cannot stop', T33: 'cannot stop' };
const SIMULATED = { guard: 'the five minutes the sign-in guard holds after step 4 are cut to two seconds', T22: 'the press on Allow is a grant over the control channel', T24: 'the second address is a forwarded-for header', T20: 'needs the lab certificate', T21: 'needs the lab certificate' };

async function run(name, set, cert, flags, chance = {}) {
  const lab = await start({ port: PORT, tls: cert });
  let first = true;
  const launchExt = async (dir) => { const b = await launch(dir, [...flags, '--enable-unsafe-extension-debugging']);
    const { id } = await b.send('Extensions.loadUnpacked', { path: EXT });
    b.popup = await b.tab(`chrome-extension://${id}/popup.html`);
    b.msg = (m) => within(b.popup.ev(`chrome.runtime.sendMessage(${JSON.stringify(m)})`), 20000, m.type);
    await until(async () => (await b.msg({ type: 'state' })).groups, 10000);
    if (set.entries) await b.popup.ev(`chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: [9001, 9002], addRules: ${JSON.stringify(RULES)} })`);
    if (first && set.off) await b.msg({ type: 'setMaster', on: false });
    if (first && set.auto) { await b.msg({ type: 'setMaster', on: true }); for (const g of AUTO) await b.msg({ type: 'setMode', group: g, mode: 'auto' }); }
    if (first && set.entries) for (const a of ALWAYS) await b.msg({ type: 'always', ...a, on: true });
    first = false; return b; };
  const W = makeWalk({ lab, port: PORT, launch: launchExt, soft: true }), E = W.E, out = { says: set.says, broken: [], steps: {} }, ends = [];   // ends: how many records there were after each step
  try {
    await E.open();
    out.canary = await E.kt.ev(`document.getElementById('canary').textContent`).catch(() => 'no answer');
    const personNow = () => { const a = lab.store.accounts.find((x) => x.email === MARA.email); return a ? lab.store.lookup(['acct:' + a.id]) : null; };
    for (const s of TRIP) { try { await within(W.steps[s.n](), 90000, `step ${s.n}`); } catch (e) { out.broken.push(`step ${s.n}: ${String(e.message || e).split('\n')[0]}`); }
      // the trip takes a minute and the guard holds five after the sign-in of step 4: here they are cut to two seconds, and the extension's own wake-up does the rest
      if (s.n === 4) { await E.b.popup.ev('chrome.storage.local.set({ guardUntil: Date.now() + 1000 })'); await sleep(4000); }
      await sleep(400); ends.push(lab.store.records.length); process.stdout.write(`${name}${s.n} `); }
    await sleep(1500);
    const k12 = await E.know().catch(() => null);
    out.reidentifiedAfterStep12 = !!(k12 && k12.who && k12.who.name === MARA.name);
    out.history = { opened: E.visited.length, rebuilt: k12 ? k12.history.length : 0, complete: !!k12 && JSON.stringify(k12.history.map((h) => h.url)) === JSON.stringify(E.visited) };
    const mark = lab.store.records.length, tMark = Date.now(), before = lab.store.records.slice();
    if (set.manual) { const st = await E.b.msg({ type: 'state' }), did = out.manual = {};
      for (const g of st.groups.filter((x) => x.id !== 'wifi' && x.pending)) did[`approve ${g.id}`] = await E.b.msg({ type: 'approve', group: g.id }).catch((e) => String(e.message));
      for (const h of [...HOSTS, 'friendface.test']) { did[`cookies of ${h}`] = await E.b.msg({ type: 'dropSite', host: h, kept: true }).catch((e) => String(e.message));
        did[`storage of ${h}`] = await E.b.msg({ type: 'drop', kind: 'storage', site: h.endsWith('.test') ? `${h}:${lab.tlsPort}` : `${h}:${PORT}` }).catch((e) => String(e.message)); }
      did['block notifications'] = await E.b.msg({ type: 'drop', kind: 'permission', site: `http://friendface.localhost:${PORT}`, perm: 'notifications' }).catch((e) => String(e.message));
      did['clear cache and remembered servers'] = await E.b.msg({ type: 'drop', kind: 'servers' }).catch((e) => String(e.message));
      await sleep(500);
      // the second look: the sites again, then Friendface
      for (const [site, p] of [['gazette', '/article/harbour-bridge'], ['gazette', '/'], ['tidewater', '/post/mending-a-kite'], ['parcelpine', '/product/kite-line'], ['parcelpine', '/'], ['friendface', '/'], ['friendface', '/what-i-know']])
        try { await E.t.go(E.at(site, p)); await sleep(1200); } catch (e) { out.broken.push(`second look ${site}${p}: ${e.message}`); }
      const kc = await E.t.ev(`fetch('/what-i-know.json').then((r) => r.json())`).catch(() => null);
      out.afterManual = { reidentified: !!(kc && kc.who && kc.who.name === MARA.name), historyStillShown: kc ? kc.history.length : 0 }; }
    const ext = await E.b.msg({ type: 'state' }).catch(() => ({ log: [], groups: [], hold: {} }));
    const matched = await E.b.popup.ev(`chrome.declarativeNetRequest.getMatchedRules({}).then((r) => r.rulesMatchedInfo.map((x) => x.rule.rulesetId + ':' + x.rule.ruleId))`).catch(() => []);
    out.extension = { master: ext.master, guardHeldAtEnd: !!(ext.hold && ext.hold.guard), stopped: ext.stopped || [], cutOff: ext.params || [], removed: ext.log.filter((l) => l.did === 'removed').length,
      waiting: Object.fromEntries(ext.groups.filter((g) => g.pending).map((g) => [g.id, g.pending])), blockRuleMatches: matched.filter((m) => m.endsWith(':9001')).length, tagRuleMatches: matched.filter((m) => m.endsWith(':9002') || m.startsWith('url-params')).length };
    const dir = E.b.dir; await E.b.close(true); E.b = null; const files = outside(dir, PORT); fs.rmSync(dir, { recursive: true, force: true });

    // ---- one verdict per row
    const person = personNow();
    const linked = new Set(person === null ? [] : lab.store.of(person)), removals = ext.log.filter((l) => l.did === 'removed');
    const firedAt = (id) => removals.filter((l) => COOKIE[id] ? l.kind === 'cookie' && l.name === COOKIE[id] : KIND[id] ? l.kind === KIND[id] : false).map((l) => l.t);
    const idRows = ['T3', 'T5', 'T7', 'T8', 'T9', 'T11', 'T12', 'T15', 'T16'];
    const survivors = (t) => idRows.filter((id) => { const old = new Set(lab.store.records.filter((r) => r.trace === id && r.t <= t).map((r) => r.value));
      return lab.store.records.some((r) => r.trace === id && r.t > t && old.has(r.value) && linked.has(r)); });
    out.rows = {};
    for (const tr of TRACES) { const id = tr.id;
      if (tr.status !== 'built') { out.rows[id] = { status: 'not built', cause: tr.status }; continue; }
      const all = lab.store.records.filter((r) => r.trace === id), trip = all.filter((r) => r.n < mark), after = all.filter((r) => r.n >= mark);
      const use = set.manual && REVISITED.includes(id) ? after : set.manual && OUTSIDE.includes(id) ? [] : trip;
      let status = use.some((r) => linked.has(r)) ? 'tracked' : use.length ? 'unlinked' : 'stopped';
      if (set.manual && OUTSIDE.includes(id)) status = files[id] ? 'tracked' : 'stopped';
      const row = out.rows[id] = { status, records: all.length, linked: all.filter((r) => linked.has(r)).length };
      const lastN = Math.max(-1, ...trip.filter((r) => linked.has(r)).map((r) => r.n)); if (lastN >= 0) row.lastStep = stepOf(ends, TRIP.map((s) => s.n), lastN);
      row.atEnd = atEnd({ outside: OUTSIDE.includes(id), onDisk: !!files[id], second: set.manual && REVISITED.includes(id), after: after.some((r) => linked.has(r)), lastStep: row.lastStep, lastChance: chance[id] });
      if (set.manual) { row.duringTrip = trip.some((r) => linked.has(r)) ? 'tracked' : trip.length ? 'unlinked' : 'stopped'; row.sameIdAfterCleaning = after.some((r) => trip.some((x) => x.value === r.value));
        if (!REVISITED.includes(id) && !OUTSIDE.includes(id)) row.note = 'not repeated after cleaning: what was sent during the trip stays sent'; }
      if (status === 'stopped' && !row.atEnd) continue;
      const caps = COVER[id], fired = firedAt(id), last = Math.max(0, ...fired);
      const blockSeen = caps.includes('C01') && out.extension.blockRuleMatches > 0;
      const vias = all.filter((r) => linked.has(r)).map((r) => r.via);
      if (vias.length && vias.every((v) => /shop's server/.test(v))) row.cause = 'no capability covers it (sent by the shop\'s server, not by the browser)';
      else if (set.entries && caps.length && caps.every((c) => c === 'C06' || c === 'C09') && !fired.length) row.cause = 'capability exists but did not fire (first-party on Friendface itself; permanent storage and permission drops need an entry from the settings program, which is not running)';
      else if (!caps.length) row.cause = `no capability covers it${WHY_NONE[id] ? ` (${WHY_NONE[id]})` : ''}`;
      else if (!set.entries && caps.every((c) => LIST_BASED.includes(c))) row.cause = 'not recognised: the lab\'s names are on no list' + (out.extension.stopped.length ? `; learned and stopped later (${out.extension.stopped.join(', ')}), last arrived in step ${row.lastStep}` : '');
      else if (!fired.length && !blockSeen) { const g = ext.groups.find((x) => x.pending && x.items && x.items.some((it) => it.name === COOKIE[id]));
        row.cause = `capability exists but did not fire${caps.includes('C11') ? ' (cache: cleared when it is switched on or "Clean now" is pressed, then once a day; this copy was saved after that)' : out.extension.guardHeldAtEnd && (COOKIE[id] || KIND[id]) ? ' (held: sign-in guard, 5 minutes after any /login or /oauth address)' : g ? ' (waits for approval)' : ''}`; }
      else if (!fired.length && blockSeen) row.cause = 'capability exists but did not fire for this request (the block rule matched others: this one is first-party or a page of its own)';
      else { const back = all.filter((r) => r.t > last && linked.has(r)), sameId = back.some((r) => all.some((x) => x.t <= last && x.value === r.value)), via = (back.find((r) => /put back from/.test(r.via)) || {}).via;
        row.cause = !back.length ? 'fired too late (ID already sent)'
          : `re-created after cleaning (${via ? via.replace('the cookie was gone; ', '') : sameId ? 'same ID again' : 'new ID'}${survivors(last).filter((x) => x !== id).length ? `; re-linked by ${survivors(last).filter((x) => x !== id).join(' ')}` : ''})`; }
      if (caps.includes('C27') && out.extension.cutOff.length && !set.entries) row.cause = `learned at the first pass and handled from then on (cut off: ${out.extension.cutOff.join(', ')}); last arrived in step ${row.lastStep}`;
      if (SAID[id]) row.cause += `; the report says "Tracker Cleaner ${SAID[id]} this"`;
      if (SIMULATED[id]) row.simulated = SIMULATED[id]; }
    out.counts = { tracked: 0, unlinked: 0, stopped: 0 }; for (const r of Object.values(out.rows)) if (r.status in out.counts) out.counts[r.status]++;
    out.counts.ever = out.counts.tracked; out.counts.atEnd = Object.values(out.rows).filter((r) => r.atEnd).length;
    out.counts.stillArrivingAfterRestart = Object.values(out.rows).filter((r) => r.lastStep > RESTART).length;   // the steps after the restart open the same sites again
    return out;
  } finally { if (E.b) await E.b.close(); await lab.close(); }
}

(async () => {
  const want = process.argv.slice(2).filter((a) => SETTINGS[a]), names = want.length ? want : Object.keys(SETTINGS);
  const certDir = newProfile(), cert = labCert(certDir); fs.rmSync(certDir, { recursive: true, force: true });
  const flags = [cert.flag, '--host-resolver-rules=MAP *.test 127.0.0.1, MAP * ~NOTFOUND, EXCLUDE localhost, EXCLUDE *.localhost, EXCLUDE 127.0.0.1'];
  const ref = await run('off', OFF, cert, flags); console.log('');
  const chance = Object.fromEntries(Object.entries(ref.rows).filter(([, r]) => r.lastStep).map(([id, r]) => [id, r.lastStep]));
  const result = { what: 'Tracker Cleaner against the tracking lab: measured, nothing demanded. status: tracked = arrived and tied to the person; unlinked = arrived, not tied to her; stopped = nothing arrived (C: after the manual cleaning). '
    + 'Two counts, of 36 kinds: ever = it arrived once, tied to her (status tracked). atEnd = it still arrived, tied to her, after Chrome was started again; or, for a kind the trip only makes before that, the last time the trip made it (reference.lastChance); or, for a kind kept in Chrome\'s own files, it is still in the files when the trip is over; in C, a kind the second look makes again counts when it arrived then. The headline is B0 atEnd.',
    headline: null, reference: { says: OFF.says, counts: ref.counts, lastChance: chance, broken: ref.broken },
    extension: JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8')).version, settings: Object.fromEntries(names.map((n) => [n, SETTINGS[n].says])),
    recognised: 'Not recognised as shipped: none of the lab\'s site names is in DOMAINS or rules.json, none of its cookie names matches COOKIE_RE, and ffclid is not in URL_PARAMS (only the canary\'s utm_source is).',
    testOnlyEntries: { how: 'B and C only, alive only while the script runs; no shipped file is edited', sessionRules: RULES, alwaysDeleteList: ALWAYS,
      notAdded: 'DOMAINS (cookies judged by tracker host) is a constant inside lists.js, so the always-delete list by cookie name stands in for it. Permanent storage and permission drops come only from the settings program on port 8088, which is not running and is not imitated: in C they are done by hand instead.' },
    simulated: SIMULATED.guard, automaticGroups: AUTO, groupsLeftAlone: NOT_SET, runs: {} };
  for (const n of names) { result.runs[n] = await run(n, SETTINGS[n], cert, flags, chance); console.log(''); }
  const cell = (r) => r.status === 'not built' ? '-' : (r.atEnd ? 'AT END ' : '') + r.status + (r.cause ? `: ${r.cause}` : '');
  for (const tr of TRACES) console.log(`${tr.id.padEnd(4)}${tr.type.slice(0, 34).padEnd(35)}${names.map((n) => `${n}=${cell(result.runs[n].rows[tr.id])}`).join(' | ')}`);
  for (const n of names) { const r = result.runs[n]; console.log(`${n}: ${JSON.stringify(r.counts)} canary "${r.canary}" history ${r.history.rebuilt}/${r.history.opened}${r.history.complete ? ' complete' : ''} re-identified after step 12: ${r.reidentifiedAfterStep12}${r.afterManual ? `, after manual cleaning: ${r.afterManual.reidentified}` : ''} ext ${JSON.stringify(r.extension)}${r.broken.length ? ' broken: ' + r.broken.join('; ') : ''}`); }
  if (result.runs.B0) result.headline = `B0: ${result.runs.B0.counts.atEnd}/36 still tracked at the end, ${result.runs.B0.counts.ever}/36 ever`;
  console.log(`reference (switched off): ${JSON.stringify(ref.counts)}; ` + names.map((n) => `${n} ${result.runs[n].counts.atEnd}/36 at the end, ${result.runs[n].counts.ever}/36 ever`).join('; '));
  if (names.length === Object.keys(SETTINGS).length) { fs.writeFileSync(path.join(__dirname, '..', '..', 'lab', 'misses.json'), JSON.stringify(result, null, 1) + '\n'); console.log('written: lab/misses.json'); }
})().catch((e) => { console.log(`BROKE (the run itself, not a verdict): ${e.stack || e}`); process.exit(1); });
