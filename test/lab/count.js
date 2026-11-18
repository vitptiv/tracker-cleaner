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
const NAMES = { A: 'A (fresh install, nothing changed)', Q: 'Q (fresh install, every question answered yes: Remove, Skip it, cut it off; nothing else by hand)', B0: 'B0 (every group forced to Automatic)',
  C: 'C (lab names entered, every question answered yes and every manual cleaning done)' };
// in Q and C the middle number is counted after the answers or the cleaning, on a second look at the sites
const MIDDLE = { Q: 'tied to her after the answers', C: 'tied to her after the cleaning' };
const apart = (c) => [(c.simulated || []).length ? `apart from these, ${c.simulated.join(', ')} arrives only through the lab's simulated press (Chrome's real setting is blocked)` : '',
  (c.own || []).length ? `${c.own.join(', ')} kept on purpose: your own history, readable by no website` : ''].filter(Boolean).map((x) => '; ' + x).join('');
// Three numbers (H11): still arriving at the end and tied to her; arrived at some point and tied to her; arrived at all,
// also when tied to nobody.
const headline = (runs) => (runs.A ? '' : 'A was not run. ') + Object.keys(runs).map((n) => { const c = runs[n].counts;
  return `${NAMES[n] || n}${n === 'A' ? ', of the 35 kinds built' : ''}: ${c.atEnd} at the end; ${c.ever} ${MIDDLE[n] || 'arrived and tied to her'}; ${c.arrived} arrived at all${apart(c)}.`; }).join(' ');
// what the numbers do not show, written beside them in misses.json and on the page
const CAVEATS = ['Nothing is cut short in the measurement any more: there is no hold on everything (L4). The lab\'s own "Sign in with" page holds deleting for the network\'s own site for five minutes, as it would for a user.',
  'A is the fresh install with no press; Q is the same with every question the extension asks answered yes; since L1 a company on no list is not even blocked without such a press.',
  'In Q each press is a message sent to the extension from its own popup page, the message the button sends; it is not a click on the button in the report.',
  'The numbers differ from run to run by a few kinds (seen: "arrived at all" 15 to 28 for the same setting): how many requests get through before a block depends on timing.',
  'The lab does not use the fingerprint to tie visits together, so the page shield is not measured by these numbers.',
  'T18 and T19 (site icons and history) are counted apart as her own history, readable by no website.',
  'T22 (notification right) is counted apart when it arrives only through the lab\'s simulated press on Allow.',
  'One kind of 36 (T34) is not built in the lab.'];
// T22 only: the lab's "Allow" is a grant over the control channel, which overrides every setting, so the lab keeps reading
// "granted". When Chrome's real setting for that site, read from the extension's side at the end, is "block", the row is
// taken out of the count and listed apart, by name.
const simulatedOnly = ({ id, atEnd, setting }) => id === 'T22' && atEnd === true && setting === 'block';
// T18 (site icons) and T19 (history): the user's own record of the pages she opened, in Chrome's own files. No website can
// read them; the lab knows them only because its trip hands them in from outside. While they are still in the files at
// the end they are a class of their own, named apart; cleared (the popup's "Clear my browsing history"), there is nothing to name.
const ownRecord = ({ id, atEnd }) => (id === 'T18' || id === 'T19') && atEnd === true;
module.exports = { RESTART, stepOf, atEnd, headline, simulatedOnly, ownRecord, CAVEATS };
