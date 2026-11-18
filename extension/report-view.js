// The report (1.23) as data and as HTML, free of Chrome calls so the Node tests can build and render it.
// buildReport(state, tab) -> plain data; renderReport(report) -> HTML. Every word the report shows is made here.
//   state  background.js's reply to { type: 'state' }, plus `history` (the reply to { type: 'history' }), as in the popup
//   tab    the tab the report is about, or null when it is not a web page:
//          { id, host, matched }: matched = the rule file (rulesetId) of each request Chrome says it stopped or changed
//          on this tab, null when Chrome did not say
//          cookies = the reply to { type: 'cookies', host }: this site's cookies as Chrome has them now, each value
//          already cut to its first 24 characters; left out when Chrome did not say
//          stored = the reply to { type: 'stored', tabId }: what the page has saved besides cookies, counted in the
//          page when asked; left out until then
// What a cookie or a page's storage holds is shown cut, on the screen only: nothing here writes it anywhere.
// Every value goes through esc. A button carries its message for background.js in data-msg, or a command to copy in
// data-copy. Two things are left to the page: a button with data-act sends its message and then shows ('full') or
// copies ('copy') the `value` of the reply, keeping it nowhere; and "Delete N cookies on this site" is sent with
// kept: true when the box beside it (data-also="kept") is ticked; that button then gets the label in its data-all
// (the number of everything), and the one in data-some again when the box is cleared. data-act="refresh" reads again.
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
  // The Tor row, from background.js's { wanted, running, routed } (as TOR_SAYS in popup-view.js)
  const torSays = (t) => t.routed ? (t.running === false ? 'Routed over Tor: yes, but Tor has stopped answering. Pages will not load until Tor runs again or you switch this off'
      : 'Routed over Tor: yes, websites see an address of the Tor network, not yours')
    : t.wanted && t.running === false ? 'Tor is not running on this computer; nothing is routed' : 'Routed over Tor: no';
  // what a group's removal is called: "4 deleted today"
  const DID = { unknown: 'stopped', bounce: 'cleaned', own: 'emptied', cookies: 'deleted', google: 'deleted', allowlist: 'deleted', storage: 'emptied', wifi: 'forgotten', permissions: 'blocked', cache: 'cleared', tabs: 'closed' };
  // Blocked and cleaned links are those of this tab (Chrome counts them per tab). Deleted today and waiting are those
  // of the whole group, on all sites. For the groups that delete cookies and nothing else, the history's per-cookie
  // counters also give this site's share of today (history.js: d and g), for the site and the sites above and below it.
  const COOKIES_ONLY = ['cookies', 'google', 'allowlist'];
  const counted = (g, s, tab) => {
    const hits = (ids) => tab && Array.isArray(tab.matched) ? tab.matched.filter((id) => ids.includes(id)).length : null, again = '; press "Read again" to ask it';
    if ((g.id === 'blocking' || g.id === 'params') && !(tab && tab.host)) return 'this tab is not a web page';
    if (g.id === 'blocking') { const n = hits(['trackers', 'google-paths']); return n === null ? 'Chrome did not say how many it blocked' + again : `${n} blocked on this page`; }
    if (g.id === 'params') { const n = hits(['url-params']); return n === null ? 'Chrome did not say how many links it cleaned' + again : `${n} link${n === 1 ? '' : 's'} cleaned on this page`; }
    if (g.id === 'tor' && s.tor) return torSays(s.tor);
    if (!DID[g.id]) return '';   // nothing to count: the sign-in pause, the reports
    const h = s.history || {}, day = dep.day(s.now || 0), today = Number(((h.days || {})[day] || {})[g.id]) || 0, waiting = `${Number(g.pending) || 0} waiting`;
    if (!tab || !tab.host || !COOKIES_ONLY.includes(g.id)) return `${today} ${DID[g.id]} today${COOKIES_ONLY.includes(g.id) ? ' on all sites' : ''}, ${waiting}`;
    const here = Object.entries(h.cookies || {}).filter(([k, c]) => { const site = k.split(' ')[0];
      return c && c.g === g.id && dep.day(c.last) === day && (under(tab.host, site) || under(site, tab.host)); }).reduce((n, [, c]) => n + (Number(c.d) || 0), 0);
    return `${here} ${DID[g.id]} on this site today, ${today} ${DID[g.id]} today on all sites, ${waiting}`;
  };

  // ---- This site's cookies, judged as background.js would: by the built-in lists and the user's own exceptions
  const WHY = { name: "has a tracker's name", host: "comes from a tracker's site", google: 'Google uses it to recognise you' };
  const FATE = { on: 'deleted automatically', 'asks first': 'deleted only after you say so', off: 'kept because this cleaning is switched off',
    paused: 'kept while cleaning is paused', 'held while you sign in': 'kept while you sign in' };
  const cookieRow = (c, s, host) => {
    const domain = String(c.domain), site = domain.replace(/^\./, ''), real = core.realHost(domain), r = core.reason({ domain, name: c.name });
    const signin = dep.lists.KEEP_RE.test(c.name), value = String(c.value ?? ''), d = new Date(c.expirationDate * 1000);
    // mine: the user's own word on this cookie, 'always' (delete) or 'keep'. The always-delete list beats everything
    // but a site that is not cleaned at all. It does not wait for an approval, whatever mode its group (storage, C07)
    // is in: only that group set to off, the main switch, a pause or a sign-in keeps the cookie (background.js: mine).
    const on = (list) => (list || []).some((a) => a.site === site && a.name === c.name), mine = on(s.always) ? 'always' : on(s.allow) ? 'keep' : '';
    const found = (s.groups || []).find((x) => x.id === (mine === 'always' ? 'storage' : r === 'google' ? 'google' : 'cookies')) || {};
    const g = mine === 'always' && found.mode !== 'off' ? { ...found, mode: 'auto' } : found;
    const what = c.used === true && mine !== 'always' ? 'comes from a company that was stopped, kept because you may be signed in there'
      : mine !== 'always' && signin ? 'keeps you signed in, kept' + (core.isTrackerHost(real) ? " even though it comes from a tracker's site" : '')
      : mine !== 'always' && !r ? 'on no tracker list, kept'
      : `${mine === 'always' ? 'on your always-delete list' : WHY[r]}, ` + ((s.sitesOff || []).some((x) => under(real, x)) ? 'kept because you told it not to clean this site'
        : mine === 'keep' ? 'kept because you chose Keep'
        : !mine && r === 'host' && core.firstParty({ domain }, [host]) ? 'kept while you are on that site' : FATE[word(g, s)]);
    return { site, name: String(c.name), value: value.slice(0, CUT), long: c.long === true || value.length > CUT,
      expires: c.session || !(c.expirationDate > 0) ? 'until you close Chrome' : `until ${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`, what, signin, tracker: !!r, mine };
  };

  // ---- What the page has saved besides cookies: [id, what it is called, what it is, where it lives]
  const FOLDER = "In Chrome's own folder on this computer, in the part called ";
  const KINDS = [
    ['local', 'Notes a site keeps in your browser (local storage)', 'A site can write things down in your browser and read them again at every visit, such as your settings or a number to recognise you. They stay until someone deletes them.', FOLDER + 'Local Storage.'],
    ['session', 'Notes a site keeps for one tab (session storage)', 'The same kind of notes, but for one tab only. They are gone when you close the tab.', FOLDER + 'Session Storage, until the tab is closed.'],
    ['databases', 'Databases a site keeps in your browser (IndexedDB)', 'A bigger store for a site that wants to keep a lot, such as your mail so that it also works without internet.', FOLDER + 'IndexedDB.'],
    ['caches', 'Copies of its own pages a site put aside (cache storage)', 'A site can put its pages and pictures aside so that it opens faster, or without internet. These are separate from the copies Chrome saves by itself.', FOLDER + 'Service Worker, CacheStorage.'],
    ['workers', 'Programs a site leaves in Chrome (service workers)', 'A small program a site puts into Chrome that can run when the site is not open, for example to show you notifications.', FOLDER + 'Service Worker.']];
  const storedOf = (st) => !st ? { asked: false } : !st.ok || !st.counts ? { refused: true }
    : { kinds: KINDS.map(([id, title, what, where]) => { const n = st.counts[id];
      return { id, title, what, where, n: Number.isInteger(n) ? n : null, count: Number.isInteger(n) ? `${n} on this page` : 'this page is not allowed to use it',
        ...(st.shown === id && Array.isArray(st.items) ? { items: st.items.map((it) => typeof it.value !== 'string' ? { name: String(it.name) }
          : { name: String(it.name), value: it.value.slice(0, CUT), long: it.long === true || it.value.length > CUT }) } : {}) }; }) };

  // ---- The top line and what waits for an answer, as the popup has them
  const hms = (t) => new Date(t).toTimeString().slice(0, 8), hhmm = (t) => hms(t).slice(0, 5);
  const UNDO_MS = 10 * 60e3, UNDO_FULL = 300, LOOPING = 'this site keeps putting it back';   // as in undo.js and loop.js
  const top = (s) => { const hold = s.hold || {};
    return { master: s.master, paused: !!hold.paused, undo: (s.undo || []).filter((u) => u.t > (s.now || 0) - UNDO_MS).length,
      says: typeof s.master !== 'boolean' ? 'Cleaning is off until you turn it on.' : !s.master ? 'Cleaning is off'
        : hold.paused ? 'Cleaning is paused' + (hold.pauseUntil ? ` until ${hhmm(hold.pauseUntil)}` : '') : hold.guard ? 'Cleaning is on, but held while you sign in' : 'Cleaning is on' }; };
  // what the button of a group does, and to what: "Remove 12 cookies"
  const DOES = { cookies: ['Remove', 'cookie'], google: ['Remove', 'cookie'], allowlist: ['Remove', 'cookie'], permissions: ['Block', 'permission'], tabs: ['Close', 'tab'], wifi: ['Remove', 'saved network'], unknown: ['Stop', 'tracker'] };
  // things asked one by one, in one sentence each, with Approve and Not now
  const ASKS = { tracker: (it) => `${it.site} ${it.name}. Stop it?`,
    used: (it) => `You use ${it.site}, and it follows you on other sites. Remove what it keeps to do that?`,
    bounce: (it) => `${it.site} passed you on to another site without showing you a page. Delete what it saved in your browser?`,
    own: (it) => it.site === 'the listed trackers' ? 'Trackers on the built-in list may have saved things on their own sites. Empty that and block their notifications, now and once a day?'
      : `${it.site} is stopped. Also empty what it saved on its own site and block its notifications, now and once a day?`,
    param: (it) => `${it.site} added "${it.name}" to the address of the page it sent you to, so that page can recognise you. Cut it off from now on?` };
  const waitItem = (it) => (it.kind === 'cookie' || it.kind === 'permission' ? `${it.name} on ${it.site}` : it.kind === 'storage' ? `what ${it.site} has saved` : it.kind === 'cache' ? 'the saved copies of pages'
    : it.kind === 'wifi' ? `${it.site} (${it.why})` : String(it.site)) + (it.why === LOOPING ? ' (its site keeps putting it back)' : '');
  const waiting = (s) => (s.groups || []).filter((g) => Number(g.pending) > 0).map((g) => { const n = Number(g.pending), [verb, thing] = DOES[g.id] || ['Remove', 'item'], until = g.postponedUntil;
    const barred = g.id === 'wifi' && g.canDelete !== 'yes';   // the Wi-Fi helper says this user may not remove networks
    return { id: g.id, n, line: `${g.title}: ${n} waiting` + (until === 'restart' ? ', put off until Chrome starts again' : until > s.now ? `, put off until ${hhmm(until)}` : ''),
      button: barred ? '' : g.id === 'cache' ? 'Clear the saved copies of pages' : g.id === 'storage' ? `Empty what ${n} site${n === 1 ? ' has' : 's have'} saved` : `${verb} ${n} ${thing}${n === 1 ? '' : 's'}`,
      note: barred ? 'This user is not allowed to remove saved networks without a password, so nothing can be removed from here.' : g.id === 'wifi' ? 'Removing a saved network cannot be undone here.' : '',
      asks: (g.items || []).filter((it) => ASKS[it.kind]).map((it) => ({ site: String(it.site), name: String(it.name), line: ASKS[it.kind](it), ...(it.kind === 'used' ? { yes: 'Remove', no: 'Keep' } : {}) })),
      items: (g.items || []).filter((it) => !ASKS[it.kind]).map(waitItem) }; });

  // ---- What no cleaning reaches: said plainly, one line each, instead of a button that would do nothing
  const CANNOT = [
    ['An e-mail address you send to a site', 'Tracker Cleaner cannot stop this: once you send it, the site has your address and can hand it to anyone from its own computers.'],
    ['A shop telling a tracker what you bought', "Tracker Cleaner cannot stop this: the shop's computer tells the tracker directly, and your browser is never asked."],
    ['"Sign in with" another company', 'Tracker Cleaner cannot stop this: signing in that way tells that company which site you use, and both keep a record of it.'],
    ["Like, share or comment on a tracker's own page", 'Tracker Cleaner cannot stop this: you are on its own site, and it sees what you press there.'],
    ['The list of pages you visited (history)', "Tracker Cleaner cannot clean this: to take single sites out of the history, Chrome demands the right to read your whole history, and Tracker Cleaner does not ask you for that unless you press \"Also remove trackers' pages from my history\" in its window; even then only trackers' own pages go. Chrome's own \"Delete browsing data\" does the rest."],
    ['The small pictures of sites that Chrome saved (site icons)', "Tracker Cleaner cannot clean this: Chrome gives extensions no way to delete them. They go when Chrome's own \"Delete browsing data\" deletes the history."]];
  const buildReport = (state, tab) => {
    const s = state || {}, host = tab && tab.host ? String(tab.host) : null;
    core.S.EXTRA = (s.hard || []).map(String);   // companies that were cleaned out count as trackers; one that is only blocked keeps its cookies
    return { top: top(s), waiting: waiting(s), readAt: hms(s.now || 0), full: UNDO_FULL, site: host, tabId: tab && Number.isInteger(tab.id) ? tab.id : null, stored: host ? storedOf(tab.stored) : null,
      features: (s.groups || []).map((g) => ({ id: g.id, title: g.title, says: g.says, state: word(g, s), count: counted(g, s, tab) })),
      cookies: host && Array.isArray(tab.cookies) ? { n: tab.cookies.length, rows: tab.cookies.map((c) => cookieRow(c, s, host)) } : null,
      // what the user chose to always delete on this site, also when the cookie is not there right now
      stoppedTrackers: (s.stopped || []).map(String), cut: (s.params || []).map(String), skipped: (s.skipped || []).map(String),
      always: host ? (s.always || []).filter((a) => under(host, String(a.site)) || under(String(a.site), host)) : [],
      cannot: CANNOT.map(([what, why]) => ({ what, why })),
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
    // what "Delete all" leaves alone: the cookies that keep the user signed in (a) and those the user pressed Keep on (b),
    // but not one the user put on the always-delete list
    const all = (c) => { const stay = c.rows.filter((x) => x.mine !== 'always'), a = stay.filter((x) => x.signin).length, b = stay.filter((x) => !x.signin && x.mine === 'keep').length, n = a + b;
      const some = `Delete ${count(c.n - n, 'cookie')} on this site`, both = n ? ` data-some="${some}" data-all="Delete ${count(c.n, 'cookie')} on this site"` : '';
      return `<p>${btn(some, { type: 'dropSite', host: r.site }, ' class="go"' + both + off)}`
        + (!n ? '' : ` <span class="m">${n} stay${n === 1 ? 's' : ''}: ${[a ? `${a} keep${a === 1 ? 's' : ''} you signed in` : '', b ? `${b} you chose to keep` : ''].filter(Boolean).join(', ')}</span>`
          + ` <label><input type="checkbox" data-also="kept"> also the ${a && b ? 'ones that keep me signed in and the ones I chose to keep' : a ? `${a} that keep${a === 1 ? 's' : ''} me signed in` : `${b} I chose to keep`}</label>`) + '</p>'
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
    const look = (label, show) => r.tabId === null ? '' : btn(label, { type: 'stored', tabId: r.tabId, ...(show ? { show } : {}) });
    const item = (it) => `<div class="c">${esc(it.name)}${it.value === undefined ? '' : it.value ? ` <code>${esc(it.value)}${it.long ? '…' : ''}</code>` : ' <span class="m">holds nothing</span>'}</div>`;
    const kind = (k) => `<div class="c" data-kind="${k.id}"><div class="h"><b>${esc(k.title)}</b><span class="m">${esc(k.count)}</span></div><div class="m">${esc(k.what)}</div><div class="m">${esc(k.where)}</div>`
      + `<div class="b">${k.n ? look(`Show the ${k.n}`, k.id) : ''}${safe ? `<button class="small" data-copy="${INSPECT}storage --site ${r.site}">Copy command</button>` : ''}</div>`
      + (k.items || []).map(item).join('') + '</div>';
    const stored = () => { const st = r.stored;
      return '<h2>Other things this page has saved in your browser</h2>'
        + (!st ? '<p class="m">This tab is not a web page, so there is nothing saved by it to show.</p>' : st.refused ? '<p>Chrome does not let extensions look at this page.</p>'
          : !st.kinds ? `<p>${look('Count what this page has saved')} <span class="m">Nothing on the page is looked at until you press this.</span></p>`
          : '<p class="m">Read from the page just now. Only names and the start of what is saved are shown here, and none of it is saved anywhere else.</p>' + st.kinds.map(kind).join('')); };
    const topLine = () => { const t = r.top || {};
      if (typeof t.master !== 'boolean') return `<div class="top"><b>${esc(t.says)}</b> ${btn('Turn on', { type: 'setMaster', on: true })}</div>`;
      return `<div class="top"><label><input type="checkbox" data-msg="${esc(JSON.stringify({ type: 'setMaster' }))}"${t.master ? ' checked' : ''}> ${t.master ? 'On' : 'Off'}</label> <b>${esc(t.says)}</b><div class="b">`
        + (!t.master ? '' : t.paused ? btn('Resume', { type: 'resume' }) : btn('Pause 10 min', { type: 'pause', minutes: 10 }))
        + (t.undo ? btn(`Put back ${t.undo >= r.full ? r.full + '+' : t.undo} deleted cookie${t.undo === 1 ? '' : 's'}`, { type: 'restoreAll' }) : '')
        + btn('Clear the saved copies of pages', { type: 'drop', kind: 'servers' }, off) + '</div>'
        + (t.undo ? '' : '<div class="m">0 cookies deleted in the last 10 minutes, so there is nothing to put back.</div>') + '</div>'; };
    const page = () => `<p class="m">${r.site ? `This page: ${esc(r.site)}` : 'This tab is not a web page'} · Read at ${esc(r.readAt)} <button class="small" data-act="refresh">Read again</button></p>`;
    const ask = (w, a) => `<div class="c" data-ask="${esc(a.site)}"><div>${esc(a.line)}</div><div class="b">${btn(a.yes === 'Remove' ? 'Remove' : 'Approve', { type: 'approve', group: w.id, site: a.site, name: a.name }, ' class="go"' + off)}`
      + `${btn(a.no === 'Keep' ? 'Keep' : 'Not now', { type: 'notNow', group: w.id, site: a.site, name: a.name })}</div></div>`;
    const stoppedList = () => (!(r.stoppedTrackers || []).length ? '' : `<details id="stopped"><summary>Trackers you stopped (${r.stoppedTrackers.length})</summary>`
      + r.stoppedTrackers.map((x) => `<div class="c h"><span>${esc(x)}</span>${btn('Let it through again', { type: 'unstop', site: x })}</div>`).join('') + '</details>')
      + (!(r.cut || []).length ? '' : `<details id="cut"><summary>Tags you chose to cut off addresses (${r.cut.length})</summary>`
      + r.cut.map((x) => `<div class="c h"><span>${esc(x)}</span>${btn('Stop cutting it off', { type: 'unparam', name: x })}</div>`).join('') + '</details>')
      + (!(r.skipped || []).length ? '' : `<details id="skipped"><summary>Sites that are skipped (${r.skipped.length})</summary><div class="m">These sites only passed you along, so their links now take you straight to the page they name.</div>`
      + r.skipped.map((x) => `<div class="c h"><span>${esc(x)}</span>${btn('Let it through again', { type: 'unskip', site: x })}</div>`).join('') + '</details>');
    const waits = () => '<h2>Waiting for your answer</h2>' + (!(r.waiting || []).length ? '<p class="m">Nothing is waiting for your answer.</p>' : r.waiting.map((w) => (w.asks || []).map((a) => ask(w, a)).join('') + (!w.items.length && (w.asks || []).length ? '' :
      `<div class="c" data-wait="${esc(w.id)}"><div>${esc(w.line)}</div><div class="b">${w.button ? btn(esc(w.button), { type: 'approve', group: w.id }, ' class="go"' + off) : ''}`
      + `${btn('Postpone 1 hour', { type: 'postpone', group: w.id, minutes: 60 })}</div>` + (w.note ? `<div class="m">${w.note}</div>` : '')
      + `<details id="wait-${esc(w.id)}"><summary>Show what is waiting${w.items.length < w.n ? ` (the newest ${w.items.length} of ${w.n})` : ''}</summary>${w.items.map((x) => `<div class="c">${esc(x)}</div>`).join('')}</details></div>`)).join('')) + stoppedList();
    const cannot = () => !(r.cannot || []).length ? '' : `<h2>What Tracker Cleaner cannot do</h2><details id="cannot"><summary>Show the ${r.cannot.length} things</summary>`
      + r.cannot.map((x) => `<div class="c"><b>${esc(x.what)}</b><div class="m">${esc(x.why)}</div></div>`).join('') + '</details>';
    return topLine() + page() + waits() + '<h2>What Tracker Cleaner does for you</h2>' + (r.features || []).map(feature).join('') + cookies() + stored() + cannot();
  };
  return { buildReport, renderReport };
})();
if (typeof module !== 'undefined') module.exports = { buildReport, renderReport };
