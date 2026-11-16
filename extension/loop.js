// Loop breaker: some sites set a cookie again the moment it is removed, and removing it over and over helps nobody
// (found in use: google.com NID, 30 times in 9 minutes). Pure: background.js keeps
// chrome.storage.local { loops: { '<site> <name>': { t: [times of the latest removals], until } } } and passes it in.
// LOOP_N removals of the same cookie within LOOP_MS: it is left alone until `until` and waits in the approval queue
// with the reason LOOP_WHY. Never a cookie value.
const LOOP_N = 5, LOOP_MS = 10 * 60e3, LOOP_HOLD_MS = 24 * 3600e3, LOOP_WHY = 'this site keeps putting it back';
const loopStuck = (loops, key, now) => ((loops || {})[key] || {}).until > now;
// One more removal of `key`. Returns the new store, without what no longer matters: removals older than the window,
// holds that have ended.
const loopNote = (loops, key, now) => {
  const next = {};
  for (const [k, e] of Object.entries(loops || {})) { const t = e.t.filter((x) => x > now - LOOP_MS), held = e.until > now;
    if (t.length || held) next[k] = held ? { t, until: e.until } : { t }; }
  const e = next[key] || (next[key] = { t: [] });
  e.t.push(now);
  if (e.t.length >= LOOP_N) { e.t = []; e.until = now + LOOP_HOLD_MS; }
  return next;
};
if (typeof module !== 'undefined') module.exports = { LOOP_N, LOOP_MS, LOOP_HOLD_MS, LOOP_WHY, loopStuck, loopNote };
