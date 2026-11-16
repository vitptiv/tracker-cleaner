// The popup's HTML (chunk 6): renderPopup(state, tab) on hand-built states. No browser, no server.
const test = require('node:test'), assert = require('node:assert'), fs = require('fs'), path = require('path'), vm = require('node:vm');
const { renderPopup, hhmm } = require('../extension/popup-view.js'), { GROUPS } = require('../extension/registry.js');
const NOW = new Date(2026, 10, 10, 13, 0).getTime(), AT = new Date(2026, 10, 10, 14, 5).getTime();   // local time: 14:05 in any zone
const item = (site, name, o = {}) => ({ cap: 'C03', kind: 'cookie', site, name, why: 'name', t: NOW, ...o });
const groups = (over = {}) => GROUPS.map((g) => ({ id: g.id, title: g.title, mode: 'ask', pending: 0, postponedUntil: 0, items: [], ...over[g.id] }));
const state = (o = {}, over = {}) => ({ now: NOW, master: true, modes: {}, hold: { paused: false, guard: false, tab: false, pauseUntil: 0, guardUntil: 0 },
  groups: groups(over), log: [], allow: [], sitesOff: [], ...o });
const count = (html, s) => html.split(s).length - 1;
const two = { cookies: { mode: 'auto', pending: 2, items: [item('example.com', '_ga'), item('doubleclick.net', 'id')] }, google: { pending: 1, items: [item('google.com', 'NID', { cap: 'C04' })] } };

test('fresh install: one line, a Turn on button, no switch and no pause; one row per group with the three modes', () => {
  const html = renderPopup(state({ master: undefined }), null);
  assert.ok(html.includes('Cleaning is off until you turn it on.')); assert.equal(count(html, '>Turn on</button>'), 1);
  for (const s of ['Pause 10 min', 'type="checkbox"', 'This site', 'Approve']) assert.equal(html.includes(s), false, s);
  assert.equal(count(html, 'data-group="'), GROUPS.length);
  for (const g of GROUPS) assert.ok(html.includes(`data-group="${g.id}"`) && html.includes(`<b>${g.title.replace(/'/g, '&#39;')}</b>`), g.id);
  for (const m of ['>Off</option>', '>Ask first</option>', '>Automatic</option>']) assert.equal(count(html, m), GROUPS.length, m);
  assert.equal(count(html, '<option value="ask" selected>'), GROUPS.length);
});
test('on, two groups pending: switch and pause, each of the two rows has its count, a button that says what it removes, both postpones and a collapsed list', () => {
  const html = renderPopup(state({}, two), null);
  assert.match(html, /<input type="checkbox"[^>]*setMaster[^>]* checked> On/); assert.equal(count(html, '>Pause 10 min</button>'), 1);
  assert.ok(html.includes('2 pending') && html.includes('1 pending'));
  assert.equal(count(html, '>Remove 2 cookies</button>'), 1); assert.equal(count(html, '>Remove 1 cookie</button>'), 1);
  for (const b of ['class="go">Remove ', '>Postpone 1 h</button>', '>Until restart</button>', '<details']) assert.equal(count(html, b), 2, b);
  assert.equal(html.includes('<details open') || html.includes(' open>'), false); assert.equal(html.includes('disabled'), false);
  for (const s of ['example.com · _ga', 'doubleclick.net · id', 'google.com · NID', '<option value="auto" selected>']) assert.ok(html.includes(s), s);
  assert.equal(count(html, 'Nothing waiting'), GROUPS.length - 2);
  const msgs = [...html.matchAll(/data-msg="([^"]*)"/g)].map((m) => JSON.parse(m[1].replace(/&quot;/g, '"')));
  for (const m of [{ type: 'approve', group: 'google' }, { type: 'postpone', group: 'cookies', minutes: 60 }, { type: 'postpone', group: 'cookies', minutes: 'restart' },
    { type: 'pause', minutes: 10 }, { type: 'setMode', group: 'tor' }, { type: 'setMaster' }]) assert.ok(msgs.some((x) => JSON.stringify(x) === JSON.stringify(m)), JSON.stringify(m));
});
test('a group that cannot ask offers only On and Off; a stored "ask" shows as Off, which is what it does', () => {
  const row = (mode) => renderPopup(state({}, { signin: { ask: false, mode } }), null).split('data-group="signin"')[1].split('data-group=')[0];
  assert.equal(row('auto').includes('Ask first') || row('auto').includes('Automatic'), false);
  assert.ok(row('auto').includes('<option value="off">Off</option><option value="auto" selected>On</option>'));
  for (const m of ['off', 'ask']) assert.ok(row(m).includes('<option value="off" selected>Off</option><option value="auto">On</option>'), m);
  assert.equal(renderPopup(state({}, { signin: { ask: false } }), null).split('>Ask first</option>').length - 1, GROUPS.length - 1);
});
test('this site also lists what was set elsewhere while this page was open, marked as a guess', () => {
  const s = state({ log: [{ t: NOW, cap: 'C03', kind: 'cookie', site: 'doubleclick.net', name: 'IDE', did: 'removed', page: 'www.example.com' },
    { t: NOW, cap: 'C03', kind: 'cookie', site: 'example.com', name: '_ga', did: 'removed', page: 'www.example.com' },
    { t: NOW, cap: 'C03', kind: 'cookie', site: 'criteo.com', name: 'uid', did: 'removed', page: 'other.test' }] });
  const html = renderPopup(s, { host: 'www.example.com', blocked: null });
  assert.ok(html.includes('doubleclick.net · IDE') && html.includes('example.com · _ga')); assert.equal(html.includes('criteo.com'), false);
  assert.equal(count(html, 'set while you were on this site'), 1);
  assert.ok(html.indexOf('doubleclick.net · IDE') < html.indexOf('set while you were on this site') && html.indexOf('set while you were on this site') < html.indexOf("Don't clean"));
});
test('more pending than listed: the summary says so', () => {
  assert.ok(renderPopup(state({}, { cookies: { pending: 25, items: [item('a.test', 'x')] } }), null).includes('newest 1 of 25'));
});
test('paused: "Paused until HH:MM" and Resume instead of the pause button; the removing button is disabled', () => {
  const html = renderPopup(state({ hold: { paused: true, guard: false, pauseUntil: AT } }, two), null);
  assert.equal(hhmm(AT), '14:05'); assert.ok(html.includes('Paused until 14:05')); assert.equal(count(html, '>Resume</button>'), 1);
  assert.equal(html.includes('Pause 10 min'), false); assert.equal(count(html, 'disabled>Remove '), 2);
});
test('switched off: the switch says Off, nothing to pause, the removing button is disabled', () => {
  const html = renderPopup(state({ master: false }, two), null);
  assert.match(html, /<input type="checkbox"[^>]*setMaster[^>]*> Off/); assert.equal(html.includes(' checked> O'), false);
  assert.equal(html.includes('Pause 10 min'), false); assert.equal(count(html, 'disabled>Remove '), 2);
});
test('sign-in guard: its line shows only while the guard holds', () => {
  const line = 'Sign-in in progress: cleaning is held.';
  assert.ok(renderPopup(state({ hold: { paused: false, guard: true, guardUntil: AT } }), null).includes(line));
  assert.equal(renderPopup(state(), null).includes(line), false);
});
test('a postponed group says until when; a postponement that is over says nothing', () => {
  const html = (until) => renderPopup(state({}, { cookies: { ...two.cookies, postponedUntil: until } }), null);
  assert.ok(html(AT).includes('Postponed until 14:05')); assert.ok(html('restart').includes('Postponed until restart'));
  assert.equal(html(NOW - 1).includes('Postponed'), false);
});
test('this site: host, blocked count, the newest actions of this host and its parent domain with Allow, the site toggle', () => {
  const act = (site, name, did, t, kind = 'cookie') => ({ t, cap: 'C03', kind, site, name, did });
  const s = state({ log: [act('example.com', '_ga', 'removed', NOW), act('other.test', '_fbp', 'removed', NOW), act('www.example.com', '_hjid', 'queued', AT),
    act('example.com', '_ga', 'removed', AT), act('www.example.com', 'storage', 'removed', AT, 'storage'), act('example.com', '_gid', 'removed', AT)], allow: [{ site: 'example.com', name: '_gid' }] });
  const html = renderPopup(s, { host: 'www.example.com', blocked: 3 });
  assert.ok(html.includes('This site: www.example.com')); assert.ok(html.includes('3 requests blocked on this tab'));
  assert.equal(html.includes('_fbp'), false);
  assert.equal(count(html, '· _ga<'), 1);                             // the same action twice is shown once, the newest
  assert.ok(html.indexOf('· _gid') < html.indexOf('· _ga<') && html.indexOf('· _ga<') < html.indexOf('· _hjid'));   // newest first
  assert.ok(html.includes('14:05 removed</span> example.com · _ga<'));
  assert.equal(count(html, '>Allow</button>'), 2);                    // not for storage, not for what is allowed already
  assert.ok(html.includes('&quot;type&quot;:&quot;allow&quot;,&quot;site&quot;:&quot;www.example.com&quot;,&quot;name&quot;:&quot;_hjid&quot;'));
  assert.match(html, /<input type="checkbox"[^>]*siteOff[^>]*www\.example\.com[^>]*> Don't clean on this site/); assert.equal(html.includes('siteOff&quot;,&quot;host&quot;:&quot;www.example.com&quot;}" checked'), false);
  assert.ok(renderPopup(state(), { host: 'a.test', blocked: 1 }).includes('1 request blocked on this tab'));
  const none = renderPopup(state(), { host: 'a.test', blocked: null });
  assert.equal(none.includes('blocked on this tab'), false); assert.ok(none.includes('This site: a.test'));
});
test('a site that is switched off (itself or its parent) shows the toggle checked and is listed under the exceptions with a way back', () => {
  const html = renderPopup(state({ sitesOff: ['example.com'], allow: [{ site: 'b.test', name: 'sid' }] }), { host: 'www.example.com', blocked: null });
  assert.match(html, /<input type="checkbox"[^>]*siteOff[^>]*:&quot;example\.com&quot;[^>]* checked> Don't clean on this site/);
  assert.ok(html.includes('b.test · sid')); assert.equal(count(html, '>Revert</button>'), 1); assert.equal(count(html, '>Clean again</button>'), 1);
  assert.equal(renderPopup(state(), null).includes('exceptions'), false);
});
test('hostile strings in site, name, host and title are escaped everywhere', () => {
  const X = '"><script>alert(1)</script>', Y = "<img src=x onerror='alert(2)'>";
  const s = state({ log: [{ t: NOW, cap: 'C03', kind: Y, site: X, name: Y, did: Y }], allow: [{ site: X, name: Y }], sitesOff: [X] },
    { cookies: { title: Y, mode: X, pending: 1, postponedUntil: 0, items: [item(X, Y)] }, google: { id: X, pending: Y } });
  const html = renderPopup(s, { host: X, blocked: Y });
  for (const bad of ['<script', '<img', X, Y, "onerror='"]) assert.equal(html.includes(bad), false, bad);
  assert.ok(html.includes('&lt;script&gt;alert(1)&lt;/script&gt;') && html.includes('&lt;img src=x onerror=&#39;alert(2)&#39;&gt;'));
});
test('8088 server down: no audit section, no error text; when it answered: its view, collapsed', () => {
  const down = renderPopup(state(), { host: 'a.test', blocked: null });
  for (const s of ['id="audit"', 'No data', 'Could not', '127.0.0.1', 'chrome-baddies']) assert.equal(down.includes(s), false, s);
  assert.equal(renderPopup(state({ audit: { error: 'x' } }), null).includes('id="audit"'), false);
  const up = renderPopup(state({ audit: { t: NOW, total: 1, suspicious: 1, cookies: [{ site: '.bad.test', name: 'trk', reasons: ['tracker'] }] } }), null);
  assert.match(up, /<details id="audit"><summary>/); assert.ok(up.includes('bad.test · trk') && up.includes('>Drop</button>'));
  assert.ok(up.indexOf('id="audit"') > up.indexOf('data-group="server"'));
});
test('popup.html loads the three scripts in order; popup.js holds no markup of its own', () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '../extension', f), 'utf8'), html = read('popup.html');
  assert.match(html, /popup-audit\.js.*popup-view\.js.*popup\.js/s); assert.ok(html.includes('width:320px'));
  assert.equal(/<(div|p|button|details)\b/.test(read('popup.js')), false);
  assert.ok(require('../extension/manifest.json').permissions.includes('declarativeNetRequestFeedback'));
  for (const f of ['popup-view.js', 'popup-audit.js', 'popup.js', 'popup.html']) assert.ok(read('pack.sh').includes(f), f);
});
// The three files are classic scripts sharing one global scope: a name declared twice would stop the popup. Stubs only.
test('the scripts of popup.html load together, ask for the state and render it; no fetch error reaches the page', async () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '../extension', f), 'utf8'), sent = [];
  const out = { innerHTML: '', querySelectorAll: () => [], addEventListener: () => {} }, note = { textContent: '' };
  const chrome = { runtime: { sendMessage: async (m) => { sent.push(m); return state({ master: undefined }); } },
    tabs: { query: async () => [{ id: 7, url: 'https://www.example.com/a' }] },
    declarativeNetRequest: { getMatchedRules: async () => ({ rulesMatchedInfo: [{ rule: { ruleId: 1, rulesetId: 'trackers' } }, { rule: { ruleId: 1, rulesetId: '_dynamic' } }] }) } };
  const ctx = vm.createContext({ chrome, URL, document: { getElementById: (id) => (id === 'out' ? out : note) }, fetch: async () => { throw new TypeError('fetch failed'); } });
  for (const f of ['popup-audit.js', 'history.js', 'popup-view.js', 'popup.js']) vm.runInContext(read(f), ctx, { filename: f });
  for (let i = 0; i < 5; i++) await new Promise(setImmediate);
  assert.deepEqual(sent, [{ type: 'state' }, { type: 'history' }]); assert.equal(note.textContent, '');
  assert.ok(out.innerHTML.includes('Turn on') && out.innerHTML.includes('This site: www.example.com') && out.innerHTML.includes('1 request blocked on this tab'));
  assert.equal(out.innerHTML.includes('id="audit"'), false);
});

// ---- 1.22 popup fixes
const rowOf = (html, id) => html.split(`data-group="${id}"`)[1].split('data-group=')[0];
test('"Removed in the last 10 minutes" says 300+ when the buffer is full, the plain number below that', () => {
  const undo = (n) => Array.from({ length: n }, (_, i) => ({ t: NOW - 1000, site: `s${i}.test`, name: '_ga' }));
  assert.ok(renderPopup(state({ undo: undo(300) }), null).includes('Removed in the last 10 minutes: 300+ <button'));
  assert.ok(renderPopup(state({ undo: undo(299) }), null).includes('Removed in the last 10 minutes: 299 <button'));
});
test('the cache row says how much there is and when it is next offered, instead of "Nothing waiting"', () => {
  const TOMORROW = new Date(2026, 10, 11, 9, 30).getTime(), row = (g) => rowOf(renderPopup(state({}, { cache: g }), null), 'cache');
  assert.ok(row({ size: 778 * 1024 * 1024, nextAt: AT }).includes('<span>778 MB of saved pages, offered again today at 14:05</span>'));
  assert.ok(row({ nextAt: TOMORROW }).includes('<span>Offered again tomorrow at 09:30</span>'));
  assert.ok(row({ mode: 'auto', nextAt: TOMORROW }).includes('<span>Cleared again tomorrow at 09:30</span>'));
  assert.ok(row({ mode: 'off', size: 2048, nextAt: AT }).includes('<span>2.0 KB of saved pages</span>'));
  for (const g of [{ size: 1, nextAt: AT }, { nextAt: TOMORROW }]) assert.equal(row(g).includes('pending'), false);
  // something waits, or nothing is known: as before
  assert.ok(row({ pending: 1, nextAt: AT, items: [item('*', 'http-cache', { cap: 'C11', kind: 'cache' })] }).includes('1 pending'));
  assert.ok(row({}).includes('Nothing waiting')); assert.ok(row({ nextAt: NOW - 1 }).includes('Nothing waiting'));
  assert.equal(rowOf(renderPopup(state({}, { cookies: { nextAt: AT, size: 5 } }), null), 'cookies').includes('saved pages'), false);
});
test('a row with cookies that keep coming back says so, with the number, and marks them in the list', () => {
  const back = 'this site keeps putting it back', row = (items, looping) => rowOf(renderPopup(state({}, { google: { mode: 'auto', pending: items.length, looping, items } }), null), 'google');
  const one = row([item('google.com', 'NID', { cap: 'C04', why: back })], 1);
  assert.ok(one.includes('<div class="m">1 of these is no longer removed automatically: its site keeps putting it back, so it waits for you.</div>'), one);
  assert.ok(one.includes('google.com · NID <span class="m">keeps coming back</span>'));
  const two = row([item('google.com', 'NID', { cap: 'C04', why: back }), item('youtube.com', 'YSC', { cap: 'C04', why: back }), item('google.com', 'OTZ', { cap: 'C04', why: 'google' })], 2);
  assert.ok(two.includes('<div class="m">2 of these are no longer removed automatically: their sites keep putting them back, so they wait for you.</div>'));
  assert.equal(two.split('keeps coming back').length - 1, 2);
  assert.equal(row([item('google.com', 'OTZ', { cap: 'C04', why: 'google' })], 0).includes('no longer removed'), false);
});
test('8088 server absent: the popup does not ask it at all, so Chrome prints no red line; present: it asks', async () => {
  const read = (f) => fs.readFileSync(path.join(__dirname, '../extension', f), 'utf8');
  const open = async (server) => { const asked = [], out = { innerHTML: '', querySelectorAll: () => [], addEventListener: () => {} };
    const chrome = { runtime: { sendMessage: async () => ({ ...state(), ...server }) }, tabs: { query: async () => [] } };
    const ctx = vm.createContext({ chrome, URL, document: { getElementById: () => out }, fetch: async (url) => { asked.push(url); throw new TypeError('fetch failed'); } });
    for (const f of ['popup-audit.js', 'history.js', 'popup-view.js', 'popup.js']) vm.runInContext(read(f), ctx, { filename: f });
    for (let i = 0; i < 5; i++) await new Promise(setImmediate);
    return asked; };
  assert.deepEqual(await open({ server: false }), []); assert.deepEqual(await open({}), []);
  assert.deepEqual(await open({ server: true }), ['http://127.0.0.1:8088/audit/baddies.json']);
});

// ---- 1.22: the wording rules, the numbers of a row, the command to copy, and the way to the page
test('a button says what it does and to how many things; the word "pending" never stands without its number', () => {
  const it = (kind, site, name) => ({ cap: 'C07', kind, site, name, why: 'permanent drop', t: NOW });
  const html = renderPopup(state({}, { cookies: { pending: 2, items: two.cookies.items }, google: { pending: 1, items: two.google.items }, cache: { pending: 1, items: [it('cache', '*', 'http-cache')] },
    storage: { pending: 3, items: [it('storage', 'a.test', 'storage')] }, permissions: { pending: 1, items: [it('permission', 'a.test', 'camera')] }, tabs: { pending: 4, items: [it('tabs', 'a.test', '7')] } }), null);
  for (const b of ['>Remove 2 cookies</button>', '>Remove 1 cookie</button>', '>Clear the saved copies of pages</button>', '>Remove 3 items</button>', '>Block 1 permission</button>', '>Close 4 tabs</button>'])
    assert.equal(count(html, b), 1, b);
  assert.equal(html.includes('Approve'), false);
  assert.equal(/(?<!\d )pending/.test(html.replace(/id="pending-|"pending"/g, '')), false);
  assert.ok(html.includes('Nothing waiting')); assert.ok(html.includes('<summary class="m">What is waiting'));
});
test('a row says how many were removed today, when the history has it', () => {
  const day = require('../extension/history.js').historyDay, history = { days: { [day(NOW)]: { cookies: 12, google: 1 }, [day(NOW - 86400e3)]: { storage: 9 } }, cookies: {} };
  const html = renderPopup(state({ history }, two), null), row = (id) => (new RegExp(`<div class="c" data-group="${id}">.*?(?=<div class="c" data-group|$)`, 's').exec(html) || [''])[0];
  assert.ok(row('cookies').includes('2 pending · 12 removed today')); assert.ok(row('google').includes('1 pending · 1 removed today'));
  assert.ok(row('storage').includes('Nothing waiting</span>'), 'yesterday is not today');
  assert.equal(renderPopup(state({}, two), null).includes('removed today'), false);
});
test('"Copy command" on the rows the inspector command covers, carrying exactly that command', () => {
  const html = renderPopup(state(), null), { BLOCKS } = require('../tools/inspect.js');
  const got = Object.fromEntries([...html.matchAll(/data-group="([a-z]+)">(?:(?!data-group).)*?<button class="small" data-copy="([^"]*)">Copy command<\/button>/gs)].map((m) => [m[1], m[2]]));
  assert.deepEqual(got, { cookies: 'node tools/inspect.js cookies', google: 'node tools/inspect.js cookies', allowlist: 'node tools/inspect.js cookies', storage: 'node tools/inspect.js storage',
    wifi: 'node tools/inspect.js wifi', permissions: 'node tools/inspect.js permissions', cache: 'node tools/inspect.js cache', tor: 'node tools/inspect.js tor' });
  for (const cmd of Object.values(got)) assert.ok(Object.hasOwn(BLOCKS, cmd.split(' ')[2]), cmd);
  assert.equal(count(html, 'Copy command'), 8);
});
test('popup.html: one link at the top opens the page in a tab', () => {
  const html = fs.readFileSync(path.join(__dirname, '../extension/popup.html'), 'utf8');
  assert.equal(count(html, '<a '), 1);
  assert.ok(html.includes('<h1>Tracker Cleaner</h1>\n  <p><a href="history.html" target="_blank">See everything and its history</a></p>'));
  assert.ok(html.indexOf('history.js') > 0 && html.indexOf('history.js') < html.indexOf('popup-view.js'));
});
