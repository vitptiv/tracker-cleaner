// Popup (tap the Tracker Cleaner icon): everything `chrome-baddies` reports about this browser, refreshed
// when opened (the audit server reruns it): suspicious cookies, site storage, site permissions, servers Chrome
// remembers, extensions, policies. Every item can be dropped now; drops are logged on the audit server
// (logs/drops.jsonl) and can be made permanent (the cleaner then repeats them every 15 min). Never cookie values.
const AUDIT = 'http://127.0.0.1:8088/audit';
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
    `<p class="m">${j.suspicious} of ${j.total} look suspicious by chrome-baddies' strict rules.</p>`
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
    out.push(sec('Servers Chrome remembers', `${j.servers.count} servers${t.length ? `, ${t.length} look like trackers` : ''}`,
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
    + j.recentlyRemoved.map((x) => item(`${esc(x.site)} · ${esc(x.name)}`, `removed ${x.count}×`, false,
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

// Drop one thing now, then log it (worked or not) on the audit server.
async function drop(d) {
  let ok = true, error, verified;
  try {
    if (d.kind === 'cookie') { const host = d.site.replace(/^\./, '');
      const r = await chrome.cookies.remove({ url: `https://${host}/`, name: d.name }); if (!r) await chrome.cookies.remove({ url: `http://${host}/`, name: d.name });
      try { verified = !(await chrome.cookies.getAll({ domain: host, name: d.name })).some((c) => c.domain.replace(/^\./, '') === host); } catch {} }   // check failing ≠ drop failing
    else if (d.kind === 'storage') await chrome.browsingData.remove({ origins: [`https://${d.site}`, `http://${d.site}`] },
      { localStorage: true, indexedDB: true, serviceWorkers: true, cacheStorage: true, fileSystems: true, webSQL: true });
    else if (d.kind === 'permission') await chrome.contentSettings[d.perm].set({ primaryPattern: `${d.site}/*`, setting: 'block' });
    else if (d.kind === 'servers') await chrome.browsingData.remove({ since: 0 }, { cache: true });
  } catch (e) { ok = false; error = String(e.message || e); }
  try { await fetch(`${AUDIT}/drops`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...d, ok, error }) }); } catch {}
  const r = { ok, error, verified }; markDropped(d, r); return r;
}
const dropsFor = (j) => [...j.cookies.filter((c) => !c.allowed).map((c) => ({ kind: 'cookie', site: c.site, name: c.name })),
  ...(j.storage || []).filter((x) => x.tracking).map((x) => ({ kind: 'storage', site: x.site })), ...((j.servers?.tracking || []).length ? [{ kind: 'servers' }] : [])];

if (typeof document !== 'undefined') {
  const out = document.getElementById('out'), note = document.getElementById('note');
  let data = null;
  const show = (j, msg) => { data = j; out.innerHTML = renderBaddies(j); note.textContent = msg || ''; };
  const refresh = async (msg) => { note.textContent = 'Checking Chrome now…';
    try { show(await (await fetch(`${AUDIT}/baddies/refresh`, { method: 'POST' })).json(), msg); } catch { note.textContent = 'Could not refresh (audit server down?)'; } };
  fetch(`${AUDIT}/baddies.json`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null).then((j) => { show(j); refresh(); });   // last snapshot at once, then live
  out.addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.warn && b.textContent === 'Drop') { b.textContent = 'Tap again: ' + b.dataset.warn; b.classList.add('warn'); return; }   // two taps for sign-ins
    b.disabled = true;
    if (b.dataset.drop) { b.textContent = 'Dropping…';
      const r = await drop({ kind: b.dataset.drop, site: b.dataset.site, name: b.dataset.name, perm: b.dataset.perm });
      show(data, r.ok ? '✓ Dropped and logged' + (r.verified === false ? ' (Chrome still lists it)' : '') : '✗ ' + r.error); refresh(note.textContent); }
    else if (b.dataset.dropall) { b.textContent = 'Dropping…'; const all = dropsFor(data); let n = 0; for (const d of all) if ((await drop(d)).ok) n++;
      show(data, `✓ Dropped ${n} of ${all.length}`); refresh(note.textContent); }
    else if (b.dataset.decide) { const r = await (await fetch(`${AUDIT}/decisions`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: b.dataset.decide, was: b.dataset.was, kind: b.dataset.kind, site: b.dataset.site, name: b.dataset.name, perm: b.dataset.perm }) })).json().catch(() => ({ error: 'no answer' }));
      if (r.error) note.textContent = '✗ ' + r.error; else show(r, b.dataset.decide === 'allow' ? '✓ Allowed: the cleaner keeps it from now on (Revert under Your decisions)' : '✓ Reverted'); }
    else if (b.dataset.permanent) { const r = await (await fetch(`${AUDIT}/drops/permanent`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: b.dataset.permanent, site: b.dataset.site, name: b.dataset.name, perm: b.dataset.perm }) })).json().catch(() => ({ error: 'no answer' }));
      if (r.error) note.textContent = '✗ ' + r.error; else show(r, '✓ Permanent: the cleaner repeats this drop every 15 min'); }
  });
}
