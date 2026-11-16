'use strict';
// "What I know about you": the checklist of marks, one row per kind of trace, and the visit history, for one group of the log.
const TRACES = require('./traces.json');
const iso = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);

function know(store, g) {
  const recs = g === null ? [] : store.of(g), account = g === null ? null : store.account(g), joined = g === null ? undefined : store.joinedAt(g);
  const rows = TRACES.map((row) => { const seen = new Map();
    for (const r of recs.filter((x) => x.trace === row.id)) { const k = r.value + '|' + r.site + '|' + r.via;
      if (seen.has(k)) seen.get(k).times++; else seen.set(k, { value: r.value, site: r.site, when: iso(r.t), via: r.via, times: 1 }); }
    const captures = [...seen.values()];
    return { id: row.id, type: row.type, class: row.class, technique: row.technique, status: row.status, reason: row.reason || '',
      mark: row.status !== 'built' ? row.status : captures.length ? 'tracked' : 'not yet seen',
      value: captures.length ? captures[0].value : '', sites: [...new Set(captures.map((x) => x.site).filter(Boolean))], captures }; });
  const history = recs.filter((r) => r.trace === 'visit').map((r) => ({ when: iso(r.t), site: r.site, url: r.value, from: r.extra.ref || '', via: r.via,
    beforeSignIn: joined === undefined || r.n < joined }));
  return { who: account ? { name: account.name, email: account.email, sure: 'signed in from this browser' } : null,
    tracked: rows.filter((r) => r.mark === 'tracked').length, buildable: rows.filter((r) => r.status === 'built').length, of: rows.length,
    canary: store.canary, rows, history };
}
const MARK = { tracked: '&#10003; tracked', 'not yet seen': '&#9744; not yet seen' };
function page(k, esc) {
  return `<p id="who">${k.who ? `This browser is <b>${esc(k.who.name)}</b> (${esc(k.who.email)}), ${esc(k.who.sure)}.` : 'A browser with no name yet: not signed in.'}</p>
<p id="count">${k.tracked} of ${k.of} kinds tracked (${k.buildable} can be created here). The same as data: <a href="/what-i-know.json">/what-i-know.json</a></p>
<table id="marks"><tr><th>Row</th><th>Type</th><th>Mark</th><th>Identifier and value captured</th><th>When</th><th>Seen on</th></tr>
${k.rows.map((r) => `<tr data-row="${r.id}" data-mark="${esc(r.mark)}"><td>${r.id}</td><td>${esc(r.type)}<br><small>${esc(r.class)}: ${esc(r.technique)}</small></td><td>${MARK[r.mark] || '&#8211; ' + esc(r.mark)}</td>
<td>${r.captures.length ? r.captures.slice(0, 6).map((x) => `<code>${esc(x.value)}</code>${x.via ? ` <small>(${esc(x.via)})</small>` : ''}`).join('<br>') : esc(r.reason || 'none yet')}</td>
<td>${esc((r.captures[0] || {}).when || '')}</td><td>${r.sites.map(esc).join('<br>')}</td></tr>`).join('\n')}</table>
<h2>Where you have been</h2>
<table id="history"><tr><th>When</th><th>Site</th><th>Page</th><th>Came from</th><th></th></tr>
${k.history.map((h) => `<tr><td>${h.when}</td><td>${esc(h.site)}</td><td>${esc(h.url)}</td><td>${esc(h.from)}</td><td>${k.who && h.beforeSignIn ? 'seen before sign-in' : ''}</td></tr>`).join('\n')}</table>`;
}
module.exports = { know, page, TRACES };
