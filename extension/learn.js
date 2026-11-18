// Learning (C25): which outside company turns up on several of the sites the user visits, each time able to recognise
// them. Pure: background.js keeps chrome.storage.local { follow: { '<company>': { on, id, hosts, t } } } and passes it in.
//   on    one mark per site it was seen on: a short hash, not the site's name, and never more than FOLLOW_N
//   id    it had a number to recognise the user by (a cookie other sites can use, or a long random value in a request)
//   hosts its server names (at most 5), so that what it saved itself can be emptied later
// Bounded to FOLLOW_MAX companies, the longest unseen go. It stays on this computer: no report carries it.
// Never learned and never cleaned as a passing site: companies that pages need to check that you are human or to take a
// payment. They are seen on many sites with an ID, and stopping them would break sign-in forms and checkouts.
const NEEDED = ['hcaptcha.com', 'recaptcha.net', 'gstatic.com', 'googleapis.com', 'cloudflare.com', 'stripe.com', 'stripe.network', 'paypal.com', 'paypalobjects.com',
  'klarna.com', 'adyen.com', 'braintreegateway.com', 'auth0.com', 'okta.com', 'duosecurity.com'];
const FOLLOW_N = 3, FOLLOW_MAX = 300, LATER_MS = 7 * 86400e3;
// never more than STOPPED_MAX stopped companies, and at most STOPS_HOUR stopped without a question in an hour: the next ones are asked about
const STOPPED_MAX = 300, STOPS_HOUR = 10;
// Names under which anyone can rent a host of their own: there every host is a site of its own, so that one tenant can
// never get the whole name, or a neighbour, stopped. A short built-in table, not the full public suffix list.
const SHARED = ['cloudfront.net', 'amazonaws.com', 'github.io', 'githubusercontent.com', 'herokuapp.com', 'azurewebsites.net', 'azureedge.net', 'windows.net', 'appspot.com', 'pages.dev',
  'workers.dev', 'netlify.app', 'vercel.app', 'web.app', 'firebaseapp.com', 'blogspot.com', 'wordpress.com', 'fastly.net', 'akamaized.net', 'akamaihd.net', 'edgekey.net', 'edgesuite.net', 'cloudflare.net',
  'r2.dev', 'glitch.me', 'onrender.com', 'fly.dev', 'googleusercontent.com', 'web.core.windows.net', 'myshopify.com', 'wixsite.com', 'tumblr.com'];
// the name a site is known by: its last two labels, three under co.uk, or.jp, com.au and the like, the whole host under a shared name
const siteOf = (host) => { const h = String(host || '').toLowerCase().replace(/:\d+$/, ''), p = h.split('.');
  if (/^[\d.]+$/.test(h) || h.includes('[') || SHARED.some((s) => h.endsWith('.' + s))) return h;
  return p.slice(p.length > 2 && p.at(-1).length === 2 && /^(co|com|org|net|ac|gov|edu|or|ne|go|gob|nom|mil|sch|ltd|plc)$/.test(p.at(-2)) ? -3 : -2).join('.'); };
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
// added parts that look like an ID. Never a part a sign-in hands over, and never a name pages commonly need to work
// (a video, a list, a search, a page number): cutting those off every address would break sites.
const NEVER_PARAM = new Set(('code state token id_token access_token refresh_token session_state nonce ticket samlresponse relaystate sig signature key client_id redirect_uri response_type scope '
  + 'v id q p s t u n c a list page lang locale url uri to next continue return callback search query type tab view sort order limit offset name user email sid session item product article post file path action format').split(' '));
const bounceAdded = (from, to) => { try { const b = new URL(to);
  for (const [, v] of new URL(from).searchParams) { let want; try { want = new URL(v); } catch { continue; }
    if (want.host === b.host && want.pathname === b.pathname) return [...b.searchParams].filter(([k, x]) => !want.searchParams.has(k) && idLike(x) && !NEVER_PARAM.has(k.toLowerCase())).map(([k]) => k); }
  } catch {} return []; };
const followFull = (e) => !!e && e.on.length >= FOLLOW_N;
if (typeof module !== 'undefined') module.exports = { NEEDED, SHARED, FOLLOW_N, FOLLOW_MAX, LATER_MS, STOPPED_MAX, STOPS_HOUR, siteOf, idLike, idInUrl, followNote, followFull, bounceAdded };
