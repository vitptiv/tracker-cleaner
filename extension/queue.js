// Approval queue (C20): what waits for Approve, per group. Pure: background.js reads and writes
// chrome.storage.local { pending: { <groupId>: { items: [...], postponedUntil } } } and passes `pending` in.
// item: { cap, kind, site, name, why, t }, kind: cookie | storage | permission | cache | tabs | wifi (site = the network's
// name, name = its UUID). Never a cookie value.
// postponedUntil: a timestamp, or 'restart' (until Chrome starts again); the group then does not count on the badge.
// The functions that change `pending` do so in place and return whether anything changed.
const QUEUE_MAX = 500, QUEUE_SHOWN = 20;   // per group: a busy day must not fill storage; the popup shows the newest few
const queueKey = (it) => [it.cap, it.kind, it.site, it.name].join(' ');
const queueGroup = (pending, group) => pending[group] || (pending[group] = { items: [], postponedUntil: 0 });
const queueAdd = (pending, group, { cap, kind, site, name, why, t }) => {
  const g = queueGroup(pending, group), item = { cap, kind, site, name, why, t };   // only these fields are ever stored
  if (g.items.some((x) => queueKey(x) === queueKey(item))) return false;
  g.items.push(item); g.items.splice(0, g.items.length - QUEUE_MAX);   // over the cap: the oldest go
  return true;
};
const queueKeep = (pending, keep) => {
  let changed = false;
  for (const g of Object.values(pending)) { const n = g.items.length; g.items = g.items.filter(keep); changed = changed || g.items.length !== n; }
  return changed;
};
const queuePostpone = (pending, group, until) => { queueGroup(pending, group).postponedUntil = until; return true; };
const queueRestart = (pending) => {
  const gs = Object.values(pending).filter((g) => g.postponedUntil === 'restart');
  for (const g of gs) g.postponedUntil = 0;
  return gs.length > 0;
};
const queuePostponed = (g, now) => g.postponedUntil === 'restart' || g.postponedUntil > now;
const queueCount = (pending, now) => Object.values(pending || {}).reduce((n, g) => n + (queuePostponed(g, now) ? 0 : g.items.length), 0);
const queueBadge = (pending, paused, now) => paused ? 'II' : String(queueCount(pending, now) || '');
const queueView = (g) => ({ pending: g ? g.items.length : 0, postponedUntil: (g && g.postponedUntil) || 0, items: g ? g.items.slice(-QUEUE_SHOWN) : [] });
// Action log (C21): what was removed, queued or held, newest last, for the popup's "This site". A ring: the oldest go.
// entry: { t, cap, kind, site, name, did, page }, did: removed | queued | held. Never a cookie value.
// page (live cookie actions only): the host of the tab the user was looking at, a guess at which page set the cookie.
const LOG_MAX = 200;
const logAdd = (log, items, did, t) => [...log, ...items.map((it) => ({ t, cap: it.cap, kind: it.kind, site: it.site, name: it.name, did: did || it.did, ...(it.page ? { page: it.page } : {}) }))].slice(-LOG_MAX);
if (typeof module !== 'undefined') module.exports = { QUEUE_MAX, LOG_MAX, logAdd, queueKey, queueAdd, queueKeep, queuePostpone, queueRestart, queueCount, queueBadge, queueView };
