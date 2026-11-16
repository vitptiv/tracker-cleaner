// Pins what 1.20 decides about cookies: 1.21's core.js with 1.20's lists (read from extension-1.20/, untouched)
// decides exactly like 1.20. What 1.21 changes on purpose is in the lists (NID, li_at): see cookie-split.test.js.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const makeCore = require('../extension/core.js');
// 1.20's lists.js has no export line; it is three const lines, evaluated here without running anything else
const L = new Function(fs.readFileSync(path.join(__dirname, '../extension-1.20/lists.js'), 'utf8') + '; return { DOMAINS, COOKIE_RE, KEEP_RE };')();

const ck = (name, domain = '.example.com') => ({ name, domain, path: '/', secure: true, storeId: '0' });
const core = (set = {}) => { const c = makeCore(L); Object.assign(c.S, set); return c; };

// 1.20's own decision lines (isTrackerHost .. shouldGo), cut out of the untouched baseline. They are
// pure: STATE mentions chrome but is never called here.
function baseline() {
  const src = fs.readFileSync(path.join(__dirname, '../extension-1.20/background.js'), 'utf8');
  const cut = src.slice(src.indexOf('const isTrackerHost'), src.indexOf('async function refreshBlacklist'));
  assert.ok(cut.includes('const shouldGo'));
  return new Function('DOMAINS', 'COOKIE_RE', 'KEEP_RE', cut +
    '; return { shouldGo, isTrackerHost, realHost, set: (s) => { BLACK = s.BLACK; MODE = s.MODE; ALLOW = s.ALLOW; CLEAN = s.CLEAN; } };')(L.DOMAINS, L.COOKIE_RE, L.KEEP_RE);
}

test('NID is deleted (Google sign-in and reCAPTCHA cookie)', () => assert.equal(core().shouldGo(ck('NID', '.google.com')), true));
test('the other Google/YouTube identity cookies are deleted', () => {
  for (const n of ['OTZ', '1P_JAR', 'YSC', 'VISITOR_INFO1_LIVE', 'VISITOR_PRIVACY_METADATA', '__Secure-YNID', '__Secure-YEC', 'GPS'])
    assert.equal(core().shouldGo(ck(n, '.youtube.com')), true, n);
});
test('SID and the other Google login cookies are kept', () => {
  for (const n of ['SID', 'HSID', 'SAPISID', '__Secure-1PSID', '__Secure-3PSIDTS', '__Host-GAPS', 'LOGIN_INFO'])
    assert.equal(core().shouldGo(ck(n, '.google.com')), false, n);
});
test('li_at is deleted (LinkedIn login cookie, caught by the li_ prefix)', () => assert.equal(core().shouldGo(ck('li_at', '.www.linkedin.com')), true));
test('any cookie on a tracker host is deleted, also on a subdomain', () => {
  assert.equal(core().shouldGo(ck('whatever', '.doubleclick.net')), true);
  assert.equal(core().shouldGo(ck('whatever', 'stats.g.doubleclick.net')), true);
  assert.equal(core().shouldGo(ck('whatever', '.notdoubleclick.net')), false);
});
test('a keep-listed name survives even on a tracker host', () => assert.equal(core().shouldGo(ck('SID', '.doubleclick.net')), false));
test('an ordinary cookie on an ordinary site is kept', () => assert.equal(core().shouldGo(ck('session', '.example.com')), false));
test('Fit-browser *.localhost copies are judged by the real host', () => {
  const c = core();
  assert.equal(c.realHost('.www.doubleclick.net.http.localhost'), 'www.doubleclick.net');
  assert.equal(c.shouldGo(ck('x', 'www.doubleclick.net.localhost')), true);
});
test('blacklist beats the keep list; "*" means any site', () => {
  assert.equal(core({ BLACK: [{ h: 'google.com', n: 'SID' }] }).shouldGo(ck('SID', '.google.com')), true);
  assert.equal(core({ BLACK: [{ h: '*', n: 'session' }] }).shouldGo(ck('session')), true);
});
test('allow-list mode deletes everything not listed, sign-in state cookies included', () => {
  const c = core({ MODE: 'allowlist', ALLOW: [{ site: 'youtube.com', names: ['SID'] }, { site: 'spotify.com', names: ['*'] }] });
  assert.equal(c.shouldGo(ck('SID', '.youtube.com')), false);
  assert.equal(c.shouldGo(ck('anything', '.open.spotify.com')), false);
  assert.equal(c.shouldGo(ck('SID', '.google.com')), true);
  assert.equal(c.shouldGo(ck('g_state', 'accounts.google.com')), true);
});
test('CLEAN false stops all cookie deletion, the blacklist included', () => {
  const c = core({ CLEAN: false, BLACK: [{ h: '*', n: 'NID' }] });
  assert.equal(c.shouldGo(ck('NID', '.google.com')), false);
  assert.equal(c.shouldGo(ck('x', '.doubleclick.net')), false);
});

test('reason says why: blacklist, allowlist, name, host or null', () => {
  assert.equal(core().reason(ck('NID', '.google.com')), 'name');
  assert.equal(core().reason(ck('_ga', '.doubleclick.net')), 'name');
  assert.equal(core().reason(ck('x', '.doubleclick.net')), 'host');
  assert.equal(core().reason(ck('SID', '.google.com')), null);
  assert.equal(core({ BLACK: [{ h: '*', n: '_ga' }] }).reason(ck('_ga')), 'blacklist');
  assert.equal(core({ MODE: 'allowlist', ALLOW: [{ site: 'a.com', names: ['*'] }] }).reason(ck('_ga')), 'allowlist');
  assert.equal(core({ MODE: 'allowlist', ALLOW: [{ site: 'example.com', names: ['*'] }] }).reason(ck('_ga')), null);
  assert.equal(core({ CLEAN: false }).reason(ck('_ga')), null);
});

test('core.js decides exactly like the 1.20 lines over a cookie x settings matrix', () => {
  const names = ['NID', 'SID', 'li_at', 'lidc', '_ga', '_ga_ABC', 'fr', 'free', 'session', 'sp_dc', 'sp_t', 'sp_gaid', 'PREF', 'GPS', 'g_state', '__Secure-1PSID', 'IDE', ''];
  const domains = ['.google.com', 'accounts.google.com', '.youtube.com', '.doubleclick.net', 'a.b.criteo.com', '.linkedin.com', 'open.spotify.com',
    'www.hotjar.com.http.localhost', 'example.com.localhost', '.EXAMPLE.com', 'DoubleClick.net'];
  const settings = [
    {}, { CLEAN: false }, { BLACK: [{ h: 'google.com', n: 'SID' }, { h: '*', n: 'session' }, { h: 'example.com', n: 'free' }] },
    { MODE: 'allowlist', ALLOW: [{ site: 'google.com', names: ['SID', 'NID'] }, { site: 'spotify.com', names: ['*'] }] },
    { MODE: 'allowlist', ALLOW: [{ site: 'youtube.com', names: ['*'] }], BLACK: [{ h: 'youtube.com', n: 'PREF' }] },
    { MODE: 'allowlist', ALLOW: [] },
  ];
  const old = baseline(); let n = 0;
  for (const s of settings) {
    const full = { BLACK: [], MODE: 'normal', ALLOW: [], CLEAN: true, ...s }, c = core(full); old.set(full);
    for (const d of domains) {
      assert.equal(c.isTrackerHost(d), old.isTrackerHost(d), d); assert.equal(c.realHost(d), old.realHost(d), d);
      for (const name of names) { assert.equal(c.shouldGo(ck(name, d)), old.shouldGo(ck(name, d)), `${name} @ ${d} ${JSON.stringify(s)}`); n++; }
    }
  }
  assert.equal(n, names.length * domains.length * settings.length);
});

test('background.js takes its decisions from core.js and no longer defines them itself', () => {
  const bg = fs.readFileSync(path.join(__dirname, '../extension/background.js'), 'utf8');
  assert.match(bg, /importScripts\('lists\.js', 'core\.js'/);
  for (const f of ['isTrackerHost', 'realHost', 'isBlack', 'isAllowed', 'shouldGo']) assert.doesNotMatch(bg, new RegExp(`const ${f} = \\(`), f);
  assert.doesNotMatch(bg, /\b(BLACK|MODE|ALLOW|CLEAN)\b(?<!S\.(BLACK|MODE|ALLOW|CLEAN))/);   // state lives in core's S only
});
