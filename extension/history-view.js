// The "now and history" page (history.html) as HTML, free of Chrome calls so the Node tests can render it.
// renderHistoryPage(state): state = background.js's reply to { type: 'state' }, plus what history-page.js adds:
//   history  the reply to { type: 'history' }: { days, cookies } (history.js), numbers and names only
//   cookies  [{ domain, name }] of every cookie Chrome has now, never a value; null when Chrome did not say
//   proxy    'tor' | 'other' | 'none': what Chrome's proxy setting says; anything else = it could not be read
//   blocked  [{ site, n }]: requests Chrome says it stopped, per open tab's site ('' = a tab closed since); absent
//            when Chrome did not say
//   tor      the answer to "Check how websites see me": { checking } | { ip, isTor } | { failed }; absent until asked
// One section per block, each answering in the words of tools/inspect.js (test/history-view.test.js holds the two
// together): what is there now, what is kept and why, what was removed and when, what cleaning costs. Lists are
// collapsed. Every value goes through esc. A button carries a message for background.js in data-msg, a command to copy
// in data-copy, or an action of the page itself in data-act.
const renderHistoryPage = (() => {
  const dep = typeof module !== 'undefined' ? { lists: require('./lists.js'), makeCore: require('./core.js'), day: require('./history.js').historyDay }
    : { lists: { DOMAINS, COOKIE_RE, GOOGLE_RE, KEEP_RE }, makeCore, day: historyDay };
  const core = dep.makeCore(dep.lists), MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const num = (n) => Number(n).toLocaleString('en-US'), count = (n, one, many) => `${num(n)} ${n === 1 ? one : many || one + 's'}`;
  // "3 (1 with a tracker's name, 2 from trackers' sites)", as the command writes it
  const sum = (parts) => { const n = parts.reduce((a, p) => a + p[0], 0);
    return n ? `${num(n)} (${parts.filter((p) => p[0]).map(([k, one, many]) => `${num(k)} ${k === 1 ? one : many}`).join(', ')})` : 'none'; };
  const date = (key) => { const m = /^(\d{4})-(\d\d)-(\d\d)$/.exec(key); return m ? `${+m[3]} ${MONTHS[m[2] - 1]} ${m[1]}` : esc(key); };   // a key of history.days
  const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);
  const dayAt = (t, now) => `${new Date(t).toDateString() === new Date(now).toDateString() ? 'today' : 'tomorrow'} at ${hhmm(t)}`;
  const under = (h, site) => h === site || h.endsWith('.' + site);
  const INSPECT = 'node tools/inspect.js ';

  return (state) => {
    const s = state || {}, h = s.history || {}, days = h.days || {}, groups = s.groups || [], today = dep.day(s.now || 0);
    const group = (id) => groups.find((g) => g.id === id) || {};
    // removals of these groups: how many today, how many in all, and [day, n] newest first
    const removed = (ids) => { const per = Object.entries(days).map(([d, by]) => [d, ids.reduce((n, id) => n + (Number((by || {})[id]) || 0), 0)]).filter(([, n]) => n).sort().reverse();
      return { per, today: (per.find(([d]) => d === today) || [0, 0])[1], all: per.reduce((n, [, k]) => n + k, 0) }; };
    const when = (r) => r.all ? `${r.today ? num(r.today) : 'none'} today, ${num(r.all)} in the last 30 days` : 'none in the last 30 days';
    const waits = (id) => { const n = Number(group(id).pending) || 0; return n ? `, ${num(n)} waiting in the popup` : ''; };

    const block = (id, title, b) => `<section id="${id}"><h2>${title}</h2><p><b>There now:</b> ${b.now}</p>`
      + (b.kept ? `<p><b>Kept:</b> ${b.kept}</p><p><b>Removed:</b> ${b.removed}</p>` : '') + (b.more || '')
      + `<p><b>What happens if you clean this:</b> ${b.after}</p>`
      + (b.lists || []).filter(([, rows]) => rows.length).map(([heading, rows]) => `<details><summary>${heading} (${num(rows.length)})</summary>${rows.map((r) => `<div class="c">${r}</div>`).join('')}</details>`).join('')
      + (b.command ? `<p><button data-copy="${INSPECT + b.command}">Copy command</button> <code>${INSPECT + b.command}</code></p>` : '') + '</section>';

    // ---- cookies, sorted as background.js would judge them by the built-in lists and the user's own exceptions
    const cookies = () => {
      const by = { name: [], host: [], google: [], keep: [], other: [], allowed: [], off: [] }, sites = new Set(), list = Array.isArray(s.cookies) ? s.cookies : [];
      for (const c of list) { const domain = String(c.domain), site = core.realHost(domain), r = core.reason({ domain, name: c.name }); sites.add(site);
        by[!r ? (dep.lists.KEEP_RE.test(c.name) ? 'keep' : 'other') : (s.sitesOff || []).some((x) => under(site, x)) ? 'off'
          : (s.allow || []).some((a) => a.site === domain.replace(/^\./, '') && a.name === c.name) ? 'allowed' : r].push(`${esc(site)} · ${esc(c.name)}`); }
      const n = (k) => by[k].length, r = removed(['cookies', 'google', 'allowlist']), loops = ['cookies', 'google', 'allowlist'].reduce((k, id) => k + (Number(group(id).looping) || 0), 0);
      const go = sum([[n('name'), "with a tracker's name", "with a tracker's name"], [n('host'), "from a tracker's site", "from trackers' sites"], [n('google'), 'that Google uses to recognise you', 'that Google uses to recognise you']]);
      const often = Object.entries(h.cookies || {}).sort((a, b) => b[1].n - a[1].n).slice(0, 50).map(([k, c]) => { const i = k.indexOf(' ');
        return `${esc(k.slice(0, i))} · ${esc(k.slice(i + 1))}: ${count(c.n, 'time')}, first on ${date(dep.day(c.first))}, last on ${date(dep.day(c.last))}`; });
      return block('cookies', 'Small files sites leave to recognise you (cookies)', {
        now: !Array.isArray(s.cookies) ? 'Chrome did not say which cookies it has.' : list.length ? `${count(list.length, 'cookie')} from ${count(sites.size, 'site')}` : 'no cookies',
        kept: esc(sum([[n('keep'), 'that keeps you signed in', 'that keep you signed in'], [n('other'), 'that is on no tracker list', 'that are on no tracker list'],
          [n('allowed'), 'that you allowed', 'that you allowed'], [n('off'), 'on a site you told it not to clean', 'on sites you told it not to clean']])),
        removed: `${when(r)}. Would be removed now: ${esc(go)}`,
        more: !loops ? '' : `<p>${loops === 1 ? '1 cookie keeps coming back, so it waits an hour.'
          : `${num(loops)} cookies keep coming back, so they wait an hour.`}</p>`,
        after: 'Trackers recognise you less from one site to the next, and you stay signed in. Without Google&#39;s cookies you may be asked to prove you are human more often.',
        lists: [['Removed, day by day', r.per.map(([d, k]) => `${date(d)}: ${num(k)}`)], ['Removed most often', often],
          ['Still there: has a tracker&#39;s name', by.name], ['Still there: comes from a tracker&#39;s site', by.host], ['Still there: Google uses it to recognise you', by.google],
          ['Kept: keeps you signed in', by.keep], ['Kept: on no tracker list', by.other], ['Kept: you allowed it', by.allowed], ['Kept: on a site you told it not to clean', by.off]],
        command: 'cookies' });
    };

    // ---- the saved copies of pages; the code cache and the remembered servers go with them (seen in a real Chrome:
    // test/browser/run.js V6), so all three say the same about when
    const cleared = () => { const g = group('cache'), r = removed(['cache']);
      return (r.all ? `cleared on ${count(r.per.length, 'day')} in the last 30 days, last on ${date(r.per[0][0])}` : 'not cleared in the last 30 days')
        + (g.mode === 'off' ? '. Clearing is off' : g.pending ? '. Waiting in the popup' : g.nextAt > s.now ? `. ${g.mode === 'auto' ? 'Cleared' : 'Offered'} again ${dayAt(g.nextAt, s.now)}` : ''); };
    const cache = () => block('cache', 'Saved copies of pages (HTTP cache)', {
      now: 'Chrome does not tell extensions its size. The command below shows it.',
      kept: 'none (the copies are cleared all together, not site by site)', removed: cleared(),
      after: 'Pages load a little slower until Chrome has saved them again. You stay signed in.', command: 'cache' });
    const codeCache = () => block('code-cache', 'Ready-made copies of page scripts (code cache)', {
      now: 'Chrome does not tell extensions its size. The command below shows it.',
      kept: 'none (it is emptied together with the saved copies of pages)', removed: cleared(),
      after: 'Pages start a little slower the first time. Websites cannot read these files, so little is gained.', command: 'code-cache' });
    const servers = () => block('servers', 'Servers Chrome remembers how to reach (remembered servers)', {
      now: 'Chrome does not tell extensions which servers it remembers. The command below counts them.',
      kept: 'none (both lists are emptied together with the saved copies of pages)', removed: cleared(),
      after: 'The first visit to each site connects a little slower. A site that asked Chrome to always connect securely is remembered again at its next visit.', command: 'servers' });

    const storage = () => block('storage', 'Data that sites keep in your browser (site storage)', {
      now: 'Chrome does not tell extensions which sites keep data. The command below lists them.',
      kept: 'everything except sites you drop or put on your always-drop list', removed: when(removed(['storage'])) + waits('storage'),
      after: 'Those sites forget what they stored about you. Without the data of a &quot;prove you are human&quot; check you will be asked to prove you are human more often.', command: 'storage' });
    const permissions = () => block('permissions', 'What sites may do, such as send notifications or use the camera (site permissions)', {
      now: 'Chrome does not give extensions this list. The command below lists it.',
      kept: 'all of them, unless you put one on your always-block list', removed: when(removed(['permissions'])) + waits('permissions'),
      after: 'The site can no longer do that thing, and cannot ask you for it again.', command: 'permissions' });
    // Chrome keeps a blocked request for as long as its tab is open and a few minutes more (V4): a count, no history
    const blocking = () => { const list = Array.isArray(s.blocked) ? s.blocked : null, n = (list || []).reduce((k, b) => k + (Number(b.n) || 0), 0);
      return block('blocking', 'Blocked tracker requests', {
        now: !list ? 'Chrome did not say how many requests it stopped.'
          : `${n ? count(n, 'request') : 'no requests'} stopped in open and recently closed tabs. Chrome keeps no daily count.`,
        after: 'These requests never leave your computer. If a page breaks, &quot;Don&#39;t clean on this site&quot; in the popup lets them through.',
        lists: [['By site', (list || []).map((b) => `${esc(b.site) || 'a tab closed since'}: ${num(Number(b.n) || 0)}`)]] }); };
    // ---- Tor: asked from inside Chrome, so the answer is about Chrome itself. One request, only at the button.
    const tor = () => { const t = s.tor || {}, set = s.proxy === 'tor';
      const answer = t.checking ? '<p>Asking check.torproject.org…</p>'
        : t.failed ? (set ? '<p class="bad">No answer. Tor is probably not running, so pages will not load.</p>' : '<p>No answer from check.torproject.org.</p>')
        : typeof t.ip !== 'string' ? '' : `<p>Websites see you as ${esc(t.ip)}. ${t.isTor ? 'This is Tor.' : set ? 'That is not Tor, so something is wrong.' : 'That is your own or your VPN&#39;s address, not Tor.'}</p>`;
      return block('tor', 'Hiding your address from websites (Tor)', {
        now: set ? 'Chrome is set to use Tor.' : s.proxy === 'other' ? 'Chrome is set to use another go-between, not Tor.' : s.proxy === 'none' ? 'Chrome is not set to use Tor.' : 'Could not read whether Chrome uses Tor.',
        more: answer + (t.checking ? '' : '<p><button data-act="tor">Check how websites see me</button> <span class="m">It sends one request to check.torproject.org, only when pressed.</span></p>'),
        after: 'Nothing is cleaned here. With Tor switched on, pages load slower and you are asked to prove you are human more often.', command: 'tor' }); };

    const kept = Object.keys(days).length;
    return '<p>Run a command in a terminal in the Tracker Cleaner folder to check this page.</p>'
      + '<p class="m">Removals are counted for 30 days, never what a cookie held. '
      + 'This history stays on this computer, and no website can read it.</p>'
      + (kept ? `<p><button data-msg="${esc(JSON.stringify({ type: 'clearHistory' }))}">Clear ${count(kept, 'day')} of history</button></p>` : '<p class="m">Nothing has been removed yet, so there is no history.</p>')
      + cookies() + cache() + codeCache() + storage() + servers() + permissions() + blocking() + tor();
  };
})();
if (typeof module !== 'undefined') module.exports = { renderHistoryPage };
