'use strict';
// S1: "still tracked at the end" is counted apart from "arrived once" (test/lab/count.js, used by trip-cleaner.js)
const test = require('node:test'), assert = require('node:assert');
const { stepOf, atEnd, RESTART } = require('./lab/count');

test('a record belongs to the step whose end it came before; one after the last end belongs to the last step', () => {
  const ends = [3, 5, 9], steps = [1, 2, 3];
  assert.equal(stepOf(ends, steps, 0), 1); assert.equal(stepOf(ends, steps, 3), 2); assert.equal(stepOf(ends, steps, 8), 3); assert.equal(stepOf(ends, steps, 20), 3);
});
test('at the end: it still arrived, tied to her, after Chrome was started again', () => {
  assert.equal(atEnd({ lastStep: RESTART + 1, lastChance: 12 }), true);
  assert.equal(atEnd({ lastStep: 5, lastChance: 12 }), false);
  assert.equal(atEnd({ lastChance: 12 }), false);
});
test('a kind the trip only makes before the restart counts when it arrived the last time the trip made it', () => {
  assert.equal(atEnd({ lastStep: 7, lastChance: 7 }), true);
  assert.equal(atEnd({ lastStep: 6, lastChance: 7 }), false);
  assert.equal(atEnd({ lastStep: 7 }), true, 'no reference: what arrived counts');
});
test("a kind kept in Chrome's own files counts while it is still in the files when the trip is over", () => {
  assert.equal(atEnd({ outside: true, onDisk: true }), true);
  assert.equal(atEnd({ outside: true, onDisk: false, lastStep: 8, lastChance: 8 }), false);
});
test('after cleaning by hand, a kind the second look makes again counts only when it arrived then', () => {
  assert.equal(atEnd({ second: true, after: false, lastStep: 12, lastChance: 12 }), false);
  assert.equal(atEnd({ second: true, after: true }), true);
});
test('F9: the headline is the fresh install (A), both counts always written; B0 is named as what it is', () => {
  const { headline } = require('./lab/count');
  const runs = { A: { counts: { atEnd: 7, ever: 28 } }, B0: { counts: { atEnd: 6, ever: 27 } }, C: { counts: { atEnd: 5, ever: 7 } } };
  assert.equal(headline(runs), 'A (fresh install, nothing changed): 7 at the end, 28 ever, of 36. B0 (every group forced to Automatic): 6 at the end, 27 ever. C: 5 at the end, 7 ever.');
  assert.equal(headline({ B0: runs.B0 }), 'A was not run. B0 (every group forced to Automatic): 6 at the end, 27 ever.');
});
test('S15: a notification right that Chrome really has blocked, but that the lab keeps seeing through its simulated Allow, is listed apart and never folded in', () => {
  const { simulatedOnly, headline } = require('./lab/count');
  assert.equal(simulatedOnly({ id: 'T22', atEnd: true, setting: 'block' }), true);
  for (const o of [{ id: 'T22', atEnd: true, setting: 'allow' }, { id: 'T22', atEnd: true, setting: 'ask' }, { id: 'T22', atEnd: true, setting: null }, { id: 'T22', atEnd: false, setting: 'block' }, { id: 'T19', atEnd: true, setting: 'block' }])
    assert.equal(simulatedOnly(o), false, JSON.stringify(o));
  assert.equal(headline({ A: { counts: { atEnd: 6, ever: 28, simulated: ['T22'] } } }),
    "A (fresh install, nothing changed): 6 at the end, 28 ever, of 36; apart from these, T22 arrives only through the lab's simulated press (Chrome's real setting is blocked).");
});
test('S16: her own history and site icons are a class of their own, named apart, never folded into the count', () => {
  const { ownRecord, headline } = require('./lab/count');
  assert.equal(ownRecord({ id: 'T18', atEnd: true }), true); assert.equal(ownRecord({ id: 'T19', atEnd: true }), true);
  assert.equal(ownRecord({ id: 'T19', atEnd: false }), false, 'cleared: nothing to name'); assert.equal(ownRecord({ id: 'T17', atEnd: true }), false);
  assert.equal(headline({ A: { counts: { atEnd: 4, ever: 27, simulated: ['T22'], own: ['T18', 'T19'] } } }),
    "A (fresh install, nothing changed): 4 at the end, 27 ever, of 36; apart from these, T22 arrives only through the lab's simulated press (Chrome's real setting is blocked); "
    + 'T18, T19 kept on purpose: your own history, readable by no website.');
});
