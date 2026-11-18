const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path');
const { CAPS, GROUPS, cap, mayRun } = require('../extension/registry.js');

// the capability table in PLAN.md is the specification: | C03 | name | status | default mode |
const table = fs.readFileSync(path.join(__dirname, '../PLAN.md'), 'utf8').split('\n').map((l) => l.match(/^\| (C\d\d) \|.*\| *([a-z/]+)[^|]*\|$/)).filter(Boolean)
  .map((m) => ({ id: m[1], mode: m[2] === 'n/a' ? null : m[2] }));

test('every capability of PLAN.md is registered once, with the planned default mode', () => {
  assert.equal(table.length, 30);
  assert.deepEqual(CAPS.map((c) => c.id), table.map((t) => t.id));
  for (const t of table) assert.equal(cap(t.id).mode, t.mode, t.id);
});
test('each entry has a name, a group and a destructive flag', () => {
  for (const c of CAPS) { assert.ok(c.name && c.group, c.id); assert.equal(typeof c.destructive, 'boolean', c.id); }
  for (const id of ['C03', 'C04', 'C06', 'C07', 'C09', 'C11', 'C12', 'C13', 'C14', 'C24', 'C25', 'C27', 'C28']) assert.equal(cap(id).destructive, true, id);
  for (const id of ['C01', 'C02', 'C05', 'C23', 'C26']) assert.equal(cap(id).destructive, false, id);
});
test('no stored setting means no destructive action', () => {
  for (const set of [undefined, null, {}, { modes: {} }])
    for (const c of CAPS.filter((x) => x.destructive)) assert.notEqual(mayRun(c.id, set), 'run', c.id);
  assert.equal(mayRun('C03', {}), 'ask');          // would run by default, but only once the user has stored a choice
  assert.equal(mayRun('C01', {}), 'run');          // blocking deletes nothing, so it works out of the box
  for (const id of ['C12', 'C13', 'C14', 'C15']) assert.equal(mayRun(id, {}), 'no', id);
});
test('a mode stored without the master switch does not unlock a destructive action', () => assert.equal(mayRun('C13', { modes: { C13: 'auto' } }), 'ask'));
test('master on: registry defaults apply', () => {
  const s = { master: true };
  assert.equal(mayRun('C01', s), 'run'); assert.equal(mayRun('C03', s), 'run'); assert.equal(mayRun('C04', s), 'ask');
  for (const id of ['C12', 'C13', 'C14', 'C15']) assert.equal(mayRun(id, s), 'no', id);
  assert.equal(mayRun('C18', s), 'run');           // not an action group: no mode to stop it
});
test('master on: a stored mode overrides the default; a nonsense mode does not', () => {
  const s = { master: true, modes: { C03: 'ask', C13: 'auto', C01: 'off', C04: 'always' } };
  assert.equal(mayRun('C03', s), 'ask'); assert.equal(mayRun('C13', s), 'run'); assert.equal(mayRun('C01', s), 'no'); assert.equal(mayRun('C04', s), 'ask');
});
test('master off stops everything, including tabs, cache and Tor', () => {
  const modes = Object.fromEntries(CAPS.map((c) => [c.id, 'auto']));
  for (const c of CAPS) assert.equal(mayRun(c.id, { master: false, modes }), 'no', c.id);
});
test('an unknown ID never runs', () => assert.equal(mayRun('C99', { master: true, modes: { C99: 'auto' } }), 'no'));
// PLAN.md "Wording rules": everyday words first, the technical name second in brackets and only if useful.
// Where the history page and tools/inspect.js name the same thing, the popup row uses their words.
test('each popup row is titled in everyday words, short enough for the popup', () => {
  assert.deepEqual(GROUPS.map((g) => [g.id, g.title]), [['signin', 'Pause cleaning while you sign in'], ['blocking', 'Ads and trackers blocked as pages load'],
    ['cookies', "Trackers' cookies"], ['google', 'Cookies Google uses to recognise you'], ['othercookies', 'Other companies get no cookies'], ['othertags', 'Other companies get no page address or tag'], ['local', 'Pages may not call this computer'], ['shield', 'Blur what makes this browser recognisable'], ['params', 'Tracking tags removed from links'], ['unknown', 'Trackers that are on no list'], ['bounce', 'Sites that only pass you along'], ['own', 'What trackers saved on their own sites'],
    ['storage', 'Data that sites keep (site storage)'], ['wifi', 'Remembered Wi-Fi networks'], ['permissions', 'What sites may do (site permissions)'],
    ['cache', 'Saved copies of pages (HTTP cache)'], ['allowlist', 'Keep only the cookies you list'], ['tabs', 'Limit how many tabs stay open'],
    ['tor', 'Hiding your address from websites (Tor)'], ['server', 'Reports to a server on this computer']]);
  for (const g of GROUPS) assert.ok(g.title.length < 45, g.title);
});
