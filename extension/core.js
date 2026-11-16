// Cookie decisions of Tracker Cleaner, free of Chrome calls so Node tests can load them.
// Service worker: importScripts('lists.js', 'core.js'); makeCore({ DOMAINS, COOKIE_RE, GOOGLE_RE, KEEP_RE }).
// GOOGLE_RE may be left out (1.20's lists have none): then no cookie is 'google'.
// Node: require('./core.js')(require('./lists.js')).
const makeCore = ({ DOMAINS, COOKIE_RE, GOOGLE_RE, KEEP_RE, URL_PARAMS = [] }) => {
  // Settings, written by background.js after it reads them:
  // BLACK  your blacklist (audit page / settings): deleted even when normally kept (sign-ins included).
  // MODE 'allowlist' + ALLOW: delete EVERY cookie except the allowed sign-ins (YouTube, Spotify).
  // CLEAN false = settings switch "delete cookies" is off.
  const S = { BLACK: [], MODE: 'normal', ALLOW: [], CLEAN: true };
  // the DOMAINS entry a host falls under
  const trackerSite = (h) => { h = h.toLowerCase().replace(/^\./, ''); return DOMAINS.find((d) => h === d || h.endsWith('.' + d)); };
  const isTrackerHost = (h) => !!trackerSite(h);
  // hosts: those of the open tabs. True when one is on the tracker's own site: segment.com, mixpanel.com and others are
  // also products people log in to, and a cookie that is only there because of its host must survive that visit.
  const firstParty = (c, hosts) => { const d = trackerSite(realHost(c.domain)); return !!d && hosts.some((h) => h === d || h.endsWith('.' + d)); };
  // Proxied Fit-browser hosts look like www.example.com.localhost: judge them by the real host.
  const realHost = (h) => h.replace(/^\./, '').replace(/(\.http)?\.localhost$/, '');
  // exact site, or the real site (which then also covers its Fit-browser *.localhost copy)
  const isBlack = (c) => S.BLACK.some((b) => (b.h === '*' || b.h === c.domain.replace(/^\./, '') || b.h === realHost(c.domain)) && b.n === c.name);
  const isAllowed = (c) => { const h = realHost(c.domain); return S.ALLOW.some((a) => (h === a.site || h.endsWith('.' + a.site)) && (a.names.includes('*') || a.names.includes(c.name))); };
  // google.<tld> (google.com, google.de, google.co.uk, google.com.au), youtube.com, or a subdomain of either
  const isGoogleHost = (h) => /(^|\.)(google\.(com?\.)?[a-z]{2,3}|youtube\.com)$/.test(h.toLowerCase());
  // Why a cookie would be deleted: 'blacklist', 'allowlist' (allow-list mode, not listed), 'name', 'host' (tracker
  // host), 'google' (Google's own identity cookie on Google's own site); null = keep.
  // your blacklist always wins, also over the allow-list
  // noBlack: judge as if the blacklist were empty (background.js: the blacklist asks, another rule may still run)
  const reason = (c, noBlack) => !S.CLEAN ? null : !noBlack && isBlack(c) ? 'blacklist' : S.MODE === 'allowlist' ? (isAllowed(c) ? null : 'allowlist')
    : KEEP_RE.test(c.name) ? null : COOKIE_RE.test(c.name) ? 'name' : isTrackerHost(realHost(c.domain)) ? 'host'
    : GOOGLE_RE && GOOGLE_RE.test(c.name) && isGoogleHost(realHost(c.domain)) ? 'google' : null;
  const shouldGo = (c) => !!reason(c);
  // What the url-params rule (C23, rules-params.json) does to a URL, for the tests: declarativeNetRequest does not run
  // in Node. The listed parameters go; the rest, their order and the fragment stay. Nothing listed: the same string.
  const stripParams = (url) => {
    const m = /^([^?#]*)\?([^#]*)(#.*)?$/.exec(url); if (!m) return url;
    const name = (p) => { const n = p.split('=')[0]; try { return decodeURIComponent(n); } catch { return n; } };
    const all = m[2].split('&'), keep = all.filter((p) => !URL_PARAMS.includes(name(p)));
    return keep.length === all.length ? url : m[1] + (keep.length ? '?' + keep.join('&') : '') + (m[3] || '');
  };
  return { S, isTrackerHost, firstParty, isGoogleHost, realHost, isBlack, isAllowed, reason, shouldGo, stripParams };
};
if (typeof module !== 'undefined') module.exports = makeCore;
