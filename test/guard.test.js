const test = require('node:test'), assert = require('node:assert');
const { isSignIn, holdNow, GUARD_MS } = require('../extension/guard.js');
const { gate, mayRun, CAPS, GROUPS, cap } = require('../extension/registry.js');

test('isSignIn: sign-in hosts, OAuth-style URLs and login paths', () => {
  for (const u of ['https://accounts.google.com/v3/signin/identifier', 'https://accounts.google.com/', 'https://accounts.youtube.com/accounts/SetSID',
    'https://login.microsoftonline.com/common/x', 'https://login.live.com/', 'https://appleid.apple.com/auth', 'https://github.com/login', 'https://github.com/login/device',
    'https://github.com/sessions/two-factor', 'https://example.com/cb?client_id=1&redirect_uri=https%3A%2F%2Fa.test', 'https://example.com/oauth/start',
    'https://example.com/api/oauth2/v1', 'https://example.com/authorize?x=1', 'https://example.com/signin', 'https://example.com/en/sign-in/',
    'https://example.com/Login', 'https://example.com/sso/start', 'https://idp.example.com/saml/acs', 'http://example.com/login'])
    assert.equal(isSignIn(u), true, u);
});
test('isSignIn: everything else is not sign-in', () => {
  for (const u of ['https://example.com/blog/login-tips', 'https://example.com/', 'https://www.google.com/search?q=login', 'https://github.com/torvalds/linux',
    'https://github.com/loginx', 'https://example.com/sessions', 'https://example.com/?client_id=1', 'https://example.com/?redirect_uri=x', 'https://notaccounts.google.com.evil.test/',
    'https://example.com/?next=/login', 'https://example.com/oauthx/a', 'chrome://settings/login', 'about:blank', '', undefined, 'not a url'])
    assert.equal(isSignIn(u), false, String(u));
});

const T = 1.8e12, tab = (url, active = true) => ({ id: 1, url, active });
test('guard: an active sign-in tab holds regardless of the timestamp; pendingUrl counts', () => {
  assert.equal(holdNow({}, [tab('https://accounts.google.com/')], T).guard, true);
  assert.equal(holdNow({ guardUntil: T - 1 }, [{ id: 2, active: true, pendingUrl: 'https://example.com/oauth/x' }], T).guard, true);
  assert.equal(holdNow({}, [tab('https://example.com/')], T).guard, false);
});
test('guard: a sign-in tab in the background does not hold by itself, only through guardUntil', () => {
  const parked = [tab('https://example.com/'), tab('https://example.com/login', false)];
  assert.deepEqual(holdNow({ guardUntil: T - 1 }, parked, T), { paused: false, guard: false, tab: false });
  assert.equal(holdNow({ guardUntil: T + 1 }, parked, T).guard, true);
});
test('guard: holds until guardUntil, not after', () => {
  assert.equal(GUARD_MS, 5 * 60e3);
  assert.equal(holdNow({ guardUntil: T + GUARD_MS }, [], T + GUARD_MS - 1).guard, true);
  assert.equal(holdNow({ guardUntil: T + GUARD_MS }, [], T + GUARD_MS).guard, false);
});
test('pause expires on time', () => {
  const st = { pauseUntil: T + 10 * 60e3 };
  assert.equal(holdNow(st, [], T).paused, true); assert.equal(holdNow(st, [], T + 10 * 60e3 - 1).paused, true);
  assert.equal(holdNow(st, [], T + 10 * 60e3).paused, false); assert.equal(holdNow({}, [], T).paused, false);
});

test('gate: guard holds destructive capabilities only; pause holds all; without a hold it is mayRun', () => {
  const s = { master: true, modes: { C13: 'auto' } }, none = { paused: false, guard: false };
  for (const c of CAPS) assert.equal(gate(c.id, s, none), mayRun(c.id, s), c.id);
  assert.equal(gate('C03', s, { guard: true }), 'held'); assert.equal(gate('C13', s, { guard: true }), 'held');
  assert.equal(gate('C01', s, { guard: true }), 'run');
  assert.equal(gate('C01', s, { paused: true }), 'held'); assert.equal(gate('C03', s, { paused: true }), 'held');
  assert.equal(gate('C04', s, { paused: true, guard: true }), 'ask');   // held only replaces 'run'
  assert.equal(gate('C12', s, { paused: true }), 'no');
});

test('GROUPS: every action capability is in exactly one group, in usability order', () => {
  const ids = GROUPS.flatMap((g) => g.caps);
  assert.deepEqual([...ids].sort(), CAPS.filter((c) => c.mode !== null).map((c) => c.id).sort());
  assert.equal(new Set(ids).size, ids.length);
  for (const g of GROUPS) { assert.ok(g.id && g.title && g.caps.length, g.id); for (const id of g.caps) assert.equal(cap(id).group, g.id); }
  const rank = 'C18 C19 C01 C03 C04 C20 C21 C02 C05 C26 C22 C23 C25 C06 C07 C08 C24 C09 C10 C11 C12 C13 C14 C15'.split(' ');
  const first = GROUPS.map((g) => Math.min(...g.caps.map((id) => rank.indexOf(id))));
  assert.deepEqual(first, [...first].sort((a, b) => a - b));
  for (const g of GROUPS) assert.deepEqual(g.caps, [...g.caps].sort((a, b) => rank.indexOf(a) - rank.indexOf(b)), g.id);
});
