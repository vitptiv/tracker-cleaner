// 1.30: the strength dial (registry.js). One stored setting, `level` ('ask' | 'balanced' | 'strong'), is a thin layer
// under the gate: a row's own stored mode wins, otherwise the level gives the mode, otherwise the capability's default.
const test = require('node:test'), assert = require('node:assert');
const { CAPS, GROUPS, cap, mayRun, gate, modeOf, levelMode, levelNow, answersYes, LEVELS, OWN_SWITCH, CLEANABLE } = require('../extension/registry.js');
const on = (o = {}) => ({ master: true, ...o });
const dial = CAPS.filter((c) => c.mode !== null && !OWN_SWITCH.includes(c.group));

test('three levels; the rows that keep their own switch are Tor, tab limit, allow-list mode, reports and the sign-in guard', () => {
  assert.deepEqual(LEVELS, ['ask', 'balanced', 'strong']);
  assert.deepEqual([...OWN_SWITCH].sort(), ['allowlist', 'server', 'signin', 'tabs', 'tor']);
  for (const id of ['C12', 'C13', 'C14', 'C15', 'C19']) for (const level of LEVELS) assert.equal(modeOf(id, { level }), cap(id).mode, `${id} at ${level}`);
});
test('Balanced (and nothing stored, as on every install before 1.30) is exactly the 1.29 defaults', () => {
  for (const c of CAPS.filter((x) => x.mode !== null)) for (const s of [{}, { level: 'balanced' }, { level: 'nonsense' }]) {
    assert.equal(modeOf(c.id, s), c.mode, c.id);
    assert.equal(mayRun(c.id, on(s)), mayRun(c.id, on({ modes: { [c.id]: c.mode } })), c.id); }
  assert.equal(levelNow({}), 'balanced'); assert.equal(levelNow({ level: 'balanced' }), 'balanced');
});
test('Strongest: every cleaning group runs by itself, including those that ask at Balanced; the two question rows answer yes', () => {
  const s = on({ level: 'strong' });
  for (const id of ['C03', 'C04', 'C06', 'C07', 'C09', 'C11', 'C28', 'C33']) { assert.equal(modeOf(id, s), 'auto', id); assert.equal(mayRun(id, s), 'run', id); }
  for (const id of ['C25', 'C27']) { assert.equal(modeOf(id, s), 'yes', id); assert.equal(mayRun(id, s), 'run', id); assert.equal(answersYes(id, s, {}), true, id); }
  for (const id of ['C01', 'C02', 'C05', 'C23', 'C26', 'C29', 'C30', 'C31', 'C32']) assert.equal(mayRun(id, s), 'run', id);
  assert.equal(mayRun('C14', s), 'no'); assert.equal(mayRun('C13', s), 'no'); assert.equal(mayRun('C12', s), 'no'); assert.equal(mayRun('C15', s), 'no');
  assert.equal(levelNow(s), 'strong');
});
test('Ask first: every group that deletes waits for a press; the rules that delete nothing stay on', () => {
  const s = on({ level: 'ask' });
  for (const c of dial) assert.equal(mayRun(c.id, s), c.destructive ? 'ask' : 'run', c.id);
  for (const id of ['C25', 'C27']) assert.equal(answersYes(id, s, {}), false, id);
  assert.equal(levelNow(s), 'ask');
});
test('the master switch, the pause and a sign-in hold win at every level', () => {
  for (const level of LEVELS) for (const c of dial) {
    assert.equal(mayRun(c.id, { level, master: false }), 'no', `${c.id} off at ${level}`);
    if (c.destructive) assert.notEqual(mayRun(c.id, { level }), 'run', `${c.id}: nothing stored for master, nothing destructive runs at ${level}`);
    assert.notEqual(gate(c.id, on({ level }), { paused: true }), 'run', `${c.id} paused at ${level}`);
    if (c.destructive) assert.notEqual(gate(c.id, on({ level }), { guard: true }), 'run', `${c.id} sign-in at ${level}`); }
  for (const id of ['C25', 'C27']) { assert.equal(answersYes(id, on({ level: 'strong' }), { paused: true }), false); assert.equal(answersYes(id, on({ level: 'strong' }), { guard: true }), false);
    assert.equal(answersYes(id, { level: 'strong', master: false }, {}), false); assert.equal(answersYes(id, { level: 'strong' }, {}), false); }
});
test('a row set by hand keeps its choice under any level, and the dial then says custom', () => {
  const s = on({ level: 'strong', modes: { C04: 'ask' } });
  assert.equal(mayRun('C04', s), 'ask'); assert.equal(levelNow(s), 'custom');
  assert.equal(levelNow(on({ level: 'strong', modes: { C04: 'auto' } })), 'strong', 'the same as the level is not custom');
  assert.equal(levelNow(on({ level: 'strong', modes: { C25: 'auto' } })), 'custom', 'Automatic that asks is not what Strongest does');
  assert.equal(levelNow(on({ level: 'ask', modes: { C14: 'auto', C13: 'ask', C12: 'auto', C15: 'auto' } })), 'ask', 'own-switch rows never make it custom');
  assert.equal(levelNow(on({ modes: { C11: 'ask', C25: 'ask', C27: 'ask', C28: 'ask' } })), 'custom', 'the 1.25 update kept these asking: custom, and nothing changes');
  assert.equal(mayRun('C11', on({ modes: { C11: 'ask' } })), 'ask');
});
test("'yes' is a mode only of the two question rows; stored anywhere else it is ignored", () => {
  assert.equal(modeOf('C25', { modes: { C25: 'yes' } }), 'yes'); assert.equal(modeOf('C27', { modes: { C27: 'yes' } }), 'yes');
  assert.equal(modeOf('C03', { modes: { C03: 'yes' } }), 'auto'); assert.equal(modeOf('C04', { modes: { C04: 'yes' } }), 'ask');
  assert.equal(answersYes('C25', on({ modes: { C25: 'yes' } }), {}), true, 'a hand-set yes at Balanced');
  assert.equal(answersYes('C25', on({ level: 'strong', modes: { C25: 'ask' } }), {}), false, 'a hand-set Ask first at Strongest');
  assert.equal(answersYes('C03', on({ level: 'strong' }), {}), false);
  for (const level of LEVELS) for (const c of CAPS) assert.equal(levelMode(c.id, level) === 'yes', ['C25', 'C27'].includes(c.id) && level === 'strong', c.id);
});
test('the rows with something to clean (a Clean now button) and those that are only rules', () => {
  assert.deepEqual(CLEANABLE, ['cookies', 'google', 'crossid', 'unknown', 'bounce', 'own', 'storage', 'permissions', 'cache']);
  for (const g of CLEANABLE) assert.ok(GROUPS.some((x) => x.id === g), g);
});
