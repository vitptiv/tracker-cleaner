// The popup's HTML (C21 and the group rows), free of Chrome calls so the Node tests can render it.
// renderPopup(state, tab): state = background.js's reply to { type: 'state' }, plus `audit` (what the 8088 server
// answered, if it did); tab = { host, blocked } for the active tab, blocked null when Chrome did not say, or null
// when the tab is not a web page. Every value goes through esc. A control carries its message in data-msg;
// popup.js sends it, adding `mode` for a select and `on` for a checkbox.
const AUDIT_VIEW = typeof module !== 'undefined' ? require('./popup-audit.js') : { esc, renderBaddies };
const SITE_SHOWN = 8, MODES = [['off', 'Off'], ['ask', 'Ask first'], ['auto', 'Automatic']], ON_OFF = [['off', 'Off'], ['auto', 'On']];
const UNDO_SHOWN_MS = 10 * 60e3, UNDO_FULL = 300;   // as UNDO_MS and UNDO_MAX in undo.js: an older entry can no longer be restored; at the cap there were more
const LOOPING = 'this site keeps putting it back';   // as LOOP_WHY in loop.js
const DAY_OF = typeof module !== 'undefined' ? require('./history.js').historyDay : historyDay;
// The inspector command (tools/inspect.js) that shows the same things from Chrome's own files, per group
const COMMAND = { cookies: 'cookies', google: 'cookies', allowlist: 'cookies', storage: 'storage', wifi: 'wifi', permissions: 'permissions', cache: 'cache', tor: 'tor' };
// What the button of a group does, and to what: "Remove 12 cookies"
const DOES = { cookies: ['Remove', 'cookie'], google: ['Remove', 'cookie'], allowlist: ['Remove', 'cookie'], permissions: ['Block', 'permission'], tabs: ['Close', 'tab'], wifi: ['Remove', 'saved network'], unknown: ['Stop', 'tracker'] };
// The Tor row, from background.js's { wanted, running, routed } (as torSays in report-view.js)
const TOR_SAYS = (t) => t.routed ? (t.running === false ? 'Routed over Tor: yes, but Tor has stopped answering. Pages will not load until Tor runs again or you switch this off'
    : 'Routed over Tor: yes, websites see an address of the Tor network, not yours')
  : t.wanted && t.running === false ? 'Tor is not running on this computer; nothing is routed' : 'Routed over Tor: no';
const renderPopup = (state, tab) => {
  const { esc, renderBaddies } = AUDIT_VIEW, s = state || {}, hold = s.hold || {}, allow = s.allow || [], sitesOff = s.sitesOff || [];
  const msg = (m) => `data-msg="${esc(JSON.stringify(m))}"`;
  const btn = (label, m, cls, off) => `<button ${msg(m)}${cls ? ` class="${cls}"` : ''}${off ? ' disabled' : ''}>${label}</button>`;
  const check = (label, m, on) => `<label><input type="checkbox" ${msg(m)}${on ? ' checked' : ''}> ${label}</label>`;
  const under = (h, site) => h === site || h.endsWith('.' + site);
  const stopped = hold.paused || s.master === false;   // Approve would be refused
  const undo = (s.undo || []).filter((u) => u.t > s.now - UNDO_SHOWN_MS);

  const status = () => typeof s.master !== 'boolean' ? `<p>Cleaning is off until you turn it on.</p><p>${btn('Turn on', { type: 'setMaster', on: true })}</p>`
    : `<div class="h">${check(s.master ? 'On' : 'Off', { type: 'setMaster' }, s.master)}`
      + (!s.master ? '' : hold.paused ? `<span>Paused until ${hhmm(hold.pauseUntil)} ${btn('Resume', { type: 'resume' })}</span>` : btn('Pause 10 min', { type: 'pause', minutes: 10 })) + '</div>'
      + (s.master && hold.guard ? '<p class="m">Sign-in in progress: cleaning is held.</p>' : '')
      + (Array.isArray(s.serverOff) && s.serverOff.length ? `<p class="c">The settings program on this computer has switched off: ${esc(s.serverOff.join(', '))}.</p>` : '')
      + (s.master && s.firstRun === 'update' ? `<p class="c">New in 1.25: Tracker Cleaner now also stops companies that follow you without asking first, and deletes what they saved. To have it ask again, choose "Ask first" in the rows below; to turn it off, untick "On" above. ${btn('OK', { type: 'seen' })}</p>`
        : s.master && s.firstRun ? `<p class="c">Tracker Cleaner is on. By itself it now stops companies that follow you from site to site and deletes what they saved. To turn it off, untick "On" above. ${btn('OK', { type: 'seen' })}</p>` : '');
  const undone = () => !undo.length ? '' : `<p>Removed in the last 10 minutes: ${undo.length >= UNDO_FULL ? UNDO_FULL + '+' : undo.length} ${btn('Restore all', { type: 'restoreAll' })}</p>`;

  // This site (C21). An action belongs here when its site is this host, a parent domain (where most cookies are
  // set) or a subdomain; or when it happened while this site was the page in front (`page`: a guess, and marked so).
  // The same action many times over (a tracker cookie comes back at every page) is shown once.
  const site = () => {
    if (!tab || !tab.host) return '';
    const h = String(tab.host), off = sitesOff.find((x) => under(h, x)), seen = new Set(), n = tab.blocked;
    const here = (x) => !!x && (under(h, String(x)) || under(String(x), h));
    const rows = (s.log || []).filter((l) => l.kind !== 'wifi' && (here(l.site) || here(l.page))).reverse()
      .filter((l) => { const k = [l.kind, l.site, l.name, l.did].join(' '); return !seen.has(k) && seen.add(k); }).slice(0, SITE_SHOWN);
    const allowed = (l) => allow.some((a) => a.site === l.site && a.name === l.name);
    return `<h2>This site: ${esc(h)}</h2>` + (Number.isInteger(n) ? `<p>${n} request${n === 1 ? '' : 's'} blocked on this tab</p>` : '')
      + (rows.map((l) => `<div class="c h"><span><span class="m">${hhmm(l.t)} ${esc(l.did)}</span> ${esc(l.site)} · ${esc(l.name)}</span>`
        + `<span>${l.kind !== 'cookie' ? '' : l.cap === 'C07' ? '<span class="m">on your always-drop list</span>'   // neither Undo nor Allow would hold
          : (l.did === 'removed' && undo.some((u) => u.site === l.site && u.name === l.name) ? btn('Undo', { type: 'restore', site: l.site, name: l.name }) + ' ' : '')
          + (allowed(l) ? '<span class="m">allowed</span>' : btn('Allow', { type: 'allow', site: l.site, name: l.name }))}</span></div>`
        + (here(l.site) ? '' : '<div class="m sub">set while you were on this site</div>')).join('')
        || '<p class="m">Nothing cleaned here yet.</p>')
      + `<p>${check("Don't clean on this site", { type: 'siteOff', host: off || h }, !!off)}</p>`;
  };

  const group = (g) => {
    const n = Number(g.pending) || 0, items = g.items || [], until = g.postponedUntil;
    const mode = g.ask === false && g.mode !== 'auto' ? 'off' : g.noAuto && g.mode === 'auto' ? 'ask' : g.mode;   // nothing to ask about: 'ask' acts as off
    // Wi-Fi (the only noAuto group): what the local helper last said. With a hint there is nothing to approve.
    const wifi = g.id === 'wifi', hint = !wifi || mode === 'off' ? '' : g.helper === 'missing' ? 'Helper not installed (see wifi-helper/README.md)'
      : g.helper === 'ok' && g.canDelete !== 'yes' ? 'This user is not allowed to remove saved networks without a password, so nothing can be removed from here.' : '';
    const post = until === 'restart' ? 'Postponed until restart' : until > s.now ? `Postponed until ${hhmm(until)}` : '';
    // the cache row, while nothing waits: how much there is (when the state says) and when it is next due
    const idle = g.id !== 'cache' ? '' : [Number.isFinite(g.size) ? `${bytes(g.size)} of saved pages` : '',
      mode !== 'off' && g.nextAt > s.now ? `${mode === 'auto' ? 'cleared' : 'offered'} again ${dayAt(g.nextAt, s.now)}` : ''].filter(Boolean).join(', ');
    const [verb, thing] = DOES[g.id] || ['Remove', 'item'];
    const approve = hint ? '' : btn(g.id === 'cache' ? 'Clear the saved copies of pages' : `${verb} ${n} ${thing}${n === 1 ? '' : 's'}`, { type: 'approve', group: g.id }, 'go', stopped);
    const today = Number((((s.history || {}).days || {})[DAY_OF(s.now)] || {})[g.id]) || 0, cmd = COMMAND[g.id];
    const line = `${g.id === 'tor' && s.tor ? TOR_SAYS(s.tor) : n ? `${n} pending` : idle ? idle[0].toUpperCase() + idle.slice(1) : 'Nothing waiting'}${today ? ` · ${today} removed today` : ''}${post ? ` · ${post}` : ''}`;
    const k = Number(g.looping) || 0;
    return `<div class="c" data-group="${esc(g.id)}"><div class="h"><b>${esc(g.title)}</b><select ${msg({ type: 'setMode', group: g.id })}>`
      + (g.ask === false ? ON_OFF : g.noAuto ? MODES.slice(0, 2) : MODES).map(([v, t]) => `<option value="${v}"${v === mode ? ' selected' : ''}>${t}</option>`).join('') + '</select></div>'
      + (cmd ? `<div class="m h"><span>${line}</span><button class="small" data-copy="node tools/inspect.js ${cmd}">Copy command</button></div>` : `<div class="m">${line}</div>`) + (hint ? `<div class="m">${hint}</div>` : '')
      + (!k ? '' : `<div class="m">${k} of these ${k === 1 ? 'is no longer removed automatically: its site keeps putting it back, so it waits for you.'
        : 'are no longer removed automatically: their sites keep putting them back, so they wait for you.'}</div>`)
      + (g.id === 'cache' && mode !== 'off' && !n ? `<div class="b">${btn('Clean now', { type: 'drop', kind: 'servers' }, '', stopped)}</div>` : '')
      + (!n ? '' : `<div class="b">${approve}${btn('Postpone 1 h', { type: 'postpone', group: g.id, minutes: 60 })}`
        + `${btn('Until restart', { type: 'postpone', group: g.id, minutes: 'restart' }, 'small')}</div>`
        + (wifi && approve ? '<div class="m">This cannot be undone here</div>' : '')   // the undo buffer holds cookies only
        + `<details id="pending-${esc(g.id)}"><summary class="m">What is waiting${items.length < n ? ` (the newest ${items.length} of ${n})` : ''}</summary>`
        + items.map((it) => `<div class="c">${esc(it.site)} · ${esc(it.kind === 'wifi' ? it.why : it.name)}${it.why === LOOPING ? ' <span class="m">keeps coming back</span>' : ''}</div>`).join('') + '</details>') + '</div>';
  };

  // the way back from Allow and from "Don't clean on this site", also when that site is not the open tab
  const exceptions = () => {
    const rows = [...allow.map((a) => [`${esc(a.site)} · ${esc(a.name)}`, 'cookie is kept', btn('Revert', { type: 'revertAllow', site: a.site, name: a.name })]),
      ...sitesOff.map((h) => [esc(h), 'site is not cleaned', btn('Clean again', { type: 'siteOff', host: h, on: false })])];
    return !rows.length ? '' : `<details id="exceptions"><summary><b>Your exceptions</b> <span class="m">${rows.length}</span></summary>`
      + rows.map(([what, note, b]) => `<div class="c h"><span>${what} <span class="m">${note}</span></span>${b}</div>`).join('') + '</details>';
  };

  const audit = () => !s.audit || !Array.isArray(s.audit.cookies) ? ''
    : `<details id="audit"><summary><b>Audit from the local server</b></summary>${renderBaddies(s.audit)}</details>`;

  // S11: asked for at a press only; popup.js asks Chrome for the right and then sends { type: 'histOn' }
  const history = () => `<div class="c" data-row="history"><b>Trackers' pages in your history</b>` + (s.histOn
    ? `<div class="m">Pages on trackers' own addresses are taken out of your history once a day. Pages of other sites stay.</div><div class="b"><button data-perm-off="history">Stop removing them</button></div>`
    : `<div class="m">Chrome will ask you to let Tracker Cleaner read your history. Only pages on trackers' own addresses are removed; nothing of your history is kept or sent anywhere.</div>`
      + `<div class="b"><button data-perm="history">Also remove trackers' pages from my history</button></div>`) + '</div>';
  const browsing = () => `<div class="c" data-row="browsing"><b>Your own browsing history</b><div class="m">Clears every page Chrome remembers you visited, on all sites. It cannot be put back. Tracker Cleaner never does this by itself.</div>`
    + `<div class="b"><button data-twice="Press again: this clears all of your browsing history and cannot be put back" ${msg({ type: 'clearBrowsing' })}>Clear my browsing history</button></div></div>`;
  const full = () => (s.stopped || []).length < 300 ? '' : '<p class="c">300 companies are stopped, the most Tracker Cleaner keeps, so new ones are not stopped. In the report you can let some through again.</p>';
  return status() + full() + undone() + site() + '<h2>What gets cleaned</h2>' + (s.groups || []).map(group).join('') + history().replace(/'/g, '&#39;') + browsing() + exceptions() + audit();
};
const hhmm = (t) => new Date(t).toTimeString().slice(0, 5);
const dayAt = (t, now) => `${new Date(t).toDateString() === new Date(now).toDateString() ? 'today' : 'tomorrow'} at ${hhmm(t)}`;   // t is at most 24 hours ahead
const bytes = (b) => { let i = 0; while (b >= 1024 && i < 4) { b /= 1024; i++; } return i ? `${b < 10 ? b.toFixed(1) : Math.round(b)} ${' KMGT'[i]}B` : `${b} bytes`; };
if (typeof module !== 'undefined') module.exports = { renderPopup, hhmm };
