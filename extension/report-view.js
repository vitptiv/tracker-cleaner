// The report (1.23) as data and as HTML, free of Chrome calls so the Node tests can build and render it.
// buildReport(state, tab) -> plain data; renderReport(report) -> HTML. Every word the report shows is made here.
//   state  background.js's reply to { type: 'state' }, plus `history` (the reply to { type: 'history' }), as in the popup
//   tab    the tab the report is about, or null when it is not a web page:
//          { id, host, matched }: matched = the rule file (rulesetId) of each request Chrome says it stopped or changed
//          on this tab, null when Chrome did not say
//          cookies = the reply to { type: 'cookies', host }: this site's cookies as Chrome has them now, each value
//          already cut to its first 24 characters; left out when Chrome did not say
// What a cookie holds is shown cut, on the screen only: nothing here writes it anywhere.
// Every value goes through esc. A button carries its message for background.js in data-msg.
const { buildReport, renderReport } = (() => {
  const dep = typeof module !== 'undefined' ? { lists: require('./lists.js'), makeCore: require('./core.js'), day: require('./history.js').historyDay }
    : { lists: { DOMAINS, COOKIE_RE, GOOGLE_RE, KEEP_RE }, makeCore, day: historyDay };
  const core = dep.makeCore(dep.lists), MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const under = (h, site) => h === site || h.endsWith('.' + site);
  const INSPECT = 'node tools/inspect.js ', CUT = 24;   // CUT: how much of a value is shown, as in background.js
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

  // ---- This site's cookies, judged as background.js would: by the built-in lists and the user's own exceptions
  const WHY = { name: "has a tracker's name", host: "comes from a tracker's site", google: 'Google uses it to recognise you' };
  const FATE = { on: 'deleted automatically', 'asks first': 'deleted only after you say so', off: 'kept because this cleaning is switched off',
    paused: 'kept while cleaning is paused', 'held while you sign in': 'kept while you sign in' };
  const cookieRow = (c, s, host) => {
    const domain = String(c.domain), site = domain.replace(/^\./, ''), real = core.realHost(domain), r = core.reason({ domain, name: c.name });
    const signin = dep.lists.KEEP_RE.test(c.name), value = String(c.value ?? ''), d = new Date(c.expirationDate * 1000);
    const g = (s.groups || []).find((x) => x.id === (r === 'google' ? 'google' : 'cookies')) || {};
    const what = signin ? 'keeps you signed in, kept' + (core.isTrackerHost(real) ? " even though it comes from a tracker's site" : '')
      : !r ? 'on no tracker list, kept'
      : `${WHY[r]}, ` + ((s.sitesOff || []).some((x) => under(real, x)) ? 'kept because you told it not to clean this site'
        : (s.allow || []).some((a) => a.site === site && a.name === c.name) ? 'kept because you chose Keep'
        : r === 'host' && core.firstParty({ domain }, [host]) ? 'kept while you are on that site' : FATE[word(g, s)]);
    return { site, name: String(c.name), value: value.slice(0, CUT), long: c.long === true || value.length > CUT,
      expires: c.session || !(c.expirationDate > 0) ? 'until you close Chrome' : `until ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, what, signin };
  };

  const buildReport = (state, tab) => {
    const s = state || {}, host = tab && tab.host ? String(tab.host) : null;
    return { site: host,
      features: (s.groups || []).map((g) => ({ id: g.id, title: g.title, says: g.says, state: word(g, s), count: counted(g, s, tab) })),
      cookies: host && Array.isArray(tab.cookies) ? { n: tab.cookies.length, rows: tab.cookies.map((c) => cookieRow(c, s, host)) } : null };
  };

  const renderReport = (report) => {
    const r = report || {};
    const feature = (f) => `<div class="c" data-group="${esc(f.id)}"><div class="h"><b>${esc(f.title)}</b><span class="m">${esc(f.state)}${f.count ? ` · ${esc(f.count)}` : ''}</span></div>`
      + `<div class="m">${esc(f.says)}</div></div>`;
    const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`, safe = /^[a-z0-9.-]+$/i.test(r.site || '');   // only such a name goes into a command
    const cookie = (c) => `<div class="c"><div><b>${esc(c.name)}</b> <span class="m">${esc(c.site)} · ${esc(c.expires)}</span></div>`
      + `<div>${c.value ? `<code>${esc(c.value)}${c.long ? '…' : ''}</code>` : '<span class="m">holds nothing</span>'}</div><div class="m">${esc(c.what)}</div></div>`;
    const cookies = () => { const c = r.cookies;
      return '<h2>Small files this site has saved to recognise you (cookies)</h2>'
        + (!r.site ? '<p class="m">This tab is not a web page, so there are no cookies to show.</p>' : !c ? '<p class="m">Chrome did not say which cookies this site has.</p>'
          : !c.n ? '<p>This site has saved no cookies.</p>'
          : `<p>${count(c.n, 'cookie')} on ${esc(r.site)}, read from Chrome just now. They are in Chrome&#39;s own cookie file on this computer. `
            + 'Only the start of what each one holds is shown here, and none of it is saved anywhere.</p>'
            + (safe ? `<p class="m">See this list in a terminal: <code>${INSPECT}cookies --site ${r.site}</code> <button class="small" data-copy="${INSPECT}cookies --site ${r.site}">Copy command</button></p>` : '')
            + `<details id="cookies"><summary>Show the ${count(c.n, 'cookie')}</summary>${c.rows.map(cookie).join('')}</details>`); };
    return '<h2>What Tracker Cleaner does for you</h2>' + (r.features || []).map(feature).join('') + cookies();
  };
  return { buildReport, renderReport };
})();
if (typeof module !== 'undefined') module.exports = { buildReport, renderReport };
