// security/trackers.js was rebuilt from 1.20's generated files; this proves build.js gives them back.
// Since 1.21 the rules are split: rules.json (tracker domains, C01) and rules-google.json (ad paths, C02).
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), os = require('os'), path = require('path');
const { execFileSync } = require('child_process');
const root = path.join(__dirname, '..'), read = (...p) => fs.readFileSync(path.join(root, ...p), 'utf8');
const EXPORT = "if (typeof module !== 'undefined') module.exports = { DOMAINS, COOKIE_RE, GOOGLE_RE, KEEP_RE, URL_PARAMS };\n";
const SIGNIN = ['accounts.google.com', 'accounts.youtube.com'];

// build.js writes next to itself, so run a copy in a temp tree rather than over the working files
function build() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tc-build-')), out = (f) => fs.readFileSync(path.join(tmp, 'extension', f), 'utf8');
  fs.mkdirSync(path.join(tmp, 'extension')); fs.mkdirSync(path.join(tmp, 'security'));
  for (const f of ['build.js', 'guard.js']) fs.copyFileSync(path.join(root, 'extension', f), path.join(tmp, 'extension', f));
  fs.copyFileSync(path.join(root, 'security/trackers.js'), path.join(tmp, 'security/trackers.js'));
  try { execFileSync(process.execPath, [path.join(tmp, 'extension/build.js')]);
    return { rules: out('rules.json'), google: out('rules-google.json'), params: out('rules-params.json'), lists: out('lists.js') };
  } finally { fs.rmSync(tmp, { recursive: true }); }
}

test('trackers.js exports the lists', () => {
  const T = require('../security/trackers.js');
  assert.ok(Array.isArray(T.DOMAINS) && T.DOMAINS.length === 65);
  assert.ok(Array.isArray(T.AD_PATHS) && T.AD_PATHS.length === 14);
  assert.ok(T.COOKIE_RE instanceof RegExp && T.KEEP_RE instanceof RegExp && T.GOOGLE_RE instanceof RegExp);
});
test('the two rule files together hold exactly the rules of 1.20, apart from the sign-in exclusions and the split of the domain rule (first-party.test.js)', () => {
  const b = build(), old = JSON.parse(read('extension-1.20/rules.json')), [one, two] = JSON.parse(b.rules);
  assert.equal(b.rules, JSON.stringify([one, two], null, 1) + '\n');
  assert.deepEqual([...one.condition.requestDomains, ...two.condition.requestDomains].sort(), [...old[0].condition.requestDomains].sort());
  assert.deepEqual(two.condition.resourceTypes, old[0].condition.resourceTypes);
  const google = JSON.parse(b.google);
  assert.equal(b.google, JSON.stringify(google, null, 1) + '\n');
  assert.deepEqual(google.map(({ condition: { excludedInitiatorDomains, excludedRequestDomains, ...condition }, ...r }) => ({ ...r, condition })), old.slice(1));
});
test('every Google/YouTube path rule leaves the sign-in hosts alone, as page and as request', () => {
  const google = JSON.parse(build().google);
  assert.equal(google.length, 14);
  for (const r of google) { assert.deepEqual(r.condition.excludedInitiatorDomains, SIGNIN, r.id); assert.deepEqual(r.condition.excludedRequestDomains, SIGNIN, r.id); }
});
test('build.js regenerates lists.js: domains and keep list as in 1.20, the cookie names split (chunk 5), an export line for Node', () => {
  const now = build().lists.split('\n'), old = read('extension-1.20/lists.js').split('\n');
  const line = (ls, start) => ls.filter((l) => l.startsWith(start));
  for (const k of ['const DOMAINS', 'const KEEP_RE']) { assert.equal(line(now, k).length, 1); assert.deepEqual(line(now, k), line(old, k), k); }
  assert.equal(line(now, 'const COOKIE_RE').length, 1); assert.equal(line(now, 'const GOOGLE_RE').length, 1);
  assert.equal(now.slice(-2).join('\n'), EXPORT);
});
test('the working copy holds exactly what build.js generates', () => {
  const b = build(); assert.equal(read('extension/rules.json'), b.rules); assert.equal(read('extension/rules-google.json'), b.google); assert.equal(read('extension/lists.js'), b.lists);
  assert.equal(read('extension/rules-params.json'), b.params);
});
test('the manifest declares the three rulesets, enabled, and pack.sh ships every file the worker loads', () => {
  assert.deepEqual(require('../extension/manifest.json').declarative_net_request.rule_resources,
    [{ id: 'trackers', enabled: true, path: 'rules.json' }, { id: 'google-paths', enabled: true, path: 'rules-google.json' }, { id: 'url-params', enabled: true, path: 'rules-params.json' }]);
  for (const f of ['core.js', 'registry.js', 'guard.js', 'rules-google.json', 'rules-params.json', 'undo.js', 'popup-view.js', 'popup-audit.js']) assert.ok(read('extension/pack.sh').includes(f), f);
});
test('files no chunk had a reason to touch are still 1.20', () => {
  for (const f of ['yt-adfree.js', 'yt-adfree.css']) assert.equal(read('extension', f), read('extension-1.20', f), f);
});
test('rules-params.json (C23): one redirect rule that removes exactly URL_PARAMS, top-level navigations only, never on the sign-in hosts of guard.js', () => {
  const T = require('../security/trackers.js'), { SIGNIN_HOSTS } = require('../extension/guard.js'), rules = JSON.parse(build().params);
  assert.equal(T.URL_PARAMS.length, 27); assert.equal(new Set(T.URL_PARAMS).size, 27); assert.ok(SIGNIN_HOSTS.includes('accounts.google.com') && SIGNIN_HOSTS.length >= 5);
  assert.deepEqual(rules, [{ id: 1, priority: 1, action: { type: 'redirect', redirect: { transform: { queryTransform: { removeParams: T.URL_PARAMS } } } },
    condition: { resourceTypes: ['main_frame'], excludedRequestDomains: SIGNIN_HOSTS } }]);
  assert.deepEqual(require('../extension/lists.js').URL_PARAMS, T.URL_PARAMS);
});
test('URL_PARAMS holds no parameter a sign-in flow uses', () => {
  const { URL_PARAMS } = require('../security/trackers.js');
  for (const p of ['state', 'code', 'client_id', 'redirect_uri', 'scope', 'nonce', 'response_type', 'id_token', 'access_token', 'token', 'session_state', 'prompt', 'login_hint'])
    assert.equal(URL_PARAMS.includes(p), false, p);
  for (const p of ['gclid', 'fbclid', 'msclkid', 'utm_source', 'utm_id', 'mkt_tok', 'li_fat_id']) assert.ok(URL_PARAMS.includes(p), p);
});
