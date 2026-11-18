// The 8088 audit view (C10), as in 1.20: everything `chrome-baddies` reports about this browser: suspicious cookies,
// site storage, site permissions, servers Chrome remembers, extensions, policies. Every item can be dropped now; drops
// are logged on the audit server (logs/drops.jsonl) and can be made permanent. Never cookie values.
// Since 1.21 it is one collapsed section of the popup, rendered by popup-view.js only when the server answered.
const AUDIT = 'http://127.0.0.1:8088/audit';
// a count that the settings program sent: shown only if it is a number (it was put into the page as it came, L10)
const num = (x) => { const n = Number(x); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : 0; };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const sec = (title, count, body, warn) => `<details${warn ? ' open' : ''}><summary><b>${title}</b> <span class="${warn ? 'bad' : 'm'}">${count}</span></summary>${body}</details>`;
const attrs = (d) => Object.entries(d).filter(([, v]) => v != null).map(([k, v]) => `data-${k}="${esc(v)}"`).join(' ');
const dropBtn = (d, warn) => `<button class="drop" ${attrs({ drop: d.kind, site: d.site, name: d.name, perm: d.perm })}${warn ? ` data-warn="${esc(warn)}"` : ''}>Drop</button>`;
const item = (head, sub, bad, btn, gone) => `<div class="c${gone ? ' gone' : ''}"><div class="h"><b>${head}</b>${btn || ''}</div>${sub ? `<div class="${bad ? 'bad' : 'm'}">${sub}</div>` : ''}</div>`;
// Dropped in this popup session: shown as done even while Chrome's files on disk (read by chrome-baddies) catch up
const DROPPED = new Map(), key = (d) => [d.kind, d.site || '', d.name || '', d.perm || ''].join('|');
function markDropped(d, r) { DROPPED.set(key(d), r); }
const doneTag = (d) => { const r = DROPPED.get(key(d)); if (!r) return null;
  return r.ok ? `<span class="ok">✓ Dropped${r.verified === false ? ' (Chrome still lists it)' : ''}</span>` : `<span class="bad">✗ ${esc(r.error || 'failed')}</span>`; };
// a Drop button, or "✓ Dropped" once done
const dropOrDone = (d, warn) => doneTag(d) || dropBtn(d, warn);
const isGone = (d) => !!DROPPED.get(key(d))?.ok;

function renderBaddies(j) {
  if (!j || !Array.isArray(j.cookies)) return '<p class="bad">No data: is the audit server (127.0.0.1:8088) running?</p>';
  const out = [], look = [];

  // Cookies: not-allowed first, then allowed sign-ins (dropping one signs you out)
  const bad = j.cookies.filter((c) => !c.allowed), ok = j.cookies.filter((c) => c.allowed), groups = {};
  for (const c of ok) (groups[c.allowed] ||= []).push(c);
  if (bad.length) look.push(`${bad.length} cookie(s)`);
  out.push(sec('Cookies', bad.length ? `${bad.length} NOT on your allow-list` : `✓ all ${ok.length} are allowed sign-ins`,
    `<p class="m">${num(j.suspicious)} of ${num(j.total)} look suspicious by chrome-baddies' strict rules.</p>`
    + bad.map((c) => { const d = { kind: 'cookie', site: c.site, name: c.name }; return item(`${esc(c.site.replace(/^\./, ''))} · ${esc(c.name)}`, esc(c.reasons.join('; ')), !isGone(d), dropOrDone(d), isGone(d)); }).join('')
    + Object.entries(groups).map(([why, cs]) => `<div class="c"><b>✓ ${esc(why)}</b>${cs.map((c) => { const d = { kind: 'cookie', site: c.site, name: c.name }; return `<div class="h sub${isGone(d) ? ' gone' : ''}"><span>${esc(c.name)}</span>${dropOrDone(d, `signs you out (${why})`)}</div>`; }).join('')}</div>`).join(''), bad.length > 0));

  if (j.storage) {   // site storage the cookie cleaner doesn't touch
    const tr = j.storage.filter((x) => x.tracking); if (tr.length) look.push(`${tr.length} tracker storage`);
    out.push(sec('Site storage', `${j.storage.length} sites${tr.length ? `, ${tr.length} tracker` : ''}`,
      '<p class="m">Kept outside cookies; the cleaner only drops these when you say so.</p>'
      + j.storage.map((x) => { const d = { kind: 'storage', site: x.site }, sessionOnly = x.kinds.every((k) => k === 'sessionStorage');
        return item(esc(x.site) + (x.tracking ? ' <span class="bad">· tracker</span>' : ''), esc(x.kinds.join(', ')) + (sessionOnly ? ' · cleared when its tabs close (extensions cannot clear session storage)' : ''),
          x.tracking && !isGone(d), sessionOnly ? '' : dropOrDone(d), isGone(d)); }).join(''), tr.length > 0));
  }
  if (j.permissions) out.push(sec('Site permissions', j.permissions.length ? `${j.permissions.length}` : 'none',
    j.permissions.map((p) => item(esc(p.site.replace(/^https?:\/\/|:443$/g, '')), `${esc(p.perm)}: ${esc(p.value)}`, false, dropOrDone({ kind: 'permission', site: p.site, perm: p.perm }), isGone({ kind: 'permission', site: p.site, perm: p.perm }))).join('')
    || '<p class="m">No site has asked for or been given a permission.</p>'));
  if (j.servers) {
    const t = j.servers.tracking || []; if (t.length) look.push(`${t.length} tracker server(s)`);
    out.push(sec('Servers Chrome remembers', `${num(j.servers.count)} servers${t.length ? `, ${t.length} look like trackers` : ''}`,
      `<div class="h"><span class="m">Chrome's list of servers it talked to; forgotten every 15 min.</span>${dropOrDone({ kind: 'servers' })}</div>`
      + (j.servers.hosts || []).map((h) => `<div class="c ${t.includes(h) ? 'bad' : ''}">${esc(h)}${t.includes(h) ? ' · tracker' : ''}</div>`).join(''), t.length > 0));
  }
  if (j.extensions) out.push(sec('Extensions', `${j.extensions.length}`,
    j.extensions.map((x) => item(`${esc(x.name)} ${esc(x.version)}`, esc(x.status) + (x.broad.length ? ` · broad access: ${esc(x.broad.join(', '))}` : ''))).join('')));
  if (j.policies) out.push(sec('Chrome policies', `${j.policies.length} in force`, j.policies.map((p) => `<div class="c">${esc(p)}</div>`).join('')));

  // Drops: what was dropped (and whether it worked); Make permanent once it turned out painless
  if (j.drops) {
    const perm = j.permanent || {}, isPerm = (d) => (d.kind === 'cookie' && (perm.cookies || []).some((b) => b.h === d.site.replace(/^\./, '') && b.n === d.name))
      || (d.kind === 'storage' && (perm.storage || []).includes(d.site)) || (d.kind === 'permission' && (perm.permissions || []).some((b) => b.site === d.site && b.perm === d.perm));
    out.push(sec('Dropped', `${j.drops.length}`, '<p class="m">If nothing broke after a drop, make it permanent: the cleaner then repeats it every 15 min.</p>'
      + j.drops.map((d) => item(`${d.ok ? '✓' : '✗'} ${esc(d.kind)} · ${esc((d.site || 'all').replace(/^\./, ''))}${d.name || d.perm ? ' · ' + esc(d.name || d.perm) : ''}`,
        `${esc(new Date(d.t).toLocaleString())}${d.error ? ' · ' + esc(d.error) : ''}`, !d.ok,
        d.ok && !d.permanent && d.kind !== 'servers' ? (isPerm(d) ? '<span class="ok">permanent</span>' : `<button class="perm" ${attrs({ permanent: d.kind, site: d.site, name: d.name, perm: d.perm })}>Make permanent</button>`) : '')).join('')
      || '<p class="m">Nothing dropped yet.</p>'));
  }

  // What the cleaner keeps deleting: Allow one if a site breaks without it (e.g. a login)
  if (j.recentlyRemoved) out.push(sec('Recently removed by the cleaner', `${j.recentlyRemoved.length} in the last hour`,
    '<p class="m">If a site breaks (e.g. a login fails), Allow what it needs; you can Revert any time below.</p>'
    + j.recentlyRemoved.map((x) => item(`${esc(x.site)} · ${esc(x.name)}`, `removed ${num(x.count)}×`, false,
      `<button class="allow" ${attrs({ decide: 'allow', kind: 'cookie', site: x.site, name: x.name })}>Allow</button>`)).join('') || '<p class="m">Nothing removed in the last hour.</p>'));
  // Every remembered decision, each revertible
  if (j.decisions || j.permanent) {
    const P = j.permanent || {}, rows = [
      ...(j.decisions || []).map((d) => item(`✓ allowed · ${esc(d.site)} · ${esc(d.name)}`, esc(new Date(d.t).toLocaleString()), false,
        `<button ${attrs({ decide: 'revert', was: 'allow', kind: 'cookie', site: d.site, name: d.name })}>Revert</button>`)),
      ...(P.cookies || []).map((b) => item(`✗ always drop cookie · ${esc(b.h)} · ${esc(b.n)}`, '', false, `<button ${attrs({ decide: 'revert', was: 'permanent', kind: 'cookie', site: b.h, name: b.n })}>Revert</button>`)),
      ...(P.storage || []).map((x) => item(`✗ always drop storage · ${esc(x)}`, '', false, `<button ${attrs({ decide: 'revert', was: 'permanent', kind: 'storage', site: x })}>Revert</button>`)),
      ...(P.permissions || []).map((b) => item(`✗ always block · ${esc(b.site.replace(/^https?:\/\/|:443$/g, ''))} · ${esc(b.perm)}`, '', false, `<button ${attrs({ decide: 'revert', was: 'permanent', kind: 'permission', site: b.site, perm: b.perm })}>Revert</button>`))];
    out.push(sec('Your decisions', `${rows.length}`, rows.join('') || '<p class="m">None yet.</p>'));
  }

  const head = look.length ? `<p class="bad"><b>${look.join(', ')} need a look</b></p>` : '<p class="ok"><b>✓ Nothing needs a look</b></p>';
  return head + (look.length ? '<button class="all" data-dropall="1">Drop all trackers</button>' : '') + out.join('')
    + `<p class="m">Checked ${esc(new Date(j.t).toLocaleString())} · <a href="http://127.0.0.1:8088/audit#baddies" target="_blank">audit page</a></p>`;
}

// Drop one thing now: background.js does it (message `drop`: refused while paused, written to the action log, a
// cookie kept 10 minutes for Undo). Then log it, worked or not, on the audit server.
async function drop(d) {
  const { ok, error, verified } = await chrome.runtime.sendMessage({ type: 'drop', ...d }).catch(() => null) || { ok: false, error: 'no answer' };
  try { await fetch(`${AUDIT}/drops`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...d, ok, error }) }); } catch {}
  const r = { ok, error, verified }; markDropped(d, r); return r;
}
const dropsFor = (j) => [...j.cookies.filter((c) => !c.allowed).map((c) => ({ kind: 'cookie', site: c.site, name: c.name })),
  ...(j.storage || []).filter((x) => x.tracking).map((x) => ({ kind: 'storage', site: x.site })), ...((j.servers?.tracking || []).length ? [{ kind: 'servers' }] : [])];
if (typeof module !== 'undefined') module.exports = { esc, renderBaddies, drop, dropsFor };
