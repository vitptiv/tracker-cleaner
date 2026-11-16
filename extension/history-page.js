// The "now and history" page, opened in a tab from the popup's link. It asks background.js for its state and its
// private history, asks Chrome which cookies there are (site and name only: the content is dropped here and goes
// nowhere), what its proxy setting is, and how many requests it stopped, and shows
// all of it (history-view.js). It removes nothing itself.
// It sends nothing over the network, with one exception: the button "Check how websites see me" asks the Tor Project
// once per press, from inside Chrome, which is the only way to know what Chrome itself does.
const out = document.getElementById('out'), note = document.getElementById('note');
const send = (m) => chrome.runtime.sendMessage(m);
let tor;   // the answer to the Tor check, for as long as this page is open
const cookiesNow = async () => { let all;
  try { try { all = await chrome.cookies.getAll({ partitionKey: {} }); } catch { all = await chrome.cookies.getAll({}); } } catch { return null; }
  return all.map((c) => ({ domain: c.domain, name: c.name })); };
const proxyNow = async () => { try { const { value } = await chrome.proxy.settings.get({}), one = (value.rules || {}).singleProxy || {};
  return value.mode === 'fixed_servers' && one.host === '127.0.0.1' && one.port === 9050 ? 'tor' : ['fixed_servers', 'pac_script'].includes(value.mode) ? 'other' : 'none'; } catch { return undefined; } };
// requests Chrome says it stopped, per site of the tab they came from; '' = a tab that has been closed since
const blockedNow = async () => { try { const hit = (await chrome.declarativeNetRequest.getMatchedRules({})).rulesMatchedInfo.filter((m) => m.rule.rulesetId !== '_dynamic');
  const site = new Map((await chrome.tabs.query({})).map((t) => { try { return [t.id, new URL(t.url).hostname]; } catch { return [t.id, '']; } })), by = new Map();
  for (const m of hit) { const k = site.get(m.tabId) || ''; by.set(k, (by.get(k) || 0) + 1); }
  return [...by].map(([k, n]) => ({ site: k, n })).sort((a, b) => b.n - a.n); } catch { return undefined; } };   // Chrome limits how often this may be asked
// sections the user opened stay open across a re-render
async function show(msg) {
  const open = [...out.querySelectorAll('details')].map((d) => d.open);
  try { const [state, history, cookies, proxy, blocked] = await Promise.all([send({ type: 'state' }), send({ type: 'history' }), cookiesNow(), proxyNow(), blockedNow()]);
    out.innerHTML = renderHistoryPage({ ...state, history, cookies, proxy, blocked, tor }); } catch { msg = 'Tracker Cleaner did not answer. Close this page and open it again.'; }
  const now = [...out.querySelectorAll('details')];
  if (now.length === open.length) now.forEach((d, i) => { d.open = open[i]; });
  note.textContent = msg || '';
}
async function checkTor() {
  tor = { checking: true }; await show();
  try { const a = await (await fetch('https://check.torproject.org/api/ip', { cache: 'no-store', credentials: 'omit' })).json();
    tor = typeof a.IP === 'string' ? { ip: a.IP, isTor: a.IsTor === true } : { failed: true }; } catch { tor = { failed: true }; }
  await show();
}
out.addEventListener('click', async (e) => { const b = e.target.closest('button'); if (!b) return;
  if (b.dataset.act === 'tor') return checkTor();
  if (b.dataset.copy) { try { await navigator.clipboard.writeText(b.dataset.copy); note.textContent = 'Copied. Paste it into a terminal opened in the Tracker Cleaner folder.'; }
    catch { note.textContent = 'Could not copy. Select the command beside the button instead.'; } return; }
  if (b.dataset.msg) { b.disabled = true; const r = await send(JSON.parse(b.dataset.msg)).catch(() => null); await show(r && r.ok ? 'Done.' : 'That did not work.'); } });
show();
