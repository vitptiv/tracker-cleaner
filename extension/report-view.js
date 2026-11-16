// The report (1.23) as data and as HTML, free of Chrome calls so the Node tests can build and render it.
// buildReport(state, tab) -> plain data; renderReport(report) -> HTML. Every word the report shows is made here.
//   state  background.js's reply to { type: 'state' }, plus `history` (the reply to { type: 'history' }), as in the popup
//   tab    the tab the report is about, or null when it is not a web page:
//          { id, host, matched }: matched = the rule file (rulesetId) of each request Chrome says it stopped or changed
//          on this tab, null when Chrome did not say
// Every value goes through esc. A button carries its message for background.js in data-msg.
const { buildReport, renderReport } = (() => {
  const dep = typeof module !== 'undefined' ? { day: require('./history.js').historyDay } : { day: historyDay };
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  // ---- What Tracker Cleaner does for you: one row per group
  // The state in a word, as the gate (registry.js) would answer for the group right now.
  const word = (g, s) => {
    const hold = s.hold || {}, mode = g.ask === false && g.mode !== 'auto' ? 'off' : g.noAuto && g.mode === 'auto' ? 'ask' : g.mode;
    if (s.master === false || (mode !== 'auto' && mode !== 'ask')) return 'off';
    if (hold.paused) return 'paused';
    if (mode === 'ask' || (g.ask && s.master !== true)) return 'asks first';   // nothing is deleted before the user turned cleaning on
    return hold.guard && g.ask ? 'held while you sign in' : 'on';
  };
  // what a group's removal is called: "4 deleted today"
  const DID = { cookies: 'deleted', google: 'deleted', allowlist: 'deleted', storage: 'emptied', wifi: 'forgotten', permissions: 'blocked', cache: 'cleared', tabs: 'closed' };
  // Blocked and cleaned links are those of this tab (Chrome counts them per tab). Deleted today and waiting are those
  // of the whole group: the history keeps one number per group and day, and the button acts on everything that waits.
  const counted = (g, s, tab) => {
    const hits = (ids) => tab && Array.isArray(tab.matched) ? tab.matched.filter((id) => ids.includes(id)).length : null;
    if (g.id === 'blocking') { const n = hits(['trackers', 'google-paths']); return n === null ? 'Chrome did not say how many it blocked' : `${n} blocked on this page`; }
    if (g.id === 'params') { const n = hits(['url-params']); return n === null ? 'Chrome did not say how many links it cleaned' : `${n} link${n === 1 ? '' : 's'} cleaned on this page`; }
    if (!DID[g.id]) return '';   // nothing to count: the sign-in pause, Tor, the reports
    const today = Number((((s.history || {}).days || {})[dep.day(s.now || 0)] || {})[g.id]) || 0;
    return `${today} ${DID[g.id]} today, ${Number(g.pending) || 0} waiting`;
  };

  const buildReport = (state, tab) => {
    const s = state || {};
    return { site: tab && tab.host ? String(tab.host) : null,
      features: (s.groups || []).map((g) => ({ id: g.id, title: g.title, says: g.says, state: word(g, s), count: counted(g, s, tab) })) };
  };

  const renderReport = (report) => {
    const r = report || {};
    const feature = (f) => `<div class="c" data-group="${esc(f.id)}"><div class="h"><b>${esc(f.title)}</b><span class="m">${esc(f.state)}${f.count ? ` · ${esc(f.count)}` : ''}</span></div>`
      + `<div class="m">${esc(f.says)}</div></div>`;
    return '<h2>What Tracker Cleaner does for you</h2>' + (r.features || []).map(feature).join('');
  };
  return { buildReport, renderReport };
})();
if (typeof module !== 'undefined') module.exports = { buildReport, renderReport };
