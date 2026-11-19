'use strict';
// The hidden collector's own "What I know about you" (lab-only): its parallel trace list and knows page. The frozen test-network
// page (know.js) is keyed to traces.json; this is a separate list for the ff2 kinds, so nothing frozen is touched.
const TRACES2 = [
  { id: 'F1', type: 'First-party reverse-proxy ID', how: 'A first-party cookie set under each site’s own name through its /f/ proxy; the structural rules (thirdParty) never match.' },
  { id: 'F2', type: 'Cookie-less first-party ID', how: 'The master id kept only in the site’s own localStorage/IndexedDB/cacheStorage and the address; never a cookie, so the cleaner never even asks.' },
  { id: 'F3', type: 'URL-ID chain across sites', how: 'The id carried between sites in a rotating ordinary-looking parameter, rebuilt server-side; the shipped strip list never matches a novel name.' },
  { id: 'F4', type: 'Scripted / meta hand-off', how: 'The browser passed on by location.assign or a <meta refresh>, never an HTTP 302, so onBeforeRedirect never fires and skip/bounce never engage.' },
  { id: 'F5', type: 'First-party click record', how: 'The outgoing click recorded by a first-party fetch before the scripted jump; no ping attribute for no-ping.js to strip.' },
  { id: 'F6', type: 'Unshielded fingerprint join key', how: 'A stable id from installed fonts, matchMedia and screen — surfaces shield.js never blurs — so one browser is joined across sites even with the shield on.' },
  { id: 'F7', type: 'Sign-in-window cookie', how: 'An ID cookie set under a KEEP_RE name on a client_id+redirect_uri page; the guard arms its hold on any site’s URL shape and spares the cookie.' },
  { id: 'F8', type: 'First-party address and referrer', how: 'The page’s own URL and referrer posted first-party; C30 removes the referrer only for another company.' },
  { id: 'F9', type: 'First-party loopback probe', how: 'The page asks its own site, which probes loopback server-side; C31 blocks only the browser’s own third-party calls.' },
  { id: 'F10', type: 'First-party cache tag (ETag)', how: 'The id carried as an ETag on the site’s own image; C30 strips ETags only for another company.' },
];
const iso = (t) => new Date(t).toISOString().replace('T', ' ').slice(0, 19);

function know2(store, g) {
  const recs = g === null ? [] : store.of(g);
  const rows = TRACES2.map((row) => { const seen = new Map();
    for (const r of recs.filter((x) => x.trace === row.id)) { const k = r.value + '|' + r.site;
      if (seen.has(k)) seen.get(k).times++; else seen.set(k, { value: r.value, site: r.site, via: r.via, when: iso(r.t), times: 1 }); }
    const captures = [...seen.values()];
    return { id: row.id, type: row.type, how: row.how, mark: captures.length ? 'tracked' : 'not seen',
      value: captures.length ? captures[0].value : '', sites: [...new Set(captures.map((x) => x.site).filter(Boolean))], captures }; });
  // the browser this all ties to: the cookie-less master id if seen, else the first-party cookie id
  const f2 = (recs.find((r) => r.trace === 'F2') || {}).value || '', f1 = (recs.find((r) => r.trace === 'F1') || {}).value || '';
  const browser = (f2.match(/ff2m-[0-9a-z]+/) || [])[0] || f1.replace(/^fp_id=/, '').replace(/ .*/, '') || '';
  return { browser, tracked: rows.filter((r) => r.mark === 'tracked').length, of: rows.length, rows,
    sites: [...new Set(recs.map((r) => r.site).filter(Boolean))] };
}
function page2(k, esc) {
  return `<p id="who">${k.browser ? `This browser is known to the hidden collector as <b>${esc(k.browser)}</b>, the same across every site it visits.` : 'No id for this browser yet.'}</p>
<p id="count">${k.tracked} of ${k.of} ff2 kinds tracked. The same as data: <a href="/what-i-know.json">/what-i-know.json</a></p>
<table id="marks"><tr><th>Row</th><th>Type</th><th>Mark</th><th>Id / value captured</th><th>Seen on</th></tr>
${k.rows.map((r) => `<tr data-row="${r.id}" data-mark="${r.mark}"><td>${r.id}</td><td>${esc(r.type)}<br><small>${esc(r.how)}</small></td>
<td>${r.mark === 'tracked' ? '&#10003; tracked' : '&#9744; not seen'}</td>
<td>${r.captures.length ? r.captures.slice(0, 6).map((x) => `<code>${esc(x.value)}</code> <small>(${esc(x.via)})</small>`).join('<br>') : 'none yet'}</td>
<td>${r.sites.map(esc).join('<br>')}</td></tr>`).join('\n')}</table>`;
}
module.exports = { TRACES2, know2, page2 };
