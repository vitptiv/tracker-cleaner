// The report (1.23) as data and as HTML, free of Chrome calls so the Node tests can build and render it.
// buildReport(state, tab) -> plain data; renderReport(report) -> HTML. Every word the report shows is made here.
//   state  background.js's reply to { type: 'state' }, plus `history` (the reply to { type: 'history' }), as in the popup
//   tab    the tab the report is about, or null when it is not a web page:
//          { id, host, matched }: matched = the rule file (rulesetId) of each request Chrome says it stopped or changed
//          on this tab, null when Chrome did not say
//          cookies = the reply to { type: 'cookies', host }: this site's cookies as Chrome has them now, each value
//          already cut to its first 24 characters; left out when Chrome did not say
// What a cookie holds is shown cut, on the screen only: nothing here writes it anywhere.
// Every value goes through esc. A button carries its message for background.js in data-msg, or a command to copy in
// data-copy. Two things are left to the page: a button with data-act sends its message and then shows ('full') or
// copies ('copy') the `value` of the reply, keeping it nowhere; and "Delete N cookies on this site" is sent with
// signins: true when the box beside it (data-also="signins") is ticked.
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
    // mine: the user's own word on this cookie, 'always' (delete) or 'keep'. The always-delete list beats everything
    // but a site that is not cleaned at all, and follows the switch of the group it belongs to (storage, C07).
    const on = (list) => (list || []).some((a) => a.site === site && a.name === c.name), mine = on(s.always) ? 'always' : on(s.allow) ? 'keep' : '';
    const g = (s.groups || []).find((x) => x.id === (mine === 'always' ? 'storage' : r === 'google' ? 'google' : 'cookies')) || {};
    const what = mine !== 'always' && signin ? 'keeps you signed in, kept' + (core.isTrackerHost(real) ? " even though it comes from a tracker's site" : '')
      : mine !== 'always' && !r ? 'on no tracker list, kept'
      : `${mine === 'always' ? 'on your always-delete list' : WHY[r]}, ` + ((s.sitesOff || []).some((x) => under(real, x)) ? 'kept because you told it not to clean this site'
        : mine === 'keep' ? 'kept because you chose Keep'
        : !mine && r === 'host' && core.firstParty({ domain }, [host]) ? 'kept while you are on that site' : FATE[word(g, s)]);
    return { site, name: String(c.name), value: value.slice(0, CUT), long: c.long === true || value.length > CUT,
      expires: c.session || !(c.expirationDate > 0) ? 'until you close Chrome' : `until ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, what, signin, tracker: !!r, mine };
  };

  const buildReport = (state, tab) => {
    const s = state || {}, host = tab && tab.host ? String(tab.host) : null;
    return { site: host,
      features: (s.groups || []).map((g) => ({ id: g.id, title: g.title, says: g.says, state: word(g, s), count: counted(g, s, tab) })),
      cookies: host && Array.isArray(tab.cookies) ? { n: tab.cookies.length, rows: tab.cookies.map((c) => cookieRow(c, s, host)) } : null,
      // what the user chose to always delete on this site, also when the cookie is not there right now
      always: host ? (s.always || []).filter((a) => under(host, String(a.site)) || under(String(a.site), host)) : [],
      stopped: (s.hold || {}).paused ? 'paused' : s.master === false ? 'switched off' : '' };   // deleting would be refused
  };

  const renderReport = (report) => {
    const r = report || {};
    const feature = (f) => `<div class="c" data-group="${esc(f.id)}"><div class="h"><b>${esc(f.title)}</b><span class="m">${esc(f.state)}${f.count ? ` · ${esc(f.count)}` : ''}</span></div>`
      + `<div class="m">${esc(f.says)}</div></div>`;
    const count = (n, one) => `${n} ${one}${n === 1 ? '' : 's'}`, safe = /^[a-z0-9.-]+$/i.test(r.site || '');   // only such a name goes into a command
    const btn = (label, m, more = '') => `<button data-msg="${esc(JSON.stringify(m))}"${more}>${label}</button>`, off = r.stopped ? ' disabled' : '';
    const cookie = (c) => { const id = { site: c.site, name: c.name }, value = { type: 'cookieValue', ...id };
      return `<div class="c"><div><b>${esc(c.name)}</b> <span class="m">${esc(c.site)} · ${esc(c.expires)}</span></div>`
        + `<div>${c.value ? `<code>${esc(c.value)}${c.long ? '…' : ''}</code>` : '<span class="m">holds nothing</span>'}</div><div class="m">${esc(c.what)}</div>`
        + `<div class="b">${btn(c.signin ? 'Delete (may sign you out)' : 'Delete', { type: 'drop', kind: 'cookie', ...id }, off)}`
        + (c.mine === 'always' || (c.tracker && !c.mine) ? btn('Keep', { type: 'allow', ...id }) : '') + (c.mine === 'always' ? '' : btn('Always delete', { type: 'always', ...id }, off))
        + (c.long ? btn('Show all of it', value, ' data-act="full"') : '') + (c.value ? btn('Copy what it holds', value, ' data-act="copy"') : '') + '</div></div>'; };
    const all = (c) => { const keep = c.rows.filter((x) => x.signin).length;
      return `<p>${btn(`Delete ${count(c.n - keep, 'cookie')} on this site`, { type: 'dropSite', host: r.site }, ' class="go"' + off)}`
        + (keep ? ` <label><input type="checkbox" data-also="signins"> also the ${keep} that keep${keep === 1 ? 's' : ''} me signed in</label>` : '') + '</p>'
        + (r.stopped ? `<p class="m">Cleaning is ${r.stopped}, so nothing can be deleted from here right now.</p>` : ''); };
    const always = () => !(r.always || []).length ? '' : `<details id="always"><summary>Always deleted on this site (${r.always.length})</summary>`
      + r.always.map((a) => `<div class="c h"><span>${esc(a.site)} · ${esc(a.name)}</span>${btn('Stop always deleting', { type: 'always', site: a.site, name: a.name, on: false })}</div>`).join('') + '</details>';
    const cookies = () => { const c = r.cookies;
      return '<h2>Small files this site has saved to recognise you (cookies)</h2>'
        + (!r.site ? '<p class="m">This tab is not a web page, so there are no cookies to show.</p>' : !c ? '<p class="m">Chrome did not say which cookies this site has.</p>'
          : !c.n ? '<p>This site has saved no cookies.</p>'
          : `<p>${count(c.n, 'cookie')} on ${esc(r.site)}, read from Chrome just now. They are in Chrome&#39;s own cookie file on this computer. `
            + 'Only the start of what each one holds is shown here, and none of it is saved anywhere.</p>'
            + (safe ? `<p class="m">See this list in a terminal: <code>${INSPECT}cookies --site ${r.site}</code> <button class="small" data-copy="${INSPECT}cookies --site ${r.site}">Copy command</button></p>` : '')
            + '<p class="m">Deleting them from a terminal is not offered: Chrome&#39;s cookie file cannot be changed safely while Chrome is running. Use the buttons here.</p>'
            + all(c) + `<details id="cookies"><summary>Show the ${count(c.n, 'cookie')}</summary>${c.rows.map(cookie).join('')}</details>`) + always(); };
    return '<h2>What Tracker Cleaner does for you</h2>' + (r.features || []).map(feature).join('') + cookies();
  };
  return { buildReport, renderReport };
})();
if (typeof module !== 'undefined') module.exports = { buildReport, renderReport };
