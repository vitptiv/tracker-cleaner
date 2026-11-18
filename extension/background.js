// Tracker Cleaner 1.25: blocks tracker requests (the rule files), and cleans tracking cookies as they are set and in a
// sweep every 15 minutes, but only what its group allows: each group (registry.js) is off, asks first (the
// candidates wait in a queue for Approve or Postpone) or is automatic. A new install is switched on, and the groups
// that only touch what follows you run without asking from the start; the popup says so once. Only deleted cookies
// can be put back, for 10 minutes; emptied storage and cleared saved copies cannot. Everything is held while paused,
// and everything destructive while a sign-in is going on. Login cookies (KEEP_RE) are deleted by nothing but the
// user's own always-delete list and "Delete" in the report.
importScripts('lists.js', 'core.js', 'registry.js', 'guard.js', 'queue.js', 'undo.js', 'loop.js', 'history.js', 'learn.js', 'net-rules.js');
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
  const set = await chrome.storage.local.get(['master', 'modes', 'guardUntil', 'pauseUntil', 'pending', 'cacheClearedAt', 'allow', 'always', 'sitesOff', 'loops', 'stopped', 'later', 'params', 'mine', 'salt', 'histOn']), now = Date.now();
  const tabs = await chrome.tabs.query({}), hold = holdNow(set, tabs, now), hosts = tabs.map((t) => hostOf(t.url || t.pendingUrl));
  if (mayRun('C19', set) !== 'run') hold.guard = false;
  // a sign-in page is the active tab: keep the guard armed, so it still holds GUARD_MS after the user leaves it
  // (written at most once a minute; the 1-minute alarm passes here)
  else if (hold.tab && !(set.guardUntil > now + GUARD_MS - 60e3)) await chrome.storage.local.set({ guardUntil: now + GUARD_MS });
  return { set, hold, tabs, hosts };
}
const verdict = (id, cx) => gate(id, cx.set, cx.hold);
const can = (id, cx) => verdict(id, cx) === 'run';
const waits = (v) => v === 'ask' || v === 'held';
// Sign-in guard (C19): every navigation to a sign-in URL (re)arms it.
// The tab it is seen in, and the tab that opened it (a sign-in in a pop-up), are noted in chrome.storage.session
// { gtabs: [tab numbers] }: in those tabs the header rules of net-rules.js do not apply while the guard holds
// (applyFeatures; the list is emptied when the guard is over).
const arm = (url, tabs = []) => { if (!isSignIn(url)) return;
  chrome.storage.local.set({ guardUntil: Date.now() + GUARD_MS });
  serial(async () => { const { gtabs = [] } = await chrome.storage.session.get('gtabs');
    await chrome.storage.session.set({ gtabs: [...new Set([...gtabs, ...tabs.filter((id) => Number.isInteger(id) && id >= 0)])].slice(-100) }); }).then(() => applyFeatures()); };
chrome.tabs.onCreated.addListener((t) => arm(t.pendingUrl || t.url, [t.id, t.openerTabId]));
chrome.tabs.onUpdated.addListener((id, info, t) => { if (info.url) arm(info.url, [id, (t || {}).openerTabId]); });
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
// `spared`: core.js's reason, minus what is spared: every cookie of a site the user switched off (sitesOff), a cookie the user
// allowed (the blacklist still wins over that), and a cookie that is only there because of its tracker host while
// a tab is open on that tracker's own site.
const spared = (c, cx, noBlack) => {
  const r = reason(c, noBlack);
  if (!r || (cx.set.sitesOff || []).some((s) => under(realHost(c.domain), s))) return null;
  if (r !== 'blacklist' && (cx.set.allow || []).some((a) => a.site === bare(c.domain) && a.name === c.name)) return null;
  return r === 'host' && (firstParty(c, cx.hosts) || usedSite(c, cx)) ? null : r;
};
// a cookie of a company that was stopped here (on no built-in list) whose site the user opens as a page, or one that
// looks like a sign-in (the user may have signed in there before this list existed): no sweep and no cookie event
// deletes it; the company is only blocked on other sites
const signinLike = (c) => KEEP_RE.test(c.name) || (c.httpOnly === true && c.secure === true);
const usedSite = (c, cx) => { const h = realHost(c.domain), s = (cx.set.stopped || []).find((x) => under(h, x));
  return !!s && !DOMAINS.some((d) => under(h, d)) && (signinLike(c) || visited(cx, s)); };
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
const logged = (items, did) => items.length ? serial(async () => {
  const { log = [], history } = await chrome.storage.local.get(['log', 'history']), now = Date.now();
  const gone = items.filter((it) => (did || it.did) === 'removed').map((it) => ({ group: cap(it.cap).group, kind: it.kind, site: it.site, name: it.name }));
  await chrome.storage.local.set({ log: logAdd(log, items, did, now), ...(gone.length ? { history: historyAdd(history, gone, now) } : {}) }); }) : chain;
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
async function carry(it, cookies, tabs, cx) {
  if (it.kind === 'cookie') { let n = 0;
    for (const c of cookies) if (c.name === it.name && bare(c.domain) === it.site && CAP_OF[spared(c, cx)] === it.cap && await remove(c, it.cap !== 'C07')) n++;
    return n > 0; }
  if (it.kind === 'tabs') { const t = tabs.find((x) => String(x.id) === it.name);
    // approval is allowed during the sign-in guard, so it must not close a sign-in page itself
    if (!t || tabHost(t) !== it.site || isSignIn(t.url || t.pendingUrl)) return false;
    await chrome.tabs.remove(t.id); return true; }
  if (it.kind === 'tracker') return stopTracker(it.site);
  if (it.kind === 'bounce') return cleanBounce(it.site);
  if (it.kind === 'param') return stripParam(it.name);
  if (it.kind === 'own') return cleanOwn(it.site, cx);
  if (it.kind === 'storage') await dropStorage(it.site);
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
  await withQueue((p) => { const g = p[group] || { items: [] }; const mine = (it) => (!site || it.site === site) && (!name || it.name === name); items = g.items.filter(mine);
    if (site) g.items = g.items.filter((it) => !mine(it)); else delete p[group];
    return items.length > 0; });
  const cookies = items.some((it) => it.kind === 'cookie') ? await allCookies() : [], tabs = await chrome.tabs.query({});
  const done = [];
  for (const it of items) if (mayRun(it.cap, cx.set) !== 'no' && await carry(it, cookies, tabs, cx).catch(() => false)) done.push(it);
  await logged(done, 'removed');
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

// ---- The popup: chrome.runtime.sendMessage({ type, ... }) -> reply.
async function state() {
  await ready;
  const { set, hold } = await context(), modes = set.modes || {}, pending = set.pending || {};
  const looping = (g) => g ? g.items.filter((it) => it.why === LOOP_WHY).length : 0;
  const { wifi } = await chrome.storage.local.get('wifi');   // what the helper last said: { helper: 'ok' | 'missing', canDelete }
  return { now: Date.now(), master: set.master, modes, hold: { ...hold, pauseUntil: set.pauseUntil || 0, guardUntil: set.guardUntil || 0 },
    log: (await chrome.storage.local.get('log')).log || [], allow: set.allow || [], always: set.always || [], sitesOff: set.sitesOff || [], stopped: set.stopped || [], params: set.params || [], skipped: ((await chrome.storage.local.get('skip')).skip || { sites: [] }).sites,
    ...(((f) => f === true || f === 'update' ? { firstRun: f } : {})((await chrome.storage.local.get('firstRun')).firstRun)),
    ...(serverOff().length ? { serverOff: serverOff() } : {}), histOn: set.histOn === true,
    server: SERVER,   // did the 8088 server answer the last time: the popup asks it only then
    tor: await torNow({ set, hold }),
    undo: (await undoBuffer()).map(({ t, c }) => ({ t, site: bare(c.domain), name: c.name })),   // never the value
    // one row per group that has an action capability; it shows the mode of its first one, setMode keeps them all the same.
    // ask: false = nothing destructive in the group, so 'ask' would only mean off: the popup offers On and Off
    groups: GROUPS.filter((g) => g.caps.length).map((g) => ({ id: g.id, title: g.title, says: g.says, ask: g.caps.some((id) => cap(id).destructive), mode: modes[g.caps[0]] || cap(g.caps[0]).mode, ...queueView(pending[g.id]), looping: looping(pending[g.id]),
      // the cache: when it is next offered or cleared. Its size is not here: no Chrome API tells an extension (tools/inspect.js does)
      ...(g.id === 'cache' ? { nextAt: (set.cacheClearedAt || 0) + CACHE_MS } : {}), ...(g.id === 'wifi' ? { noAuto: true, ...wifi } : {}) })) };
}
async function setMode(group, mode) {
  const g = GROUPS.find((x) => x.id === group);
  if (!g || !['auto', 'ask', 'off'].includes(mode)) return { ok: false };
  const old = (await chrome.storage.local.get('modes')).modes || {}, modes = { ...old, ...Object.fromEntries(g.caps.map((id) => [id, mode])) };
  // the saved copies of pages, turned on by the user: the day's wait starts over, so the sweep below clears (or offers) them now
  await chrome.storage.local.set({ modes, ...(group === 'cache' && mode !== 'off' && old.C11 !== mode ? { cacheClearedAt: 0 } : {}) });
  if (group === 'tor') await applyProxy();   // before the reply, so the row that is drawn next is true
  await sweep('settings');
  return { ok: true, modes };
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
const MESSAGES = { state, stored, seen: async () => { await chrome.storage.local.remove('firstRun'); return { ok: true }; }, cookies: (m) => cookiesOf(m.host), cookieValue: (m) => cookieValue(m.site, m.name), dropSite, always: (m) => always(m.site, m.name, m.on !== false), pause: (m) => pause(m.minutes), resume, approve: (m) => approve(m.group, m.site, m.name), notNow, unstop: (m) => unstop(m.site), unskip: (m) => unskip(m.site), histOn: (m) => histOn(m.on), clearBrowsing, unparam: (m) => unparam(m.name), postpone: (m) => postpone(m.group, m.minutes),
  setMode: (m) => setMode(m.group, m.mode), setMaster: (m) => setMaster(m.on), allow: (m) => allow(m.site, m.name, true),
  revertAllow: (m) => allow(m.site, m.name, false), siteOff: (m) => siteOff(m.host, m.on),
  restore: (m) => isHost(m.site) && typeof m.name === 'string' ? restore((c) => bare(c.domain) === m.site && c.name === m.name) : Promise.resolve({ ok: false }),
  restoreAll: () => restore(() => true), drop,
  // the private history, for the extension's own page; "Clear history" empties it
  history: async () => ({ ok: true, ...historyTrim((await chrome.storage.local.get('history')).history, Date.now()) }),
  clearHistory: async () => { await serial(() => chrome.storage.local.remove(['history', 'mine'])); return { ok: true }; } };

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
    else if (m.kind === 'servers') { await clearCache(); await logged([{ cap: 'C11', kind: 'cache', site: '*', name: 'http-cache' }], 'removed'); }
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
  if (serverOn(cx)) try { l = await (await fetch('http://127.0.0.1:8088/audit/limits.json', { cache: 'no-store' })).json(); } catch {}
  else { back = !S.CLEAN || S.MODE !== 'normal'; ON = BLOCK = YT = DROPS = S.CLEAN = true; S.MODE = 'normal'; S.ALLOW = []; SERVER_BLACK = []; }
  if (l) SERVER_BLACK = Array.isArray(l.cookieBlacklist) ? l.cookieBlacklist : [];
  // The blacklist: the user's own always-delete list (`always`, needs no server) and the server's when it has answered.
  // A list counts only while its capability runs; otherwise the normal rules judge the cookie.
  // The blacklist also counts while C07 asks or is held, so its cookies can be queued (see judge); allow-list
  // mode does not: asking about every cookie of every site would only fill the queue.
  const next = verdict('C07', cx) !== 'no' ? [...(cx.set.always || []).map((a) => ({ h: a.site, n: a.name })), ...SERVER_BLACK] : [];
  let again = back || next.some((b) => !S.BLACK.some((x) => x.h === b.h && x.n === b.n)); S.BLACK = next;
  S.EXTRA = mayRun('C25', cx.set) !== 'no' ? cx.set.stopped || [] : [];
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
const YT_CSS = { id: 'yt-adfree-css', matches: ['*://*.youtube.com/*'], css: ['yt-adfree.css'], runAt: 'document_start', allFrames: true };
async function applyFeatures() {
  const cx = await context(), yt = YT && can('C05', cx), pings = BLOCK && can('C26', cx);
  // url-params (C23) is not request blocking: the server's blocking switch does not reach it
  const want = { trackers: BLOCK && can('C01', cx), 'google-paths': BLOCK && can('C02', cx), 'url-params': can('C23', cx) };
  try { const on = await chrome.declarativeNetRequest.getEnabledRulesets(), ids = Object.keys(want);
    const enableRulesetIds = ids.filter((id) => want[id] && !on.includes(id)), disableRulesetIds = ids.filter((id) => !want[id] && on.includes(id));
    if (enableRulesetIds.length || disableRulesetIds.length) await chrome.declarativeNetRequest.updateEnabledRulesets({ enableRulesetIds, disableRulesetIds }); } catch {}
  const stopped = BLOCK && mayRun('C25', cx.set) !== 'no' && !cx.hold.paused ? cx.set.stopped || [] : [];
  const strip = mayRun('C27', cx.set) !== 'no' && !cx.hold.paused ? cx.set.params || [] : [];
  await learnedRules([...(!stopped.length ? [] : [{ id: LEARNED + 1, priority: 1, action: { type: 'block' },
    condition: { requestDomains: stopped, domainType: 'thirdParty', resourceTypes: TYPES, excludedInitiatorDomains: SIGNIN_HOSTS } }]),
    // C27: the tags the user chose to cut off, on every page address but a sign-in's
    ...(!strip.length ? [] : [{ id: LEARNED + 2, priority: 1, action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: strip } } } },
      condition: { resourceTypes: ['main_frame'], excludedRequestDomains: SIGNIN_HOSTS } }]),
    // C26: a page telling another company what was pressed or how long it was read (the request kind "ping")
    ...(!pings ? [] : [{ id: LEARNED + 3, priority: 1, action: { type: 'block' },
      condition: { resourceTypes: ['ping'], domainType: 'thirdParty', excludedInitiatorDomains: SIGNIN_HOSTS, excludedRequestDomains: SIGNIN_HOSTS } }]),
    // S8: no calls from a page to this computer (net-rules.js)
    ...netRules({ local: BLOCK && can('C31', cx), self: chrome.runtime.id })]);
  // S4, S5: what other companies get less of; left alone: sign-in hosts, the companies pages need, the sites cleaning is off for,
  // and, while the sign-in guard holds, the tabs a sign-in page was seen in (session rules: only those can name tabs)
  try { let { gtabs = [] } = await chrome.storage.session.get('gtabs');
    if (!cx.hold.guard && gtabs.length) await chrome.storage.session.set({ gtabs: gtabs = [] });
    const guardTabs = cx.hold.guard ? [...new Set([...gtabs, ...cx.tabs.filter((t) => isSignIn(t.url || t.pendingUrl)).map((t) => t.id)])].sort((a, b) => a - b) : [];
    const want = netRules({ cookies: BLOCK && can('C29', cx), tags: BLOCK && can('C30', cx), exempt: [...SIGNIN_HOSTS, 'github.com', ...NEEDED, ...(cx.set.sitesOff || [])], guardTabs });
    const old = (await chrome.declarativeNetRequest.getSessionRules()).filter((r) => r.id >= NET_BASE && r.id < NET_BASE + 10);
    if (JSON.stringify(old) !== JSON.stringify(want)) await chrome.declarativeNetRequest.updateSessionRules({ removeRuleIds: old.map((r) => r.id), addRules: want }); } catch {}
  // what skip.js reads: the passing sites (none while paused, switched off or during a sign-in) and the sites not to touch
  const { bounce = {}, noskip = [], skip: was } = await chrome.storage.local.get(['bounce', 'noskip', 'skip']);
  const skip = { sites: can('C27', cx) ? Object.keys(bounce).filter((s) => !noskip.includes(s)) : [], off: cx.set.sitesOff || [] };
  if (JSON.stringify(skip) !== JSON.stringify(was)) await chrome.storage.local.set({ skip });
  try { const have = (await chrome.scripting.getRegisteredContentScripts()).map((x) => x.id);
    const want = [...(yt ? [YT_JS, YT_CSS] : []), ...(pings ? [NO_PING] : []), ...(mayRun('C27', cx.set) === 'run' && !cx.hold.paused ? [SKIP] : [])], add = want.filter((x) => !have.includes(x.id)), drop = have.filter((id) => !want.some((x) => x.id === id));
    if (add.length) await chrome.scripting.registerContentScripts(add);
    if (drop.length) await chrome.scripting.unregisterContentScripts({ ids: drop }); } catch {}
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
  await wifiSweep(cx, wait); await followSweep(cx, all, wait); await bounceSweep(cx, wait); await ownSweep(cx, wait); await historySweep(cx);
  const now = new Set(wait.map(queueKey));
  await queueUp(wait, (it) => now.has(queueKey(it)));
  await report({ reason: cause, scanned: all.length, removed, kept, ...rest });
}

// ---- Trackers on no list (C25, learn.js). Every request a page makes to another company is counted, privately: on
// how many sites was that company seen. Seen on FOLLOW_N sites and able to recognise the user (a cookie of its own that
// other sites can use), or handed a visited site's own ID and answering with such a cookie (S6), it is stopped, or on
// "Ask first" offered: "X followed you on 2 sites. Stop it?". Stopped = blocked when
// another site asks for it (one dynamic rule, above LEARNED; the rules below it are siteOff's), its cookies deleted,
// and from then on judged like a listed tracker (core.js EXTRA). Never learned: a company people sign in with.
const LEARNED = 100000, TYPES = ['script', 'xmlhttprequest', 'image', 'ping', 'sub_frame', 'media', 'other', 'websocket', 'font', 'stylesheet'];
const sig = (r) => JSON.stringify([r.id, r.condition.requestDomains, r.condition.excludedRequestDomains, r.condition.regexFilter, r.action]);
async function learnedRules(want) {
  try { const old = (await chrome.declarativeNetRequest.getDynamicRules()).filter((r) => r.id > LEARNED);
    if (old.map(sig).join() === want.map(sig).join()) return;
    try { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id), addRules: want }); }
    // Chrome refuses the whole change when it refuses one rule: then each rule is tried alone, so that one bad rule cannot take the others down
    catch { await chrome.declarativeNetRequest.updateDynamicRules({ removeRuleIds: old.map((r) => r.id) });
      for (const r of want) try { await chrome.declarativeNetRequest.updateDynamicRules({ addRules: [r] }); } catch {} } } catch {}
}
// "Not now" on one question (site and name) or on all about a site: not asked again for LATER_MS
const later = (cx, id, site, name) => [`${id} ${site}`, `${id} ${site} ${name}`].some((k) => (cx.set.later || {})[k] > Date.now());
async function notNow(m) {
  const g = GROUPS.find((x) => x.id === m.group), now = Date.now();
  if (!g || typeof m.site !== 'string' || !m.site) return { ok: false };
  const old = Object.entries((await chrome.storage.local.get('later')).later || {}).filter(([, t]) => t > now);
  await chrome.storage.local.set({ later: Object.fromEntries([...old, ...g.caps.map((id) => [`${id} ${m.site}${typeof m.name === 'string' ? ' ' + m.name : ''}`, now + LATER_MS])]) });
  await sweep('settings');
  return { ok: true };
}
// Sites the user opens as pages themselves: a short hash each, made with a random value of this install (`salt`), never
// the name; the MINE_MAX opened last, emptied by "Clear history". The user may be signed in there, so nothing
// automatic deletes such a site's cookies or empties what it saved: it is only blocked elsewhere. A page counts when
// its tab is still on that site MINE_WAIT_MS later: one that passes the browser straight on cannot put itself here.
const MINE_MAX = 2000, MINE_WAIT_MS = 3000;
function visited(cx, site) { return !!cx.set.salt && (cx.set.mine || []).includes(mark(`${cx.set.salt} ${site}`)); }
async function notePage(d) {
  if (d.type !== 'main_frame' || !(d.statusCode >= 200 && d.statusCode < 300) || !(d.tabId >= 0)) return;
  let u; try { u = new URL(d.url); } catch { return; }
  const site = siteOf(u.hostname);
  if (/^https?:$/.test(u.protocol)) setTimeout(async () => {
    const tab = await chrome.tabs.get(d.tabId).catch(() => null);
    if (!tab || siteOf(hostOf(tab.url)) !== site) return;
    await serial(async () => { let { mine = [], salt } = await chrome.storage.local.get(['mine', 'salt']);
      if (!salt) salt = [...crypto.getRandomValues(new Uint8Array(16))].map((x) => x.toString(16).padStart(2, '0')).join('');
      const m = mark(`${salt} ${site}`);
      if (mine.at(-1) !== m) await chrome.storage.local.set({ salt, mine: [...mine.filter((x) => x !== m), m].slice(-MINE_MAX) }); }); }, MINE_WAIT_MS);
}
try { chrome.webRequest.onCompleted.addListener((d) => { notePage(d); }, { urls: ['<all_urls>'], types: ['main_frame'] }); } catch {}
const signInCompany = (site) => site === 'github.com' || isGoogleHost(site) || NEEDED.includes(site) || SIGNIN_HOSTS.some((h) => siteOf(h) === site);
const seen = new Set();   // what this worker has counted already, so that a page's hundred requests cost one look
// The site a sighting is counted for is the one the user has in the tab (its address bar), never the frame that asked:
// one page cannot stand for three sites by holding three frames. A request that belongs to no tab is not counted.
const tabSite = new Map();
const topSite = async (tabId) => { if (!tabSite.has(tabId)) { if (tabSite.size > 500) tabSite.clear(); tabSite.set(tabId, siteOf(hostOf(((await chrome.tabs.get(tabId).catch(() => null)) || {}).url))); } return tabSite.get(tabId); };
chrome.tabs.onUpdated.addListener((id, info) => { if (info.url) tabSite.delete(id); });
chrome.tabs.onRemoved.addListener((id) => { tabSite.delete(id); });
async function noteRequest(d) {
  if (d.type === 'main_frame' || !(d.tabId >= 0)) return;
  let u; try { u = new URL(d.url); } catch { return; }
  if (!/^https?:$/.test(u.protocol)) return;
  const site = siteOf(u.hostname), page = await topSite(d.tabId), key = `${u.host} ${page}`;   // an ID in the address is no evidence (anyone can write one): followSweep asks for a real cookie
  if (!page || site === page || isSignIn(d.url) || isTrackerHost(u.hostname) || signInCompany(site)) return;
  // S6: does this request hand the company the ID that the visited site keeps for the user (address or what is sent)?
  let sent = false;
  if (!handed.has(`${site} ${page}`)) try { const ids = await ownIds(page);
    sent = ids.size > 0 && carries(ids, safeDecode(d.url) + ' ' + bodyText(d.requestBody), SYNC_SALT);
    if (sent) { if (handed.size > 2000) handed.clear(); handed.add(`${site} ${page}`); } } catch {}
  if (seen.has(key) && !sent) return;
  if (seen.size > 5000) seen.clear();
  seen.add(key); await ready;
  if (mayRun('C25', await chrome.storage.local.get(['master', 'modes'])) === 'no') return;
  let full = false;
  await serial(async () => { const next = followNote((await chrome.storage.local.get('follow')).follow, site, u.host, page, false, Date.now(), sent);
    if (next) { await chrome.storage.local.set({ follow: next }); full = followFull(next[site]); } });
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
  const ok = (d.responseHeaders || []).some((h) => String(h.name).toLowerCase() === 'set-cookie' && /;\s*samesite=none/i.test(h.value) && idLike(String(h.value).split(';')[0].split('=').slice(1).join('=')));
  let u; try { u = new URL(d.url); } catch { return; }
  if (!ok || !/^https?:$/.test(u.protocol)) return;
  const site = siteOf(u.hostname), page = await topSite(d.tabId);
  if (!page || site === page || isSignIn(d.url) || isTrackerHost(u.hostname) || signInCompany(site)) return;
  await ready;
  if (mayRun('C25', await chrome.storage.local.get(['master', 'modes'])) === 'no') return;
  let full = false;
  await serial(async () => { const next = followNote((await chrome.storage.local.get('follow')).follow, site, u.host, page, true, Date.now());
    if (next) { await chrome.storage.local.set({ follow: next }); full = followFull(next[site]); } });
  if (full) sweep('learned');
}
try { chrome.webRequest.onBeforeRequest.addListener((d) => { noteRequest(d); }, { urls: ['<all_urls>'] }, ['requestBody']); } catch {}
try { chrome.webRequest.onHeadersReceived.addListener((d) => { noteAnswer(d); }, { urls: ['<all_urls>'] }, ['responseHeaders', 'extraHeaders']); } catch {}
async function followSweep(cx, all, wait) {
  const v = verdict('C25', cx), stopped = cx.set.stopped || [];
  if (v === 'no') return;
  const hasId = (site) => all.some((c) => under(bare(c.domain), site) && (c.sameSite === 'no_restriction' || c.partitionKey) && !KEEP_RE.test(c.name) && idLike(c.value));
  const { follow = {}, stops = [] } = await chrome.storage.local.get(['follow', 'stops']), now = Date.now(), recent = stops.filter((t) => t > now - 3600e3), n = recent.length;
  for (const [site, e] of Object.entries(follow)) {
    // evidence: on FOLLOW_N sites, a cookie of its own that other sites can use (in Chrome's list, or tried in its answer);
    // on one site (`sent`), only its own answer counts: a page must not get a company stopped that never asked for anything
    const many = e.on.length >= FOLLOW_N;
    if (!followFull(e) || stopped.includes(site) || later(cx, 'C25', site) || !(e.ck || (many && hasId(site)))) continue;
    const it = { cap: 'C25', kind: 'tracker', site, name: many ? `followed you on ${FOLLOW_N} sites` : 'was handed the ID a site keeps for you', why: 'on no list', did: waitsAs(v) };
    if (waits(v)) wait.push(it);
    else if (recent.length >= STOPS_HOUR) wait.push({ ...it, did: 'queued' });   // too many in an hour to be an accident: the user is asked
    else if (await stopTracker(site, visited(cx, site))) { recent.push(now); await logged([it], 'removed'); } }
  if (recent.length !== n || stops.length !== n) await chrome.storage.local.set({ stops: recent });
}
// its sign-in cookies stay (KEEP_RE), and all of them while the user has its own site open
async function stopTracker(site, keep) {
  if (!isHost(site)) return false;
  const { stopped = [] } = await chrome.storage.local.get('stopped');
  if (!stopped.includes(site)) { if (stopped.length >= STOPPED_MAX) return false; await chrome.storage.local.set({ stopped: [...stopped, site] }); }
  await refreshBlacklist();
  const cx = await context(), gone = [];
  if (!keep) for (const c of await allCookies()) if (under(bare(c.domain), site) && !signinLike(c) && !firstParty(c, cx.hosts) && await remove(c)) gone.push({ cap: 'C25', kind: 'cookie', site: bare(c.domain), name: c.name });
  await logged(gone, 'removed');
  // a saved copy can carry the ID and bring it back: the saved copies go with the stop
  // (clearing them for the tracker's addresses alone was tried in a real Chrome: it leaves the compiled copy of its script and the remembered server)
  await copiesNow(cx); chrome.alarms.create('copies', { when: Date.now() + 60e3 });   // once more a minute later: pages still open may have saved new ones
  return true;
}
// "Let it through again": the block goes, and it is not offered again for a while
async function unstop(site) {
  const { stopped: was = [], own = {} } = await chrome.storage.local.get(['stopped', 'own']), stopped = was.filter((s) => s !== site);
  // its notifications were blocked by C28: Chrome can only take back all blocks this extension set, so the others are set again at the sweep that follows
  if (own[site]) try { await chrome.contentSettings.notifications.clear({}); } catch {}
  await chrome.storage.local.set({ stopped, own: Object.fromEntries(Object.entries(own).filter(([s]) => s !== site).map(([s, e]) => [s, { ...e, at: 0, mute: false }])) });
  return { ...(await notNow({ group: 'unknown', site })), stopped };
}

// ---- Sites that only pass you along (C27, learn.js bounceAdded). A page address that answers "go to another site" has
// shown the user nothing, yet it can save a cookie and add an ID to the next address. Kept privately in
// chrome.storage.local { bounce: { '<site>': { n: passes, done: passes cleaned up after, hosts, params: names it added } } }.
// Two questions per site, each asked once per need: delete what it saved, and cut the added name off every address
// (`params`, one dynamic rule). Left alone: anything on the way of a sign-in, and a site the user has open in a tab.
const BOUNCE_MAX = 100, PASSED = 'passed you on without showing a page';
async function noteRedirect(d) {
  if (d.type !== 'main_frame') return;
  let a, b; try { a = new URL(d.url); b = new URL(d.redirectUrl); } catch { return; }
  const site = siteOf(a.hostname);
  if (!/^https?:$/.test(a.protocol) || !/^https?:$/.test(b.protocol) || site === siteOf(b.hostname) || isSignIn(d.url) || isSignIn(d.redirectUrl) || signInCompany(site)) return;
  await ready;
  const cx = await context();
  if (mayRun('C27', cx.set) === 'no' || cx.hold.guard || cx.hosts.some((h) => siteOf(h) === site)) return;
  await serial(async () => { const { bounce = {} } = await chrome.storage.local.get('bounce'), old = bounce[site] || { n: 0, done: 0, hosts: [], params: [] };
    bounce[site] = { n: old.n + 1, done: old.done, t: Date.now(), hosts: [...new Set([...old.hosts, a.host])].slice(0, 5), params: [...new Set([...old.params, ...bounceAdded(d.url, d.redirectUrl)])].slice(0, 10) };
    await chrome.storage.local.set({ bounce: Object.fromEntries(Object.entries(bounce).sort((x, y) => y[1].t - x[1].t).slice(0, BOUNCE_MAX)) }); });
  sweep('passed on');
}
try { chrome.webRequest.onBeforeRedirect.addListener((d) => { noteRedirect(d); }, { urls: ['<all_urls>'] }); } catch {}
async function bounceSweep(cx, wait) {
  const v = verdict('C27', cx), cut = cx.set.params || [], done = [];
  if (v === 'no') return;
  for (const [site, e] of Object.entries((await chrome.storage.local.get('bounce')).bounce || {})) {
    const asks = [...(e.n > e.done && !cx.hosts.some((h) => siteOf(h) === site) ? [{ kind: 'bounce', name: PASSED }] : []), ...e.params.filter((p) => !cut.includes(p)).map((name) => ({ kind: 'param', name }))];
    for (const x of asks) { const it = { cap: 'C27', site, why: 'a redirect', did: waitsAs(v), ...x };
      if (later(cx, 'C27', site, x.name) || (x.kind === 'bounce' && v === 'run' && visited(cx, site))) continue;
      // a tag is never cut off by itself: the rule works on every address of every site, so it is always a question (1.25, F2)
      if (waits(v) || x.kind === 'param') wait.push({ ...it, did: v === 'held' ? 'held' : 'queued' }); else if (await carry(it).catch(() => false)) done.push(it); } }
  await logged(done, 'removed');
}
async function cleanBounce(site) {
  const e = ((await chrome.storage.local.get('bounce')).bounce || {})[site], gone = [];
  if (!e) return false;
  for (const c of await allCookies()) if (under(bare(c.domain), site) && !signinLike(c) && await remove(c)) gone.push({ cap: 'C27', kind: 'cookie', site: bare(c.domain), name: c.name });
  await dropStorage(e.hosts);
  await serial(async () => { const { bounce = {} } = await chrome.storage.local.get('bounce'); if (bounce[site]) { bounce[site].done = bounce[site].n; await chrome.storage.local.set({ bounce }); } });
  await logged(gone, 'removed');
  return true;
}
async function stripParam(name) {
  const { params = [] } = await chrome.storage.local.get('params');
  if (typeof name !== 'string' || !name) return false;
  if (!params.includes(name)) await chrome.storage.local.set({ params: [...params, name].slice(-50) });
  await applyFeatures();
  return true;
}
// "Let it through again" for a passing site: its links are no longer changed (at most 100 such sites are remembered)
async function unskip(site) {
  if (!isHost(site)) return { ok: false };
  const { noskip = [] } = await chrome.storage.local.get('noskip');
  await chrome.storage.local.set({ noskip: [...noskip.filter((s) => s !== site), site].slice(-BOUNCE_MAX) }); await applyFeatures();
  return { ok: true };
}
// "Stop cutting it off": the name is forgotten everywhere, and asked about again only when a site adds it again
async function unparam(name) {
  const params = ((await chrome.storage.local.get('params')).params || []).filter((p) => p !== name);
  await serial(async () => { const { bounce = {} } = await chrome.storage.local.get('bounce');
    for (const e of Object.values(bounce)) e.params = e.params.filter((p) => p !== name);
    await chrome.storage.local.set({ params, bounce }); });
  await sweep('settings');
  return { ok: true, params };
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
  const { own = {}, stopped = [] } = await chrome.storage.local.get(['own', 'stopped']);   // read now: this sweep may just have stopped one
  // what is kept per company goes with the company: `own` never outgrows the list of the stopped
  const stale = Object.keys(own).filter((k) => k !== LISTED && !stopped.includes(k)); for (const k of stale) delete own[k];
  if (stale.length) await chrome.storage.local.set({ own });
  // its notifications are blocked at once, also while its own page is open or the user uses its site: nothing there is deleted by this
  if (v === 'run') for (const site of stopped) if (!(own[site] || {}).mute) try { await chrome.contentSettings.notifications.set({ primaryPattern: `*://*.${site}/*`, setting: 'block' });
    own[site] = { ...own[site], mute: true }; await chrome.storage.local.set({ own }); done.push({ cap: 'C28', kind: 'permission', site, name: 'notifications' }); } catch {}
  for (const site of [...stopped, ...(mayRun('C28', cx.set) === 'run' ? [LISTED] : [])]) { const e = own[site] || {};
    if (e.at > now - CACHE_MS || later(cx, 'C28', site, OWN) || (!e.ok && visited(cx, site)) || (site !== LISTED && cx.hosts.some((h) => under(h, site)))) continue;
    const it = { cap: 'C28', kind: 'own', site, name: OWN, why: 'a tracker', did: waitsAs(v) };
    if (v === 'run' || (v === 'ask' && e.ok && !cx.hold.guard && !cx.hold.paused && cx.set.master === true)) { if (await cleanOwn(site, cx).catch(() => false)) done.push(it); }
    else wait.push(it); }
  await logged(done, 'removed');
}
async function cleanOwn(site, cx) {
  const { own = {}, follow = {} } = await chrome.storage.local.get(['own', 'follow']);
  const sites = site === LISTED ? DOMAINS.filter((d) => !cx.hosts.some((h) => under(h, d)) && !visited(cx, siteOf(d))) : [site];
  await dropStorage([...new Set(sites.flatMap((s) => [s, 'www.' + s, ...((follow[s] || {}).hosts || [])]))]);
  for (const s of sites) if (!(own[s] || {}).mute) await chrome.contentSettings.notifications.set({ primaryPattern: `*://*.${s}/*`, setting: 'block' });
  await chrome.storage.local.set({ own: { ...own, [site]: { ...own[site], ok: true, at: Date.now(), ...(site === LISTED ? {} : { mute: true }) } } });
  return true;
}

// ---- Trackers' pages in Chrome's history (S11). Only with the optional `history` permission, which the popup asks for
// at a press of its button, and only while the user's switch (`histOn`) is on: once a day the pages on the own
// addresses of stopped and listed trackers are taken out of the history. Chrome is asked for the entries that name a
// tracker's site; each address is compared with that site and deleted or left, and is kept nowhere. Never a site the
// user opens as a page or has open, never while paused, off or during a sign-in.
async function historySweep(cx) {
  if (cx.set.histOn !== true || cx.set.master !== true || cx.hold.paused || cx.hold.guard) return;
  const { histAt = 0, stopped = [] } = await chrome.storage.local.get(['histAt', 'stopped']), done = [];
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
try { chrome.runtime.onUpdateAvailable.addListener(async () => { const cx = await context(); if (can('C15', cx) && !cx.hold.guard) chrome.runtime.reload(); }); } catch {}

// ---- Permanent drops (made permanent in the popup → settings → limits.json): site storage dropped and
// site permissions blocked at every sweep. Cookies use the cookie blacklist (cookieBlacklist) above.
const dropStorage = (site) => chrome.browsingData.remove({ origins: [].concat(site).flatMap((s) => [`https://${s}`, `http://${s}`]) },
  { localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true, fileSystems: true, webSQL: true });
const blockPermission = (site, perm) => chrome.contentSettings[perm].set({ primaryPattern: `${site}/*`, setting: 'block' });
async function applyPermanentDrops(cx, wait) {
  const storage = verdict('C07', cx), perms = verdict('C09', cx);
  if (!DROPS || (storage === 'no' && perms === 'no')) return {};
  let l; try { if (!serverOn(cx)) return {}; l = await (await fetch(LIMITS, { cache: 'no-store' })).json(); } catch { return {}; }
  const done = [];
  for (const site of storage !== 'no' && Array.isArray(l.storageBlacklist) ? l.storageBlacklist : []) {
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
// State); cookies and logins are untouched. Local since 1.21, no 8088 server involved: offered (ask) or done
// (auto) at most once in 24 hours, counted from cacheClearedAt in storage.
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
const clearCache = async () => { await chrome.browsingData.remove({ since: 0 }, { cache: true }); await chrome.storage.local.set({ cacheClearedAt: Date.now() }); };
const copiesNow = async (cx) => { if (can('C11', cx)) try { await clearCache(); await logged([{ cap: 'C11', kind: 'cache', site: '*', name: 'http-cache' }], 'removed'); } catch {} };
// a minute after a stop, and when Chrome starts while a tracker is stopped
const copiesAgain = async () => { await ready; const cx = await context(); if ((cx.set.stopped || []).length) await copiesNow(cx); };
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'copies') copiesAgain(); });
chrome.runtime.onStartup.addListener(copiesAgain);
chrome.runtime.onInstalled.addListener(copiesAgain);   // loaded again: Chrome drops the wake-up set before
async function forgetServers(cx, wait) {
  const v = verdict('C11', cx);
  if (v === 'no' || cx.set.cacheClearedAt > Date.now() - CACHE_MS) return {};
  const it = { cap: 'C11', kind: 'cache', site: '*', name: 'http-cache', why: 'daily', did: waitsAs(v) };
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
  // 1.25: a new install is switched on, and the popup says once what now happens by itself and where the switch is
  const { master } = await chrome.storage.local.get('master'), [a, b] = String((d || {}).previousVersion).split('.').map(Number);
  if (d && d.reason === 'install' && master === undefined) await chrome.storage.local.set({ master: true, firstRun: true });
  // an update from before 1.25 with cleaning on: four groups now run without asking, and the popup says that once
  if (d && d.reason === 'update' && master === true && (a < 1 || (a === 1 && b < 25))) await chrome.storage.local.set({ firstRun: 'update' });
  // a fresh install has cleared nothing yet: count the 24 hours of C11 from now, so the first sweep does not offer it
  if (!('cacheClearedAt' in await chrome.storage.local.get('cacheClearedAt'))) await chrome.storage.local.set({ cacheClearedAt: Date.now() });
  return sweep('installed');
});
chrome.runtime.onStartup.addListener(() => sweep('chrome-start'));

// ---- Tab limit (settings on 127.0.0.1:8088/settings → /audit/limits.json): at each sweep keep only
// chromeTabs tabs and close the rest. First ONE tab for each preferred site (e.g. one Spotify, one
// YouTube), then the most active other tabs. Within a group the best tab wins: playing audio, then the
// focused tab, then most recently used. chromeTabs 0 = off. If the audit server is down, nothing is closed.
const LIMITS = 'http://127.0.0.1:8088/audit/limits.json';
async function tabLimit() {
  try { const l = await (await fetch(LIMITS, { cache: 'no-store' })).json();
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
  if (cx.hold.guard && !cx.hold.paused) return;   // a sign-in is going on: do not change the network path under it
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
  if (ch.master || ch.modes || ch.pauseUntil || ch.stopped || ch.params || ch.bounce || ch.noskip || ch.sitesOff || ch.guardUntil) { applyFeatures(); applyProxy(); }
  if (ch.pending || ch.pauseUntil || ch.guardUntil) badge();
  // the sign-in guard was armed: wake up when it ends, so that what it held is done then and not at the next quarter-hour sweep
  if (ch.guardUntil && ch.guardUntil.newValue > Date.now()) chrome.alarms.create('unguard', { when: ch.guardUntil.newValue + 1000 });
});
badge();
