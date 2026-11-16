// Private history: what was removed, as numbers only, for the extension's own "now and history" page. Pure:
// background.js keeps chrome.storage.local { history: { days, cookies } } and passes it in.
//   days:    { '2026-11-12': { <group id>: removals that day } }, local days, the last HISTORY_DAYS of them
//   cookies: { '<site> <name>': { first, last, n } }: first seen being removed, last removed, times removed
// Bounded: old days and cookies not removed for HISTORY_DAYS go, and of the cookies only the HISTORY_COOKIES latest
// stay, each under a key of at most HISTORY_KEY characters. Never a cookie value. It stays on this computer: not in
// storage.sync, not in a report to the 8088 server, and background.js gives it to the extension's own pages only.
const HISTORY_DAYS = 30, HISTORY_COOKIES = 500, HISTORY_KEY = 120;
const historyDay = (t) => { const d = new Date(t), two = (n) => String(n).padStart(2, '0'); return `${d.getFullYear()}-${two(d.getMonth() + 1)}-${two(d.getDate())}`; };
// The store without what is too old or too much; anything that is not a store counts as empty.
const historyTrim = (h, now) => {
  const from = now - HISTORY_DAYS * 86400e3, first = historyDay(from), obj = (x) => (x && typeof x === 'object' ? x : {});
  let cookies = Object.entries(obj(obj(h).cookies)).filter(([, c]) => c.last > from);
  if (cookies.length > HISTORY_COOKIES) cookies = cookies.sort((a, b) => b[1].last - a[1].last).slice(0, HISTORY_COOKIES);
  return { days: Object.fromEntries(Object.entries(obj(obj(h).days)).filter(([d]) => d > first)), cookies: Object.fromEntries(cookies) };
};
// items: what was just removed, [{ group, kind, site, name }]. Returns the new store; the one given is not changed.
const historyAdd = (h, items, now) => {
  const { days, cookies } = historyTrim(h, now), d = historyDay(now), day = { ...days[d] };
  for (const it of items) { day[it.group] = (day[it.group] || 0) + 1;
    if (it.kind !== 'cookie') continue;
    const k = `${it.site} ${it.name}`.slice(0, HISTORY_KEY), c = cookies[k];
    cookies[k] = { first: c ? c.first : now, last: now, n: (c ? c.n : 0) + 1 }; }
  return historyTrim({ days: { ...days, [d]: day }, cookies }, now);
};
if (typeof module !== 'undefined') module.exports = { HISTORY_DAYS, HISTORY_COOKIES, HISTORY_KEY, historyDay, historyTrim, historyAdd };
