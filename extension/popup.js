// Popup (tap the Tracker Cleaner icon): the only control surface of 1.21. On / off and pause, what was cleaned on
// this site with Undo and Allow, and one row per group with its mode, its numbers and, when something waits, a button
// that says what it does ("Remove 12 cookies") and Postpone. At the top, a button opens the report beside the page
// (report.html, 1.23) and a link opens the "now and history" page (history.html).
// It asks background.js for its state, shows it (popup-view.js) and sends the message a control carries; it deletes
// nothing itself. Works with the 8088 audit server down; when that server answers, its audit view (popup-audit.js)
// is added at the end, collapsed.
const out = document.getElementById('out'), note = document.getElementById('note');
const send = (m) => chrome.runtime.sendMessage(m);
const REFUSED = { paused: 'Not done: cleaning is paused.', off: 'Not done: cleaning is switched off.' };
let tab = null, audit = null, serverUp = false;
// details the user opened stay open across a re-render
async function show(msg) {
  const open = [...out.querySelectorAll('details[open]')].map((d) => d.id);
  try { const [state, history] = await Promise.all([send({ type: 'state' }), send({ type: 'history' })]);   // the history: for "N removed today"
    serverUp = state.server === true; out.innerHTML = renderPopup({ ...state, history, audit }, tab); } catch { msg = 'Tracker Cleaner did not answer. Close this and open it again.'; }
  for (const id of open) { const d = id && document.getElementById(id); if (d) d.open = true; }
  note.textContent = msg || '';
}
// The report (report.html) opens in Chrome's side panel, beside the page. Chrome allows that only straight from a click,
// so the window and tab are looked up beforehand. If Chrome refuses, the report opens in a tab of its own instead.
let front = null;
document.getElementById('report').addEventListener('click', async () => {
  try { await chrome.sidePanel.open({ windowId: front.windowId }); window.close(); }
  catch { chrome.tabs.create({ url: `report.html${front ? `?tab=${front.id}` : ''}` }); } });
async function activeTab() {
  try { const [t] = await chrome.tabs.query({ active: true, currentWindow: true }); front = t; const u = new URL(t.url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    let blocked = null;   // Chrome limits how often this may be asked: then no count is shown
    try { blocked = (await chrome.declarativeNetRequest.getMatchedRules({ tabId: t.id })).rulesMatchedInfo.filter((m) => m.rule.rulesetId !== '_dynamic').length; } catch {}
    return { host: u.hostname, blocked }; } catch { return null; }
}
async function act(el, extra) {
  const r = await send({ ...JSON.parse(el.dataset.msg), ...extra }).catch(() => null);
  await show(!r || r.ok === false ? REFUSED[r && r.why] || 'That did not work.' : r.of !== undefined ? `Cleaned ${r.done} of ${r.of}.` : r.restored !== undefined ? `Restored ${r.restored}.` : '');
}
// ---- the 8088 audit view: silent when the server is down
const post = (path, body) => fetch(`${AUDIT}/${path}`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
const got = (j, msg) => { if (j && Array.isArray(j.cookies)) audit = j; return show(msg); };
const refresh = async (msg) => { try { await got(await (await fetch(`${AUDIT}/baddies/refresh`, { method: 'POST' })).json(), msg); } catch {} };
async function auditClick(b) {
  const d = b.dataset;
  if (d.warn && b.textContent === 'Drop') { b.textContent = 'Tap again: ' + d.warn; b.classList.add('warn'); return; }   // two taps for sign-ins
  b.disabled = true;
  if (d.drop) { b.textContent = 'Dropping…';
    const r = await drop({ kind: d.drop, site: d.site, name: d.name, perm: d.perm });
    const msg = r.ok ? '✓ Dropped and logged' + (r.verified === false ? ' (Chrome still lists it)' : '') : '✗ ' + r.error; await show(msg); refresh(msg); }
  else if (d.dropall) { b.textContent = 'Dropping…'; const all = dropsFor(audit); let n = 0; for (const x of all) if ((await drop(x)).ok) n++;
    const msg = `✓ Dropped ${n} of ${all.length}`; await show(msg); refresh(msg); }
  else if (d.decide || d.permanent) {
    const r = await (await post(d.decide ? 'decisions' : 'drops/permanent', { action: d.decide, was: d.was, kind: d.kind || d.permanent, site: d.site, name: d.name, perm: d.perm })).json().catch(() => ({ error: 'no answer' }));
    if (r.error) note.textContent = '✗ ' + r.error;
    else got(r, d.permanent ? '✓ Permanent: the cleaner repeats this drop every 15 min' : d.decide === 'allow' ? '✓ Allowed: the cleaner keeps it from now on (Revert under Your decisions)' : '✓ Reverted'); }
}
out.addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.copy) return navigator.clipboard.writeText(b.dataset.copy).then(() => { note.textContent = 'Copied. Paste it into a terminal opened in the Tracker Cleaner folder.'; }, () => { note.textContent = `Could not copy. The command is: ${b.dataset.copy}`; });
  // Chrome shows its own question for the history right, and only straight from a press
  if (b.dataset.perm === 'history') return chrome.permissions.request({ permissions: ['history'] }).then((ok) => ok ? send({ type: 'histOn', on: true }).then(() => show()) : show('Chrome did not allow it, so nothing changed.'), () => show('That did not work.'));
  if (b.dataset.permOff === 'history') return send({ type: 'histOn', on: false }).then(() => chrome.permissions.remove({ permissions: ['history'] })).then(() => show(), () => show());
  // a press that only shows a second, separate button, which can be pressed after its waiting time
  if (b.dataset.reveal) { const box = document.getElementById(b.dataset.reveal), yes = box && box.querySelector('button[data-wait]'); if (!box) return;
    box.hidden = false; if (yes) setTimeout(() => { yes.disabled = false; }, Number(yes.dataset.wait) || 1000); return; }
  if (b.dataset.msg) { b.disabled = true; act(b); } else auditClick(b).catch(() => { note.textContent = '✗ no answer from the audit server'; }); });
out.addEventListener('change', (e) => { const el = e.target; if (el.dataset.msg) act(el, el.tagName === 'SELECT' ? { mode: el.value } : { on: el.checked }); });
(async () => {
  tab = await activeTab(); await show();
  if (!serverUp) return;   // the background worker got no answer from it: asking again would only put a red line in the console
  try { await got(await (await fetch(`${AUDIT}/baddies.json`, { cache: 'no-store' })).json()); } catch { return; }   // last snapshot at once, then live
  if (audit) refresh();
})();
