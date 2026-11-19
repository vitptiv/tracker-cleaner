'use strict';
// Cross-site identifier detection (1.26, M1). Orthogonal to first/third party: a high-entropy VALUE that the cleaner
// sees SENT by two or more different registrable sites the user actually visited is a cross-site tracking id, whoever
// serves it. This catches a first-party reverse-proxy collector (Friendface 2) that carries one id across sites, with
// no third-party signal. Pure helpers; the worker keeps the state in chrome.storage.session (in-memory, cleared on
// restart) and never writes a raw value to disk, the log, the queue or a report. An observed value is kept there in the
// clear -- the raw bytes are needed to strip and block the id later, and a one-way hash could not be reversed for that
// -- keyed by a per-session salted hash; nothing is persisted and nothing is sent anywhere.
const XID_MIN = 12, XID_MAX = 256;
// the id-like tokens in a text (a request's decoded URL query + path, or its body): a long, high-entropy run of
// url-safe characters -- letters and digits, or long hex -- not a date, a plain number or a dictionary word.
function idTokens(text) {
  const out = []; if (!text) return out;
  for (const raw of String(text).slice(0, 16000).split(/[^A-Za-z0-9_.~-]+/)) {
    const t = raw.replace(/^[._~-]+|[._~-]+$/g, '');
    if (t.length < XID_MIN || t.length > XID_MAX) continue;
    const mixed = /[A-Za-z]/.test(t) && /[0-9]/.test(t), hex = /^[0-9a-f]{16,}$/i.test(t);
    if (!mixed && !hex) continue;
    const distinct = new Set(t.toLowerCase()).size;                 // not 'aaaaaaaaaaaa' or 'ababababab'
    if (distinct < 6 || distinct / t.length < 0.18) continue;
    if (!out.includes(t)) out.push(t);
  }
  return out.slice(0, 20);
}
const idValue = (v) => idTokens(v).length > 0;   // a single value (e.g. a cookie value) carries an id-like token
function fnv1a(s) { let h = 0x811c9dc5; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(16).padStart(8, '0'); }
const tokHash = (salt, tok) => fnv1a(salt + '|' + tok);
// a safe path prefix to block: the request's directory (up to the last slash), so the collector endpoint is cut but the
// site root keeps working. Never the bare root.
function pathPrefix(pathname) { const p = String(pathname || '/'); const i = p.lastIndexOf('/'); const pre = i > 0 ? p.slice(0, i + 1) : '/'; return pre === '/' ? p : pre; }
// ---- M2 (1.26): the DNR rules that act on a confirmed cross-site id. Pure, so the regex logic is unit-tested without
// a browser; the worker fills in rule ids, resource types and the sign-in/off exemptions.
const reEsc = (s) => String(s).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
// block the exact collector endpoint: a host (maybe with a port) and a path prefix, never the bare site root.
const blockRe = (host, prefix) => `^(https?|wss?)://([^/?#@]*@)?${reEsc(host)}${reEsc(prefix)}`;
// strip one token from a request URL or a navigation link, whatever the parameter name: three forms cover the token as
// the first query parameter (with and without parameters after it) and as a later one. [regexFilter, regexSubstitution].
const stripRes = (T) => [
  [`^([^?#]+)\\?[^=&#]+=${T}&([^#]*)(#.*)?$`, '\\1?\\2\\3'],   // first parameter, more follow
  [`^([^?#]+)\\?[^=&#]+=${T}(#.*)?$`, '\\1\\2'],               // first parameter, none follow
  [`^([^#]*?)&[^=&#]+=${T}(&[^#]*)?(#.*)?$`, '\\1\\2\\3'],      // a later parameter
];
// the same strip, in JS, so a test can prove what the DNR redirect rules do to a URL (RE2 and JS agree on these forms)
function applyStrip(url, tok) {
  for (const [rf, sub] of stripRes(reEsc(tok))) { const m = String(url).match(new RegExp(rf)); if (m) return sub.replace(/\\(\d)/g, (_, d) => m[+d] || ''); }
  return url;
}
const nz = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => !Array.isArray(v) || v.length));   // DNR rejects an empty array
// Build the dynamic rules for the confirmed cross-site ids. eps and toks are already vetted by the caller (no sign-in
// host or company, no site the user turned off). The collector block is priority 2 so a site-off `allow` (also
// priority 2, and allow beats block) still exempts it; the URL strip is priority 1, below both. Sign-in hosts are never
// cut (the return-address list), and the sites the user turned off are excluded from both.
// M5: match one EXACT resource (host + full path) whose ETag carried a confirmed cross-site id.
const etagRe = (res) => { const i = res.indexOf('/'), host = i < 0 ? res : res.slice(0, i), path = i < 0 ? '/' : res.slice(i); return `^https?://([^/?#@]*@)?${reEsc(host)}${reEsc(path)}([?#]|$)`; };
function xidRules({ eps = [], toks = [], etags = [], block, strip, etag, signin = [], off = [], blockTypes, stripTypes }) {
  const rules = []; let b = block, s = strip, g = etag, inOff = signin.concat(off);
  // Never the bare site root: an endpoint whose path prefix is '/' (a top-level POST with no directory) is
  // indistinguishable from the site itself, so it is not blocked -- the URL strip and the cookie delete still act on it.
  for (const ep of eps) { const i = ep.indexOf('/'); if (i < 0 || ep.slice(i) === '/') continue;
    rules.push({ id: b++, priority: 2, action: { type: 'block' }, condition: nz({ regexFilter: blockRe(ep.slice(0, i), ep.slice(i)), excludedInitiatorDomains: inOff, excludedRequestDomains: off, resourceTypes: blockTypes }) }); }
  for (const tok of toks) for (const [rf, sub] of stripRes(reEsc(tok)))
    rules.push({ id: s++, priority: 1, action: { type: 'redirect', redirect: { regexSubstitution: sub } }, condition: nz({ regexFilter: rf, excludedInitiatorDomains: inOff, excludedRequestDomains: inOff, resourceTypes: stripTypes }) });
  // M5: strip the conditional request headers for the id-bearing resource only, so caching for every other resource stays
  for (const res of etags) rules.push({ id: g++, priority: 1, action: { type: 'modifyHeaders', requestHeaders: [{ header: 'if-none-match', operation: 'remove' }, { header: 'if-modified-since', operation: 'remove' }] },
    condition: nz({ regexFilter: etagRe(res), excludedInitiatorDomains: inOff, excludedRequestDomains: inOff, resourceTypes: blockTypes }) });
  return rules;
}
// ---- M3 (1.26): strip a confirmed cross-site id from a navigation URL (a scripted or meta hand-off, or a pushState),
// but NEVER from a sign-in return-address parameter -- cutting those breaks OAuth/SAML/CAS return flows. The list is
// specific return-address names only: it must not include the short, ordinary names a tracker rotates through (ref,
// cid, u, r, s, ...), or the chain would never be cut. Matched case-insensitively.
const RETURN_PARAMS = ['redirect_uri', 'redirect_url', 'redirecturl', 'redirect', 'return_to', 'returnto', 'return_url', 'returnurl', 'continue', 'callback', 'callback_url', 'callbackurl', 'state', 'relaystate', 'wreply', 'wa', 'wctx', 'service', 'sso', 'saml', 'samlrequest', 'openid.return_to', 'openid_return_to', 'response_uri', 'post_logout_redirect_uri', 'ticket'];
// Returns the URL with every query parameter whose value carries a confirmed token removed, or null if nothing changed.
// A return-address parameter is left whole (the id may be nested in its callback URL, which the flow needs).
function stripNav(url, toks = [], returnParams = RETURN_PARAMS) {
  let u; try { u = new URL(url); } catch { return null; }
  if (!u.search || !toks.length) return null;
  const rp = new Set(returnParams.map((p) => p.toLowerCase())); let changed = false;
  for (const name of [...new Set([...u.searchParams.keys()])]) {
    if (rp.has(name.toLowerCase())) continue;
    if (u.searchParams.getAll(name).some((v) => toks.some((t) => t && v.includes(t)))) { u.searchParams.delete(name); changed = true; }
  }
  return changed ? u.toString() : null;
}
if (typeof module !== 'undefined') module.exports = { XID_MIN, XID_MAX, idTokens, idValue, fnv1a, tokHash, pathPrefix, reEsc, blockRe, stripRes, applyStrip, xidRules, RETURN_PARAMS, stripNav, etagRe };
