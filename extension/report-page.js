// The report (1.23): the page in Chrome's side panel, beside the web page it is about. It asks background.js for its
// state and for this site's cookies, asks Chrome what it blocked on the tab, shows all of it (report-view.js) and
// sends the message a button carries. It deletes nothing itself and keeps nothing: what a cookie or the page holds
// is on the screen only, until the next redraw.
// The report is about the tab in front and is drawn again when another tab comes to the front or the tab goes to
// another address. Opened in a tab of its own (report.html?tab=<id>, when Chrome will not open the side panel) it is
// about that tab, and after that about whichever other tab comes to the front.
const out = document.getElementById('out'), note = document.getElementById('note');
const send = (m) => chrome.runtime.sendMessage(m);
const REFUSED = { paused: 'Not done: cleaning is paused.', off: 'Not done: cleaning is switched off.' };
let about = Number(new URLSearchParams(location.search).get('tab')) || null;   // null = the tab in front
let stored = null, storedFor = '';   // what the page in the tab has saved, as last counted when asked, and for which tab and address
async function theTab() {
  try { const t = about ? await chrome.tabs.get(about) : (await chrome.tabs.query({ active: true, currentWindow: true }))[0], u = new URL(t.url);
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return null;
    if (`${t.id} ${t.url}` !== storedFor) { stored = null; storedFor = `${t.id} ${t.url}`; }
    // Chrome answers this 20 times in 10 minutes and then refuses, except when the question follows a press of the user
    // (seen in a real Chrome, check R9): the report then says so and names the button
    let matched = null;
    try { matched = (await chrome.declarativeNetRequest.getMatchedRules({ tabId: t.id })).rulesMatchedInfo.map((m) => m.rule.rulesetId); } catch {}
    const c = await send({ type: 'cookies', host: u.hostname }).catch(() => null);
    return { id: t.id, host: u.hostname, matched, ...(c && c.ok ? { cookies: c.cookies } : {}), ...(stored ? { stored } : {}) }; } catch { return null; }
}
// lists the user opened stay open across a redraw
async function show(msg) {
  const open = [...out.querySelectorAll('details[open]')].map((d) => d.id);
  try { const [state, history, tab] = await Promise.all([send({ type: 'state' }), send({ type: 'history' }), theTab()]);
    out.innerHTML = renderReport(buildReport({ ...state, history }, tab)); } catch { msg = 'Tracker Cleaner did not answer. Close this and open it again.'; }
  for (const id of open) { const d = id && document.getElementById(id); if (d) d.open = true; }
  note.textContent = msg || '';
}
const said = (m, r) => !r || r.ok === false ? REFUSED[r && r.why] || 'That did not work.' : m.type === 'approve' && m.site ? 'Done.' : m.type === 'approve' ? `Removed ${r.done} of ${r.of}.` : m.type === 'dropSite' ? `Deleted ${r.done} of ${r.of}.`
  : r.restored !== undefined ? `Put back ${r.restored}.` : m.type === 'drop' || m.type === 'always' ? 'Done.' : '';
const copy = (text, done) => navigator.clipboard.writeText(text).then(() => { note.textContent = done; }, () => { note.textContent = 'Could not copy. Click once inside this report, then press the button again.'; });
out.addEventListener('click', async (e) => { const b = e.target.closest('button'); if (!b) return;
  const d = b.dataset;
  if (d.copy) return copy(d.copy, 'Copied. Paste it into a terminal opened in the Tracker Cleaner folder.');
  if (d.act === 'refresh') return show();
  if (!d.msg) return;
  const m = JSON.parse(d.msg), also = out.querySelector('[data-also]');
  if (m.type === 'dropSite' && also && also.checked) m.kept = true;
  b.disabled = true;
  const r = await send(m).catch(() => null);
  // the whole of what one cookie holds: onto the screen or the clipboard, and nowhere else
  if (d.act === 'full' || d.act === 'copy') { b.disabled = false;
    if (!r || !r.ok) { note.textContent = 'That cookie is no longer there. Press "Read again".'; return; }
    if (d.act === 'copy') return copy(r.value, 'Copied what this cookie holds.');
    b.closest('.c').querySelector('code').textContent = r.value; b.remove(); return; }
  if (m.type === 'stored') { stored = r; return show(); }
  await show(said(m, r)); });
out.addEventListener('change', async (e) => { const el = e.target;
  // the box beside "Delete N cookies on this site": the button says how many will go now
  if (el.dataset.also) { const b = out.querySelector('button[data-all]'); if (b) b.textContent = el.checked ? b.dataset.all : b.dataset.some; return; }
  if (el.dataset.msg) { const m = { ...JSON.parse(el.dataset.msg), on: el.checked }; await show(said(m, await send(m).catch(() => null))); } });
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  if (about) { const me = await chrome.tabs.getCurrent().catch(() => null); if (me && me.id === tabId) return; about = tabId; }   // coming back to the report itself changes nothing
  show(); });
chrome.tabs.onUpdated.addListener((id, info, t) => { if ((info.url || info.status === 'complete') && (about ? id === about : t && t.active)) show(); });
show();
