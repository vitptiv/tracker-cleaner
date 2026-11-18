'use strict';
// Two counts per kind of trace, kept apart: "ever" (it arrived once, tied to the visitor) and "at the end".
// At the end = it still arrived, tied to her, after Chrome was started again (steps after RESTART); or, for a kind the
// trip only makes before that, the last time the trip made it (lastChance, from the run with the cleaner switched off);
// or, for a kind kept in Chrome's own files, it is still in the files when the trip is over. After cleaning by hand
// (second), a kind the second look makes again counts only when it arrived then.
const RESTART = 8;
const stepOf = (ends, steps, n) => { const i = ends.findIndex((e) => n < e); return steps[i < 0 ? steps.length - 1 : i]; };
const atEnd = ({ outside, onDisk, second, after, lastStep, lastChance }) => outside ? !!onDisk : second ? !!after
  : lastStep > 0 && lastStep >= Math.min(RESTART + 1, lastChance || 0);
// The headline is setting A, the install as a user gets it; B0 forces also the groups that ask by default (Google's
// identity cookies, the user's own lists) to Automatic, so it is named as that. Both counts, always.
const NAMES = { A: 'A (fresh install, nothing changed)', B0: 'B0 (every group forced to Automatic)' };
const apart = (c) => (c.simulated || []).length ? `; apart from these, ${c.simulated.join(', ')} arrives only through the lab's simulated press (Chrome's real setting is blocked)` : '';
const headline = (runs) => (runs.A ? '' : 'A was not run. ') + Object.keys(runs).map((n) => `${NAMES[n] || n}: ${runs[n].counts.atEnd} at the end, ${runs[n].counts.ever} ever${n === 'A' ? ', of 36' : ''}${apart(runs[n].counts)}.`).join(' ');
// T22 only: the lab's "Allow" is a grant over the control channel, which overrides every setting, so the lab keeps reading
// "granted". When Chrome's real setting for that site, read from the extension's side at the end, is "block", the row is
// taken out of the count and listed apart, by name.
const simulatedOnly = ({ id, atEnd, setting }) => id === 'T22' && atEnd === true && setting === 'block';
module.exports = { RESTART, stepOf, atEnd, headline, simulatedOnly };
