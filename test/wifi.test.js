const test = require('node:test'), assert = require('node:assert');
const { list, candidates, remove, canDelete } = require('../wifi-helper/wifi.js');

const DAY = 86400, NOW = 1.8e12, S = NOW / 1000; // now is epoch ms, TIMESTAMP is epoch seconds
const U = (n) => `00000000-0000-4000-8000-00000000000${n}`;
const LISTING = [
  `Home:${U(1)}:802-11-wireless:${S - 60}:yes`,
  `Cafe\\: 5G\\\\x:${U(2)}:802-11-wireless:${S - 31 * DAY}:no`,
  `Office:${U(3)}:802-11-wireless:${S - 29 * DAY}:no`,
  `Hotel:${U(4)}:802-11-wireless:0:no`,
  `Wired:${U(5)}:802-3-ethernet:0:no`,
  `Work VPN:${U(6)}:vpn:${S - 90 * DAY}:no`,
  `br0:${U(7)}:bridge:0:no`,
  `lo:${U(8)}:loopback:${S}:yes`,
  `Broken:${U(9)}:802-11-wireless::no`,
  '',
].join('\n');
const PERMS = (v) => `PERMISSION                                                        VALUE \n` +
  `org.freedesktop.NetworkManager.network-control                    yes   \n` +
  `org.freedesktop.NetworkManager.settings.modify.system             ${v}  \n` +
  `org.freedesktop.NetworkManager.settings.modify.own                yes   \n`;

// A fake runner: records every call, answers the two read-only commands, never touches the system.
function fake({ listing = LISTING, perms = PERMS('yes'), failOn } = {}) {
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (args[0] === 'general') return perms;
    if (args.at(-1) === 'show') return listing;
    if (args[1] === 'delete') { if (args[3] === failOn) throw new Error('nmcli failed'); return ''; }
    throw new Error('unexpected command: ' + args.join(' '));
  };
  run.calls = calls;
  run.deleted = () => calls.filter((c) => c[2] === 'delete').map((c) => c[4]);
  return run;
}

test('list: asks nmcli for exactly the terse five-field listing', () => {
  const run = fake(); list(run);
  assert.deepEqual(run.calls, [['nmcli', '-t', '-f', 'NAME,UUID,TYPE,TIMESTAMP,ACTIVE', 'connection', 'show']]);
});
test('list: only Wi-Fi connections appear, never ethernet, vpn, bridge or loopback', () => {
  assert.deepEqual(list(fake()).map((c) => c.uuid), [U(1), U(2), U(3), U(4), U(9)]);
});
test('list: escaped colons and backslashes in a name are unescaped', () => {
  assert.deepEqual(list(fake())[1], { name: 'Cafe: 5G\\x', uuid: U(2), lastUsed: S - 31 * DAY, active: false });
  assert.deepEqual(list(fake())[0], { name: 'Home', uuid: U(1), lastUsed: S - 60, active: true });
});
test('list: a row whose timestamp is not a number stays in the list, marked unreadable, not read as never used', () => {
  assert.deepEqual(list(fake()).at(-1), { name: 'Broken', uuid: U(9), lastUsed: null, active: false });
  for (const stamp of ['', 'soon', '-5', '1e9']) assert.equal(list(fake({ listing: `a:${U(1)}:802-11-wireless:${stamp}:no\n` }))[0].lastUsed, null, stamp);
});
test('list: an unreadable in-use field counts as in use; a row without a UUID is no network', () => {
  assert.deepEqual(list(fake({ listing: `a:${U(1)}:802-11-wireless:0\n` })), [{ name: 'a', uuid: U(1), lastUsed: 0, active: true }]);
  assert.deepEqual(list(fake({ listing: `a::802-11-wireless:0:no\n` })), []);
});
test('an unreadable row is never a candidate and never deleted, whatever the limit', () => {
  assert.equal(candidates(list(fake()), NOW).some((c) => c.uuid === U(9)), false);
  assert.deepEqual(candidates([{ name: 'x', uuid: U(9), lastUsed: null, active: false }, { name: 'y', uuid: U(8), active: false }], NOW, 0), []);
  const run = fake(), r = remove(run, [U(9)], NOW);
  assert.deepEqual(run.deleted(), []);
  assert.deepEqual(r.refused, [{ uuid: U(9), reason: 'last use unreadable' }]);
});

test('candidates: 31 days unused is proposed, 29 days is kept, the active one never', () => {
  const c = candidates(list(fake()), NOW);
  assert.deepEqual(c.map((x) => x.uuid), [U(2), U(4)]);
  assert.equal(c[0].reason, 'not used for 31 days');
});
test('candidates: never-used networks are proposed with their own reason', () => {
  assert.equal(candidates(list(fake()), NOW)[1].reason, 'never used');
});
test('candidates: exactly 30 days is kept; the limit can be changed', () => {
  const one = (ago) => [{ name: 'n', uuid: U(1), lastUsed: S - ago, active: false }];
  assert.equal(candidates(one(30 * DAY), NOW).length, 0);
  assert.equal(candidates(one(30 * DAY + 1), NOW).length, 1);
  assert.equal(candidates(one(8 * DAY), NOW, 7).length, 1);
});
test('candidates: an active connection is never a candidate, even never used or very old', () => {
  const l = [{ name: 'a', uuid: U(1), lastUsed: 0, active: true }, { name: 'b', uuid: U(2), lastUsed: 1, active: true }];
  assert.deepEqual(candidates(l, NOW), []);
});
test('candidates: a wrong clock proposes nothing by age (seconds instead of ms, or no clock)', () => {
  assert.deepEqual(candidates(list(fake()), S).map((x) => x.uuid), [U(4)]);
  assert.throws(() => candidates(list(fake())), /now/);
  assert.throws(() => candidates(list(fake()), NOW, -1), /days/);
});

test('remove: passes exactly the approved UUIDs to the runner, one delete each, as an argument array', () => {
  const run = fake(), r = remove(run, [U(2), U(4)], NOW);
  assert.deepEqual(run.calls.slice(2), [
    ['nmcli', 'connection', 'delete', 'uuid', U(2)],
    ['nmcli', 'connection', 'delete', 'uuid', U(4)],
  ]);
  assert.deepEqual(r, { removed: [{ uuid: U(2), name: 'Cafe: 5G\\x' }, { uuid: U(4), name: 'Hotel' }], refused: [], failed: [] });
});
test('remove: only one candidate approved means only that one is deleted', () => {
  const run = fake(); remove(run, [U(4)], NOW);
  assert.deepEqual(run.deleted(), [U(4)]);
});
test('remove: the active network is never deleted even if its UUID is passed', () => {
  const run = fake(), r = remove(run, [U(1), U(2)], NOW);
  assert.deepEqual(run.deleted(), [U(2)]);
  assert.deepEqual(r.refused, [{ uuid: U(1), reason: 'in use now' }]);
});
test('remove: recently used, non-Wi-Fi and unknown UUIDs are refused and reported', () => {
  const run = fake(), r = remove(run, [U(3), U(5), U(6), 'nope', '--help', 42], NOW);
  assert.deepEqual(run.deleted(), []);
  assert.deepEqual(r.refused.map((x) => x.reason), ['used in the last 30 days', 'not a saved Wi-Fi network', 'not a saved Wi-Fi network', 'not a saved Wi-Fi network', 'not a saved Wi-Fi network', 'not a saved Wi-Fi network']);
});
test('remove: re-reads the list, so a network that became active since the proposal is kept', () => {
  const run = fake({ listing: LISTING.replace(`${S - 31 * DAY}:no`, `${S - 5}:yes`) });
  assert.deepEqual(remove(run, [U(2)], NOW).refused, [{ uuid: U(2), reason: 'in use now' }]);
  assert.deepEqual(run.deleted(), []);
});
test('remove: a repeated UUID is deleted once; a failing delete is reported and the rest go on', () => {
  const run = fake({ failOn: U(2) }), r = remove(run, [U(2), U(2), U(4)], NOW);
  assert.deepEqual(run.deleted(), [U(2), U(4)]);
  assert.deepEqual(r.removed, [{ uuid: U(4), name: 'Hotel' }]);
  assert.deepEqual(r.failed, [{ uuid: U(2), name: 'Cafe: 5G\\x', error: 'nmcli failed' }]);
});
test('remove: without a list of UUIDs or a clock nothing runs', () => {
  const run = fake();
  assert.throws(() => remove(run, U(2), NOW), /uuids/);
  assert.throws(() => remove(run, [U(2)]), /now/);
  assert.deepEqual(run.deleted(), []);
});

test("remove: refuses everything, with the reason, when deletion is not permitted outright", () => {
  for (const [v, why] of [['auth', /password/], ['no', /not permitted/], ['unknown', /not permitted/]]) {
    const run = fake({ perms: PERMS(v) }), r = remove(run, [U(2), U(4), U(2)], NOW);
    assert.deepEqual(run.calls, [['nmcli', 'general', 'permissions']], v);       // not even the list is read
    assert.deepEqual(r.removed, []); assert.deepEqual(r.failed, []);
    assert.deepEqual(r.refused.map((x) => x.uuid), [U(2), U(4)]);
    for (const x of r.refused) assert.match(x.reason, why);
  }
  assert.throws(() => remove(fake({ perms: PERMS('no') }), U(2), NOW), /uuids/);
});

test('canDelete: yes, auth or no for settings.modify.system; anything unclear is no', () => {
  const run = fake();
  assert.equal(canDelete(run), 'yes');
  assert.deepEqual(run.calls, [['nmcli', 'general', 'permissions']]);
  assert.equal(canDelete(fake({ perms: PERMS('auth') })), 'auth');
  assert.equal(canDelete(fake({ perms: PERMS('no') })), 'no');
  assert.equal(canDelete(fake({ perms: PERMS('unknown') })), 'no');
  assert.equal(canDelete(fake({ perms: '' })), 'no');
  assert.equal(canDelete(() => { throw new Error('no nmcli'); }), 'no');
});
