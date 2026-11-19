// Tracker Cleaner 1.32: blocks tracker requests (the rule files), and cleans tracking cookies as they are set and in a
// sweep every 15 minutes, but only what its group allows: each group (registry.js) is off, asks first (the
// candidates wait in a queue for Approve or Postpone) or is automatic. A new install is switched on, and the groups
// that only touch what follows you run without asking from the start; the popup says so once. Only deleted cookies
// can be put back, for 10 minutes; emptied storage and cleared saved copies cannot. Everything is held while paused,
// and everything destructive while a sign-in is going on. Login cookies (KEEP_RE) are deleted by nothing but the
// user's own always-delete list and "Delete" in the report. 1.30: a strength dial (registry.js `level`) sets every row at
// once, a new install starts at Strongest, and each row with something to clean has "Clean now" (cleanPress, below).
importScripts('lists.js', 'core.js', 'registry.js', 'guard.js', 'queue.js', 'undo.js', 'loop.js', 'history.js', 'learn.js', 'xsid.js', 'net-rules.js');
const REPORT = 'http://127.0.0.1:8088/audit/cleaner';
// The cookie decisions and their settings (S) live in core.js, where the Node tests can reach them.
const { S, realHost, reason, firstParty, isTrackerHost, isGoogleHost } = makeCore({ DOMAINS, COOKIE_RE, GOOGLE_RE, KEEP_RE });
// The gate (registry.js): every action below first asks can(id, cx), which combines the stored settings,
// the pause and the sign-in guard. Only 'run' acts; what gets 'ask' or 'held' goes to the approval queue.
// The 8088 server supplies lists and can switch things off while its row (C15) is on; it cannot switch a capability on.
// State is in chrome.storage.local because this worker sleeps: master, modes, guardUntil, pauseUntil, pending,
// cacheClearedAt, log, allow, always, sitesOff, loops, history, follow, stopped, stops, own, bounce, params, skip, noskip,
// mine, salt, later, firstRun. Only chrome.storage.session (memory) holds removed cookies, for Undo.
const hostOf = (url) => { try { return new URL(url).hostname; } catch { return ''; } };
async function context() {
  const set = await chrome.storage.local.get(['master', 'modes', 'level', 'unauto', 'guardUntil', 'pauseUntil', 'pending', 'cacheClearedAt', 'allow', 'always', 'sitesOff', 'loops', 'stopped', 'hard', 'later', 'params', 'mine', 'mineShared', 'salt', 'histOn', 'sguard']), now = Date.now();
  const tabs = await chrome.tabs.query({}), hold = holdNow(set, tabs, now), hosts = tabs.map((t) => hostOf(t.url || t.pendingUrl));
  // L4: nothing holds all cleaning any more. A sign-in holds deleting only for the sites named in `sguard` (see `guarded`).
  // signing: a tab is on a shipped sign-in host right now; used only to leave the network path and the extension itself
  // alone meanwhile (no Tor switch, no self-reload) and for the line in the popup.
  const signing = mayRun('C19', set) === 'run' && tabs.some((t) => isGuardSignIn(t.url || t.pendingUrl));
  hold.guard = false; hold.tab = false;
  return { set, hold, tabs, hosts, signing };
}
const verdict = (id, cx) => gate(id, cx.set, cx.hold);
const can = (id, cx) => verdict(id, cx) === 'run';
const waits = (v) => v === 'ask' || v === 'held';
// Sign-in guard (C19), as narrowed by H2, J3 and L4. It never holds all cleaning. It holds DELETING for named sites, in
// chrome.storage.local { sguard: { '<site>' or 'family:<n>': when it began } }, for GUARD_MS each:
// - a tab that has stayed SIGNIN_STAY_MS on a shipped sign-in host (exact name): the sites of that sign-in's family
//   (net-rules.js FAMILIES) and the site the tab came from. At most GARM_HOUR such holds begin in an hour (ten minutes
//   in all). A tab that only bounces through the sign-in host begins nothing.
// - a sign-in-looking address of any other site: that site alone, at most once an hour per site, at most 200 sites
//   (the family holds are not counted there, so tenants' /login pages cannot use up their room).
// The header rules skip a tab only while it is on a shipped sign-in host (applyFeatures).
const SGUARD_AGAIN_MS = 3600e3, SIGNIN_STAY_MS = 3000, GARM_HOUR = 2, came = new Map();   // came: tab -> the site it was on before
const arm = (url, tab, opener) => { const host = hostOf(url), site = siteOf(host), now = Date.now();
  if (!isGuardSignIn(url)) { if (site && Number.isInteger(tab) && /^https?:/.test(String(url))) { if (came.size > 500) came.clear(); came.set(tab, site); } }
  if (!isSignIn(url)) return;
  if (!isGuardSignIn(url)) return serial(async () => { const { sguard = {} } = await chrome.storage.local.get('sguard');
    if (sguard[site] > now - SGUARD_AGAIN_MS) return;   // once an hour per site: going there again does not begin it anew
    const live = Object.entries(sguard).filter(([, t]) => t > now - SGUARD_AGAIN_MS);
    if (live.filter(([k]) => !k.startsWith('family:')).length >= 200) return;   // full: no new hold, rather than pushing a running one out
    await chrome.storage.local.set({ sguard: Object.fromEntries([...live, [site, now]]) }); chrome.alarms.create('unguard', { when: now + GUARD_MS + 1000 }); });
  if (!came.has(tab) && Number.isInteger(opener) && opener >= 0) chrome.tabs.get(opener).then((t) => { if (t && !isGuardSignIn(t.url)) came.set(tab, siteOf(hostOf(t.url))); }, () => {});
  applyFeatures();   // the header rules skip this tab while it is on the sign-in host
  // only a tab that is still on that sign-in host a moment later begins a hold
  setTimeout(async () => { const t = await chrome.tabs.get(tab).catch(() => null), from = came.get(tab);
    if (!t || hostOf(t.url) !== host) return;
    await serial(async () => { const { sguard = {}, garm = [] } = await chrome.storage.local.get(['sguard', 'garm']), at = Date.now(), recent = garm.filter((x) => x > at - SGUARD_AGAIN_MS);
      if (recent.length >= GARM_HOUR) return;
      const fam = FAMILIES.findIndex((f) => f.some((d) => under(site, d))), live = Object.entries(sguard).filter(([, x]) => x > at - SGUARD_AGAIN_MS);
      await chrome.storage.local.set({ garm: [...recent, at], sguard: Object.fromEntries([...live, ...(fam >= 0 ? [[`family:${fam}`, at]] : [[site, at]]), ...(from && isHost(from) ? [[from, at]] : [])]) });
      chrome.alarms.create('unguard', { when: at + GUARD_MS + 1000 }); }); }, SIGNIN_STAY_MS); };
chrome.tabs.onCreated.addListener((t) => arm(t.pendingUrl || t.url, t.id, t.openerTabId));
chrome.tabs.onUpdated.addListener((id, info, t) => { if (info.url) { arm(info.url, id, (t || {}).openerTabId); if (!isGuardSignIn(info.url)) applyFeatures(); } });
chrome.tabs.onRemoved.addListener((id) => { came.delete(id); });
// is deleting held for this site right now?
const guarded = (cx, site) => { const sg = cx.set.sguard || {}, live = (k) => sg[k] > Date.now() - GUARD_MS;
  return mayRun('C19', cx.set) === 'run' && (live(site) || FAMILIES.some((f, i) => live(`family:${i}`) && f.some((d) => under(site, d)))); };
// Pause (C18): everything stops until pauseUntil; the 'resume' alarm switches the features back on.
// The storage listener at the end of this file applies the change.
async function pause(minutes) {
  const pauseUntil = Date.now() + (minutes > 0 ? minutes : 10) * 60e3;
  chrome.alarms.create('resume', { when: pauseUntil }); await chrome.storage.local.set({ pauseUntil }); await applyProxy();
  return { pauseUntil };
}
async function resume() { await chrome.alarms.clear('resume'); await chrome.storage.local.remove('pauseUntil'); await applyProxy(); return { pauseUntil: 0 }; }
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'resume') resume(); });
// which capability deletes this cookie, by core.js's reason
const CAP_OF = { blacklist: 'C07', allowlist: 'C12', name: 'C03', host: 'C03', google: 'C04' };
const bare = (domain) => domain.replace(/^\./, ''), under = (h, site) => h === site || h.endsWith('.' + site);
// a host under a site the user turned off (sitesOff): nothing of it is touched
const isOff = (cx, host) => (cx.set.sitesOff || []).some((s) => under(String(host).replace(/:\d+$/, ''), s));
// `spared`: core.js's reason, minus what is spared: every cookie of a site the user switched off (sitesOff), a cookie the user
// allowed (the blacklist still wins over that), and a cookie that is only there because of its tracker host while
// a tab is open on that tracker's own site.
const spared = (c, cx, noBlack) => {
  const r = reason(c, noBlack);
  if (!r || (cx.set.sitesOff || []).some((s) => under(realHost(c.domain), s))) return null;
  if (r !== 'blacklist' && (cx.set.allow || []).some((a) => a.site === bare(c.domain) && a.name === c.name)) return null;
  return r === 'host' && (firstParty(c, cx.hosts) || usedSite(c, cx)) ? null : r;
};
// a cookie that looks like a sign-in, of a company that was cleaned out here (`hard`, on no built-in list): no sweep and
// no cookie event deletes it (the user may be signed in there). A company that is only blocked (`stopped`) keeps all its cookies.
const signinLike = (c) => KEEP_RE.test(c.name) || (c.httpOnly === true && c.secure === true);
const usedSite = (c, cx) => { const hs = [realHost(c.domain), bare(c.domain)], s = (cx.set.hard || []).find((x) => hs.some((h) => under(h, x)));
  return !!s && !DOMAINS.some((d) => hs.some((h) => under(h, d))) && signinLike(c); };
// [reason, verdict] for a cookie. A blacklisted cookie whose capability only asks is still deleted when
// another rule that runs wants it gone (a tracker name, allow-list mode); otherwise it waits in the queue.
// Loop breaker (loop.js): a cookie that would be removed, but that its site has put back LOOP_N times in a row, is not
// removed again: it waits in the queue, with LOOP_WHY as the third answer, the reason shown to the user.
const loopKey = (c) => `${bare(c.domain)} ${c.name}`;
// A cookie on the user's own always-delete list (`always`) is the user's explicit choice, so it does not wait for an
// approval: it goes whenever cleaning is on, not paused and no sign-in is being protected, whatever mode its group
// (C07) is in. Only that group set to Off, or the main switch, stops it. The server's list stays under C07's mode.
const mine = (c, cx) => (cx.set.always || []).some((a) => (a.site === bare(c.domain) || a.site === realHost(c.domain)) && a.name === c.name);
const mineVerdict = (cx) => mayRun('C07', cx.set) === 'no' ? 'no' : gate('C07', { ...cx.set, modes: { ...cx.set.modes, C07: 'auto' } }, cx.hold);
const judge = (c, cx) => {
  const r = spared(c, cx), v = r && (r === 'blacklist' && mine(c, cx) ? mineVerdict(cx) : verdict(CAP_OF[r], cx)), r2 = r === 'blacklist' && v !== 'run' && spared(c, cx, true);
  const [why, did] = r2 && can(CAP_OF[r2], cx) ? [r2, 'run'] : [r, v];
  if (did === 'run' && guarded(cx, siteOf(bare(c.domain)))) return [why, 'held'];   // a sign-in page of that very site was just opened
  return did === 'run' && loopStuck(cx.set.loops, loopKey(c), Date.now()) ? [why, 'ask', LOOP_WHY] : [why, did];
};

// ---- Approval queue (C20, queue.js): candidates the gate answered 'ask' or 'held' wait in storage under `pending`.
// Every change goes through withQueue, one after the other: the queue is read, changed and written back, and cookie
// events come in bursts, so two handlers at once would overwrite each other's additions. fn(pending) changes
// `pending` in place and returns whether it did. The action log (`log`, C21) is written through the same chain.
let chain = Promise.resolve();
const serial = (fn) => (chain = chain.then(fn).catch(() => {}));
const withQueue = (fn) => serial(async () => {
  const { pending = {} } = await chrome.storage.local.get('pending');
  if (fn(pending)) await chrome.storage.local.set({ pending }); });
// did: 'removed', or left out for items that wait: each then says itself whether it is 'queued' or 'held'
// What was removed is also counted in the private history (history.js): numbers per day and per cookie, nothing else.
// tally: how many were removed per group since this worker started, counted as they are logged (what "Clean now" reports)
const tally = {};
const logged = (items, did) => { for (const it of items) if ((did || it.did) === 'removed') { const g = cap(it.cap).group; tally[g] = (tally[g] || 0) + 1; }
  return items.length ? serial(async () => {
  const { log = [], history } = await chrome.storage.local.get(['log', 'history']), now = Date.now();
  const gone = items.filter((it) => (did || it.did) === 'removed').map((it) => ({ group: cap(it.cap).group, kind: it.kind, site: it.site, name: it.name }));
  await chrome.storage.local.set({ log: logAdd(log, items, did, now), ...(gone.length ? { history: historyAdd(history, gone, now) } : {}) }); }) : chain; };
const waitsAs = (v) => v === 'held' ? 'held' : 'queued';
// Adds what is not queued yet and logs just that, so an item waiting through many sweeps is logged once.
// keep: first forget the queued items it rejects.
async function queueUp(items, keep) {
  const fresh = [];
  await withQueue((p) => { const forgot = !!keep && queueKeep(p, keep);
    for (const it of items) if (queueAdd(p, cap(it.cap).group, { ...it, t: Date.now() })) fresh.push(it);
    return forgot || fresh.length > 0; });
  await logged(fresh);
}
const cookieItem = (c, r, v, why) => ({ cap: CAP_OF[r], kind: 'cookie', site: bare(c.domain), name: c.name, why: why || r, did: waitsAs(v) });
async function badge() {
  const s = await chrome.storage.local.get(['pending', 'pauseUntil']), now = Date.now();
  try { await chrome.action.setBadgeText({ text: queueBadge(s.pending, s.pauseUntil > now, now) }); } catch {}
}
// One queued item, carried out now. A cookie or tab that has gone or changed meanwhile is skipped.
// standing false (a "Clean now" press): what was done once is not taken as a standing yes for the days after (C28)
async function carry(it, cookies, tabs, cx, standing = true) {
  if (it.kind === 'cookie') { let n = 0;
    for (const c of cookies) if (c.name === it.name && bare(c.domain) === it.site && CAP_OF[spared(c, cx)] === it.cap && await remove(c, it.cap !== 'C07')) n++;
    return n > 0; }
  if (it.kind === 'tabs') { const t = tabs.find((x) => String(x.id) === it.name);
    // approval is allowed during the sign-in guard, so it must not close a sign-in page itself
    if (!t || tabHost(t) !== it.site || isSignIn(t.url || t.pendingUrl)) return false;
    await chrome.tabs.remove(t.id); return true; }
  // the press on Block: that host is blocked on other sites, and the saved copies are cleared (at most once an hour); removing what it saved is the next question (USED)
  if (it.kind === 'tracker') { if (!(await stopTracker(it.site))) return false; await copiesNow(await context()); return true; }
  if (it.kind === 'used') return hardClean(it.site);
  if (it.kind === 'bounce') return cleanBounce(it.site);
  if (it.kind === 'skip') return skipAdd(it.site);
  if (it.kind === 'own') return cleanOwn(it.site, cx, standing);
  if (it.kind === 'storage') { if (isOff(cx, it.site)) return false; await dropStorage(it.site); }   // F8: never a site turned off
  else if (it.kind === 'permission') await blockPermission(it.site, it.name);
  else if (it.kind === 'cache') await clearCache();
  else return false;
  return true;
}
// Approve: exactly what is queued for this group, then the group is empty. Refused while paused; allowed during
// the sign-in guard, because the user asked for it. site, name: only that one question, the rest keep waiting.
async function approve(group, site, name) {
  await ready;
  const cx = await context();
  if (cx.hold.paused) return { ok: false, why: 'paused' };
  if (cx.set.master === false) return { ok: false, why: 'off' };
  let items = [];
  await withQueue((p) => { const g = p[group] || { items: [] }; const mine = (it) => site ? it.site === site && (!name || it.name === name) : !['tracker', 'used', 'bounce', 'skip'].includes(it.kind); items = g.items.filter(mine);   // the group button never answers a question that deletes something of a learned host or changes addresses
    g.items = g.items.filter((it) => !mine(it)); if (!g.items.length) delete p[group];
    return items.length > 0; });
  const cookies = items.some((it) => it.kind === 'cookie') ? await allCookies() : [], tabs = await chrome.tabs.query({});
  const done = [];
  for (const it of items) if (mayRun(it.cap, cx.set) !== 'no' && await carry(it, cookies, tabs, cx).catch(() => false)) done.push(it);
  await logged(done, 'removed');
  if (done.some((it) => it.kind === 'tracker')) await sweep('settings');   // so that the next question about that host is there at once
  const nets = mayRun('C24', cx.set) !== 'no' ? items.filter((it) => it.kind === 'wifi') : [];
  return { ok: true, done: done.length + (nets.length ? await wifiRemove(nets) : 0), of: items.length };
}
async function postpone(group, minutes) {
  if (!GROUPS.some((g) => g.id === group)) return { ok: false };
  const postponedUntil = minutes === 'restart' ? 'restart' : Date.now() + (minutes > 0 ? minutes : 60) * 60e3;
  await withQueue((p) => queuePostpone(p, group, postponedUntil));
  return { ok: true, postponedUntil };
}
chrome.runtime.onStartup.addListener(() => withQueue(queueRestart));

// ---- Clean now (1.30): a row's cleaning once, now, as the user's own press, so also on Ask first; "Clean everything now"
// is every such row in one press. Refused with the main switch not on, while paused, for a row that is off, and while a
// tab is on a sign-in host; what a site's own sign-in page holds stays where it is. One press is one pass: a press while
// one runs is refused (busy). The pass: a sweep (on Automatic it cleans; on Ask first it queues), then what waits in those
// rows is carried out, as Approve does, and the two question rows' questions are answered yes (a block's next question,
// remove what it saved, in a second round) -- all of them but what mayYes holds absolutely (sign-in companies, sites turned off, sign-in holds).
// Wi-Fi is never part of it: it keeps its own Remove button and the line that it cannot be undone. Then what a row has
// beyond its queue: the saved copies (cache), what trackers saved on their own sites (own), cookies with a cross-site
// code (crossid). The answer: how many were removed per row, from the log lines (tally); each row keeps { t, n }.
let cleaning = false;
const QUESTION_KINDS = ['tracker', 'used', 'bounce', 'skip'];
const noteCleaned = async (done) => { const { cleanedNow = {} } = await chrome.storage.local.get('cleanedNow'), t = Date.now();
  await chrome.storage.local.set({ cleanedNow: { ...cleanedNow, ...Object.fromEntries(Object.entries(done).map(([g, n]) => [g, { t, n }])) } }); };
async function cleanPress(rows) {
  if (cleaning) return { ok: false, why: 'busy' };
  cleaning = true;
  try {
    await ready;
    let cx = await context();
    const no = refusal(cx) || (cx.set.master !== true ? { ok: false, why: 'off' } : null); if (no) return no;
    if (cx.signing) return { ok: false, why: 'signin' };
    const want = rows.filter((id) => GROUPS.find((g) => g.id === id).caps.some((c) => mayRun(c, cx.set) !== 'no'));
    if (!want.length) return { ok: false, why: 'rowOff' };
    const before = Object.fromEntries(want.map((g) => [g, tally[g] || 0]));
    await sweep('clean now'); cx = await context();
    let r = await carryNow(want, cx), own = r.own;
    if (r.trackers) { await sweep('clean now'); cx = await context(); const r2 = await carryNow(want, cx); r = { ...r2, cache: r.cache || r2.cache }; own = [...own, ...r2.own]; }
    if (want.includes('cache') && !r.cache) try { await clearCache(); await logged([{ cap: 'C11', kind: 'cache', site: '*', name: 'http-cache' }], 'removed'); } catch {}
    if (want.includes('own')) await ownNow(cx, own);
    if (want.includes('crossid')) { const forced = { ...cx, set: { ...cx.set, modes: { ...cx.set.modes, C33: 'auto' } } }, all = await allCookies(); await xidClean(forced, all); await xidSetClean(forced, all); }
    await chain;
    const done = Object.fromEntries(want.map((g) => [g, (tally[g] || 0) - before[g]]));
    await noteCleaned(done);
    return { ok: true, cleaned: Object.values(done).reduce((a, b) => a + b, 0), groups: done, ...(r.left ? { left: r.left } : {}) };
  } finally { cleaning = false; }
}
// what waits in these rows, carried out now; a question only where mayYes allows it, nothing of a site whose sign-in holds it
async function carryNow(rows, cx) {
  const all = await allCookies(), items = []; let left = 0;
  const take = (it) => it.kind !== 'wifi' && (it.kind === 'cache' || !guarded(cx, siteOf(bare(String(it.site))))) && (!QUESTION_KINDS.includes(it.kind) || mayYes(cx, it.site, true));
  await withQueue((p) => { let changed = false;
    for (const g of rows) { const q = p[g]; if (!q) continue;
      const mine = q.items.filter(take); left += q.items.filter((it) => QUESTION_KINDS.includes(it.kind) && !take(it)).length;
      if (!mine.length) continue;
      items.push(...mine); q.items = q.items.filter((it) => !take(it)); if (!q.items.length) delete p[g]; changed = true; }
    return changed; });
  const tabs = await chrome.tabs.query({}), done = [];
  for (const it of items) if (mayRun(it.cap, cx.set) !== 'no' && await carry(it, all, tabs, cx, false).catch(() => false)) done.push(it);
  await logged(done, 'removed');
  return { left, trackers: done.some((it) => it.kind === 'tracker'), cache: done.some((it) => it.kind === 'cache'), own: done.filter((it) => it.kind === 'own').map((it) => it.site) };
}
// "Clean now" on the row of what trackers saved on their own sites: every cleaned-out company and the built-in list, now
// (not waiting for the day), but never while its own site is open in a tab or its sign-in holds it; `done`: already done in this press
async function ownNow(cx, done) {
  const { hard = [] } = await chrome.storage.local.get('hard'), gone = [];
  for (const site of [...hard, LISTED]) { if (done.includes(site) || guarded(cx, site) || (site !== LISTED && cx.hosts.some((h) => under(h, site)))) continue;
    if (await cleanOwn(site, cx, false).catch(() => false)) gone.push({ cap: 'C28', kind: 'own', site, name: OWN, why: 'a tracker' }); }
  await logged(gone, 'removed');
}

// ---- The popup: chrome.runtime.sendMessage({ type, ... }) -> reply.
async function state() {
  await ready;
  const { set, hold, signing } = await context(), modes = set.modes || {}, pending = set.pending || {};
  const looping = (g) => g ? g.items.filter((it) => it.why === LOOP_WHY).length : 0;
  const { wifi, cleanedNow = {}, autoDone = {} } = await chrome.storage.local.get(['wifi', 'cleanedNow', 'autoDone']);   // wifi: what the helper last said: { helper: 'ok' | 'missing', canDelete }
  return { now: Date.now(), master: set.master, modes, level: levelNow(set), hold: { ...hold, guard: signing, pauseUntil: set.pauseUntil || 0, guardUntil: 0 },   // guard: a tab is on a sign-in host right now (for the popup's line)
    log: (await chrome.storage.local.get('log')).log || [], allow: set.allow || [], always: set.always || [], sitesOff: set.sitesOff || [], stopped: set.stopped || [], hard: set.hard || [], stoppedUsed: (set.stopped || []).filter((s) => visited({ set }, siteOf(s))), skipped: ((await chrome.storage.local.get('skip')).skip || { sites: [] }).sites,
    ...(((f) => f === true || f === 'update' ? { firstRun: f } : {})((await chrome.storage.local.get('firstRun')).firstRun)),
    ...(serverOff().length ? { serverOff: serverOff() } : {}), ...(notWorking().length ? { notWorking: notWorking() } : {}), histOn: set.histOn === true,
    server: SERVER,   // did the 8088 server answer the last time: the popup asks it only then
    tor: await torNow({ set, hold }),
    // F3: the hosts answered by itself that can still be let through, newest first
    autoDone: Object.entries(autoDone).filter(([h]) => isHost(h) && !unautoHas({ set }, siteOf(h))).map(([site, a]) => ({ site, row: a.row, t: a.t })).sort((a, b) => b.t - a.t),
    undo: (await undoBuffer()).map(({ t, c }) => ({ t, site: bare(c.domain), name: c.name })),   // never the value
    // one row per group that has an action capability; it shows the mode of its first one (its own, or the level's),
    // setMode keeps them all the same. ask: false = nothing destructive in the group, so 'ask' would only mean off: the
    // popup offers On and Off. answers: it can answer its questions yes by itself ('yes'). cleanable: it has "Clean now";
    // cleanedNow: { t, n } of the last press there
    groups: GROUPS.filter((g) => g.caps.length).map((g) => ({ id: g.id, title: g.title, says: g.says, ask: g.caps.some((id) => cap(id).destructive), mode: modeOf(g.caps[0], set), ...queueView(pending[g.id]), looping: looping(pending[g.id]),
      ...(g.caps.some((id) => cap(id).answers) ? { answers: true } : {}), ...(CLEANABLE.includes(g.id) ? { cleanable: true } : {}), ...(cleanedNow[g.id] ? { cleanedNow: cleanedNow[g.id] } : {}),
      // the cache: when it is next offered or cleared. Its size is not here: no Chrome API tells an extension (tools/inspect.js does)
      ...(g.id === 'cache' ? { nextAt: (set.cacheClearedAt || 0) + CACHE_MS } : {}), ...(g.id === 'wifi' ? { noAuto: true, ...wifi } : {}) })) };
}
async function setMode(group, mode) {
  const g = GROUPS.find((x) => x.id === group);
  if (!g || !(['auto', 'ask', 'off'].includes(mode) || (mode === 'yes' && g.caps.some((id) => cap(id).answers)))) return { ok: false };
  const old = (await chrome.storage.local.get('modes')).modes || {}, modes = { ...old, ...Object.fromEntries(g.caps.map((id) => [id, mode])) };
  // the saved copies of pages, turned on by the user: the day's wait starts over, so the sweep below clears (or offers) them now
  await chrome.storage.local.set({ modes, ...(group === 'cache' && mode !== 'off' && old.C11 !== mode ? { cacheClearedAt: 0 } : {}) });
  if (group === 'tor') await applyProxy();   // before the reply, so the row that is drawn next is true
  await sweep('settings');
  return { ok: true, modes };
}
// The dial (1.30): the level is stored and every row on it goes back to it (their hand-set modes are taken away); the rows
// with their own switch (registry.js OWN_SWITCH) keep theirs.
async function setLevel(level) {
  if (!LEVELS.includes(level)) return { ok: false };
  const { modes = {} } = await chrome.storage.local.get('modes');
  await chrome.storage.local.set({ level, modes: Object.fromEntries(Object.entries(modes).filter(([id]) => !onDial(cap(id)))) });
  await sweep('settings');
  return { ok: true, level };
}
// A changed setting (master, mode, exception) is followed by a sweep before the reply, so the queue, and with it
// the counts the popup then asks for, are those of the new setting.
async function setMaster(on) { await chrome.storage.local.set({ master: !!on }); await applyProxy(); await sweep('settings'); return { master: !!on }; }
// The user's exceptions (see `spared`).
const isHost = (h) => typeof h === 'string' && /^[a-z0-9._-]+$/i.test(h);
// allow: [{ site, name }], site as the action log and the queue give it (the cookie's domain without the leading dot)
// A cookie the user keeps is no longer one to always delete: Keep takes it off that list (`always`, below).
async function allowSet(site, name, on) {
  const { allow = [], always = [] } = await chrome.storage.local.get(['allow', 'always']), other = (a) => !(a.site === site && a.name === name);
  const list = allow.filter(other);
  if (on) list.push({ site, name });
  await chrome.storage.local.set({ allow: list, ...(on && !always.every(other) ? { always: always.filter(other) } : {}) });
  return list;
}
// always: [{ site, name }], the user's own always-delete list (the report's button "Always delete"), kept here and not
// on the 8088 server. refreshBlacklist puts it into the blacklist; when the cookie comes back it is deleted without
// asking (see `mine`). The cookie that is there now goes at once, through drop: the user pressed the button.
async function always(site, name, on) {
  if (!isHost(site) || typeof name !== 'string' || !name) return { ok: false };
  const no = on && refusal(await context()); if (no) return no;
  const list = ((await chrome.storage.local.get('always')).always || []).filter((a) => !(a.site === site && a.name === name));
  if (on) { list.push({ site, name }); await allowSet(site, name, false); }
  await chrome.storage.local.set({ always: list });
  if (on) await drop({ kind: 'cookie', site, name });
  await sweep('settings');
  return { ok: true, always: list };
}
async function allow(site, name, on) {
  if (!isHost(site) || typeof name !== 'string' || !name) return { ok: false };
  const list = await allowSet(site, name, on);
  await sweep('settings');
  return { ok: true, allow: list };
}
// sitesOff: [host]. Besides the cookies, pages of that site get all their requests through: two dynamic rules per
// host, above the block rules (priority 1). allowAllRequests covers every frame of a page loaded from then on; Chrome
// does not apply it to a page that is already open, so `allow` lets through what a page of that site requests itself
// (no resourceTypes = everything but main_frame: a link from there to another site is still stripped of parameters).
// These are the only dynamic rules, so they are simply rewritten.
async function siteOff(host, on) {
  if (!isHost(host)) return { ok: false };
  host = host.toLowerCase();
  const list = ((await chrome.storage.local.get('sitesOff')).sitesOff || []).filter((h) => h !== host);
  if (on) list.push(host);
  await chrome.storage.local.set({ sitesOff: list });
  try { const old = await chrome.declarativeNetRequest.getDynamicRules();
    await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.filter((r) => r.id < LEARNED).map((r) => r.id), addRules: list.flatMap((h, i) => [
      { id: 2 * i + 1, priority: 2, action: { type: 'allowAllRequests' }, condition: { requestDomains: [h], resourceTypes: ['main_frame', 'sub_frame'] } },
      { id: 2 * i + 2, priority: 2, action: { type: 'allow' }, condition: { initiatorDomains: [h] } }]) }); } catch {}
  await sweep('settings');
  return { ok: true, sitesOff: list };
}
// ---- The report (1.23, report-view.js): this site's cookies as Chrome has them right now: the site itself and the
// sites above and below it. What a cookie holds leaves here cut to its first CUT characters, for the screen only: it is
// never written to storage, the history, the queue, the log or a report to 8088.
const CUT = 24;
const siteCookies = async (host) => (await allCookies()).filter((c) => under(host, bare(c.domain)) || under(bare(c.domain), host));
async function cookiesOf(host) {
  if (!isHost(host)) return { ok: false };
  const cx = await context();   // used: a cookie of a stopped company that is kept because the user may be signed in there
  return { ok: true, cookies: (await siteCookies(host.toLowerCase())).map((c) => ({ domain: c.domain, name: c.name, value: c.value.slice(0, CUT), long: c.value.length > CUT,
    session: c.session, expirationDate: c.expirationDate, ...(usedSite(c, cx) ? { used: true } : {}) })) };
}
// The whole of what one cookie holds, for "Show all of it" and "Copy": read now, answered, kept nowhere.
async function cookieValue(site, name) {
  const c = isHost(site) && typeof name === 'string' ? (await allCookies()).find((x) => bare(x.domain) === site && x.name === name) : null;
  return c ? { ok: true, value: c.value } : { ok: false };
}
// "Delete N cookies on this site": every cookie the report lists, but those that keep the user signed in and those the
// user pressed Keep on only when asked (kept: true). One the user put on the always-delete list goes in any case.
async function dropSite(m) {
  if (!isHost(m.host)) return { ok: false };
  const cx = await context(), no = refusal(cx); if (no) return no;
  const on = (list, c) => (list || []).some((a) => a.site === bare(c.domain) && a.name === c.name);
  const stays = (c) => !on(cx.set.always, c) && (KEEP_RE.test(c.name) || on(cx.set.allow, c));
  const all = (await siteCookies(m.host.toLowerCase())).filter((c) => m.kept === true || !stays(c)), done = [];
  for (const c of all) if (await remove(c)) done.push({ cap: 'C10', kind: 'cookie', site: bare(c.domain), name: c.name });
  await logged(done, 'removed');
  return { ok: true, done: done.length, of: all.length };
}
// ---- What the page in a tab has saved besides cookies. lookInPage runs inside that page (chrome.scripting), so it
// can use nothing from this file. It counts by names; only for the kind the user asked to see (`show`) does it read
// what is saved, and it cuts each value to `cut` characters there, before anything leaves the page. Kept nowhere.
async function lookInPage(show, cut) {
  const safe = async (f) => { try { return await f(); } catch { return null; } };   // a page can be refused its own storage
  const names = { local: await safe(() => Object.keys(localStorage)), session: await safe(() => Object.keys(sessionStorage)),
    databases: await safe(async () => (await indexedDB.databases()).map((d) => d.name)), caches: await safe(() => caches.keys()),
    workers: await safe(async () => (await navigator.serviceWorker.getRegistrations()).map((w) => w.scope)) };
  const list = show && names[show], store = !list ? null : show === 'local' ? localStorage : show === 'session' ? sessionStorage : null;
  const item = (name) => { const v = store ? String(store.getItem(name) ?? '') : '';
    return { name: String(name).slice(0, 80), ...(store ? { value: v.slice(0, cut), long: v.length > cut } : {}) }; };
  return { counts: Object.fromEntries(Object.entries(names).map(([k, v]) => [k, v ? v.length : null])), ...(list ? { shown: show, items: list.slice(0, 200).map(item) } : {}) };
}
// refused: Chrome lets no extension into this page (chrome://, the web store), or the tab has gone
async function stored(m) {
  if (!Number.isInteger(m.tabId)) return { ok: false };
  const show = ['local', 'session', 'databases', 'caches', 'workers'].includes(m.show) ? m.show : null;
  try { const [r] = await chrome.scripting.executeScript({ target: { tabId: m.tabId }, func: lookInPage, args: [show, CUT] });
    return r && r.result ? { ok: true, ...r.result } : { ok: false, refused: true }; } catch { return { ok: false, refused: true }; }
}
const NEW_AUTO = ['C11', 'C25', 'C27', 'C28'];
// the one-time line was answered. auto true = "OK": the modes the update stored as "Ask first" are taken away again
async function lineSeen(m) {
  const { held125 = [], modes = {} } = await chrome.storage.local.get(['held125', 'modes']);
  if (m.auto === true && held125.length) await chrome.storage.local.set({ modes: Object.fromEntries(Object.entries(modes).filter(([id, v]) => !(held125.includes(id) && v === 'ask'))) });
  await chrome.storage.local.remove(['firstRun', 'held125']);
  if (m.auto === true) await sweep('settings');
  return { ok: true };
}
const MESSAGES = { state, stored, seen: lineSeen, cookies: (m) => cookiesOf(m.host), cookieValue: (m) => cookieValue(m.site, m.name), dropSite, always: (m) => always(m.site, m.name, m.on !== false), pause: (m) => pause(m.minutes), resume, approve: (m) => approve(m.group, m.site, m.name), notNow, unstop: (m) => unstop(m.site), letThrough: (m) => letThrough(m.site), unskip: (m) => unskip(m.site), keepRemoving: (m) => keepRemoving(m.site, m.on), histOn: (m) => histOn(m.on), clearBrowsing, postpone: (m) => postpone(m.group, m.minutes),
  setMode: (m) => setMode(m.group, m.mode), setLevel: (m) => setLevel(m.level), cleanNow: (m) => CLEANABLE.includes(m.group) ? cleanPress([m.group]) : Promise.resolve({ ok: false }),
  cleanAll: () => cleanPress(CLEANABLE), setMaster: (m) => setMaster(m.on), allow: (m) => allow(m.site, m.name, true),
  revertAllow: (m) => allow(m.site, m.name, false), siteOff: (m) => siteOff(m.host, m.on),
  restore: (m) => isHost(m.site) && typeof m.name === 'string' ? restore((c) => bare(c.domain) === m.site && c.name === m.name) : Promise.resolve({ ok: false }),
  restoreAll: () => restore(() => true), drop,
  // the private history, for the extension's own page; "Clear history" empties it
  history: async () => ({ ok: true, ...historyTrim((await chrome.storage.local.get('history')).history, Date.now()) }),
  // the list of sites the user opens as pages (`mine`) stays: it is what keeps their cookies from being cleaned (H9)
  clearHistory: async () => { await serial(() => chrome.storage.local.remove('history')); return { ok: true }; } };

// ---- Drop (the audit view's buttons, popup-audit.js): one item now, because the user said so. Through here so
// that pause and the master switch hold it back, it is in the action log, and a cookie can be undone.
const refusal = (cx) => cx.hold.paused ? { ok: false, why: 'paused', error: 'cleaning is paused' } : cx.set.master === false ? { ok: false, why: 'off', error: 'cleaning is switched off' } : null;
async function drop(m) {
  const str = (...xs) => xs.every((x) => typeof x === 'string' && x), no = refusal(await context());
  if (no) return no;
  try {
    if (m.kind === 'cookie' && str(m.site, m.name)) { const site = bare(m.site), mine = (c) => bare(c.domain) === site && c.name === m.name;
      let n = 0; for (const c of (await allCookies()).filter(mine)) if (await remove(c)) n++;
      if (n) await logged([{ cap: 'C10', kind: 'cookie', site, name: m.name }], 'removed');
      return { ok: true, verified: !(await allCookies()).some(mine) }; }
    if (m.kind === 'storage' && str(m.site)) { await dropStorage(m.site); await logged([{ cap: 'C06', kind: 'storage', site: m.site, name: 'storage' }], 'removed'); }
    else if (m.kind === 'permission' && str(m.site, m.perm)) { await blockPermission(m.site, m.perm); await logged([{ cap: 'C09', kind: 'permission', site: m.site, name: m.perm }], 'removed'); }
    else if (m.kind === 'servers') { await clearCache(); await logged([{ cap: 'C11', kind: 'cache', site: '*', name: 'http-cache' }], 'removed'); await noteCleaned({ cache: 1 }); }
    else return { ok: false, error: 'unknown item' };
    return { ok: true };
  } catch (e) { return { ok: false, error: String(e.message || e) }; }
}

// ---- Undo (C22, undo.js): every cookie this worker removes waits 10 minutes in chrome.storage.session, whole.
const undoBuffer = async () => { try { return undoLive((await chrome.storage.session.get('undo')).undo, Date.now()); } catch { return []; } };
const undoWrite = (fn) => serial(async () => {
  const { undo = [] } = await chrome.storage.session.get('undo'), next = fn(undo);
  if (next.length !== undo.length || next.some((e, i) => e !== undo[i])) await chrome.storage.session.set({ undo: next }); });
const purgeUndo = () => undoWrite((undo) => undoLive(undo, Date.now()));
// Puts back the kept cookies `pick` accepts, as they were. Each is allowed first, or the cleaner would take it
// again the moment it is set; the popup lists that under "Your exceptions", where it can be reverted.
async function restore(pick) {
  let take = [];
  await undoWrite((undo) => { const live = undoLive(undo, Date.now()); take = live.filter((e) => pick(e.c)); return live.filter((e) => !pick(e.c)); });
  let restored = 0;
  for (const { c } of take) { const d = cookieDetails(c, Date.now());
    if (!d) continue;
    await allowSet(bare(c.domain), c.name, true);
    try { if (await chrome.cookies.set(d)) restored++; } catch {} }
  return { ok: true, restored };
}
// Only the extension's own pages are answered (the popup, a page of ours open in a tab): not a content script, whose
// sender carries the web page's address, and not another extension. Nobody else can read the history or change a switch.
const ownPage = (from) => !!from && from.id === chrome.runtime.id && String(from.url || '').startsWith(chrome.runtime.getURL(''));
chrome.runtime.onMessage.addListener((m, from, reply) => {
  if (!ownPage(from) || !m || !Object.hasOwn(MESSAGES, m.type)) return false;
  MESSAGES[m.type](m).then(reply, () => reply({ ok: false }));
  return true;   // the reply comes later
});
// Switches on 127.0.0.1:8088/tracker-cleaner (sent in limits.json). ON false = the whole extension does nothing.
let ON = true, BLOCK = true, YT = true, DROPS = true, SERVER = false, SERVER_BLACK = [];   // SERVER_BLACK: the server's always-delete list, as it last answered
const serverOn = (cx) => mayRun('C15', cx.set) === 'run';
// what the settings program has switched off, in the popup's words
const serverOff = () => SERVER ? [!S.CLEAN && 'deleting cookies', !BLOCK && 'blocking', !YT && 'the YouTube ad remover', !DROPS && 'your own lists'].filter(Boolean) : [];
const STATE = () => ({ on: ON, cookies: S.CLEAN, blocking: BLOCK, yt: YT, drops: DROPS, v: chrome.runtime.getManifest().version });
async function refreshBlacklist() {
  const cx = await context(); let l = null, back = false;   // back: the settings program's switches were just taken away
  // the settings program on this computer is asked only while its row (C15) is on; off, nothing it said counts any more
  if (serverOn(cx)) try { l = cleanLimits(await (await fetch('http://127.0.0.1:8088/audit/limits.json', { cache: 'no-store' })).json()); } catch {}
  else { back = !S.CLEAN || S.MODE !== 'normal'; ON = BLOCK = YT = DROPS = S.CLEAN = true; S.MODE = 'normal'; S.ALLOW = []; SERVER_BLACK = []; }
  if (l) SERVER_BLACK = Array.isArray(l.cookieBlacklist) ? l.cookieBlacklist : [];
  // The blacklist: the user's own always-delete list (`always`, needs no server) and the server's when it has answered.
  // A list counts only while its capability runs; otherwise the normal rules judge the cookie.
  // The blacklist also counts while C07 asks or is held, so its cookies can be queued (see judge); allow-list
  // mode does not: asking about every cookie of every site would only fill the queue.
  const next = verdict('C07', cx) !== 'no' ? [...(cx.set.always || []).map((a) => ({ h: a.site, n: a.name })), ...SERVER_BLACK] : [];
  let again = back || next.some((b) => !S.BLACK.some((x) => x.h === b.h && x.n === b.n)); S.BLACK = next;
  S.EXTRA = mayRun('C25', cx.set) !== 'no' ? (cx.set.hard || []).filter((s) => (cx.set.stopped || []).includes(s)) : [];   // judged like listed trackers: only the cleaned-out ones
  if (l) {
    const mode = can('C12', cx) && l.cookieMode === 'allowlist' && Array.isArray(l.cookieAllow) && l.cookieAllow.length ? 'allowlist' : 'normal';   // never delete everything by mistake
    const changed = mode !== S.MODE || JSON.stringify(l.cookieAllow || []) !== JSON.stringify(S.ALLOW);
    const clean = l.cookieClean !== false, turnedOn = clean && !S.CLEAN; S.CLEAN = clean;
    ON = l.enabled !== false; BLOCK = ON && l.blocking !== false; YT = ON && l.ytAds !== false; DROPS = ON && l.drops !== false;
    S.MODE = mode; S.ALLOW = l.cookieAllow || []; again = again || changed || turnedOn; }
  SERVER = !!l;
  await applyFeatures();   // also with the server down: the stored settings decide
  return again;
}

// Tracker blocking (rules.json) and the YouTube ad remover follow their switches.
const YT_JS = { id: 'yt-adfree', matches: ['*://*.youtube.com/*'], js: ['yt-adfree.js'], runAt: 'document_start', world: 'MAIN', allFrames: true };
// Link pings (C26): no-ping.js takes the ping address off a link as it is pressed; never on the sign-in hosts
const NO_PING = { id: 'no-ping', matches: ['http://*/*', 'https://*/*'], excludeMatches: SIGNIN_HOSTS.map((h) => `*://${h}/*`), js: ['no-ping.js'], runAt: 'document_start', allFrames: true };
// Known passing sites are skipped (S2c): skip.js changes a pressed link to the address it names; never on the sign-in hosts
const SKIP = { id: 'skip', matches: ['http://*/*', 'https://*/*'], excludeMatches: SIGNIN_HOSTS.map((h) => `*://${h}/*`), js: ['guard.js', 'learn.js', 'skip.js'], runAt: 'document_start', allFrames: true };
// Page shield (S7, J5; ON by default since M4, C32 mode 'auto'): shield.js alone, in the page's own world. It takes no message,
// so the only switch is whether it is put into a page: never on the sign-in hosts or on a site cleaning is switched off
// for, and into no new page while paused or while a sign-in holds everything.
const SHIELD = (off) => ({ id: 'shield', js: ['shield.js'], world: 'MAIN', matches: ['http://*/*', 'https://*/*'], runAt: 'document_start', allFrames: true, matchOriginAsFallback: true,
  excludeMatches: [...SIGNIN_HOSTS, ...off].flatMap((h) => SIGNIN_HOSTS.includes(h) ? [`*://${h}/*`] : [`*://${h}/*`, `*://*.${h}/*`]) });
const YT_CSS = { id: 'yt-adfree-css', matches: ['*://*.youtube.com/*'], css: ['yt-adfree.css'], runAt: 'document_start', allFrames: true };
// one at a time: two at once would both register the same page script, or install rules from an older look at the tabs
let applying = Promise.resolve();
function applyFeatures() { return (applying = applying.then(applyOnce, applyOnce)); }
async function applyOnce() {
  const cx = await context(), yt = YT && can('C05', cx), pings = BLOCK && can('C26', cx);
  // url-params (C23) is not request blocking: the server's blocking switch does not reach it
  const want = { trackers: BLOCK && can('C01', cx), 'google-paths': BLOCK && can('C02', cx), 'url-params': can('C23', cx) };
  try { const on = await chrome.declarativeNetRequest.getEnabledRulesets(), ids = Object.keys(want);
    const enableRulesetIds = ids.filter((id) => want[id] && !on.includes(id)), disableRulesetIds = ids.filter((id) => !want[id] && on.includes(id));
    if (enableRulesetIds.length || disableRulesetIds.length) await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds }); } catch {}
  const stopped = BLOCK && mayRun('C25', cx.set) !== 'no' && !cx.hold.paused ? cx.set.stopped || [] : [];
  // C33 (M2): for each confirmed cross-site id (session `xsid`), block its exact collector host+path prefix (never the
  // site root) and strip its value from request URLs and navigation links. Vet the collector endpoints here: never a
  // sign-in host or company, and never a site the user turned off (also left out so the block is not even built there).
  const xidWant = await xidActRules(cx);
  // one rule per blocked host, anchored on the whole host name: the host itself and nothing above, below or beside it (L1)
  await learnedRules([...stopped.filter(isHost).slice(-STOPPED_MAX).map((h, i) => ({ id: BLOCKED + i, priority: 1, action: { type: 'block' },
    condition: { regexFilter: `^(https?|wss?)://([^/?#@]*@)?${h.toLowerCase().replace(/[.\-]/g, '\\$&')}\\.?(:[0-9]+)?([/?#]|$)`, domainType: 'thirdParty', resourceTypes: TYPES, excludedInitiatorDomains: SIGNIN_HOSTS } })),
    // C26: a page telling another company what was pressed or how long it was read (the request kind "ping")
    ...(!pings ? [] : [{ id: LEARNED + 3, priority: 1, action: { type: 'block' },
      condition: { resourceTypes: ['ping'], domainType: 'thirdParty', excludedInitiatorDomains: SIGNIN_HOSTS, excludedRequestDomains: SIGNIN_HOSTS } }]),
    ...xidWant,
    // S8: no calls from a page to this computer (net-rules.js)
    ...netRules({ local: BLOCK && can('C31', cx), self: chrome.runtime.id })]);
  // S4, S5: what other companies get less of; left alone: sign-in hosts, the companies pages need, the sites cleaning is off for,
  // and, while the sign-in guard holds, the tabs a sign-in page was seen in (session rules: only those can name tabs)
  try {
    const guardTabs = mayRun('C19', cx.set) === 'run' ? cx.tabs.filter((t) => isGuardSignIn(t.url || t.pendingUrl)).map((t) => t.id).sort((a, b) => a - b) : [];   // only while a tab is on a shipped sign-in host (L4)
    const want = netRules({ cookies: BLOCK && can('C29', cx), tags: BLOCK && can('C30', cx), exempt: [...SIGNIN_HOSTS, 'github.com', ...NEEDED.filter((d) => d !== 'googleapis.com'), ...GOOGLE_APIS, ...(cx.set.sitesOff || [])], guardTabs });
    await installEach('session', (o) => chrome.declarativeNetRequest.updateSessionRules(o), (r) => r.id >= NET_BASE && r.id < NET_BASE + 10, want); } catch {}
  // what skip.js reads: the passing sites (none while paused, switched off or during a sign-in) and the sites not to touch
  const { skipok = [], noskip = [], skip: was } = await chrome.storage.local.get(['skipok', 'noskip', 'skip']);
  // only the hosts the user chose with "Skip it next time?" (`skipok`): never one that was only learned (J4), and there is no
  // shipped list (L6: skipping a site's own link check, such as l.facebook.com, takes away a warning that site gives)
  const skip = { sites: can('C27', cx) ? skipok.filter((s) => !noskip.includes(s)) : [], off: cx.set.sitesOff || [] };
  if (JSON.stringify(skip) !== JSON.stringify(was)) await chrome.storage.local.set({ skip });
  try { const there = await chrome.scripting.getRegisteredContentScripts(), have = there.map((x) => x.id);
    const want = [...(yt ? [YT_JS, YT_CSS] : []), ...(pings ? [NO_PING] : []), ...(mayRun('C27', cx.set) === 'run' && !cx.hold.paused ? [SKIP] : []), ...(can('C32', cx) ? [SHIELD((cx.set.sitesOff || []).filter(isHost))] : [])], same = (x) => there.some((y) => y.id === x.id && JSON.stringify(y.excludeMatches || []) === JSON.stringify(x.excludeMatches || [])),
      drop = have.filter((id) => !want.some((x) => x.id === id && same(x))), add = want.filter((x) => !same(x));   // one whose left-alone list changed is put in anew
    if (drop.length) await chrome.scripting.unregisterContentScripts({ ids: drop });
    if (add.length) await chrome.scripting.registerContentScripts(add); } catch {}
}

// undo false: a blacklisted cookie is not kept for Undo, restoring it would only see it removed again
async function remove(c, undo = true) {
  const url = (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path;
  const d = { url, name: c.name, storeId: c.storeId }; if (c.partitionKey) d.partitionKey = c.partitionKey;
  try { if (!(await chrome.cookies.remove(d))) return false; } catch { return false; }
  if (undo) await undoWrite((buf) => undoKeep(buf, c, Date.now()));
  await serial(async () => { const { loops } = await chrome.storage.local.get('loops'); await chrome.storage.local.set({ loops: loopNote(loops, loopKey(c), Date.now()) }); });
  return true;
}

async function allCookies() { try { return await chrome.cookies.getAll({ partitionKey: {} }); } catch { return chrome.cookies.getAll({}); } }

// The sweep acts where the gate says 'run' and collects in `wait` what got 'ask' or 'held'. Afterwards the queue
// holds exactly what waits now: a held item whose hold has ended was carried out above, a cookie that has gone
// or a group since switched off is forgotten.
// One sweep at a time. A request while one runs waits for it and then runs one more, shared by every request
// that came in meanwhile: the caller's change (a setting, a new blacklist) is then certainly seen.
let sweeping = null, sweepNext = null;
function sweep(cause) {
  if (!sweeping) return (sweeping = sweepOnce(cause).catch(() => {}).then(() => { sweeping = null; }));
  return sweepNext || (sweepNext = sweeping.then(() => { sweepNext = null; return sweep(cause); }));
}
async function sweepOnce(cause) {
  await refreshBlacklist(); await purgeUndo();
  const cx = await context(), all = await allCookies(), removed = [], gone = [], wait = [];
  for (const c of all) { const [r, v, why] = judge(c, cx);
    if (v === 'run') { if (await remove(c, r !== 'blacklist')) { removed.push(`${realHost(c.domain)} ${c.name}`); gone.push(cookieItem(c, r)); } }
    else if (waits(v)) wait.push(cookieItem(c, r, v, why)); }
  await logged(gone, 'removed'); await copiesOf(gone.filter((it) => it.cap === 'C03' && isTrackerHost(realHost(it.site))).map((it) => it.site), cx);
  const kept = all.filter((c) => KEEP_RE.test(c.name)).map((c) => `${realHost(c.domain)} ${c.name}`);
  if (can('C15', cx)) selfUpdate();
  const rest = { ...(await enforceTabs(cx, wait)), ...(await forgetServers(cx, wait)), ...(await applyPermanentDrops(cx, wait)) };
  await wifiSweep(cx, wait); await followSweep(cx, all, wait); await bounceSweep(cx, wait, all); await ownSweep(cx, wait); await historySweep(cx);
  const xid = await xidSweep(cx);
  if (xid.changed) await applyFeatures();   // a newly confirmed cross-site id: install (or lift) its block and strip rules now (M2)
  const xidC = await xidClean(cx, all);     // delete a cookie whose value carries a confirmed cross-site id (M2)
  const xidS = await xidSetClean(cx, all);  // delete the cookies a confirmed first-party collector path was seen setting (N2)
  // M6: first-party address/referrer collection the cleaner cannot stop without breaking the site -- reported honestly
  const cannot = mayRun('C33', cx.set) === 'no' ? 0 : Object.keys((await chrome.storage.session.get('xcannot')).xcannot || {}).length;
  const now = new Set(wait.map(queueKey));
  await queueUp(wait, (it) => now.has(queueKey(it)));
  await report({ reason: cause, scanned: all.length, removed, kept, ...rest, ...(xid.crossIds ? { crossIds: xid.crossIds } : {}), ...xidC, ...xidS, ...(cannot ? { cannotStop: cannot, cannotNote: "cannot stop (the site's own server)" } : {}) });
}

// ---- Trackers on no list (C25, learn.js). Every request a page makes to another company is counted, privately: on
// how many sites was that company seen. Seen on FOLLOW_N sites and able to recognise the user (a cookie of its own that
// other sites can use), or handed a visited site's own ID and answering with such a cookie (S6), it is stopped, or on
// "Ask first" offered: "X followed you on 2 sites. Stop it?". Stopped = blocked when
// another site asks for it (one dynamic rule, above LEARNED; the rules below it are siteOff's), its cookies deleted,
// and from then on judged like a listed tracker (core.js EXTRA). Never learned: a company people sign in with.
const LEARNED = 100000, TYPES = ['script', 'xmlhttprequest', 'image', 'ping', 'sub_frame', 'media', 'other', 'websocket', 'font', 'stylesheet'];
// Cross-site-id stripping (C33, M2) also cleans navigations, so a hand-off link carrying the id is cleaned: main_frame on top of TYPES.
const STRIP_TYPES = ['main_frame', ...TYPES];
// A rule as one text, whatever order its fields come in: Chrome hands a rule back with its fields in its own order, so
// comparing the plain texts never found "nothing changed" and the session rules were taken out and put back at every
// look (P1, 1.29: a request to another company that fell into that gap kept its cookies).
const ordered = (v) => Array.isArray(v) ? v.map(ordered) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, ordered(v[k])])) : v;
const sig = (r) => JSON.stringify(ordered(r));
async function learnedRules(want) {
  try { await installEach('dynamic', (o) => chrome.declarativeNetRequest.updateDynamicRules(o), (r) => r.id > LEARNED, want); } catch {}
}
// Chrome refuses a whole change when it refuses one rule, so every rule is installed on its own (H6): one bad rule cannot
// take the others down, and what could not be installed is named in the popup (`notWorking`) instead of looking switched on.
const REFUSED = { dynamic: new Set(), session: new Set() };
const BLOCKED = 101000;   // dynamic rule ids BLOCKED .. BLOCKED + 299: one per host the user blocked
// C33 (M2/M5): a confirmed cross-site id's collector-path blocks (XBLOCK..), URL/nav strip-redirects (XSTRIP..) and
// conditional-header strips for an id-bearing ETag resource (XETAG..)
const XBLOCK = 102000, XSTRIP = 102400, XETAG = 102800;
const RULE_NAME = (id) => id >= XETAG ? 'Cross-site code cache tags stripped' : id >= XSTRIP ? 'Cross-site codes stripped from links' : id >= XBLOCK ? 'Cross-site code collectors blocked'
  : id >= BLOCKED ? 'Hosts you blocked' : id === LEARNED + 3 ? 'Pings are blocked'
  : id >= NET_BASE + 10 ? 'Pages may not call this computer' : 'Other companies get no cookies or cache tags';
// One change at a time per kind (two at once would trip over each other's rule numbers); what counts as refused is what
// is not there afterwards, read back from Chrome.
const installing = { dynamic: Promise.resolve(), session: Promise.resolve() };
// What is there is read inside the turn, not before it: of two changes asked for at nearly the same moment the later one
// decides (L4: the earlier one could otherwise be installed last and stay).
// P1 (1.29): a rule that is there as wanted is not touched; with nothing to change no call is made. A change is ONE call
// that removes and adds together (Chrome applies one call whole), so no rule is ever absent in between. Only when Chrome
// refuses that call (it refuses a whole change for one bad rule, H6): the rules no longer wanted go, and each changed
// rule is swapped in a call of its own that removes the old one and adds the new one together, so a refused rule
// leaves the working one it was to replace in place. Refused = not there as wanted afterwards, read back from Chrome.
const installEach = (kind, update, mine, want) => (installing[kind] = installing[kind].catch(() => {}).then(async () => {
  const read = async () => (await (kind === 'dynamic' ? chrome.declarativeNetRequest.getDynamicRules() : chrome.declarativeNetRequest.getSessionRules())).filter(mine);
  const cur = await read(), there = new Map(cur.map((r) => [r.id, sig(r)])), ids = new Set(want.map((r) => r.id));
  const change = want.filter((r) => there.get(r.id) !== sig(r)), stale = cur.map((r) => r.id).filter((id) => !ids.has(id));
  const swap = (rules, gone = []) => update({ removeRuleIds: [...gone, ...rules.filter((r) => there.has(r.id)).map((r) => r.id)], addRules: rules });
  if (change.length || stale.length) try { await swap(change, stale); }
    catch { if (stale.length) try { await update({ removeRuleIds: stale }); } catch {}
      for (const r of change) try { await swap([r]); } catch {} }
  const have = new Set((change.length || stale.length ? await read() : cur).map(sig)), names = new Set([...cur, ...want].map((r) => RULE_NAME(r.id)));
  REFUSED[kind] = new Set([...[...REFUSED[kind]].filter((n) => !names.has(n)), ...want.filter((r) => !have.has(sig(r))).map((r) => RULE_NAME(r.id))]); }));
const notWorking = () => [...new Set([...REFUSED.dynamic, ...REFUSED.session])];
// "Not now" on one question (site and name) or on all about a site: not asked again for LATER_MS
const later = (cx, id, site, name) => [`${id} ${site}`, `${id} ${site} ${name}`].some((k) => (cx.set.later || {})[k] > Date.now());
async function notNow(m) {
  const g = GROUPS.find((x) => x.id === m.group), now = Date.now();
  if (!g || typeof m.site !== 'string' || !m.site) return { ok: false };
  const old = Object.entries((await chrome.storage.local.get('later')).later || {}).filter(([, t]) => t > now);
  const ms = m.name === USED ? 3650 * 86400e3 : LATER_MS;   // "Keep" on a company the user also uses is asked once, not every week
  await chrome.storage.local.set({ later: Object.fromEntries([...old, ...g.caps.map((id) => [`${id} ${m.site}${typeof m.name === 'string' ? ' ' + m.name : ''}`, now + ms])].slice(-500)) });
  if (g.caps.some((id) => cap(id).answers)) await noAuto(m.site);
  await sweep('settings');
  return { ok: true };
}
// Sites the user opens as pages themselves: a short hash each, made with a random value of this install (`salt`), never
// the name; the MINE_MAX opened last, emptied by "Clear history". The user may be signed in there, so nothing
// automatic deletes such a site's cookies or empties what it saved: it is only blocked elsewhere. A page counts when
// its tab is still on that site MINE_WAIT_MS later: one that passes the browser straight on cannot put itself here.
const MINE_MAX = 2000, MINE_SHARED = 50, MINE_WAIT_MS = 3000;
// the random value of this install that every stored hash of a site name is made with
// P2 (1.29): made exactly once. Everyone who asks while it is being read or made waits for that same answer; before, the
// first requests of a fresh install each found none and each wrote one, and one visited site got two different marks.
// The slot is cleared by .finally, which always runs after it was filled (a try/finally inside would run first when the
// read throws at once, and the failure would then be kept for good).
let salting = null;
const saltNow = () => salting || (salting = (async () => { let { salt } = await chrome.storage.local.get('salt');
  if (!salt) await chrome.storage.local.set({ salt: salt = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('') });
  return salt; })().finally(() => { salting = null; }));
function visited(cx, site) { const m = mark(`${cx.set.salt} ${site}`); return !!cx.set.salt && ((cx.set.mine || []).includes(m) || (cx.set.mineShared || []).includes(m)); }
async function notePage(d) {
  if (d.type !== 'main_frame' || !(d.statusCode >= 200 && d.statusCode < 300) || !(d.tabId >= 0)) return;
  let u; try { u = new URL(d.url); } catch { return; }
  const site = siteOf(u.hostname);
  if (/^[0-9.]+$/.test(u.hostname) || u.hostname.includes(':') || u.hostname.includes('[')) return;   // a number, not a name: never on the list (J6)
  if (/^https?:$/.test(u.protocol)) setTimeout(async () => {
    const tab = await chrome.tabs.get(d.tabId).catch(() => null);
    if (!tab || siteOf(hostOf(tab.url)) !== site) return;
    // a page under a shared name (pages.dev and the like, where anyone can have a host) goes on a list of its own of
    // MINE_SHARED places, so that such pages together can never push a real site off the list (L5)
    const key = SHARED.some((x) => site.endsWith('.' + x)) ? 'mineShared' : 'mine', max = key === 'mine' ? MINE_MAX : MINE_SHARED;
    await serial(async () => { const salt = await saltNow(), list = (await chrome.storage.local.get(key))[key] || [], m = mark(`${salt} ${site}`);
      if (list.at(-1) !== m) await chrome.storage.local.set({ [key]: [...list.filter((x) => x !== m), m].slice(-max) }); }); }, MINE_WAIT_MS);
}
try { chrome.webRequest.onCompleted.addListener((d) => { notePage(d); }, { urls: ['<all_urls>'], types: ['main_frame'] }); } catch {}
const signInCompany = (site) => site === 'github.com' || isGoogleHost(site) || NEEDED.includes(site) || SIGNIN_HOSTS.some((h) => siteOf(h) === site);
const seen = new Set();   // what this worker has counted already, so that a page's hundred requests cost one look
// The site a sighting is counted for is the one the user has in the tab (its address bar), never the frame that asked:
// one page cannot stand for three sites by holding three frames. A request that belongs to no tab is not counted.
// For a request of the page itself (frame 0) that site is the page that asks, as Chrome hands it over with the request;
// for a frame's request it is the tab's address, asked of Chrome at that moment. Nothing is remembered between requests
// (K3): a remembered tab address was sometimes the address before, or none yet, when the first requests of a new page
// came in ahead of the news that the tab had moved, and those requests were then counted for the wrong site or not at all.
const topSite = async (d) => siteOf(hostOf(d.frameId === 0 && d.initiator ? d.initiator : ((await chrome.tabs.get(d.tabId).catch(() => null)) || {}).url));
// for counting visited sites, every tenant of one shared name (two pages on github.io) is the same site: two of them never add up
const tabKey = (page) => SHARED.find((s) => page.endsWith('.' + s)) || page;
// At most NEW_HOUR companies are noted for the first time per visited site in an hour (in memory): a page that asks hundreds
// of made-up hosts cannot fill the list. followStore gives the list, or null when this one may not be added now.
const NEW_HOUR = 20;
// F6 (1.32): every per-page hourly cap (NEW_HOUR `fresh`, ASK_HOUR `asked`, XNEW_HOUR `xnew`) is kept in chrome.storage.session
// (memory, gone when Chrome closes), not in this worker's memory: Chrome puts the worker to sleep after a short idle time,
// and a cap that started again at every wake-up was no cap. Called inside serial() only, so a count is never lost.
// `key`: the session entry; one { t, n } per page, at most 500 pages (the hour started longest ago goes first).
async function hourCap(key, page, max) { const now = Date.now(); let m = {};
  try { m = (await chrome.storage.session.get(key))[key] || {}; } catch {}
  const e = m[page], ok = !e || e.t < now - 3600e3 ? !!(m[page] = { t: now, n: 1 }) : ++e.n <= max;
  const ks = Object.keys(m); if (ks.length > 500) for (const k of ks.sort((a, b) => m[a].t - m[b].t).slice(0, ks.length - 500)) delete m[k];
  try { await chrome.storage.session.set({ [key]: m }); } catch {}
  return ok; }
// Questions (L5): a candidate may be asked about only when it is marked `q`, and a visited site can mark at most ASK_HOUR
// of them in an hour (in memory), so one page cannot fill the list of questions; at most QUESTIONS_MAX wait at a time.
const ASK_HOUR = 2, QUESTIONS_MAX = 20;
const mayAsk = (page) => hourCap('asked', page, ASK_HOUR);
async function followStore(site, page) { const { follow = {} } = await chrome.storage.local.get('follow');
  if (follow[site]) return follow;
  return await hourCap('fresh', page, NEW_HOUR) ? follow : null; }
async function noteRequest(d) {
  if (d.type === 'main_frame' || !(d.tabId >= 0)) return;
  let u; try { u = new URL(d.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol)) return;
  // co: the company, to tell "another company" from the site's own hosts. site: the exact host; everything learned and
  // blocked is kept per exact host, never per company or per shared name (J2)
  const co = siteOf(u.hostname), site = u.hostname.toLowerCase(), page = await topSite(d), key = `${u.host} ${page}`;   // an ID in the address is no evidence (anyone can write one): followSweep asks for a real cookie
  if (!page || co === page || isSignIn(d.url) || isTrackerHost(u.hostname) || signInCompany(co)) return;
  // S6: does this request hand the company the ID that the visited site keeps for the user (address or what is sent)?
  let sent = false;
  if (!handed.has(`${site} ${page}`)) try { const ids = await ownIds(page);
    sent = ids.size > 0 && carries(ids, safeDecode(d.url) + ' ' + bodyText(d.requestBody), SYNC_SALT);
    if (sent) { if (handed.size > 2000) handed.clear(); handed.add(`${site} ${page}`); } } catch {}
  if (seen.has(key) && !sent) return;
  if (seen.size > 5000) seen.clear();
  seen.add(key); await ready;
  if (mayRun('C25', await chrome.storage.local.get(['master', 'modes', 'level'])) === 'no') return;
  let full = false; const salt = await saltNow();
  await serial(async () => { const st = await followStore(site, page), next = st && followNote(st, site, u.host, `${salt} ${tabKey(page)}`, false, Date.now(), sent);
    if (next) { full = followFull(next[site]); if (full && next[site].q !== true && await mayAsk(page)) next[site] = { ...next[site], q: true };
      await chrome.storage.local.set({ follow: next }); } });
  if (full) sweep('learned');
}
// What S6 compares, all in memory: hashes of the ID-like parts of the visited site's own script-readable cookies (asked
// of Chrome at most every 5 seconds per site, and again when one of its cookies changes), and the request's address and
// body cut to 16000 characters. Neither is stored, logged or sent anywhere.
const SYNC_SALT = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join(''), pageIds = new Map(), handed = new Set();
async function ownIds(page) { let e = pageIds.get(page);
  if (!e || e.t < Date.now() - 5000) { if (pageIds.size > 50) pageIds.clear(); e = { t: Date.now(), set: idHashes(await chrome.cookies.getAll({ domain: page }), SYNC_SALT) }; pageIds.set(page, e); }
  return e.set; }
chrome.cookies.onChanged.addListener(({ cookie }) => { pageIds.delete(siteOf(bare(cookie.domain))); });
const safeDecode = (s) => { s = String(s).slice(0, 16000); try { return decodeURIComponent(s); } catch { return s; } };
const bodyText = (b) => { if (!b) return ''; let out = Object.values(b.formData || {}).flat().join(' ').slice(0, 16000);
  for (const part of b.raw || []) { if (out.length >= 16000 || !part.bytes) break; out += ' ' + new TextDecoder().decode(new Uint8Array(part.bytes).subarray(0, 16000 - out.length)); }
  return out; };
// The company's answer: does it try to set a cookie with an ID that other sites can use? Kept as a yes or no (`ck`). With
// S4 such a cookie is no longer saved, so Chrome's cookie list alone would never show it.
async function noteAnswer(d) {
  if (d.type === 'main_frame' || !(d.tabId >= 0)) return;
  // F9 (1.32): never a load-balancer or bot-protection cookie (lists.js INFRA_COOKIE_RE): those are set by sites that track nobody
  const ok = (d.responseHeaders || []).some((h) => { if (String(h.name).toLowerCase() !== 'set-cookie') return false;
    return String(h.value).split('\n').some((line) => { const [pair] = line.split(';'), eq = pair.indexOf('=');
      return eq > 0 && /;\s*samesite=none/i.test(line) && !INFRA_COOKIE_RE.test(pair.slice(0, eq).trim()) && idLike(pair.slice(eq + 1)); }); });
  let u; try { u = new URL(d.url); } catch { return; }
  if (!ok || !/^https?:$/.test(u.protocol)) return;
  const co = siteOf(u.hostname), site = u.hostname.toLowerCase(), page = await topSite(d);
  if (!page || co === page || isSignIn(d.url) || isTrackerHost(u.hostname) || signInCompany(co)) return;
  await ready;
  if (mayRun('C25', await chrome.storage.local.get(['master', 'modes', 'level'])) === 'no') return;
  let full = false; const salt = await saltNow();
  await serial(async () => { const st = await followStore(site, page), next = st && followNote(st, site, u.host, `${salt} ${tabKey(page)}`, true, Date.now());
    if (next) { full = followFull(next[site]); if (full && next[site].q !== true && await mayAsk(page)) next[site] = { ...next[site], q: true };
      await chrome.storage.local.set({ follow: next }); } });
  if (full) sweep('learned');
}
// ---- Cross-site identifiers (1.26, C33). Orthogonal to first/third party: a high-entropy VALUE the cleaner sees SENT
// by two or more DIFFERENT registrable sites the user actually visited is a cross-site tracking id, whoever serves it.
// This catches a first-party reverse-proxy collector that carries one id across sites with no third-party signal: the
// cleaner reacts to the VALUE, not the host. What it observes is kept in chrome.storage.session (memory), never in
// storage.local, the log, the queue or a report: xseen { tokHash: { raw, sites: { siteHash }, eps: { 'host/prefix': fp },
// t } } and, once confirmed, xsid { tokHash: { raw, eps: [first-party only], n } }. A value counts for a site only where
// the cleaner saw that site's OWN page send it -- a sub-resource it asked for, never the address bar -- so a value an
// attacker merely reflects into a victim's address is not attributed to the victim; and both sites must be in `mine`.
// M8: an endpoint is actionable (blocked) only where it is FIRST-PARTY to a sending site (eps[ep] === true); a value
// being cross-site never entitles the cleaner to block an unrelated host it was merely sent to. The token
// hash uses a per-session salt kept beside xseen so the hashes stay stable while the worker sleeps. Caps: at most
// XSEEN_MAX tokens tracked, XNEW_HOUR new per visited site per hour; a value seen 3 s after a scripted hand-off still
// counts, because there is no timing gate. M1 only detects and reports; stripping and blocking are C33's job (M2).
const XSEEN_MAX = 50, XNEW_HOUR = 10;   // session `xnew` (hourCap): per visited site, tokens new to the detector this hour
async function xidSalt() { let { xsalt } = await chrome.storage.session.get('xsalt');
  if (!xsalt) { xsalt = [...crypto.getRandomValues(new Uint8Array(8))].map((x) => x.toString(16).padStart(2, '0')).join(''); await chrome.storage.session.set({ xsalt }); }
  return xsalt; }
// Record id-like tokens a page sent (or that rode its ETag): the site that sent each, the endpoint it went to, and -- for
// an ETag (M5) -- the exact resource. Per-page hourly cap of new tokens; at most XSEEN_MAX tracked.
// `fp` (first-party): the endpoint/ETag resource is served under the SENDING site's own name. Only first-party endpoints
// are ever blocked (M8): a value being cross-site does not entitle the cleaner to block an UNRELATED host it was merely
// sent to -- that would let a script on two of the user's sites block any endpoint it chooses. A first-party collector
// (Friendface 2) is exactly the case the structural rules cannot reach, so that is the one C33 acts on.
async function xidObserve(page, toks, ep, fp, etagRes) {
  const salt = await saltNow(), xs = await xidSalt(), siteHash = mark(`${salt} ${page}`);
  const setFp = (map, key) => { if (!(key in map)) { map[key] = !!fp; return true; } if (fp && map[key] !== true) { map[key] = true; return true; } return false; };
  await serial(async () => { const xseen = (await chrome.storage.session.get('xseen')).xseen || {}, now = Date.now(); let changed = false;
    for (const tok of toks) { const k = tokHash(xs, tok), e = xseen[k];
      if (e) { if (!e.sites[siteHash]) { e.sites[siteHash] = true; changed = true; } if (ep && setFp(e.eps, ep)) changed = true;
        if (etagRes) { if (!e.etag) e.etag = {}; if (setFp(e.etag, etagRes)) changed = true; } e.t = now; continue; }
      // a token new to this worker: it costs the site one of its XNEW_HOUR new tokens an hour, and at most XSEEN_MAX are kept
      if (!(await hourCap('xnew', page, XNEW_HOUR))) continue;
      const ks = Object.keys(xseen); if (ks.length >= XSEEN_MAX) delete xseen[ks.sort((a, b) => xseen[a].t - xseen[b].t)[0]];
      xseen[k] = { raw: tok, sites: { [siteHash]: true }, eps: ep ? { [ep]: !!fp } : {}, ...(etagRes ? { etag: { [etagRes]: !!fp } } : {}), t: now }; changed = true; }
    if (changed) await chrome.storage.session.set({ xseen }); });
}
async function noteSent(d) {
  if (d.type === 'main_frame' || !(d.tabId >= 0)) return;   // not the address bar: only what a page itself sends counts
  let u; try { u = new URL(d.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || isSignIn(d.url)) return;   // never a sign-in return address (the never-cut list is M3)
  const page = await topSite(d);
  if (!page) return;
  await ready;
  if (mayRun('C33', await chrome.storage.local.get(['master', 'modes', 'level'])) === 'no') return;
  const toks = idTokens(safeDecode(d.url) + ' ' + bodyText(d.requestBody));
  if (toks.length) await xidObserve(page, toks, (u.host + pathPrefix(u.pathname)).toLowerCase(), siteOf(u.hostname) === page);
}
// M5 (F10): an ETag carries an id the browser echoes back as If-None-Match on revalidation. Feed its id-like tokens into
// the same detector (so an ETag reused across sites is caught) and remember the exact resource, so that once the token is
// confirmed cross-site the conditional headers are stripped for THAT resource only (caching for everything else stays).
async function noteEtag(d) {
  if (d.type === 'main_frame' || !(d.tabId >= 0)) return;
  let u; try { u = new URL(d.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || isSignIn(d.url)) return;
  const tag = (d.responseHeaders || []).find((h) => String(h.name).toLowerCase() === 'etag');
  const toks = tag ? idTokens(String(tag.value)) : [];
  if (!toks.length) return;
  const page = await topSite(d);
  if (!page) return;
  await ready;
  if (mayRun('C33', await chrome.storage.local.get(['master', 'modes', 'level'])) === 'no') return;
  await xidObserve(page, toks, (u.host + pathPrefix(u.pathname)).toLowerCase(), siteOf(u.hostname) === page, (u.host + u.pathname).toLowerCase());
}
// M6 (F8): first-party address/referrer collection -- the page posting its own URL (and referrer) to its OWN server.
// This cannot be blocked without breaking the site, and no other company is involved, so the cleaner does NOT fake a
// win: when it is not going to a cross-site collector the cleaner is already blocking, it records the site (a salted
// hash, capped, never the name) so the sweep report can say, honestly, "cannot stop (the site's own server)".
async function noteOwnCollect(d) {
  if (d.type === 'main_frame' || !(d.tabId >= 0) || d.frameId !== 0) return;
  if (d.method !== 'POST' && !['ping', 'csp_report'].includes(d.type)) return;
  let u; try { u = new URL(d.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || isSignIn(d.url)) return;
  const page = await topSite(d);
  if (!page || siteOf(u.hostname) !== page || signInCompany(page)) return;   // the site's OWN server only (first-party)
  // the signal is the page's own address carried IN the body or a query value (location.href/referrer) -- not the
  // request's own path, which is same-origin for any first-party request and would match everything.
  const origin = d.initiator;
  if (!origin || !(safeDecode(u.search) + ' ' + bodyText(d.requestBody)).includes(origin)) return;
  await ready;
  if (mayRun('C33', await chrome.storage.local.get(['master', 'modes', 'level'])) === 'no') return;
  const ep = (u.host + pathPrefix(u.pathname)).toLowerCase();
  const confirmed = Object.values((await chrome.storage.session.get('xsid')).xsid || {}).some((e) => (e.eps || []).includes(ep));
  if (confirmed) return;   // this endpoint is a cross-site collector the cleaner is blocking (M2), not a "cannot"
  const salt = await saltNow(), h = mark(`${salt} ${page}`);
  await serial(async () => { const xcannot = (await chrome.storage.session.get('xcannot')).xcannot || {};
    if (xcannot[h]) return; const ks = Object.keys(xcannot); if (ks.length >= 200) delete xcannot[ks[0]];
    xcannot[h] = true; await chrome.storage.session.set({ xcannot }); });
}
// At each sweep: a token SENT by two or more sites that are both in `mine` is confirmed a cross-site id. Re-checked
// every sweep, so a site added to `mine` after the value was first seen still counts. Records the confirmation
// (session `xsid`) and counts it for the report; acting on it (M2) reads the same `xsid`.
async function xidSweep(cx) {
  if (mayRun('C33', cx.set) === 'no') return {};
  let n = 0, changed = false;
  await serial(async () => { const xseen = (await chrome.storage.session.get('xseen')).xseen || {}, was = (await chrome.storage.session.get('xsid')).xsid || {}, xsid = {};
    const ours = (h) => (cx.set.mine || []).includes(h) || (cx.set.mineShared || []).includes(h);
    for (const [k, e] of Object.entries(xseen)) { const sites = Object.keys(e.sites).filter(ours);
      // Only FIRST-PARTY endpoints/ETags are actionable (M8): a cross-site value may be blocked/stripped at a collector
      // only where it is served under a site's own name, never at an unrelated host it was merely sent to.
      if (sites.length >= 2) { const eps = Object.keys(e.eps).filter((x) => e.eps[x] === true), etag = e.etag ? Object.keys(e.etag).filter((x) => e.etag[x] === true) : [];
        xsid[k] = { raw: e.raw, eps, ...(etag.length ? { etag } : {}), n: sites.length }; } }
    n = Object.keys(xsid).length; changed = JSON.stringify(xsid) !== JSON.stringify(was);
    if (changed) await chrome.storage.session.set({ xsid }); });
  return { ...(n ? { crossIds: n } : {}), changed };
}
// The dynamic rules C33 installs for the confirmed cross-site ids (read by applyOnce). Behind the master switch and
// held while paused or a sign-in is going on (`can`). Vets the collector endpoints: never a sign-in host or company,
// and never a site the user turned off. Caps mirror the detector: at most 50 tokens, their endpoints de-duplicated.
// never a sign-in host or company, never a site the user turned off (shared by the rules and by N2's cookie delete)
const xidOkHost = (cx) => { const off = (cx.set.sitesOff || []).filter(isHost);
  return (host) => { const bareHost = host.replace(/:\d+$/, ''), site = siteOf(bareHost);
    return !signInCompany(site) && !SIGNIN_HOSTS.some((h) => under(bareHost, h)) && !off.some((o) => under(bareHost, o)); }; };
async function xidActRules(cx) {
  if (!can('C33', cx)) return [];
  const { xsid = {} } = await chrome.storage.session.get('xsid');
  const vals = Object.values(xsid); if (!vals.length) return [];
  const off = (cx.set.sitesOff || []).filter(isHost), okHost = xidOkHost(cx);
  const eps = [...new Set(vals.flatMap((e) => e.eps))].filter((ep) => okHost(ep.split('/')[0])).slice(0, 60);
  const toks = [...new Set(vals.map((e) => e.raw))].slice(0, 50);
  const etags = [...new Set(vals.flatMap((e) => e.etag || []))].filter((r) => okHost(r.split('/')[0])).slice(0, 40);   // M5
  return xidRules({ eps, toks, etags, block: XBLOCK, strip: XSTRIP, etag: XETAG, signin: SIGNIN_HOSTS, off, blockTypes: TYPES, stripTypes: STRIP_TYPES });
}
// Delete a cookie whose value carries a confirmed cross-site id (M2). Targeted by value, so it can be undone; never a
// sign-in cookie (KEEP or http-only+secure) and never a site the user turned off. Storage that holds the id cannot be
// cut to one key without wiping the site, so it is left (the collector-path block stops the id being sent); the report
// says so where that is all that remains.
async function xidClean(cx, all) {
  if (!can('C33', cx)) return {};
  const vals = Object.values((await chrome.storage.session.get('xsid')).xsid || {}), toks = vals.map((e) => e.raw);
  if (!toks.length) return {};
  // Only on a site that is itself a confirmed FIRST-PARTY collector -- its own name serves a blocked endpoint (M8). A
  // cross-site value turning up inside an unrelated site's cookie (a shared build hash, a coincidence) is never grounds
  // to delete that cookie. Never a sign-in cookie, a site the user turned off, or a cookie the user keeps (allow, unless
  // always-delete); deletions go to the 10-minute undo buffer.
  const cols = new Set(vals.flatMap((e) => e.eps).map((ep) => siteOf(ep.split('/')[0].replace(/:\d+$/, ''))));
  if (!cols.size) return {};
  const gone = [];
  for (const c of all) { if (xidSpares(cx, c) || guarded(cx, siteOf(realHost(c.domain)))) continue;   // 1.30: not during that site's sign-in hold
    if (!cols.has(siteOf(realHost(c.domain)))) continue;
    if (toks.some((t) => String(c.value).includes(t)) && await remove(c)) gone.push({ cap: 'C33', kind: 'cookie', site: bare(c.domain), name: c.name, why: 'a cross-site code' }); }
  await logged(gone, 'removed');
  return gone.length ? { crossIdCookies: gone.length } : {};
}
// ---- N2 (1.28, C33): the first-party ID cookie that a confirmed collector path SET. A site's own reverse-proxy
// collector answers with Set-Cookie under the visited site's own name; M2/M8 block the path, but the cookie stayed and
// went on being sent to the site. So: (a) noteSetCookie keeps, per endpoint (host + path prefix, the detector's own key),
// the NAMES of the cookies a first-party sub-resource answer sets -- chrome.storage.session { xset: { '<host/prefix>':
// { t, names: [[name, domain]] } } }, memory only; never a value, never storage.local, the log, the queue or a report.
// `domain` is the Domain the cookie named ('' = the answering host alone), so the delete is exact. Not noted: a page
// address (main_frame), an answer from another company (the M8 rule: siteOf(host) === the tab's site), a sign-in address
// or company, the bare root, and any cookie that looks like a sign-in when it is set (a KEEP_RE name, or HttpOnly and
// Secure). Capped: XSET_NAMES per endpoint, XSET_SITE endpoints per site, XSET_EPS in all (the oldest go). (b) At the
// sweep, once such an endpoint is in a confirmed entry's first-party `eps`, exactly the cookies it was seen setting are
// deleted there, through remove() (10 minutes of Undo), each logged with one line; the endpoint's note is used up by
// that one pass, so the same name set later by something else is left alone (the collector path itself is blocked; if
// it is seen setting the cookie again, it is noted again). Never: a sign-in cookie, a cookie the user
// keeps, a site that is switched off, a sign-in company, a site whose sign-in page holds deleting, a partitioned
// cookie. (c) All of it behind can('C33'): main switch, the row's mode, pause.
const XSET_EPS = 50, XSET_SITE = 5, XSET_NAMES = 10;
const rootEp = (ep) => { const i = ep.indexOf('/'); return i < 0 || ep.slice(i) === '/'; };   // the bare site root: never acted on (M8)
// what no C33 cookie delete touches: a sign-in cookie, a cookie the user keeps (allow, unless always-delete), a site switched off
const xidSpares = (cx, c) => { const on = (list) => (list || []).some((a) => a.site === bare(c.domain) && a.name === c.name);
  return signinLike(c) || (!on(cx.set.always) && (KEEP_RE.test(c.name) || on(cx.set.allow))) || (cx.set.sitesOff || []).some((s) => under(realHost(c.domain), s)); };
async function noteSetCookie(d) {
  if (d.type === 'main_frame' || !(d.tabId >= 0)) return;
  let u; try { u = new URL(d.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || isSignIn(d.url)) return;
  const host = u.hostname.toLowerCase(), ep = (u.host + pathPrefix(u.pathname)).toLowerCase();
  if (rootEp(ep)) return;
  // a Domain must be the answering host or a name above it inside the same site (anything else the browser refuses)
  const set = setCookies(d.responseHeaders).filter((c) => !KEEP_RE.test(c.name) && !(c.httpOnly && c.secure) && (!c.domain || (isHost(c.domain) && under(host, c.domain) && siteOf(c.domain) === siteOf(host))));
  if (!set.length) return;
  const page = await topSite(d);
  if (!page || siteOf(host) !== page || signInCompany(page)) return;   // first-party to the page in the tab only
  await ready;
  if (mayRun('C33', await chrome.storage.local.get(['master', 'modes', 'level'])) === 'no') return;
  await serial(async () => { const xset = (await chrome.storage.session.get('xset')).xset || {}, had = (xset[ep] || {}).names || [], names = had.slice();
    for (const c of set) if (names.length < XSET_NAMES && !names.some((x) => x[0] === c.name && x[1] === c.domain)) names.push([c.name, c.domain]);
    if (names.length === had.length) return;
    delete xset[ep];
    const oldest = (keys) => keys.sort((a, b) => xset[a].t - xset[b].t)[0], ofSite = () => Object.keys(xset).filter((k) => siteOf(k.split('/')[0]) === page);
    while (ofSite().length >= XSET_SITE) delete xset[oldest(ofSite())];
    while (Object.keys(xset).length >= XSET_EPS) delete xset[oldest(Object.keys(xset))];
    xset[ep] = { t: Date.now(), names };
    await chrome.storage.session.set({ xset }); });
}
async function xidSetClean(cx, all) {
  if (!can('C33', cx)) return {};
  const okHost = xidOkHost(cx), eps = [...new Set(Object.values((await chrome.storage.session.get('xsid')).xsid || {}).flatMap((e) => e.eps))].filter((ep) => !rootEp(ep) && okHost(ep.split('/')[0]));
  if (!eps.length) return {};
  const { xset = {} } = await chrome.storage.session.get('xset'), gone = [], used = [];
  for (const ep of eps) { const host = ep.split('/')[0].replace(/:\d+$/, '');
    if (!xset[ep] || guarded(cx, siteOf(host))) continue;
    used.push(ep);   // acted on once: whatever is spared or already gone now is not come back for
    for (const [name, dom] of xset[ep].names) for (const c of all) {
      // exactly where it was set: for the answering host alone, or for the Domain it named
      if (c.name !== name || c.partitionKey || (dom ? c.hostOnly !== false || bare(c.domain) !== dom : c.hostOnly !== true || bare(c.domain) !== host)) continue;
      if (xidSpares(cx, c) || !(await remove(c))) continue;
      gone.push({ cap: 'C33', kind: 'cookie', site: bare(c.domain), name: c.name, why: 'set by a cross-site collector' }); } }
  if (used.length) await serial(async () => { const now = (await chrome.storage.session.get('xset')).xset || {};
    for (const ep of used) delete now[ep];
    await chrome.storage.session.set({ xset: now }); });
  await logged(gone, 'removed');
  return gone.length ? { collectorCookies: gone.length } : {};
}
try { chrome.webRequest.onBeforeRequest.addListener((d) => { noteRequest(d); noteSent(d); noteOwnCollect(d); }, { urls: ['<all_urls>'] }, ['requestBody']); } catch {}
try { chrome.webRequest.onHeadersReceived.addListener((d) => { noteAnswer(d); noteEtag(d); noteSetCookie(d); }, { urls: ['<all_urls>'] }, ['responseHeaders', 'extraHeaders']); } catch {}
// M3 (1.26, C33): strip a confirmed cross-site id from an in-page history pushState/replaceState
// (onHistoryStateUpdated) -- the one hand-off the DNR strip rules (M2) cannot see, because changing the address in
// script fires no request. The DNR rules already strip the id from EVERY network navigation (a link, a scripted
// location.assign, a meta refresh) on the wire before it commits, with no reload -- verified in the browser -- so
// there is nothing for this to add there, and rewriting those navigations from the worker only risks a reload that
// re-runs trackers and disturbs the walk. Never a sign-in page, a sign-in company, a site the user turned off, or a
// sign-in return-address parameter (stripNav keeps those whole). Behind the master switch; one log line the user sees.
async function xidNav(d) {
  if (d.frameId !== 0 || !(d.tabId >= 0)) return;
  let u; try { u = new URL(d.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol) || !u.search || isSignIn(d.url)) return;
  await ready;
  const cx = await context();
  if (!can('C33', cx) || signInCompany(siteOf(u.hostname)) || (cx.set.sitesOff || []).some((s) => under(u.hostname, s))) return;
  const toks = Object.values((await chrome.storage.session.get('xsid')).xsid || {}).map((e) => e.raw);
  const clean = stripNav(d.url, toks);
  if (!clean || clean === d.url) return;
  try { await chrome.tabs.update(d.tabId, { url: clean });
    await logged([{ cap: 'C33', kind: 'link', site: u.hostname, name: 'a cross-site code in the address', why: 'a hand-off' }], 'removed'); } catch {}
}
try { chrome.webNavigation.onHistoryStateUpdated.addListener((d) => { xidNav(d); }); } catch {}
// The principle (1.25, J1 and L1): what is learned from how pages behave only ever makes a question. Block (`stopped`) is
// the user's press; "Let it through again" undoes it. Then one more question, once (USED: Remove / Keep): Remove deletes
// what that host has saved now, once (hardClean). Keeping on removing is a switch per host (`hard`, keepRemoving).
// Built-in list entries are cleaned as before.
const USED = 'what it keeps to follow you';
async function followSweep(cx, all, wait) {
  const v = verdict('C25', cx), stopped = cx.set.stopped || [];
  if (v === 'no') return;
  // a cookie Chrome would send to that host; not one set for a whole shared name (a tenant can set that for every other tenant)
  const hasId = (site) => all.some((c) => under(site, bare(c.domain)) && !SHARED.includes(bare(c.domain)) &&
    (c.sameSite === 'no_restriction' || c.partitionKey) && !KEEP_RE.test(c.name) && !INFRA_COOKIE_RE.test(c.name) && idLike(c.value));   // F9: a load balancer's or bot check's cookie is no evidence
  const { follow = {}, hard = [] } = await chrome.storage.local.get(['follow', 'hard']), asks = [];
  for (const [site, e] of Object.entries(follow)) {
    // evidence: on FOLLOW_N sites, a cookie of its own that other sites can use (in Chrome's list, or tried in its answer);
    // on one site (`sent`), only its own answer counts. Whatever the evidence, it only ever makes a question (L1): a page
    // can stage all of it, so nothing is blocked before the user pressed Block.
    const many = e.on.length >= FOLLOW_N;
    if (stopped.includes(site) || !followFull(e) || e.q !== true || later(cx, 'C25', site) || !(e.ck || (many && hasId(site)))) continue;
    asks.push({ w: (e.sent ? 4 : 0) + (e.ck ? 2 : 0) + e.on.length, cap: 'C25', kind: 'tracker', site, name: many ? `followed you on ${FOLLOW_N} sites` : 'was handed the ID a site keeps for you', why: String(e.on.length), did: v === 'held' ? 'held' : 'queued' }); }
  // at most QUESTIONS_MAX such questions wait at a time: the ones with the most evidence (L5)
  // 1.30, Strongest ('yes'): a question the cleaner may answer itself (mayYes, one of STOPS_HOUR an hour) is answered at
  // once: blocked, and what it saved removed, as the presses on Block and Remove do; logged as done by itself (auto)
  const yes = answersYes('C25', cx.set, cx.hold);
  for (const { w, ...it } of asks.sort((a, b) => b.w - a.w).slice(0, QUESTIONS_MAX)) {
    if (yes && await yesNow(cx, it.site) && await stopTracker(it.site)) { const used = await hardClean(it.site, true);   // its saved copies: copiesNow, there
      await logged([{ ...it, auto: true }, ...(used ? [{ cap: 'C25', kind: 'used', site: it.site, name: USED, auto: true }] : [])], 'removed'); await noteAuto(it.site, 'unknown'); continue; }
    wait.push(it); }
  // a blocked host: the second question, once (USED: remove what it saved)
  for (const site of stopped) if (!hard.includes(site) && !later(cx, 'C25', site, USED)) {
    const it = { cap: 'C25', kind: 'used', site, name: USED, why: String(((follow[site] || {}).on || []).length), did: 'queued' };
    if (yes && await yesNow(cx, site) && await hardClean(site, true)) { await logged([{ ...it, auto: true }], 'removed'); await noteAuto(site, 'unknown'); continue; }
    wait.push(it); }
}
// ---- What the cleaner may answer yes by itself (Strongest), and what a press answers in bulk (Clean now). 1.31 (the
// owner's decision): a site the user opens, has open or seems signed in to is answered too, as a press would be; the
// removal keeps its sign-in-like and allowed cookies (`kept`), but what it saved in storage goes. Absolute, at every level:
// never a sign-in host or a company people sign in with (also never learned, noteRequest), never under a site the user
// switched off, nothing while a tab is on a sign-in host or that site's sign-in page holds deleting (the answer waits and
// is given at the sweep after the hold). By itself only: never a host the user let through or said "Not now" to (`unauto`);
// the user's own press still answers it.
const mayYes = (cx, site, press = false) => { const co = siteOf(site);
  return isHost(site) && !signInCompany(co) && !SIGNIN_HOSTS.some((h) => siteOf(h) === co) && !(cx.set.sitesOff || []).some((s) => under(site, s) || siteOf(s) === co)
    && !cx.signing && !guarded(cx, co) && (press || !unautoHas(cx, co)); };
// Q-batch F2 (1.32): `unauto` is kept per registrable site (siteOf), so after "Let it through again" on app.bank.example no
// other host of bank.example, and not its root, is answered by itself either. An entry 1.31 stored per exact host counts
// for its whole site too.
const unautoHas = (cx, co) => (cx.set.unauto || []).some((u) => siteOf(u) === co);
// what no removal of a learned host (hardClean, cleanBounce) deletes: a sign-in-like cookie, an allowed one, one of a site switched off
const kept = (cx, c) => signinLike(c) || (cx.set.allow || []).some((a) => a.site === bare(c.domain) && a.name === c.name) || (cx.set.sitesOff || []).some((s) => under(realHost(c.domain), s));
// at most STOPS_HOUR answers by itself in an hour, in all (`autoAt`: when each was given): pages cannot make more
const spendYes = () => { let ok = false;
  return serial(async () => { const now = Date.now(), { autoAt = [] } = await chrome.storage.local.get('autoAt'), recent = autoAt.filter((t) => t > now - 3600e3);
    if (recent.length < STOPS_HOUR) { ok = true; await chrome.storage.local.set({ autoAt: [...recent, now] }); } }).then(() => ok); };
const yesNow = async (cx, site) => mayYes(cx, site) && await spendYes();
// the user let it through again, or said "Not now": no host of that site is answered by itself again (it is asked)
const noAuto = (host) => serial(async () => { const { unauto = [] } = await chrome.storage.local.get('unauto'), site = isHost(host) ? siteOf(host) : '';
  if (site && !unauto.includes(site)) await chrome.storage.local.set({ unauto: [...unauto, site].slice(-STOPPED_MAX) }); });
// F3 (1.32): the hosts answered by itself, { autoDone: { '<host>': { t, row } } } (row: 'unknown' or 'bounce'), at most
// AUTODONE_MAX: the popup shows each on its row, and under "This site", with "Let it through" (letThrough). A host of a site
// the user let through is no longer shown.
const AUTODONE_MAX = 100, BOUNCE_AUTO_MS = 24 * 3600e3;
const noteAuto = (host, row) => serial(async () => { const { autoDone = {} } = await chrome.storage.local.get('autoDone');
  await chrome.storage.local.set({ autoDone: Object.fromEntries([...Object.entries(autoDone).filter(([h]) => h !== host), [host, { t: Date.now(), row }]].slice(-AUTODONE_MAX)) }); });
// "Let it through" on a host answered by itself: its block goes (as "Let it through again"), its links are no longer
// skipped, and no host of its site is answered by itself again (unauto). What was emptied cannot be put back.
async function letThrough(site) {
  if (!isHost(site)) return { ok: false };
  const { stopped = [], skipok = [] } = await chrome.storage.local.get(['stopped', 'skipok']);
  if (stopped.includes(site)) await unstop(site);
  if (skipok.includes(site)) await unskip(site);
  await noAuto(site);
  await serial(async () => { const { autoDone = {} } = await chrome.storage.local.get('autoDone');
    if (autoDone[site]) { delete autoDone[site]; await chrome.storage.local.set({ autoDone }); } });
  return { ok: true };
}
async function stopTracker(site) {
  if (!isHost(site)) return false;
  const { stopped = [] } = await chrome.storage.local.get('stopped');
  // at the cap the block made longest ago is dropped for the new one (J6): learning never ends, and the list stays bounded
  if (!stopped.includes(site)) { const next = [...stopped, site].slice(-STOPPED_MAX), gone = stopped.filter((s) => !next.includes(s)), { hard = [], own = {} } = await chrome.storage.local.get(['hard', 'own']);
    for (const s of gone) if ((own[s] || {}).mute) try { await chrome.contentSettings.notifications.set({ primaryPattern: `*://*.${s}/*`, setting: 'ask' }); } catch {}   // its own block goes with it; nobody else's is touched (L5)
    await chrome.storage.local.set({ stopped: next, hard: hard.filter((s) => next.includes(s)), ...(gone.some((s) => own[s]) ? { own: Object.fromEntries(Object.entries(own).filter(([s]) => !gone.includes(s))) } : {}) }); }
  await applyFeatures();
  return true;
}
// Remove (L2): the user's press on the second question. One-off: what that host has saved NOW goes (its cookies but those
// that look like a sign-in, what it saved on its own site and its background program, all saved copies), and nothing
// later. While its own site is open in a tab only its background program goes. The question is not asked again.
// auto (1.30, answered by itself): the saved copies go only within the hour's one clearing a page can cause (copiesNow)
async function hardClean(site, auto = false) {
  const { stopped = [], follow = {}, later: lt = {} } = await chrome.storage.local.get(['stopped', 'follow', 'later']);
  if (!isHost(site) || !stopped.includes(site)) return false;
  const cx = await context(), gone = [], origins = [...new Set([site, ...((follow[site] || {}).hosts || []).filter((h) => under(h.replace(/:\d+$/, ''), site))])].flatMap((h) => [`https://${h}`, `http://${h}`]);
  for (const c of await allCookies()) if (under(bare(c.domain), site) && !kept(cx, c) && !firstParty(c, cx.hosts) && await remove(c)) gone.push({ cap: 'C25', kind: 'cookie', site: bare(c.domain), name: c.name, ...(auto ? { auto: true } : {}) });   // F7: marked like its answer
  await logged(gone, 'removed');
  if (!(cx.set.sitesOff || []).some((s) => under(site, s))) try { await chrome.browsingData.remove({ origins }, cx.hosts.some((h) => under(h, site)) ? { serviceWorkers: true } : { localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true, fileSystems: true, webSQL: true }); } catch {}
  // the saved copies are cleared with it. This is the user's own press, so it is not counted against the hour's one clearing,
  // which bounds only what a page can cause (K1)
  if (auto) await copiesNow(cx, true);
  else if (can('C11', cx)) try { await clearCache(); await logged([{ cap: 'C11', kind: 'cache', site: '*', name: 'http-cache' }], 'removed'); } catch {}
  await chrome.storage.local.set({ later: Object.fromEntries([...Object.entries(lt).filter(([, t]) => t > Date.now()), [`C25 ${site} ${USED}`, Date.now() + 3650 * 86400e3]].slice(-500)) });
  return true;
}
// "Keep removing what X saves" (L2): a switch per blocked host, off unless the user ticks it, and never for a host whose
// site the user opens as a page. On (`hard`): the host is judged like a listed tracker from then on: its cookies go when
// they come back, what it saved on its own site is emptied daily, its notifications are blocked. Off: all of that ends.
async function keepRemoving(site, on) {
  const cx = await context(), { stopped = [], hard = [], own = {} } = await chrome.storage.local.get(['stopped', 'hard', 'own']);
  if (!isHost(site) || typeof on !== 'boolean' || !stopped.includes(site) || (on && visited(cx, siteOf(site)))) return { ok: false };
  if (!on && (own[site] || {}).mute) try { await chrome.contentSettings.notifications.set({ primaryPattern: `*://*.${site}/*`, setting: 'ask' }); } catch {}
  await chrome.storage.local.set({ hard: on ? [...hard.filter((s) => s !== site), site] : hard.filter((s) => s !== site), ...(on ? {} : { own: Object.fromEntries(Object.entries(own).filter(([s]) => s !== site)) }) });
  await sweep('settings');
  return { ok: true };
}
// "Let it through again": the block goes, and it is not offered again for a while
async function unstop(site) {
  const { stopped: was = [], own = {}, hard = [] } = await chrome.storage.local.get(['stopped', 'own', 'hard']), stopped = was.filter((s) => s !== site);
  // its notifications were blocked for "Keep removing": that one host's setting is put back to "ask"; no other host's block or note is touched (L5)
  if ((own[site] || {}).mute) try { await chrome.contentSettings.notifications.set({ primaryPattern: `*://*.${site}/*`, setting: 'ask' }); } catch {}
  await chrome.storage.local.set({ stopped, hard: hard.filter((s) => s !== site), own: Object.fromEntries(Object.entries(own).filter(([s]) => s !== site)) });
  await noAuto(site);
  return { ...(await notNow({ group: 'unknown', site })), stopped };
}

// ---- Sites that only pass you along (C27, learn.js bounceAdded). A page address that answers "go to another site" has
// shown the user nothing, yet it can save a cookie and add an ID to the next address. Kept privately in
// chrome.storage.local { bounce: { '<host>': { n: passes, done: passes cleaned up after, hosts, to, id } } }.
// Two questions per site, each asked once per need: delete what it saved, and cut the added name off every address
const BOUNCE_MAX = 100, PASSED = 'passed you on without showing a page', SKIPQ = 'skip it next time';
async function noteRedirect(d) {
  if (d.type !== 'main_frame') return;
  let a, b; try { a = new URL(d.url); b = new URL(d.redirectUrl); } catch { return; }
  const co = siteOf(a.hostname), site = a.hostname.toLowerCase();   // kept per exact host (J2)
  if (!/^https?:$/.test(a.protocol) || !/^https?:$/.test(b.protocol) || co === siteOf(b.hostname) || isSignIn(d.url) || isSignIn(d.redirectUrl) || signInCompany(co)) return;
  await ready;
  const cx = await context();
  if (mayRun('C27', cx.set) === 'no' || cx.hosts.some((h) => siteOf(h) === co)) return;
  // to: a hash per site it sent the browser on to (at most 3); id: it added an ID to the address on the way. skip.js gets a
  // site only with both (two different destinations and an added ID): one safe-link redirect makes no passing site (H4)
  const salt = await saltNow(), dest = mark(`${salt} ${siteOf(b.hostname)}`);
  await serial(async () => { const { bounce = {} } = await chrome.storage.local.get('bounce'), old = bounce[site] || { n: 0, done: 0, hosts: [], params: [] };
    bounce[site] = { n: old.n + 1, done: old.done, t: Date.now(), hosts: [...new Set([...old.hosts, a.host])].slice(0, 5), params: [],   // (1.25, L3: the names a redirect adds are no longer kept or asked about)
      to: [...new Set([...(old.to || []), dest])].slice(0, 3), id: !!old.id || bounceAdded(d.url, d.redirectUrl, true).length > 0 };
    await chrome.storage.local.set({ bounce: Object.fromEntries(Object.entries(bounce).sort((x, y) => y[1].t - x[1].t).slice(0, BOUNCE_MAX)) }); });
  sweep('passed on');
}
try { chrome.webRequest.onBeforeRedirect.addListener((d) => { noteRedirect(d); }, { urls: ['<all_urls>'] }); } catch {}
async function bounceSweep(cx, wait, all) {
  const v = verdict('C27', cx), done = [], yes = answersYes('C27', cx.set, cx.hold);
  if (v === 'no') return;
  const { bounce = {}, skipok = [], noskip = [], autoDone = {} } = await chrome.storage.local.get(['bounce', 'skipok', 'noskip', 'autoDone']), choices = [...skipok, ...noskip];
  for (const [site, e] of Object.entries(bounce)) {
    const asks = [...(e.n > e.done && !cx.hosts.some((h) => siteOf(h) === siteOf(site)) ? [{ kind: 'bounce', name: PASSED }] : []),
      // it sent the browser on to two different sites and added an ID, and is no site the user opens: may its links be changed to go straight there?
      ...((e.to || []).length >= 2 && e.id === true && !visited(cx, siteOf(site)) && !choices.includes(site) ? [{ kind: 'skip', name: SKIPQ }] : [])];
    const open = asks.filter((x) => !later(cx, 'C27', site, x.name)).map((x) => ({ cap: 'C27', site, why: 'a redirect', ...x, did: v === 'held' ? 'held' : 'queued' }));
    // 1.30, Strongest ('yes'): both questions about a site answered yes by itself, as one of the hour's STOPS_HOUR (mayYes).
    // F3 (1.32): never while a tab is open on that site, and a site's pass-through is cleaned by itself at most once a day
    // (BOUNCE_AUTO_MS); within the day it is a question again. The popup then offers "Let it through" for it (autoDone).
    const site_ = siteOf(site), tabOpen = cx.hosts.some((h) => siteOf(h) === site_);
    const again = Object.entries(autoDone).some(([h, a]) => a.row === 'bounce' && siteOf(h) === site_ && a.t > Date.now() - BOUNCE_AUTO_MS);
    const mayAuto = open.filter((it) => it.kind !== 'bounce' || !again);
    if (yes && mayAuto.length && !tabOpen && await yesNow(cx, site)) {
      for (const it of mayAuto) if (await (it.kind === 'bounce' ? cleanBounce(site, true) : skipAdd(site)).catch(() => false)) done.push({ ...it, auto: true });
      if (mayAuto.some((it) => it.kind === 'bounce')) await noteAuto(site, 'bounce');
      wait.push(...open.filter((it) => !mayAuto.includes(it))); continue; }
    // otherwise never by itself (F2, J1): what a passing site saved is deleted, and its links changed, only after the user's press on its question
    wait.push(...open); }
  await logged(done, 'removed');
}
// "Skip it next time" (the press, or Strongest): links to that host go straight where they name (skip.js)
async function skipAdd(site) {
  if (!isHost(site)) return false;
  const { skipok = [] } = await chrome.storage.local.get('skipok');
  await chrome.storage.local.set({ skipok: [...skipok.filter((s) => s !== site), site].slice(-BOUNCE_MAX) }); await applyFeatures(); return true;
}
async function cleanBounce(site, auto = false) {
  const e = ((await chrome.storage.local.get('bounce')).bounce || {})[site], gone = [];
  if (!e) return false;
  const cx = await context();
  for (const c of await allCookies()) if (under(bare(c.domain), site) && !kept(cx, c) && await remove(c)) gone.push({ cap: 'C27', kind: 'cookie', site: bare(c.domain), name: c.name, ...(auto ? { auto: true } : {}) });
  const hosts = (e.hosts || []).filter((h) => !(cx.set.sitesOff || []).some((s) => under(h.replace(/:\d+$/, ''), s)));   // never a site switched off
  if (hosts.length) await dropStorage(hosts);
  await serial(async () => { const { bounce = {} } = await chrome.storage.local.get('bounce'); if (bounce[site]) { bounce[site].done = bounce[site].n; await chrome.storage.local.set({ bounce }); } });
  await logged(gone, 'removed');
  return true;
}
// "Let it through again" for a passing site: its links are no longer changed (at most 100 such sites are remembered)
async function unskip(site) {
  if (!isHost(site)) return { ok: false };
  const { noskip = [], skipok = [] } = await chrome.storage.local.get(['noskip', 'skipok']);
  await chrome.storage.local.set({ noskip: [...noskip.filter((s) => s !== site), site].slice(-BOUNCE_MAX), skipok: skipok.filter((s) => s !== site) }); await noAuto(site); await applyFeatures(); await sweep('settings');
  return { ok: true };
}

// ---- What a tracker saved on its own site (C28). A tracker is also a site: there it can leave a program that runs
// in the background (service worker), its own storage, and the right to send notifications. For every company the
// user stopped (C25) that is emptied and its notifications are blocked: after one question each, and from then on
// once a day without asking ({ own: { '<site>': { ok, at } } }). The built-in list as a whole is done only on
// Automatic: a standing question about 65 sites that are hardly ever visited would be noise. Never while the
// tracker's own site is open in a tab. Chrome does not tell an extension whether anything was there.
const OWN = 'what it saved on its own site', LISTED = 'the listed trackers';
async function ownSweep(cx, wait) {
  const v = verdict('C28', cx), done = [], now = Date.now();
  if (v === 'no') return;
  const { own = {}, hard: stopped = [] } = await chrome.storage.local.get(['own', 'hard']);   // the cleaned-out companies; read now: this sweep may just have added one
  // what is kept per company goes with the company: `own` never outgrows the list of the stopped
  const stale = Object.keys(own).filter((k) => k !== LISTED && !stopped.includes(k)); for (const k of stale) delete own[k];
  if (stale.length) await chrome.storage.local.set({ own });
  // its notifications are blocked at once, also while its own page is open or the user uses its site: nothing there is deleted by this
  if (v === 'run') for (const site of stopped) if (!(own[site] || {}).mute && !isOff(cx, site)) try { await chrome.contentSettings.notifications.set({ primaryPattern: `*://*.${site}/*`, setting: 'block' });
    own[site] = { ...own[site], mute: true }; await chrome.storage.local.set({ own }); done.push({ cap: 'C28', kind: 'permission', site, name: 'notifications' }); } catch {}
  for (const site of [...stopped, ...(mayRun('C28', cx.set) === 'run' ? [LISTED] : [])]) { const e = own[site] || {};
    if (e.at > now - CACHE_MS || later(cx, 'C28', site, OWN) || guarded(cx, site) || (site !== LISTED && cx.hosts.some((h) => under(h, site)))) continue;
    const it = { cap: 'C28', kind: 'own', site, name: OWN, why: 'a tracker', did: waitsAs(v) };
    if (v === 'run' || (v === 'ask' && e.ok === 'press' && !cx.hold.guard && !cx.hold.paused && cx.set.master === true)) { if (await cleanOwn(site, cx).catch(() => false)) done.push(it); }
    else wait.push(it); }
  await logged(done, 'removed');
}
// pressed: the user's press on its question, a standing yes ('press'): asked once, then done daily also on Ask first.
// Done by itself or at a "Clean now", it sets no such yes (1.30: Ask first then truly does nothing by itself).
async function cleanOwn(site, cx, pressed = false) {
  const { own = {}, follow = {} } = await chrome.storage.local.get(['own', 'follow']);
  // F8 (1.32): never a site the user turned off, nor one of its hosts
  const sites = (site === LISTED ? DOMAINS.filter((d) => !cx.hosts.some((h) => under(h, d)) && !visited(cx, siteOf(d))) : [site]).filter((s) => !isOff(cx, s));
  if (!sites.length) return false;
  await dropStorage([...new Set(sites.flatMap((s) => [s, 'www.' + s, ...((follow[s] || {}).hosts || [])]))].filter((h) => !isOff(cx, h)));
  for (const s of sites) if (!(own[s] || {}).mute) await chrome.contentSettings.notifications.set({ primaryPattern: `*://*.${s}/*`, setting: 'block' });
  await chrome.storage.local.set({ own: { ...own, [site]: { ...own[site], ok: pressed ? 'press' : (own[site] || {}).ok === 'press' ? 'press' : false, at: Date.now(), ...(site === LISTED ? {} : { mute: true }) } } });
  return true;
}

// ---- Trackers' pages in Chrome's history (S11). Only with the optional `history` permission, which the popup asks for
// at a press of its button, and only while the user's switch (`histOn`) is on: once a day the pages on the own
// addresses of stopped and listed trackers are taken out of the history. Chrome is asked for the entries that name a
// tracker's site; each address is compared with that site and deleted or left, and is kept nowhere. Never a site the
// user opens as a page or has open, never while paused, off or during a sign-in.
async function historySweep(cx) {
  if (cx.set.histOn !== true || cx.set.master !== true || cx.hold.paused || cx.signing) return;
  const { histAt = 0, hard: stopped = [] } = await chrome.storage.local.get(['histAt', 'hard']), done = [];
  if (histAt > Date.now() - CACHE_MS) return;
  try { if (!(await chrome.permissions.contains({ permissions: ['history'] }))) return;
    for (const site of [...stopped, ...DOMAINS]) { if (visited(cx, siteOf(site)) || cx.hosts.some((h) => under(h, site))) continue;
      let n = 0;
      for (const h of await chrome.history.search({ text: site, startTime: 0, maxResults: 1000 })) if (under(hostOf(h.url), site)) { await chrome.history.deleteUrl({ url: h.url }); n++; }
      if (n) done.push({ cap: 'C28', kind: 'history', site, name: 'pages in your history' }); }
    await chrome.storage.local.set({ histAt: Date.now() }); } catch {}
  await logged(done, 'removed');
}
// "Clear my browsing history" in the popup (S16): all of it, at a press only; nothing here calls this by itself
async function clearBrowsing() {
  const no = refusal(await context()); if (no) return no;
  try { await chrome.browsingData.remove({ since: 0 }, { history: true }); } catch (e) { return { ok: false, error: String(e.message || e) }; }
  await logged([{ cap: 'C10', kind: 'history', site: '*', name: 'all of your browsing history' }], 'removed');
  return { ok: true };
}
const histOn = async (on) => { if (typeof on !== 'boolean') return { ok: false }; await chrome.storage.local.set({ histOn: on }); if (on) await sweep('settings'); return { ok: true }; };

// ---- Saved Wi-Fi networks (C24). Chrome cannot see them: a local program (wifi-helper/, started by Chrome through
// native messaging) lists the stale ones and removes those it is sent. Never automatic (noAuto in registry.js), so
// the gate only ever answers 'ask' or 'no' here. No helper, or an error from it, is null: C24 then simply has nothing.
const WIFI_HOST = 'com.tracker_cleaner.wifi';
const wifiHelper = async (msg) => { try { const r = await chrome.runtime.sendNativeMessage(WIFI_HOST, msg); return r && r.ok === true ? r : null; } catch { return null; } };
async function wifiSweep(cx, wait) {
  if (verdict('C24', cx) === 'no') return chrome.storage.local.remove('wifi');
  // paused: the helper is not asked; what is queued stays queued
  if (cx.hold.paused) return wait.push(...((cx.set.pending || {}).wifi || { items: [] }).items);
  const r = await wifiHelper({ type: 'list' }), found = r && Array.isArray(r.candidates) ? r.candidates : [];
  await chrome.storage.local.set({ wifi: r ? { helper: 'ok', canDelete: String(r.canDelete) } : { helper: 'missing' } });
  // site = the network's name, name = its UUID (what the helper deletes by), why = the helper's reason
  wait.push(...found.filter((c) => c && typeof c.uuid === 'string' && c.uuid).map((c) => ({ cap: 'C24', kind: 'wifi', site: String(c.name), name: c.uuid, why: String(c.reason), did: 'queued' })));
}
// Approve: the queued UUIDs and nothing else go to the helper, which reads the list again and refuses what is in use
// or recently used by now. Every network is logged with what happened to it. Not kept for Undo: only cookies are.
async function wifiRemove(items) {
  const r = await wifiHelper({ type: 'remove', uuids: items.map((it) => it.name) }) || {};
  const of = (list, it) => (Array.isArray(list) ? list : []).find((x) => x && x.uuid === it.name);
  const did = (it) => of(r.removed, it) ? 'removed' : 'kept: ' + ((of(r.refused, it) || {}).reason || (of(r.failed, it) || {}).error || 'the helper did not answer');
  const results = items.map((it) => ({ ...it, did: did(it) }));
  await logged(results);
  return results.filter((x) => x.did === 'removed').length;
}

// ---- Self-update: Chrome's own check runs only every few hours; ask at every sweep, reload when a new version is ready.
function selfUpdate() { try { chrome.runtime.requestUpdateCheck(() => {}); } catch {} }
try { chrome.runtime.onUpdateAvailable.addListener(async () => { const cx = await context(); if (can('C15', cx) && !cx.signing) chrome.runtime.reload(); }); } catch {}

// ---- Permanent drops (made permanent in the popup → settings → limits.json): site storage dropped and
// site permissions blocked at every sweep. Cookies use the cookie blacklist (cookieBlacklist) above.
const dropStorage = (site) => chrome.browsingData.remove({ origins: [].concat(site).flatMap((s) => [`https://${s}`, `http://${s}`]) },
  { localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true, fileSystems: true, webSQL: true });
const blockPermission = (site, perm) => chrome.contentSettings[perm].set({ primaryPattern: `${site}/*`, setting: 'block' });
async function applyPermanentDrops(cx, wait) {
  const storage = verdict('C07', cx), perms = verdict('C09', cx);
  if (!DROPS || (storage === 'no' && perms === 'no')) return {};
  let l; try { if (!serverOn(cx)) return {}; l = cleanLimits(await (await fetch(LIMITS, { cache: 'no-store' })).json()); if (!l) return {}; } catch { return {}; }
  const done = [];
  for (const site of storage !== 'no' && Array.isArray(l.storageBlacklist) ? l.storageBlacklist : []) {
    if (isOff(cx, site)) continue;   // F8: never a site turned off
    const it = { cap: 'C07', kind: 'storage', site, name: 'storage', why: 'permanent drop', did: waitsAs(storage) };
    if (waits(storage)) wait.push(it);
    else try { await dropStorage(site); done.push(it); } catch {} }
  for (const p of perms !== 'no' && Array.isArray(l.permissionBlacklist) ? l.permissionBlacklist : []) {
    const it = { cap: 'C09', kind: 'permission', site: p.site, name: p.perm, why: 'permanent drop', did: waitsAs(perms) };
    if (waits(perms)) wait.push(it);
    else try { await blockPermission(p.site, p.perm); done.push(it); } catch {} }
  await logged(done, 'removed');
  return done.length ? { permanentDrops: done.length } : {};
}

// ---- Clear the HTTP cache (C11). That also empties the list of servers Chrome remembers (Network Persistent
// State) and its forced-HTTPS entries; cookies and logins are untouched. Local since 1.21, no 8088 server involved:
// offered (ask) or done (auto) at most once in 24 hours, counted from cacheClearedAt in storage; and, on Automatic
// only, done once at each start of Chrome (N1, below).
const CACHE_MS = 24 * 3600e3;
// A saved copy can carry an ID and bring a deleted cookie back: when a cookie is deleted because it sits on a tracker's
// own address (listed or stopped), the saved copies of that address go too, at most once an hour (kept in memory only).
// Never for a site the user visits that merely carries a cookie with a tracker's name.
const copiesAt = new Map();
async function copiesOf(hosts, cx) {
  const now = Date.now(), due = [...new Set(hosts)].filter((h) => !(copiesAt.get(h) > now - 3600e3));
  if (!due.length || !can('C11', cx)) return;
  if (copiesAt.size > 2000) copiesAt.clear();
  for (const h of due) copiesAt.set(h, now);
  try { await chrome.browsingData.remove({ origins: due.flatMap((h) => [`https://${h}`, `http://${h}`]) }, { cache: true }); } catch {}
}
// Any clearing of all saved copies also settles the one that is due since Chrome started (`startClear`, N1).
const clearCache = async () => { await chrome.browsingData.remove({ since: 0 }, { cache: true }); await chrome.storage.local.set({ cacheClearedAt: Date.now() });
  try { if ((await chrome.storage.session.get('startClear')).startClear === true) await chrome.storage.session.set({ startClear: false }); } catch {} };
// Every clearing of all saved copies that the extension starts by itself around a block or a clean-out shares one budget:
// once an hour in total (`softClearAt`), however many blocks or clean-outs there are (J6). The daily clearing and the
// user's own "Clean now" are not counted against it.
const copiesNow = async (cx, auto = false) => { const { softClearAt = 0 } = await chrome.storage.local.get('softClearAt'), now = Date.now();
  if (softClearAt > now - 3600e3 || !can('C11', cx)) return;
  await chrome.storage.local.set({ softClearAt: now });
  try { await clearCache(); await logged([{ cap: 'C11', kind: 'cache', site: '*', name: 'http-cache', ...(auto ? { auto: true } : {}) }], 'removed'); } catch {} };
// (1.25, H7 and I1: all saved copies are cleared at most once a day, once at a clean-out, and once after a stop that only
// blocks, that last one at most once an hour in total; never a minute later.)
// N1 (1.28) takes back H7's "never at a start of Chrome": a server Chrome remembers (Alt-Svc) and a forced-HTTPS entry
// are saved after the daily clearing and then outlive it by up to a day, across restarts. Measured in Chrome 157: of
// the browsingData types only `cache` over all time drops them (not `history`, not `cacheStorage`, not `cache` for one
// origin), so the same clearing as the daily one is done once per start of Chrome. The start is noted in
// chrome.storage.session { startClear: true } (memory; gone when Chrome closes) and settled by the next sweep in which
// the row runs by itself (Automatic, main switch on, not paused) and no tab is on a sign-in host (`signing`, as for the
// Tor switch and the self-reload: nothing of the network is changed under a sign-in). The five minutes for which a
// site's own sign-in page holds deleting for that site (`sguard`) do not hold it, as they do not hold the daily
// clearing: no cookie and nothing a site saved is touched. On "Ask first" a start makes no question.
async function forgetServers(cx, wait) {
  const v = verdict('C11', cx);
  if (v === 'no') return {};
  let start = false; try { start = v === 'run' && !cx.signing && (await chrome.storage.session.get('startClear')).startClear === true; } catch {}
  if (!start && cx.set.cacheClearedAt > Date.now() - CACHE_MS) return {};
  const it = { cap: 'C11', kind: 'cache', site: '*', name: 'http-cache', why: start ? 'chrome start' : 'daily', did: waitsAs(v) };
  if (waits(v)) { wait.push(it); return {}; }
  try { await clearCache(); await logged([it], 'removed'); return { serversForgotten: true }; }
  catch (e) { return { serversForgotten: false, serversError: String(e) }; }
}

let pending = [], timer = null;     // live removals are batched into one report
// the service worker may just have woken up: read the settings once before deleting anything
let ready = refreshBlacklist();
chrome.cookies.onChanged.addListener(async ({ removed, cookie }) => {
  if (removed) return;
  await ready;
  const cx = await context(), [r, v, why] = judge(cookie, cx);
  if (!r || v === 'no') return;
  // which page set it is not known: the tab the user is looking at is the best guess (the popup says so)
  const focused = (await chrome.windows.getLastFocused().catch(() => null))?.id, tab = cx.tabs.find((t) => t.active && t.windowId === focused);
  const item = { ...cookieItem(cookie, r, v, why), page: tab ? hostOf(tab.url || tab.pendingUrl) : '' };
  if (waits(v)) return queueUp([item]);
  if (v === 'run' && await remove(cookie, r !== 'blacklist')) {
    logged([item], 'removed'); if (item.cap === 'C03' && isTrackerHost(realHost(item.site))) copiesOf([item.site], cx);
    pending.push(`${realHost(cookie.domain)} ${cookie.name}`);
    clearTimeout(timer); timer = setTimeout(() => { const r = pending; pending = []; report({ reason: 'live', removed: r }); }, 5000);
  }
});

async function report(body) {
  if (!can('C15', await context())) return;
  try { await fetch(REPORT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: Date.now(), state: STATE(), ...body }) }); } catch {}
}

chrome.alarms.create('sweep', { periodInMinutes: 15 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'sweep') sweep('every-15-min'); if (a.name === 'unguard') sweep('sign-in over'); });
// A notification block this extension set can be gone when Chrome starts or the extension is loaded again: the note that it
// was set is taken away then, so the sweep that follows sets it again.
const unmute = () => serial(async () => { const { own = {} } = await chrome.storage.local.get('own');
  if (Object.values(own).some((e) => e.mute)) await chrome.storage.local.set({ own: Object.fromEntries(Object.entries(own).map(([s, e]) => [s, { ...e, mute: false }])) }); });
chrome.runtime.onStartup.addListener(unmute); chrome.runtime.onInstalled.addListener(unmute);
chrome.runtime.onInstalled.addListener(async (d) => {
  // 1.25: a new install is switched on, and the popup says once what now happens by itself and where the switch is.
  // 1.30: a new install starts at Strongest; an update stores no level, so it stays at what it had (Balanced, or its own rows)
  const { master, level } = await chrome.storage.local.get(['master', 'level']), [a, b] = String((d || {}).previousVersion).split('.').map(Number);
  if (d && d.reason === 'install' && master === undefined) await chrome.storage.local.set({ master: true, firstRun: true, ...(level === undefined ? { level: 'strong' } : {}) });
  // an update from before 1.25 with cleaning on (H8): the four groups that 1.25 lets run by themselves are stored as "Ask
  // first", as they were, unless the user had chosen a mode; the popup's one-time line then offers OK (by itself from now
  // on) or Keep asking. Blocking and the rules that delete nothing start at once.
  if (d && d.reason === 'update' && master === true && (a < 1 || (a === 1 && b < 25))) { const { modes = {} } = await chrome.storage.local.get('modes'), held = NEW_AUTO.filter((id) => !(id in modes));
    await chrome.storage.local.set({ firstRun: 'update', held125: held, modes: { ...modes, ...Object.fromEntries(held.map((id) => [id, 'ask'])) } }); }
  // a fresh install has cleared nothing yet: count the 24 hours of C11 from now, so the first sweep does not offer it
  if (!('cacheClearedAt' in await chrome.storage.local.get('cacheClearedAt'))) await chrome.storage.local.set({ cacheClearedAt: Date.now() });
  return sweep('installed');
});
// N1: the start is noted first, so the sweep it begins (or the one that follows a sweep already running) clears the saved copies
chrome.runtime.onStartup.addListener(async () => { try { await chrome.storage.session.set({ startClear: true }); } catch {} return sweep('chrome-start'); });

// ---- Tab limit (settings on 127.0.0.1:8088/settings → /audit/limits.json): at each sweep keep only
// chromeTabs tabs and close the rest. First ONE tab for each preferred site (e.g. one Spotify, one
// YouTube), then the most active other tabs. Within a group the best tab wins: playing audio, then the
// focused tab, then most recently used. chromeTabs 0 = off. If the audit server is down, nothing is closed.
const LIMITS = 'http://127.0.0.1:8088/audit/limits.json';
async function tabLimit() {
  try { const l = cleanLimits(await (await fetch(LIMITS, { cache: 'no-store' })).json()) || {};
    return Number.isInteger(l.chromeTabs) && l.chromeTabs > 0 ? { n: l.chromeTabs, prefer: Array.isArray(l.preferSites) ? l.preferSites : [] } : null; }
  catch { return null; }
}
const tabHost = (t) => { try { return new URL(t.url || t.pendingUrl).host || t.url; } catch { return '?'; } };
async function enforceTabs(cx, wait) {
  const tabs = await chrome.tabs.query({ windowType: 'normal' }), v = verdict('C13', cx), host = tabHost;
  const limit = v !== 'no' && serverOn(cx) ? await tabLimit() : null;
  if (limit === null) return { tabs: tabs.length };
  const focused = (await chrome.windows.getLastFocused().catch(() => null))?.id;
  const score = (t) => (t.audible ? 4e15 : 0) + (t.active && t.windowId === focused ? 2e15 : 0) + (t.lastAccessed || 0);
  const ranked = tabs.sort((a, b) => score(b) - score(a));
  const keep = [];
  for (const site of limit.prefer) { const t = ranked.find((x) => host(x) === site && !keep.includes(x)); if (t && keep.length < limit.n) keep.push(t); }
  for (const t of ranked) { if (keep.length >= limit.n) break; if (!keep.includes(t) && !limit.prefer.includes(host(t))) keep.push(t); }
  const close = ranked.filter((t) => !keep.includes(t));
  // queued by tab id: the sweep replaces these items each time, so a tab the user went back to drops out
  const items = close.map((t) => ({ cap: 'C13', kind: 'tabs', site: host(t), name: String(t.id), why: 'tab limit', did: waitsAs(v) }));
  if (waits(v)) { wait.push(...items); return { tabs: tabs.length }; }
  if (close.length) { await chrome.tabs.remove(close.map((t) => t.id)).catch(() => {}); await logged(items, 'removed'); }
  return { tabs: (await chrome.tabs.query({ windowType: 'normal' })).length, closedTabs: close.map(host), keptTabs: keep.map(host) };
}

// ---- Hiding your address from websites (C14): Chrome's traffic goes through the Tor program on this computer
// (socks5 127.0.0.1:9050). Local pages stay direct. The extension's own switch decides; no 8088 server is asked.
// Before anything is routed, Tor's port must answer: a web request to it gets a short refusal page that names Tor.
// With no answer Chrome is left exactly as it is. That also means: routed already and Tor has stopped, it stays routed
// and pages do not load, which is better than quietly showing websites the real address. Checked every minute.
const TOR_PORT = 'http://127.0.0.1:9050/';
const torRuns = async () => { try { return /\bTor\b/.test(await (await fetch(TOR_PORT, { cache: 'no-store', signal: AbortSignal.timeout(3000) })).text()); } catch { return false; } };
const torRouted = async () => { try { const v = (await chrome.proxy.settings.get({})).value, one = (v.rules || {}).singleProxy || {};
  return v.mode === 'fixed_servers' && one.host === '127.0.0.1' && one.port === 9050; } catch { return false; } };
// for the Tor row: is it switched on and allowed right now, did the port answer (null = not asked), is Chrome routed
const torNow = async (cx) => { const wanted = can('C14', cx); return { wanted, running: wanted ? await torRuns() : null, routed: await torRouted() }; };
let proxyMode = null, proxying = Promise.resolve();
// one at a time: a changed switch and the reply to the popup may both ask for it
const applyProxy = () => (proxying = proxying.then(proxyOnce, proxyOnce));
async function proxyOnce() {
  const cx = await context();
  if (cx.signing && !cx.hold.paused) return;   // a tab is on a sign-in host: do not change the network path under it
  const want = can('C14', cx) ? 'tor' : 'direct';   // not allowed (off, ask, master off, paused): take our proxy setting away
  if (want === 'tor' && !(await torRuns())) return;   // Tor does not answer: leave Chrome as it is
  if (want === proxyMode) return;
  if (want === 'tor') await chrome.proxy.settings.set({ scope: 'regular', value: { mode: 'fixed_servers', rules: {
    singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: 9050 }, bypassList: ['127.0.0.1', 'localhost', '*.localhost', '[::1]'] } } });
  else await chrome.proxy.settings.clear({ scope: 'regular' });
  proxyMode = want;
  await report({ reason: 'proxy', removed: [], mode: want });
}
chrome.alarms.create('proxy', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (a) => { if (a.name === 'proxy') { badge(); purgeUndo(); applyProxy(); if (await refreshBlacklist()) sweep('blacklist'); } });
chrome.runtime.onStartup.addListener(applyProxy);
chrome.runtime.onInstalled.addListener(applyProxy);

// A changed switch takes effect at once for what would otherwise wait: blocking, YouTube scripts, Tor.
chrome.storage.onChanged.addListener((ch) => {
  if (ch.master || ch.modes || ch.pauseUntil || ch.stopped || ch.skipok || ch.noskip || ch.sitesOff) { applyFeatures(); applyProxy(); }
  if (ch.pending || ch.pauseUntil) badge();
});
badge();
