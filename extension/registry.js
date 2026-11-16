// Every capability of Tracker Cleaner (table in PLAN.md) and the one gate that decides whether it may act.
// mode: what the group does until the user chooses: 'auto' runs silently, 'ask' waits for Approve,
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
  C('C11', 'Clear HTTP cache', 'cache', 'ask', true),
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
];
const cap = (id) => CAPS.find((c) => c.id === id);
// settings: { master: true|false, modes: { C03: 'auto', ... } } as stored in chrome.storage.local.
// Returns 'run', 'ask' or 'no'. Master off stops every ID. A destructive capability runs only when the
// master switch was stored as on: with nothing stored, the most it does is ask.
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
// One popup row per group, in the usability order of PLAN.md. 'control' capabilities have no mode and no row.
const GROUPS = [['signin', 'Pause cleaning while you sign in'], ['blocking', 'Ads and trackers blocked as pages load'], ['cookies', "Trackers' cookies"],
  ['google', 'Cookies Google uses to recognise you'], ['params', 'Tracking tags removed from links'], ['storage', 'Data that sites keep (site storage)'],
  ['wifi', 'Remembered Wi-Fi networks'], ['permissions', 'What sites may do (site permissions)'], ['cache', 'Saved copies of pages (HTTP cache)'],
  ['allowlist', 'Keep only the cookies you list'], ['tabs', 'Limit how many tabs stay open'], ['tor', 'Hiding your address from websites (Tor)'],
  ['server', 'Reports to a server on this computer']]
  .map(([id, title]) => ({ id, title, caps: CAPS.filter((c) => c.group === id && c.mode !== null).map((c) => c.id) }));
if (typeof module !== 'undefined') module.exports = { CAPS, GROUPS, cap, mayRun, gate };
