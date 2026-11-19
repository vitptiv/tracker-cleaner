// A small in-memory stand-in for the chrome.* APIs the extension uses. Every call is recorded in
// `calls`, so a test can assert that nothing was deleted: assert.deepEqual(fake.destructive(), []).
// const fake = require('./chrome-fake.js')({ cookies, tabs, manifest, storage }); global.chrome = fake.chrome;
const DESTRUCTIVE = ['cookies.remove', 'tabs.remove', 'browsingData.remove', 'proxy.settings.set', 'contentSettings.set'];

const ID = 'bnejmnaojaiobbkjfhmfcljlbjedmgag';   // this extension, as chrome.runtime.id

const vm = require('node:vm');
// What a script put into a page finds there. init.pages: { <tab id>: { local: { key: value }, session: { ... },
// databases: [names], caches: [names], workers: [scopes] } }; local or session null = the page may not use it.
const pageGlobals = (p) => {
  const box = (o) => Object.defineProperty({ ...o }, 'getItem', { value: (k) => (k in o ? o[k] : null) }), g = {};
  for (const [name, k] of [['localStorage', 'local'], ['sessionStorage', 'session']])
    Object.defineProperty(g, name, { get: () => { if (p[k] === null) throw new Error('The operation is insecure.'); return box(p[k] || {}); } });
  return Object.assign(g, { indexedDB: { databases: async () => (p.databases || []).map((name) => ({ name, version: 1 })) }, caches: { keys: async () => [...(p.caches || [])] },
    navigator: { serviceWorker: { getRegistrations: async () => (p.workers || []).map((scope) => ({ scope })) } } });
};

// Chrome hands a rule back with its fields in its own (alphabetical) order, not the order it was given in
const sorted = (v) => Array.isArray(v) ? v.map(sorted) : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])])) : v;
module.exports = function makeChrome(init = {}) {
  const calls = [];
  const state = { cookies: [], tabs: (init.tabs || []).map((t) => ({ windowId: 1, ...t })), storage: { ...init.storage }, alarms: {},
    rulesets: ((init.manifest || {}).declarative_net_request || { rule_resources: [{ id: 'trackers', enabled: true }] }).rule_resources.filter((r) => r.enabled).map((r) => r.id),
    scripts: [], proxy: null, dynamic: [], session: JSON.parse(JSON.stringify(init.session || {})), sync: {}, rules: [], history: (init.history || []).map((url) => ({ url })), granted: [...(init.granted || [])] };
  const badge = { text: '', color: null };
  // rec wraps an API function: logs the call, returns a promise like the real MV3 APIs
  const rec = (api, fn) => async (...args) => { calls.push({ api, args }); return fn(...args); };
  const event = () => { const ls = [];
    return { addListener: (f) => { ls.push(f); }, removeListener: (f) => { const i = ls.indexOf(f); if (i >= 0) ls.splice(i, 1); },
      fire: async (...a) => { let kept = false; for (const f of [...ls]) kept = (await f(...a)) === true || kept; return kept; } }; };   // kept: a listener will answer later

  const onChanged = event(), onAlarm = event(), onStored = event();
  const store = async (next) => { const ch = {};
    for (const k of new Set([...Object.keys(state.storage), ...Object.keys(next)])) if (JSON.stringify(state.storage[k]) !== JSON.stringify(next[k])) {
      ch[k] = {}; if (k in state.storage) ch[k].oldValue = state.storage[k]; if (k in next) ch[k].newValue = next[k]; }
    state.storage = next; if (Object.keys(ch).length) await onStored.fire(ch, 'local'); };
  const host = (url) => new URL(url).hostname, bare = (d) => d.replace(/^\./, '');
  const cookies = {
    onChanged,
    getAll: rec('cookies.getAll', (q = {}) => state.cookies.filter((c) => (!q.name || c.name === q.name) &&
      (!q.domain || bare(c.domain) === q.domain || bare(c.domain).endsWith('.' + q.domain))).map((c) => ({ ...c }))),
    set: rec('cookies.set', async (d) => {
      const c = { name: d.name || '', value: d.value || '', domain: d.domain || host(d.url), path: d.path || '/', secure: d.secure ?? d.url.startsWith('https:'),
        httpOnly: !!d.httpOnly, sameSite: d.sameSite || 'unspecified', storeId: d.storeId || '0', hostOnly: !d.domain, session: d.expirationDate == null };
      if (d.expirationDate != null) c.expirationDate = d.expirationDate;
      if (d.partitionKey) c.partitionKey = d.partitionKey;
      state.cookies = state.cookies.filter((x) => !(x.name === c.name && x.domain === c.domain && x.path === c.path));
      state.cookies.push(c); await onChanged.fire({ removed: false, cookie: { ...c }, cause: 'explicit' }); return { ...c };
    }),
    remove: rec('cookies.remove', async (d) => {
      const h = host(d.url), i = state.cookies.findIndex((c) => c.name === d.name && (h === bare(c.domain) || (!c.hostOnly && h.endsWith('.' + bare(c.domain)))));
      if (i < 0) return null;
      const [c] = state.cookies.splice(i, 1); await onChanged.fire({ removed: true, cookie: c, cause: 'explicit' });
      return { url: d.url, name: d.name, storeId: c.storeId };
    }),
  };
  for (const c of init.cookies || []) state.cookies.push({ value: '', path: '/', secure: true, httpOnly: false, sameSite: 'unspecified', storeId: '0',
    hostOnly: !c.domain.startsWith('.'), session: c.expirationDate == null, ...c });

  // a copy, as in Chrome: changing what get() returned must not change what is stored
  const pick = (keys) => { const s = JSON.parse(JSON.stringify(state.storage));
    if (keys == null) return { ...s };
    if (typeof keys === 'string') keys = [keys];
    if (Array.isArray(keys)) return Object.fromEntries(keys.filter((k) => k in s).map((k) => [k, s[k]]));
    return Object.fromEntries(Object.keys(keys).map((k) => [k, k in s ? s[k] : keys[k]])); };

  const chrome = {
    cookies,
    alarms: { onAlarm, create: (name, info) => { calls.push({ api: 'alarms.create', args: [name, info] }); state.alarms[name] = info; },
      clear: rec('alarms.clear', (name) => delete state.alarms[name]), getAll: rec('alarms.getAll', () => Object.entries(state.alarms).map(([name, i]) => ({ name, ...i }))) },
    storage: { onChanged: onStored, local: { get: rec('storage.local.get', pick),
      set: rec('storage.local.set', (o) => store({ ...state.storage, ...JSON.parse(JSON.stringify(o)) })),
      remove: rec('storage.local.remove', (k) => { const next = { ...state.storage }; for (const x of [].concat(k)) delete next[x]; return store(next); }) },
      // never used by the extension: recorded so that a test can say so
      sync: { get: rec('storage.sync.get', () => ({ ...state.sync })), set: rec('storage.sync.set', (o) => { Object.assign(state.sync, JSON.parse(JSON.stringify(o))); }) },
      // memory only in Chrome; no change events needed here
      session: { get: rec('storage.session.get', (k) => JSON.parse(JSON.stringify(k in state.session ? { [k]: state.session[k] } : {}))),
        set: rec('storage.session.set', (o) => { Object.assign(state.session, JSON.parse(JSON.stringify(o))); }) } },
    // query: only `active` is looked at (the page in front); every tab is in window 1
    tabs: { query: rec('tabs.query', (q = {}) => state.tabs.filter((t) => q.active === undefined || !!t.active === q.active).map((t) => ({ ...t }))),
      get: rec('tabs.get', (id) => { const t = state.tabs.find((x) => x.id === id); if (!t) throw new Error(`No tab with id: ${id}.`); return { ...t }; }),
      getCurrent: rec('tabs.getCurrent', () => undefined),   // as in a side panel or a popup: the page is not a tab
      create: rec('tabs.create', (t) => ({ id: 1000 + calls.length, ...t })),
      update: rec('tabs.update', (id, props) => { const t = state.tabs.find((x) => x.id === id); if (t) Object.assign(t, props); return t ? { ...t } : undefined; }),
      remove: rec('tabs.remove', (ids) => { ids = [].concat(ids); state.tabs = state.tabs.filter((t) => !ids.includes(t.id)); }),
      onCreated: event(), onUpdated: event(), onRemoved: event(), onActivated: event() },
    // a top-level navigation: a page link, a scripted (location.assign) or meta hand-off (onBeforeNavigate/onCommitted),
    // or an in-page history pushState (onHistoryStateUpdated). Tests fire these through fake.navigate.
    webNavigation: { onBeforeNavigate: event(), onCommitted: event(), onHistoryStateUpdated: event() },
    windows: { getLastFocused: rec('windows.getLastFocused', () => ({ id: 1 })), getCurrent: rec('windows.getCurrent', () => ({ id: 1 })) },
    // init.noPanel: Chrome refuses to open the side panel (it does so when the call does not come straight from a click)
    sidePanel: { open: rec('sidePanel.open', () => { if (init.noPanel) throw new Error('`sidePanel.open()` may only be called in response to a user gesture.'); }) },
    action: { setBadgeText: rec('action.setBadgeText', (d) => { badge.text = d.text; }), setBadgeBackgroundColor: rec('action.setBadgeBackgroundColor', (d) => { badge.color = d.color; }) },
    declarativeNetRequest: { getEnabledRulesets: rec('declarativeNetRequest.getEnabledRulesets', () => [...state.rulesets]),
      updateEnabledRulesets: rec('declarativeNetRequest.updateEnabledRulesets', (o) => {
        state.rulesets = [...new Set([...state.rulesets, ...(o.enableRulesetIds || [])])].filter((id) => !(o.disableRulesetIds || []).includes(id)); }),
      getDynamicRules: rec('declarativeNetRequest.getDynamicRules', () => sorted(JSON.parse(JSON.stringify(state.dynamic)))),
      // init.matched: { <tab id>: [the rule file of each request Chrome stopped or changed on that tab] }; none given = Chrome does not say
      getMatchedRules: rec('declarativeNetRequest.getMatchedRules', ({ tabId } = {}) => { if (!init.matched) throw new Error('This function may not be called this often.');
        return { rulesMatchedInfo: (init.matched[tabId] || []).map((rulesetId) => ({ rule: { ruleId: 1, rulesetId }, tabId, timeStamp: 0 })) }; }),
      getSessionRules: rec('declarativeNetRequest.getSessionRules', () => sorted(JSON.parse(JSON.stringify(state.rules)))),
      // one call is applied whole or not at all; fake.ruleLog keeps the rule ids there after every change, so a test can look for a gap
      updateSessionRules: rec('declarativeNetRequest.updateSessionRules', (o) => { if (fake.refuse && (o.addRules || []).some(fake.refuse)) throw new Error('Rule was skipped');
        state.rules = [...state.rules.filter((r) => !(o.removeRuleIds || []).includes(r.id)), ...JSON.parse(JSON.stringify(o.addRules || []))]; fake.ruleLog.push({ kind: 'session', ids: state.rules.map((r) => r.id) }); }),
      // fake.refuse(rule) true = Chrome refuses that rule, and with it the whole change (as it does)
      updateDynamicRules: rec('declarativeNetRequest.updateDynamicRules', (o) => { if (fake.refuse && (o.addRules || []).some(fake.refuse)) throw new Error('Rule was skipped');
        state.dynamic = [...state.dynamic.filter((r) => !(o.removeRuleIds || []).includes(r.id)), ...JSON.parse(JSON.stringify(o.addRules || []))]; fake.ruleLog.push({ kind: 'dynamic', ids: state.dynamic.map((r) => r.id) }); }) },
    webRequest: { onBeforeRequest: event(), onBeforeSendHeaders: event(), onBeforeRedirect: event(), onCompleted: event(), onHeadersReceived: event() },
    // any permission name works: chrome.contentSettings.camera.set(...)
    contentSettings: new Proxy({}, { get: (_, perm) => ({ set: rec('contentSettings.set', () => {}), clear: rec('contentSettings.clear', () => {}), perm }) }),
    browsingData: { remove: rec('browsingData.remove', () => {}) },
    // optional permissions: init.granted = those the user allowed. history: init.history = the addresses in Chrome's history;
    // search finds text anywhere in an address, as Chrome does
    permissions: { contains: rec('permissions.contains', (p) => (p.permissions || []).every((x) => state.granted.includes(x))) },
    history: { search: rec('history.search', (q) => { if (!state.granted.includes('history')) throw new Error('no permission');
        return state.history.filter((h) => h.url.includes(q.text)).slice(0, q.maxResults || 100).map((h) => ({ ...h })); }),
      deleteUrl: rec('history.deleteUrl', (d) => { state.history = state.history.filter((h) => h.url !== d.url); }) },
    proxy: { settings: { set: rec('proxy.settings.set', (d) => { state.proxy = d.value; }), clear: rec('proxy.settings.clear', () => { state.proxy = null; }),
      get: rec('proxy.settings.get', () => ({ value: JSON.parse(JSON.stringify(state.proxy || { mode: 'system' })), levelOfControl: state.proxy ? 'controlled_by_this_extension' : 'controllable_by_this_extension' })) } },
    // As Chrome: the function goes to the page as text (so it can use nothing from around it) and runs among the
    // page's own things; a chrome:// page, the web store and a tab that is gone are refused.
    scripting: { executeScript: rec('scripting.executeScript', async ({ target, func, args = [] }) => {
      const t = state.tabs.find((x) => x.id === target.tabId), page = (init.pages || {})[target.tabId];
      if (!t || !page || !/^https?:/.test(t.url) || host(t.url) === 'chromewebstore.google.com') throw new Error('Cannot access contents of the page.');
      return [{ frameId: 0, result: JSON.parse(JSON.stringify(await vm.runInNewContext(`(${func})(...${JSON.stringify(args)})`, pageGlobals(page)))) }]; }),
      getRegisteredContentScripts: rec('scripting.getRegisteredContentScripts', () => state.scripts.map((s) => ({ ...s }))),
      registerContentScripts: rec('scripting.registerContentScripts', (list) => { state.scripts.push(...list); }),
      unregisterContentScripts: rec('scripting.unregisterContentScripts', (f) => { state.scripts = f && f.ids ? state.scripts.filter((s) => !f.ids.includes(s.id)) : []; }) },
    runtime: { sendMessage: (m) => fake.send(m), id: ID, getURL: (p) => `chrome-extension://${ID}/${p}`, getManifest: () => ({ version: '0', ...init.manifest }), onInstalled: event(), onStartup: event(), onUpdateAvailable: event(), onMessage: event(),
      requestUpdateCheck: (cb) => { calls.push({ api: 'runtime.requestUpdateCheck', args: [] }); if (cb) cb('no_update'); },
      reload: () => { calls.push({ api: 'runtime.reload', args: [] }); } },
  };

  const fake = { chrome, calls, state, badge, ruleLog: [],
    called: (api) => calls.filter((c) => c.api === api),
    destructive: () => calls.filter((c) => DESTRUCTIVE.includes(c.api)),
    fireAlarm: (name) => onAlarm.fire({ name }),
    // what the user does with tabs (not recorded as API calls)
    openTab: async (t) => { t = { windowId: 1, ...t }; state.tabs.push(t); await chrome.tabs.onCreated.fire({ ...t }); await chrome.tabs.onUpdated.fire(t.id, { url: t.url }, { ...t }); },
    navigate: async (id, url) => { const t = state.tabs.find((x) => x.id === id); t.url = url; await chrome.tabs.onUpdated.fire(id, { url }, { ...t }); },
    // Does a dynamic rule let a request made by a page on `host` through? As Chrome 157 did in test/browser/run.js: an
    // allowAllRequests rule counts only for a frame loaded after the rule was added (reloaded: true), an allow rule
    // with initiatorDomains counts at once.
    passes: (host, { reloaded = false } = {}) => state.dynamic.some((r) => { const under = (list) => (list || []).some((d) => host === d || host.endsWith('.' + d));
      return r.action.type === 'allowAllRequests' ? reloaded && under(r.condition.requestDomains) : r.action.type === 'allow' && under(r.condition.initiatorDomains); }),
    redirect: (d) => chrome.webRequest.onBeforeRedirect.fire(d),   // a page address answers "go to another address"
    // a page that has no tab yet gets one, in the background: Chrome always says which tab a request belongs to
    tabOf: (url) => { const o = new URL(url).origin; let t = state.tabs.find((x) => x.url && new URL(x.url).origin === o);
      if (!t) state.tabs.push(t = { id: 9000 + state.tabs.length, windowId: 1, url: o + '/', active: false }); return t.id; },
    visit: (url, tabId = fake.tabOf(url)) => chrome.webRequest.onCompleted.fire({ url, type: 'main_frame', statusCode: 200, tabId, frameId: 0 }),   // the user opens a page
    // the answer to what a page asked for, with its headers
    answer: (d) => chrome.webRequest.onHeadersReceived.fire(d.tabId === undefined && d.initiator ? { tabId: fake.tabOf(d.initiator), frameId: 0, ...d } : d),
    // a page asks for something; without a tabId it is the top page at `initiator` that asks
    request: (d) => chrome.webRequest.onBeforeRequest.fire(d.tabId === undefined && d.initiator ? { tabId: fake.tabOf(d.initiator), frameId: 0, ...d } : d),
    // a top-level navigation arrives at `url` through the webNavigation events: fires onBeforeNavigate then onCommitted
    // (phase 'history' fires onHistoryStateUpdated instead -- an in-page pushState). Sets the tab's url so a handler
    // that reads it sees it. (Distinct from `navigate`, which drives tabs.onUpdated.)
    navTo: async (url, { tabId = fake.tabOf(url), phase = 'commit' } = {}) => { const t = state.tabs.find((x) => x.id === tabId); if (t) t.url = url;
      const d = { tabId, frameId: 0, url };
      if (phase === 'history') return chrome.webNavigation.onHistoryStateUpdated.fire(d);
      await chrome.webNavigation.onBeforeNavigate.fire(d); return chrome.webNavigation.onCommitted.fire(d); },
    closeTab: async (id) => { state.tabs = state.tabs.filter((t) => t.id !== id); await chrome.tabs.onRemoved.fire(id, {}); },
    // a message as the popup sends it; `from` = another sender. No listener takes it: the answer is undefined, as in Chrome.
    send: (msg, from = { id: ID, url: `chrome-extension://${ID}/popup.html` }) => new Promise((reply) => {
      chrome.runtime.onMessage.fire(msg, from, reply).then((kept) => { if (!kept) reply(undefined); }); }) };
  return fake;
};
