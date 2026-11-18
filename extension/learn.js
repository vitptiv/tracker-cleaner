// Learning (C25): which outside company turns up on several of the sites the user visits, each time able to recognise
// them. Pure: background.js keeps chrome.storage.local { follow: { '<company>': { on, id, hosts, t } } } and passes it in.
//   on    one mark per site it was seen on: a short hash, not the site's name, and never more than FOLLOW_N
//   id    it had a number to recognise the user by (a cookie other sites can use, or a long random value in a request)
//   hosts its server names (at most 5), so that what it saved itself can be emptied later
// Bounded to FOLLOW_MAX companies, the longest unseen go. It stays on this computer: no report carries it.
const FOLLOW_N = 3, FOLLOW_MAX = 300, LATER_MS = 7 * 86400e3;
// the name a site is known by: its last two labels, three under co.uk and the like
const siteOf = (host) => { const h = String(host || '').toLowerCase().replace(/:\d+$/, ''), p = h.split('.');
  if (/^[\d.]+$/.test(h) || h.includes('[')) return h;
  return p.slice(p.length > 2 && p.at(-1).length === 2 && /^(co|com|org|net|ac|gov|edu)$/.test(p.at(-2)) ? -3 : -2).join('.'); };
// looks like a number given to one browser: 8 or more letters and digits mixed, or 10 or more digits
const idLike = (v) => String(v ?? '').split(/[^A-Za-z0-9_-]+/).some((t) => t.length >= 8 && (/^\d{10,}$/.test(t) || (/\d/.test(t) && /[a-z]/i.test(t))));
// a long random value in an address, under a name that is not a version or a time
const idInUrl = (url) => { try { return [...new URL(url).searchParams].some(([k, v]) => v.length >= 16 && idLike(v) && !/^(v|ver|version|rev|hash|cb|t|ts|_)$/i.test(k)); } catch { return false; } };
const mark = (s) => { let h = 0x811c9dc5; for (const ch of String(s)) h = Math.imul(h ^ ch.charCodeAt(0), 0x01000193) >>> 0; return h.toString(36); };
// A page of `page` asked `host`, which belongs to the company `site`. Returns the new store, or null when it says nothing new.
const followNote = (store, site, host, page, id, now) => {
  const old = (store || {})[site] || { on: [], id: false, hosts: [] }, m = mark(page);
  const e = { on: old.on.includes(m) || old.on.length >= FOLLOW_N ? old.on : [...old.on, m], id: old.id || !!id,
    hosts: !host || old.hosts.includes(host) || old.hosts.length >= 5 ? old.hosts : [...old.hosts, host], t: now };
  if (e.on === old.on && e.id === old.id && e.hosts === old.hosts) return null;
  return Object.fromEntries(Object.entries({ ...store, [site]: e }).sort((a, b) => b[1].t - a[1].t).slice(0, FOLLOW_MAX));
};
// A page address answered "go to `to`" (C27). When the address it was asked with names where the user wanted to go
// (…?to=https://blog/post), whatever `to` carries beyond that was added on the way: returned are the names of the
// added parts that look like an ID. Never a part a sign-in hands over.
const NEVER_PARAM = /^(code|state|token|id_token|access_token|refresh_token|session_state|nonce|ticket|SAMLResponse|RelayState|sig|signature|key)$/i;
const bounceAdded = (from, to) => { try { const b = new URL(to);
  for (const [, v] of new URL(from).searchParams) { let want; try { want = new URL(v); } catch { continue; }
    if (want.host === b.host && want.pathname === b.pathname) return [...b.searchParams].filter(([k, x]) => !want.searchParams.has(k) && idLike(x) && !NEVER_PARAM.test(k)).map(([k]) => k); }
  } catch {} return []; };
const followFull = (e) => !!e && e.on.length >= FOLLOW_N;
if (typeof module !== 'undefined') module.exports = { FOLLOW_N, FOLLOW_MAX, LATER_MS, siteOf, idLike, idInUrl, followNote, followFull, bounceAdded };
