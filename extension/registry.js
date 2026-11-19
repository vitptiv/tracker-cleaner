// Every capability of Tracker Cleaner (table in PLAN.md) and the one gate that decides whether it may act.
// mode: what the group does until the user chooses: 'auto' runs by itself (1.25: every group that only touches what
// follows you; what was done is in the log, and of it only deleted cookies can be put back), 'ask' waits for Approve,
// 'off' does nothing, null = not an action group. destructive: it deletes, closes or reroutes something.
// noAuto: never runs by itself, a stored 'auto' counts as 'ask' (Wi-Fi: a removed network cannot be put back).
// answers: a row that only asks questions (C25, C27); its fourth mode 'yes' answers them yes by itself (1.30, Strongest).
const C = (id, name, group, mode, destructive, noAuto) => ({ id, name, group, mode, destructive, ...(noAuto ? { noAuto } : {}), ...(['C25', 'C27'].includes(id) ? { answers: true } : {}) });
const CAPS = [
  C('C01', 'Block tracker requests', 'blocking', 'auto', false),
  C('C02', 'Block Google/YouTube ad paths', 'blocking', 'auto', false),
  C('C03', 'Delete tracking cookies', 'cookies', 'auto', true),
  C('C04', 'Delete Google/YouTube identity cookies', 'google', 'ask', true),
  C('C05', 'Strip YouTube ads', 'blocking', 'auto', false),
  C('C06', 'Drop tracker site storage', 'storage', 'ask', true),
  C('C07', 'Permanent drops and cookie blacklist', 'storage', 'ask', true),
  C('C08', 'Allow and Revert', 'control', null, false),
  C('C09', 'Block site permissions', 'permissions', 'ask', true),
  C('C10', 'Audit view', 'control', null, false),
  C('C11', 'Clear HTTP cache', 'cache', 'auto', true),
  C('C12', 'Allow-list mode', 'allowlist', 'off', true),
  C('C13', 'Tab limit', 'tabs', 'off', true),
  C('C14', 'Tor', 'tor', 'off', true),
  C('C15', 'Report and self-update', 'server', 'off', false),
  C('C18', 'Master switch and pause', 'control', null, false),
  C('C19', 'Sign-in guard', 'signin', 'auto', false),
  C('C20', 'Approve / Postpone queue', 'control', null, false),
  C('C21', 'Current-site panel', 'control', null, false),
  C('C22', 'Undo', 'control', null, false),
  C('C23', 'Strip tracking URL parameters', 'params', 'auto', false),
  C('C24', 'Remove unused Wi-Fi networks', 'wifi', 'ask', true, true),
  C('C25', 'Stop unknown trackers', 'unknown', 'auto', true),
  C('C26', 'Block pings that tell which link was followed', 'blocking', 'auto', false),
  C('C27', 'Clean sites that only pass you along', 'bounce', 'auto', true),
  C('C28', "Empty what a tracker saved on its own site", 'own', 'auto', true),
  C('C29', 'No cookies for other companies', 'othercookies', 'auto', false),
  C('C30', 'No cache tags and no referring page for other companies', 'othertags', 'auto', false),
  C('C31', 'Pages may not call this computer or the home network', 'local', 'auto', false),
  C('C32', 'Page shield: small changes to what a page can measure of the browser (experimental)', 'shield', 'auto', false),
  C('C33', 'Block cross-site identifiers: a value seen on two sites you visit is stripped from links and requests and the collector path that receives it is blocked', 'crossid', 'auto', true),
];
const cap = (id) => CAPS.find((c) => c.id === id);
// ---- The strength dial (1.30): one stored setting, `level`, under the rows' own modes. Nothing stored (every install
// from before 1.30) is 'balanced', exactly the modes above; a new install stores 'strong'.
//   ask       every group that deletes waits for a press; a rule that deletes nothing keeps its mode (it cannot ask)
//   balanced  the modes above
//   strong    every group runs by itself, and the two question rows answer their questions yes ('yes')
// Not on the dial (OWN_SWITCH), because they change how the browser works or cannot be undone: their mode is always the
// one above or the one the user chose. A row the user sets by hand keeps that choice under every level (`modes`).
const LEVELS = ['ask', 'balanced', 'strong'], OWN_SWITCH = ['signin', 'allowlist', 'tabs', 'tor', 'server', 'wifi'];
const onDial = (c) => !!c && c.mode !== null && !OWN_SWITCH.includes(c.group);
const levelMode = (id, level) => { const c = cap(id);
  if (!onDial(c)) return c ? c.mode : null;
  return level === 'strong' ? (c.answers ? 'yes' : 'auto') : level === 'ask' ? (c.destructive ? 'ask' : c.mode) : c.mode; };
// the mode a capability is in: its own stored mode when valid, else the level's
const modeOf = (id, settings) => { const c = cap(id), s = settings || {}, stored = (s.modes || {})[id];
  if (!c || c.mode === null) return null;
  return ['auto', 'ask', 'off'].includes(stored) || (stored === 'yes' && c.answers) ? stored : levelMode(id, s.level); };
// How often the cleaning runs by itself (owner, 1.32), decided here with the level: at Strongest the sweep of every row runs
// every 10 minutes and the saved copies of pages (C11, the call that also drops remembered servers and forced-HTTPS
// entries) are cleared every 10 minutes; at the other levels the sweep is every 15 minutes and the clearing daily. A cache
// row the user set by hand keeps the daily clearing.
const cleanEvery = (settings) => { const s = settings || {}, fast = s.level === 'strong';
  return { sweepMin: fast ? 10 : 15, cacheMs: fast && !(s.modes || {}).C11 ? 10 * 60e3 : 24 * 3600e3 }; };
// what the dial shows: the stored level, or 'custom' when a row on the dial was set by hand to something else
const levelNow = (settings) => { const s = settings || {}, level = LEVELS.includes(s.level) ? s.level : 'balanced';
  return CAPS.some((c) => onDial(c) && modeOf(c.id, s) !== levelMode(c.id, level)) ? 'custom' : level; };
// settings: { master: true|false, modes: { C03: 'auto', ... }, level } as stored in chrome.storage.local.
// Returns 'run', 'ask' or 'no'. Master off stops every ID. A destructive capability runs only when the
// master switch was stored as on: with nothing stored, the most it does is ask. (A new install stores it as on.)
const mayRun = (id, settings) => {
  const c = cap(id), s = settings || {};
  if (!c || s.master === false) return 'no';
  if (c.mode === null) return 'run';
  const mode = modeOf(id, s);
  if (mode === 'off') return 'no';
  return (mode === 'auto' || mode === 'yes') && !c.noAuto && (!c.destructive || s.master === true) ? 'run' : 'ask';
};
// The gate background.js asks before every action: mayRun plus what holds right now (guard.js holdNow).
// 'held' = it would run, but the extension is paused, or a sign-in is going on and the capability is destructive.
const gate = (id, settings, hold) => {
  const r = mayRun(id, settings);
  return r === 'run' && hold && (hold.paused || (hold.guard && cap(id).destructive)) ? 'held' : r;
};
// May the cleaner answer this row's questions yes by itself right now? Only a question row in its mode 'yes', and only
// where the gate says 'run' (master stored on, not paused, no sign-in hold). What it may answer is narrowed further
// per host in background.js (mayYes).
const answersYes = (id, settings, hold) => modeOf(id, settings) === 'yes' && gate(id, settings, hold) === 'run';
// One row per group, in the usability order of PLAN.md. 'control' capabilities have no mode and no row.
// says: what the group does for you, in one sentence anyone can read (the report shows it under the title).
const GROUPS = [
  ['signin', 'Pause while you sign in', 'Nothing of a site is deleted while you sign in there, and for five minutes after.'],
  ['blocking', 'Block ads and trackers', 'Pages cannot call known trackers, and YouTube plays without ads.'],
  ['cookies', "Trackers' cookies", 'Tracker cookies are deleted. Cookies that keep you signed in stay.'],
  ['google', "Google's tracking cookies", 'Google cookies that recognise you are deleted. Sign-in cookies stay.'],
  ['othercookies', 'No cookies for others', 'Other companies a page calls get none of your cookies.'],
  ['othertags', 'No page address for others', 'Other companies a page calls are not told which page you are on.'],
  ['local', 'Protect this computer', 'Websites cannot call this computer or your home network.'],
  ['shield', 'Experimental fingerprint blur', 'Experimental: makes this browser harder to recognise. A determined site can undo it.'],
  ['crossid', 'Codes shared across sites', 'A code seen on two sites is cut from links and its collector is blocked.'],
  ['params', 'Clean tags from links', 'Tracking tags are cut from links before the page opens.'],
  ['unknown', 'Trackers on no list', 'Asks before blocking a company seen following you on two sites. At Strongest it blocks and cleans by itself, sites you use included.'],
  ['bounce', 'Sites that pass you on', 'Asks before cleaning a site that only passes you on. At Strongest it cleans by itself, sites you use included.'],
  ['own', "Trackers' own sites", 'What listed trackers left on their own sites is emptied once a day.'],
  ['storage', 'Site data you chose', 'Saved data of the sites you chose is emptied.'],
  ['wifi', 'Old Wi-Fi networks', 'Networks unused for 30 days are forgotten.'],
  ['permissions', 'Site rights you chose', 'The sites you chose lose rights such as notifications.'],
  ['cache', 'Saved copies of pages', 'Cleared daily and when Chrome starts, at Strongest every 10 minutes. Pages then load slower.'],
  ['allowlist', 'Keep only listed cookies', 'Every cookie is deleted except the ones on your list.'],
  ['tabs', 'Limit open tabs', 'When too many tabs are open, the least used close.'],
  ['tor', 'Hide your address with Tor', 'Websites are reached through Tor, so they cannot see where you are.'],
  ['server', 'Reports to this computer', 'A summary goes to a settings program on this computer only.']]
  .map(([id, title, says]) => ({ id, title, says, caps: CAPS.filter((c) => c.group === id && c.mode !== null).map((c) => c.id) }));
// The rows that have something to clean, and so a "Clean now" button (1.30). Not: the rules that only block or strip
// (nothing to clean), Wi-Fi (it keeps its own confirm before anything is removed), allow-list mode (it would delete
// every cookie but those listed), the tab limit (it closes tabs), Tor and the reports.
const CLEANABLE = ['cookies', 'google', 'crossid', 'unknown', 'bounce', 'own', 'storage', 'permissions', 'cache'];
// The limits file of the settings program on this computer (127.0.0.1:8088), checked before anything in it is used (L10):
// only the known fields, each of the expected shape and size. Never a wildcard site, and of the things a site may do only
// those that are safe to block for one site (never JavaScript, cookies or images, which would break the site).
const LIMIT_PERMS = ['notifications', 'geolocation', 'camera', 'microphone', 'popups', 'automaticDownloads', 'clipboard', 'sensors'];
const cleanLimits = (l) => {
  if (!l || typeof l !== 'object' || Array.isArray(l)) return null;
  const host = (h) => typeof h === 'string' && h.length <= 253 && /^[a-z0-9]([a-z0-9.-]*[a-z0-9])?(:[0-9]{1,5})?$/i.test(h), text = (s) => typeof s === 'string' && s.length > 0 && s.length <= 200;
  const list = (x, max, ok, pick = (v) => v) => (Array.isArray(x) ? x : []).filter(ok).slice(0, max).map(pick), flag = (x) => x !== false;
  return { enabled: flag(l.enabled), cookieClean: flag(l.cookieClean), ...('blocking' in l ? { blocking: flag(l.blocking) } : {}), ...('ytAds' in l ? { ytAds: flag(l.ytAds) } : {}), ...('drops' in l ? { drops: flag(l.drops) } : {}),
    chromeTabs: Number.isInteger(l.chromeTabs) && l.chromeTabs > 0 && l.chromeTabs <= 500 ? l.chromeTabs : 0, preferSites: list(l.preferSites, 50, host),
    cookieMode: l.cookieMode === 'allowlist' ? 'allowlist' : 'normal',
    cookieBlacklist: list(l.cookieBlacklist, 500, (b) => b && host(b.h) && text(b.n), (b) => ({ h: b.h, n: b.n })),
    storageBlacklist: list(l.storageBlacklist, 200, host),
    permissionBlacklist: list(l.permissionBlacklist, 200, (p) => p && typeof p.site === 'string' && /^https?:\/\//.test(p.site) && host(p.site.replace(/^https?:\/\//, '')) && LIMIT_PERMS.includes(p.perm), (p) => ({ site: p.site, perm: p.perm })),
    cookieAllow: list(l.cookieAllow, 200, (a) => a && host(a.site) && Array.isArray(a.names) && a.names.every(text), (a) => ({ site: a.site, names: a.names.slice(0, 100) })) };
};
if (typeof module !== 'undefined') module.exports = { CAPS, GROUPS, cap, mayRun, gate, cleanLimits, LEVELS, OWN_SWITCH, CLEANABLE, onDial, levelMode, modeOf, levelNow, answersYes, cleanEvery };
