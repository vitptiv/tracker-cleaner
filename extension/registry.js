// Every capability of Tracker Cleaner (table in PLAN.md) and the one gate that decides whether it may act.
// mode: what the group does until the user chooses: 'auto' runs by itself (1.25: every group that only touches what
// follows you; what was done is in the log, and of it only deleted cookies can be put back), 'ask' waits for Approve,
// 'off' does nothing, null = not an action group. destructive: it deletes, closes or reroutes something.
// noAuto: never runs by itself, a stored 'auto' counts as 'ask' (Wi-Fi: a removed network cannot be put back).
const C = (id, name, group, mode, destructive, noAuto) => ({ id, name, group, mode, destructive, ...(noAuto ? { noAuto } : {}) });
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
  C('C32', 'Page shield: small changes to what a page can measure of the browser (experimental)', 'shield', 'off', false),
];
const cap = (id) => CAPS.find((c) => c.id === id);
// settings: { master: true|false, modes: { C03: 'auto', ... } } as stored in chrome.storage.local.
// Returns 'run', 'ask' or 'no'. Master off stops every ID. A destructive capability runs only when the
// master switch was stored as on: with nothing stored, the most it does is ask. (A new install stores it as on.)
const mayRun = (id, settings) => {
  const c = cap(id), s = settings || {};
  if (!c || s.master === false) return 'no';
  if (c.mode === null) return 'run';
  const stored = (s.modes || {})[id], mode = ['auto', 'ask', 'off'].includes(stored) ? stored : c.mode;
  if (mode === 'off') return 'no';
  return mode === 'auto' && !c.noAuto && (!c.destructive || s.master === true) ? 'run' : 'ask';
};
// The gate background.js asks before every action: mayRun plus what holds right now (guard.js holdNow).
// 'held' = it would run, but the extension is paused, or a sign-in is going on and the capability is destructive.
const gate = (id, settings, hold) => {
  const r = mayRun(id, settings);
  return r === 'run' && hold && (hold.paused || (hold.guard && cap(id).destructive)) ? 'held' : r;
};
// One row per group, in the usability order of PLAN.md. 'control' capabilities have no mode and no row.
// says: what the group does for you, in one sentence anyone can read (the report shows it under the title).
const GROUPS = [
  ['signin', 'Pause cleaning while you sign in', 'While you sign in somewhere, and for five minutes after, nothing is cleaned so the sign-in cannot break.'],
  ['blocking', 'Ads and trackers blocked as pages load', 'Pages are stopped from calling the companies that follow you from site to site, and YouTube plays without its ads.'],
  ['cookies', "Trackers' cookies", 'Small files that trackers save to recognise you are deleted, while the ones that keep you signed in stay.'],
  ['google', 'Cookies Google uses to recognise you', 'Small files that Google and YouTube save to recognise you when you are not signed in are deleted, while the ones that keep you signed in stay.'],
  ['othercookies', 'Other companies get no cookies', 'When a page you visit asks another company for something, your cookies for that company are not sent along and it cannot save new ones, so it cannot recognise you there.'],
  ['othertags', 'Other companies get no page address or tag', 'When a page you visit asks another company for something, that company is not told which page you are on, and a hidden label it left in a saved copy is not sent back to it.'],
  ['local', 'Pages may not call this computer', 'A page on the internet is stopped from calling programs on this computer or devices on your home network, which some pages do to recognise you.'],
  ['shield', 'Blur browser recognition (experimental)', 'Experimental. Makes it harder to recognise this browser by its drawing and sound; a determined site can undo it.'],
  ['params', 'Tracking tags removed from links', 'The extra letters that advertisers add to a link to see where you came from are cut off before the page opens.'],
  ['unknown', 'Trackers that are on no list', 'When a company on no list turns up on two different sites you visit, each time able to recognise you, or is handed the number a site keeps for you, you are asked whether to block it on other sites. Nothing is blocked or deleted before you press.'],
  ['bounce', 'Sites that only pass you along', 'When a site sends you straight on to another site without showing you anything, you are asked whether to remove what it saved, and whether to skip it next time. Nothing is done before you press.'],
  ['own', 'What trackers saved on their own sites', "What the trackers on the built-in list have left on their own sites (a background program, saved data, the right to send notifications) is taken away once a day; for a host you blocked yourself only if you ticked \"Keep removing what it saves\"."],
  ['storage', 'Data that sites keep (site storage)', 'Other things a site has saved in your browser are emptied, but only for the sites you chose yourself.'],
  ['wifi', 'Remembered Wi-Fi networks', 'Wi-Fi networks this computer remembers but has not used for 30 days are forgotten.'],
  ['permissions', 'What sites may do (site permissions)', 'Sites you chose yourself are stopped from doing things such as sending notifications or using the camera.'],
  ['cache', 'Saved copies of pages (HTTP cache)', 'All copies of pages that Chrome saved to load them faster are thrown away once a day, and besides that at most once an hour when you block a host; your own press on Remove or Clean now clears them too. Pages then load a little slower the first time.'],
  ['allowlist', 'Keep only the cookies you list', 'Every small file that sites save to recognise you is deleted, except the ones on your own list.'],
  ['tabs', 'Limit how many tabs stay open', 'When more tabs are open than the number you set, the ones you used least are closed.'],
  ['tor', 'Hiding your address from websites (Tor)', 'Chrome reaches websites through the Tor network, so they cannot see where you are.'],
  ['server', 'Reports to a server on this computer', 'A summary of what was cleaned is sent to a settings program on this computer, and its lists and switches are read from it; nothing goes anywhere else.']]
  .map(([id, title, says]) => ({ id, title, says, caps: CAPS.filter((c) => c.group === id && c.mode !== null).map((c) => c.id) }));
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
if (typeof module !== 'undefined') module.exports = { CAPS, GROUPS, cap, mayRun, gate, cleanLimits };
