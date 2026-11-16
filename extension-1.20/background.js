// Tracker Cleaner: deletes tracking cookies as soon as they are set and in a full sweep every 15 min
// (same rhythm as the fit-scan audit). Login/playback cookies in KEEP_RE are never touched, so Spotify
// stays logged in and playing. Tracker requests themselves are blocked by rules.json.
importScripts('lists.js');
const REPORT = 'http://127.0.0.1:8088/audit/cleaner';
const isTrackerHost = (h) => { h = h.toLowerCase().replace(/^\./, ''); return DOMAINS.some((d) => h === d || h.endsWith('.' + d)); };
// Proxied Fit-browser hosts look like www.example.com.localhost: judge them by the real host.
const realHost = (h) => h.replace(/^\./, '').replace(/(\.http)?\.localhost$/, '');
// Your blacklist (audit page / settings): deleted even when normally kept (sign-ins included).
let BLACK = [];
// exact site, or the real site (which then also covers its Fit-browser *.localhost copy)
const isBlack = (c) => BLACK.some((b) => (b.h === '*' || b.h === c.domain.replace(/^\./, '') || b.h === realHost(c.domain)) && b.n === c.name);
// Allow-list mode (settings): delete EVERY cookie except the allowed sign-ins (YouTube, Spotify).
let MODE = 'normal', ALLOW = [], CLEAN = true;   // CLEAN false = settings switch "delete cookies" is off
// Switches on 127.0.0.1:8088/tracker-cleaner (sent in limits.json). ON false = the whole extension does nothing.
let ON = true, BLOCK = true, YT = true, DROPS = true;
const STATE = () => ({ on: ON, cookies: CLEAN, blocking: BLOCK, yt: YT, drops: DROPS, v: chrome.runtime.getManifest().version });
const isAllowed = (c) => { const h = realHost(c.domain); return ALLOW.some((a) => (h === a.site || h.endsWith('.' + a.site)) && (a.names.includes('*') || a.names.includes(c.name))); };
// your blacklist always wins, also over the allow-list
const shouldGo = (c) => CLEAN && (isBlack(c) || (MODE === 'allowlist' ? !isAllowed(c)
  : (!KEEP_RE.test(c.name) && (COOKIE_RE.test(c.name) || isTrackerHost(realHost(c.domain))))));
async function refreshBlacklist() {
  try { const l = await (await fetch('http://127.0.0.1:8088/audit/limits.json', { cache: 'no-store' })).json();
    const next = Array.isArray(l.cookieBlacklist) ? l.cookieBlacklist : [];
    const grew = next.some((b) => !BLACK.some((x) => x.h === b.h && x.n === b.n)); BLACK = next;
    const mode = l.cookieMode === 'allowlist' && Array.isArray(l.cookieAllow) && l.cookieAllow.length ? 'allowlist' : 'normal';   // never delete everything by mistake
    const changed = mode !== MODE || JSON.stringify(l.cookieAllow || []) !== JSON.stringify(ALLOW);
    const clean = l.cookieClean !== false, turnedOn = clean && !CLEAN; CLEAN = clean;
    ON = l.enabled !== false; BLOCK = ON && l.blocking !== false; YT = ON && l.ytAds !== false; DROPS = ON && l.drops !== false;
    await applyFeatures();
    MODE = mode; ALLOW = l.cookieAllow || []; return grew || changed || turnedOn; } catch { return false; }
}

// Tracker blocking (rules.json) and the YouTube ad remover follow their switches.
const YT_JS = { id: 'yt-adfree', matches: ['*://*.youtube.com/*'], js: ['yt-adfree.js'], runAt: 'document_start', world: 'MAIN', allFrames: true };
const YT_CSS = { id: 'yt-adfree-css', matches: ['*://*.youtube.com/*'], css: ['yt-adfree.css'], runAt: 'document_start', allFrames: true };
async function applyFeatures() {
  try { const on = (await chrome.declarativeNetRequest.getEnabledRulesets()).includes('trackers');
    if (on !== BLOCK) await chrome.declarativeNetRequest.updateEnabledRulesets(BLOCK ? { enableRulesetIds: ['trackers'] } : { disableRulesetIds: ['trackers'] }); } catch {}
  try { const have = (await chrome.scripting.getRegisteredContentScripts()).map((x) => x.id);
    if (YT && !have.includes(YT_JS.id)) await chrome.scripting.registerContentScripts([YT_JS, YT_CSS].filter((x) => !have.includes(x.id)));
    if (!YT && have.length) await chrome.scripting.unregisterContentScripts({ ids: have.filter((id) => id.startsWith('yt-adfree')) }); } catch {}
}

async function remove(c) {
  const url = (c.secure ? 'https://' : 'http://') + c.domain.replace(/^\./, '') + c.path;
  const d = { url, name: c.name, storeId: c.storeId }; if (c.partitionKey) d.partitionKey = c.partitionKey;
  try { return !!(await chrome.cookies.remove(d)); } catch { return false; }
}

async function sweep(reason) {
  await refreshBlacklist();
  let all;
  try { all = await chrome.cookies.getAll({ partitionKey: {} }); } catch { all = await chrome.cookies.getAll({}); }
  const removed = [];
  for (const c of all) if (shouldGo(c) && await remove(c)) removed.push(`${realHost(c.domain)} ${c.name}`);
  const kept = all.filter((c) => KEEP_RE.test(c.name)).map((c) => `${realHost(c.domain)} ${c.name}`);
  selfUpdate();
  await report({ reason, scanned: all.length, removed, kept, ...(await enforceTabs()), ...(await forgetServers()), ...(await applyPermanentDrops()) });
}

// ---- Self-update: Chrome's own check runs only every few hours; ask at every sweep, reload when a new version is ready.
function selfUpdate() { try { chrome.runtime.requestUpdateCheck(() => {}); } catch {} }
try { chrome.runtime.onUpdateAvailable.addListener(() => chrome.runtime.reload()); } catch {}

// ---- Permanent drops (made permanent in the popup → settings → limits.json): site storage dropped and
// site permissions blocked at every sweep. Cookies use the cookie blacklist (cookieBlacklist) above.
async function applyPermanentDrops() {
  if (!DROPS) return {};
  let l; try { l = await (await fetch(LIMITS, { cache: 'no-store' })).json(); } catch { return {}; }
  let n = 0;
  for (const site of Array.isArray(l.storageBlacklist) ? l.storageBlacklist : []) {
    try { await chrome.browsingData.remove({ origins: [`https://${site}`, `http://${site}`] },
      { localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true, fileSystems: true, webSQL: true }); n++; } catch {} }
  for (const p of Array.isArray(l.permissionBlacklist) ? l.permissionBlacklist : []) {
    try { await chrome.contentSettings[p.perm].set({ primaryPattern: `${p.site}/*`, setting: 'block' }); n++; } catch {} }
  return n ? { permanentDrops: n } : {};
}

// ---- Forget servers (settings → checks.chromeServers): the sweep sees hosts in Chrome's Network Persistent
// State and sets forgetServers in limits.json. Clearing the HTTP cache also clears that server list; cookies
// and logins are untouched.
async function forgetServers() {
  let want = false;
  try { want = !!(await (await fetch(LIMITS, { cache: 'no-store' })).json()).forgetServers; } catch { return {}; }
  if (!want) return {};
  try { await chrome.browsingData.remove({ since: 0 }, { cache: true }); return { serversForgotten: true }; }
  catch (e) { return { serversForgotten: false, serversError: String(e) }; }
}

let pending = [], timer = null;     // live removals are batched into one report
// the service worker may just have woken up: read the settings once before deleting anything
let ready = refreshBlacklist();
chrome.cookies.onChanged.addListener(async ({ removed, cookie }) => {
  if (removed) return;
  await ready;
  if (!shouldGo(cookie)) return;
  if (await remove(cookie)) {
    pending.push(`${realHost(cookie.domain)} ${cookie.name}`);
    clearTimeout(timer); timer = setTimeout(() => { const r = pending; pending = []; report({ reason: 'live', removed: r }); }, 5000);
  }
});

async function report(body) {
  try { await fetch(REPORT, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ t: Date.now(), state: STATE(), ...body }) }); } catch {}
}

chrome.alarms.create('sweep', { periodInMinutes: 15 });
chrome.alarms.onAlarm.addListener((a) => { if (a.name === 'sweep') sweep('every-15-min'); });
chrome.runtime.onInstalled.addListener(() => sweep('installed'));
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
async function enforceTabs() {
  const tabs = await chrome.tabs.query({ windowType: 'normal' });
  const limit = await tabLimit();
  if (limit === null) return { tabs: tabs.length };
  const focused = (await chrome.windows.getLastFocused().catch(() => null))?.id;
  const host = (t) => { try { return new URL(t.url || t.pendingUrl).host || t.url; } catch { return '?'; } };
  const score = (t) => (t.audible ? 4e15 : 0) + (t.active && t.windowId === focused ? 2e15 : 0) + (t.lastAccessed || 0);
  const ranked = tabs.sort((a, b) => score(b) - score(a));
  const keep = [];
  for (const site of limit.prefer) { const t = ranked.find((x) => host(x) === site && !keep.includes(x)); if (t && keep.length < limit.n) keep.push(t); }
  for (const t of ranked) { if (keep.length >= limit.n) break; if (!keep.includes(t) && !limit.prefer.includes(host(t))) keep.push(t); }
  const close = ranked.filter((t) => !keep.includes(t));
  if (close.length) await chrome.tabs.remove(close.map((t) => t.id)).catch(() => {});
  return { tabs: (await chrome.tabs.query({ windowType: 'normal' })).length, closedTabs: close.map(host), keptTabs: keep.map(host) };
}

// ---- Private browsing via Tor (settings → privacy.torChrome): Chrome's traffic goes through the local
// Tor service (socks5 127.0.0.1:9050). Local pages stay direct. Checked every minute; changes reported.
let proxyMode = null;
async function applyProxy() {
  let want = null;
  try { want = (await (await fetch(LIMITS, { cache: 'no-store' })).json()).torChrome ? 'tor' : 'direct'; } catch { return; }   // server down: leave as is
  if (want === proxyMode) return;
  if (want === 'tor') await chrome.proxy.settings.set({ scope: 'regular', value: { mode: 'fixed_servers', rules: {
    singleProxy: { scheme: 'socks5', host: '127.0.0.1', port: 9050 }, bypassList: ['127.0.0.1', 'localhost', '*.localhost', '[::1]'] } } });
  else await chrome.proxy.settings.clear({ scope: 'regular' });
  proxyMode = want;
  await report({ reason: 'proxy', removed: [], mode: want });
}
chrome.alarms.create('proxy', { periodInMinutes: 1 });
chrome.alarms.onAlarm.addListener(async (a) => { if (a.name === 'proxy') { applyProxy(); if (await refreshBlacklist()) sweep('blacklist'); } });
chrome.runtime.onStartup.addListener(applyProxy);
chrome.runtime.onInstalled.addListener(applyProxy);
