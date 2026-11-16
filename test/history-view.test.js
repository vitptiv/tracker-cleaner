// The "now and history" page (extension/history.html): renderHistoryPage(state) on hand-built states, and its wording
// held against the inspector command on the fixture profile. No browser.
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path');
const { renderHistoryPage } = require('../extension/history-view.js'), { GROUPS } = require('../extension/registry.js');
const fx = require('./fixtures/build.js').at('profile-page'), inspect = require('../tools/inspect.js');
test.before(() => fx.build());
const EXT = path.join(__dirname, '..', 'extension'), NOW = new Date(2026, 10, 12, 14, 5).getTime();   // 12 Nov 2026, 14:05 local
const groups = (over = {}) => GROUPS.map((g) => ({ id: g.id, title: g.title, mode: 'ask', pending: 0, postponedUntil: 0, items: [], looping: 0, ...over[g.id] }));
const state = (o = {}, over = {}) => ({ now: NOW, master: true, groups: groups(over), allow: [], sitesOff: [], history: { days: {}, cookies: {} },
  cookies: fx.COOKIES.map(([domain, name]) => ({ domain, name })), proxy: 'none', ...o });
const count = (html, s) => html.split(s).length - 1;
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');
// one block of the page, and one of its lines by label
const section = (html, id) => (new RegExp(`<section id="${id}">.*?</section>`, 's').exec(html) || [''])[0];
const line = (html, id, label) => text((new RegExp(`<p><b>${label}</b> (.*?)</p>`, 's').exec(section(html, id)) || [, ''])[1]);
// what the inspector prints for a block on the fixture: { title, now, kept, remove, after }
const NET = (cmd, args) => cmd === 'curl' && !args.includes('--socks5-hostname') ? '{"IsTor":false,"IP":"203.0.113.57"}' : '';
const told = (block) => { const out = []; inspect.main([block, '--json', '--profile', fx.DIR, '--cache', fx.CACHE], { print: (s) => out.push(s), run: block === 'tor' ? NET : undefined }); return JSON.parse(out[0]); };
const FIRST = ['cookies', 'cache', 'storage', 'tor'];
const history = { days: { '2026-11-12': { cookies: 2, google: 1, cache: 1 }, '2026-11-10': { cookies: 5, storage: 2 }, '2026-10-20': { google: 1, cache: 1 } },
  cookies: { 'google.com NID': { first: new Date(2026, 9, 20, 9).getTime(), last: NOW - 60e3, n: 30 }, 'example.com _ga': { first: NOW - 2 * 86400e3, last: NOW - 3600e3, n: 7 } } };

test('each of the first four blocks has its title in everyday words, the three lines in order and one "what happens" line', () => {
  const html = renderHistoryPage(state());
  for (const id of FIRST) { const s = section(html, id), t = told(id);
    assert.ok(s.includes(`<h2>${t.title.replace(/'/g, '&#39;')}</h2>`), id);
    assert.equal(count(s, '<b>There now:</b>'), 1, id); assert.equal(count(s, '<b>What happens if you clean this:</b>'), 1, id);
    assert.equal(line(html, id, 'What happens if you clean this:'), t.after, id);
    const at = ['There now:', 'Kept:', 'Removed:', 'What happens if you clean this:'].map((l) => s.indexOf(`<b>${l}</b>`));
    if (id === 'tor') assert.deepEqual([at[1], at[2]], [-1, -1]);   // nothing is stored, kept or removed there, as in the command
    else assert.deepEqual(at, [...at].sort((a, b) => a - b).filter((i) => i > 0), id); }
  assert.deepEqual([...html.matchAll(/<section id="([^"]+)">/g)].map((m) => m[1]), ['cookies', 'cache', 'code-cache', 'storage', 'servers', 'permissions', 'blocking', 'tor', 'wifi']);
});
test('cookies: the same answers in the same words as the command gives for the same cookies', () => {
  const html = renderHistoryPage(state()), t = told('cookies');
  assert.equal(line(html, 'cookies', 'There now:'), t.now); assert.equal(t.now, '5 cookies from 3 sites');
  assert.equal(line(html, 'cookies', 'Kept:'), t.kept);
  assert.equal(line(html, 'cookies', 'Removed:'), `none in the last 30 days. Still there and would be removed: ${t.remove}`);
  for (const [heading, rows] of t.lists) assert.ok(text(section(html, 'cookies')).includes(`${heading.replace('Would be removed:', 'Still there:')} (${rows.length})${rows.map((r) => r.replace('  ', ' · ')).join('')}`), heading);
});
test('cookies: what you allowed and the sites you switched off are kept, each with its reason', () => {
  const html = renderHistoryPage(state({ allow: [{ site: 'example.com', name: '_ga' }], sitesOff: ['doubleclick.net'] }));
  assert.equal(line(html, 'cookies', 'Kept:'), '4 (1 that keeps you signed in, 1 that is on no tracker list, 1 that you allowed, 1 on a site you told it not to clean)');
  assert.equal(line(html, 'cookies', 'Removed:'), 'none in the last 30 days. Still there and would be removed: 1 (1 that Google uses to recognise you)');
  const t = text(section(html, 'cookies'));
  assert.ok(t.includes('Kept: you allowed it (1)example.com · _ga')); assert.ok(t.includes('Kept: on a site you told it not to clean (1)doubleclick.net · id'));
  assert.equal(line(renderHistoryPage(state({ cookies: [] })), 'cookies', 'There now:'), 'no cookies');
  assert.equal(line(renderHistoryPage(state({ cookies: null })), 'cookies', 'There now:'), 'Chrome did not say which cookies it has.');
});
test('what was removed and when: today, the last 30 days, per day, and the cookies removed most often', () => {
  const html = renderHistoryPage(state({ history })), t = text(section(html, 'cookies'));
  assert.ok(line(html, 'cookies', 'Removed:').startsWith('3 today, 9 in the last 30 days. Still there'));
  assert.ok(t.includes('Removed, day by day (3)12 Nov 2026: 310 Nov 2026: 520 Oct 2026: 1'), t);
  assert.ok(t.includes('Removed most often (2)google.com · NID: 30 times, first on 20 Oct 2026, last on 12 Nov 2026example.com · _ga: 7 times, first on 10 Nov 2026, last on 12 Nov 2026'), t);
  assert.equal(line(html, 'storage', 'Removed:'), 'none today, 2 in the last 30 days');
  assert.equal(line(html, 'cache', 'Removed:'), 'cleared on 2 days in the last 30 days, the last time on 12 Nov 2026');
});
test('cookies: the notice for a cookie its site keeps putting back', () => {
  const one = renderHistoryPage(state({}, { google: { pending: 1, looping: 1 } })), two = renderHistoryPage(state({}, { google: { looping: 1 }, cookies: { looping: 2 } }));
  assert.ok(section(one, 'cookies').includes('<p>1 cookie is no longer removed automatically: its site keeps putting it back, so it waits for you in the popup.</p>'));
  assert.ok(section(two, 'cookies').includes('<p>3 cookies are no longer removed automatically: their sites keep putting them back, so they wait for you in the popup.</p>'));
  assert.equal(renderHistoryPage(state()).includes('putting'), false);
});
test('saved copies of pages: what the extension cannot see it says so, and when the next clearing is due', () => {
  const at = (o) => renderHistoryPage(state({}, { cache: o }));
  assert.equal(line(at({}), 'cache', 'There now:'), 'Chrome does not tell an extension how much it has saved. The command below shows the size and the number of files.');
  assert.equal(line(at({}), 'cache', 'Kept:'), 'none (the copies are cleared all together, not site by site)');
  assert.equal(line(at({ nextAt: NOW + 3600e3 }), 'cache', 'Removed:'), 'not cleared in the last 30 days; offered again today at 15:05');
  assert.equal(line(at({ mode: 'auto', nextAt: NOW + 20 * 3600e3 }), 'cache', 'Removed:'), 'not cleared in the last 30 days; cleared again tomorrow at 10:05');
  assert.equal(line(at({ pending: 1 }), 'cache', 'Removed:'), 'not cleared in the last 30 days; clearing waits for you in the popup');
  assert.equal(line(at({ mode: 'off', nextAt: NOW + 3600e3 }), 'cache', 'Removed:'), 'not cleared in the last 30 days; clearing is switched off');
});
test('site storage: says what it cannot see, what is kept and how many wait', () => {
  const html = renderHistoryPage(state({ history }, { storage: { pending: 2 } }));
  assert.equal(line(html, 'storage', 'There now:'), 'Chrome does not tell an extension which sites keep data. The command below lists them.');
  assert.equal(line(html, 'storage', 'Kept:'), 'everything, unless you drop a site yourself or put it on your always-drop list');
  assert.equal(line(html, 'storage', 'Removed:'), 'none today, 2 in the last 30 days; 2 wait for you in the popup');
});
test('Tor: what Chrome is set to, a button for the check that says where the request goes, and each answer in its own sentence', () => {
  const tor = (o) => section(renderHistoryPage(state(o)), 'tor'), now = (o) => line(renderHistoryPage(state(o)), 'tor', 'There now:');
  const BUTTON = '<p><button data-act="tor">Check how websites see me</button> <span class="m">Pressing it sends one request to check.torproject.org, a site of the Tor Project. Nothing is sent before you press it.</span></p>';
  assert.equal(now({}), 'Chrome is not set to use Tor.'); assert.equal(now({ proxy: 'tor' }), 'Chrome is set to use Tor.');
  assert.equal(now({ proxy: 'other' }), 'Chrome is set to use another go-between (proxy), not Tor.'); assert.equal(now({ proxy: undefined }), 'Whether Chrome is set to use Tor could not be read.');
  assert.ok(tor({}).includes(BUTTON)); assert.equal(tor({}).includes('Websites see you'), false);
  assert.ok(tor({ tor: { checking: true } }).includes('<p>Asking check.torproject.org…</p>'));
  assert.ok(tor({ tor: { ip: '185.220.101.4', isTor: true }, proxy: 'tor' }).includes('<p>Websites see you as 185.220.101.4. This is Tor.</p>'));
  assert.ok(tor({ tor: { ip: '203.0.113.57', isTor: false } }).includes('<p>Websites see you as 203.0.113.57. This is not Tor: it is your own address, or that of your VPN.</p>'));
  assert.ok(tor({ tor: { ip: '203.0.113.57', isTor: false }, proxy: 'tor' }).includes('This is not Tor: it is your own address, or that of your VPN. Chrome is set to use Tor, so something is wrong.</p>'));
  assert.ok(tor({ tor: { failed: true }, proxy: 'tor' }).includes('<p class="bad">There was no answer. Chrome is set to use Tor, so Tor is probably not running, and pages will not load until it runs or you switch Tor off.</p>'));
  assert.ok(tor({ tor: { failed: true } }).includes('<p>There was no answer from check.torproject.org.</p>'));
  for (const t of [{ ip: '1.2.3.4', isTor: false }, { failed: true }]) assert.ok(tor({ tor: t }).includes(BUTTON), 'the check can be repeated');
});
test('lists are inside collapsed sections; numbers come first', () => {
  const html = renderHistoryPage(state({ history }));
  assert.equal(/<details[^>]* open/.test(html), false); assert.ok(count(html, '<details>') >= 7);
  const outside = html.replace(/<details>.*?<\/details>/gs, '');
  for (const s of ['_ga', 'NID', 'SID', 'doubleclick', '10 Nov 2026', 'class="c"']) assert.equal(outside.includes(s), false, s);
  assert.equal(count(html, '<summary>'), count(html, '<details>'));
  for (const m of html.matchAll(/<summary>([^<]*)<\/summary>/g)) assert.match(m[1], / \(\d+\)$/);
  assert.equal(html.includes('<summary>Kept: you allowed it'), false, 'an empty list is left out');
});
test('hostile strings are escaped', () => {
  const evil = '<img src=x onerror=alert(1)>"\'&', html = renderHistoryPage(state({ cookies: [{ domain: evil, name: evil }, { domain: '.doubleclick.net', name: evil }],
    allow: [{ site: evil, name: evil }], sitesOff: [evil], tor: { ip: evil, isTor: false },
    history: { days: { '2026-11-12': { cookies: 1, [evil]: 4 }, [evil]: { cookies: 2 } }, cookies: { [`${evil} ${evil}`]: { first: NOW, last: NOW, n: 1 } } } }, { cookies: { title: evil, items: [{ site: evil, name: evil }] } }));
  assert.equal(html.includes('<img'), false); assert.equal(/onerror=alert\(1\)>"/.test(html), false);
  assert.ok(count(html, '&lt;img src=x onerror=alert(1)&gt;&quot;&#39;&amp;') >= 5);
});
test('no code from the plan and no word "pending" appears, whatever the state', () => {
  for (const html of [renderHistoryPage(state()), renderHistoryPage(state({ history, tor: { failed: true }, proxy: 'tor' }, { cookies: { pending: 3, looping: 1 }, cache: { pending: 1 }, storage: { pending: 2 } })), renderHistoryPage({})]) {
    assert.equal(/\b[BCT]\d\d?\b/.test(text(html)), false); assert.equal(/pending/i.test(html), false); assert.equal(/undefined|NaN|\[object/.test(html), false); }
});
test('each copy button carries exactly the command for its block: run as printed, it answers under the same title', () => {
  const html = renderHistoryPage(state());
  assert.ok(inspect.main([], { print: (s) => assert.ok(s.startsWith('Usage: node tools/inspect.js <what>')) }) === 2);
  for (const id of FIRST) { const s = section(html, id), cmd = `node tools/inspect.js ${id}`;
    assert.equal(count(s, '<button data-copy='), 1, id);
    assert.ok(s.includes(`<button data-copy="${cmd}">Copy command</button> <code>${cmd}</code>`), id);
    const out = []; assert.equal(inspect.main([...cmd.split(' ').slice(2), '--profile', fx.DIR, '--cache', fx.CACHE], { print: (x) => out.push(x), run: id === 'tor' ? NET : undefined }), 0);
    assert.equal(out[0].split('\n')[0], text((/<h2>(.*?)<\/h2>/.exec(s) || [])[1]), id); }
  assert.ok(text(html).includes('Each command reads Chrome\'s own files without the extension, so you can check what this page says. Paste it into a terminal opened in the Tracker Cleaner folder.'));
});
test('"Clear history" says how many days it clears, and what private means is said beside it', () => {
  const html = renderHistoryPage(state({ history }));
  assert.ok(html.includes('<button data-msg="{&quot;type&quot;:&quot;clearHistory&quot;}">Clear history (3 days)</button>'));
  assert.ok(renderHistoryPage(state({ history: { days: { '2026-11-12': { cookies: 1 } }, cookies: {} } })).includes('>Clear history (1 day)</button>'));
  const empty = renderHistoryPage(state());
  assert.equal(empty.includes('clearHistory'), false); assert.ok(empty.includes('Nothing has been removed yet, so there is no history.'));
  assert.ok(html.includes('What was removed is counted for 30 days: how many each day, and for each cookie its site, its name and how often. Never what a cookie contained. '
    + 'The history stays inside the extension on this computer: it is not synced, it is not sent anywhere, and websites cannot read it.'));
});
test('history.html: its own scripts only, nothing inline, and the page script asks Tor Project only inside the button\'s action', () => {
  const html = fs.readFileSync(path.join(EXT, 'history.html'), 'utf8'), js = fs.readFileSync(path.join(EXT, 'history-page.js'), 'utf8');
  assert.deepEqual([...html.matchAll(/<script[^>]*>/g)].map((m) => m[0]), ['lists.js', 'core.js', 'history.js', 'history-view.js', 'history-page.js'].map((f) => `<script src="${f}">`));
  assert.equal(/\son\w+=/.test(html), false); assert.equal(/https?:\/\//.test(html), false);
  assert.equal(count(js, 'https://'), 1); assert.equal(count(js, "'https://check.torproject.org/api/ip'"), 1);
  assert.equal(count(js, 'fetch('), 1); assert.equal(count(js, 'checkTor('), 2, 'defined once, called once: from the click');
  assert.match(js, /if \(b\.dataset\.act === 'tor'\) return checkTor\(\);/);
  for (const bad of ['.value', 'localStorage', 'storage.sync', 'innerHTML +=']) assert.equal(js.includes(bad), false, bad);
});

// ---- the remaining blocks: those the real-Chrome run (test/browser/run.js, V1 to V6) found worth showing
const REST = ['code-cache', 'servers', 'permissions', 'wifi'];
const WIFI = (cmd) => cmd === 'nmcli' ? `Home:${fx.U(1)}:802-11-wireless:1799999940:yes\n` : NET(cmd, []);
test('the remaining blocks: title and "what happens" as the command says them, three lines, and the command to copy', () => {
  const html = renderHistoryPage(state());
  for (const id of REST) { const s = section(html, id), out = [];
    inspect.main([id, '--json', '--profile', fx.DIR, '--cache', fx.CACHE], { print: (x) => out.push(x), run: WIFI, now: 1.8e12 }); const t = JSON.parse(out[0]);
    assert.ok(s.includes(`<h2>${t.title}</h2>`), id); assert.equal(line(html, id, 'What happens if you clean this:'), t.after, id);
    for (const l of ['There now:', 'Kept:', 'Removed:', 'What happens if you clean this:']) assert.equal(count(s, `<b>${l}</b>`), 1, `${id} ${l}`);
    assert.ok(s.includes(`<button data-copy="node tools/inspect.js ${id}">Copy command</button> <code>node tools/inspect.js ${id}</code>`), id); }
  const s = section(html, 'blocking');   // exists only inside Chrome: no command
  assert.equal(count(s, '<b>There now:</b>'), 1); assert.equal(count(s, '<b>What happens if you clean this:</b>'), 1);
  assert.equal(s.includes('<b>Kept:</b>') || s.includes('data-copy'), false);
  assert.equal(html.includes('quota'), false, 'what a site is told about room is a fixed 10 GB (V3): nothing to show');
  assert.equal(count(html, 'Copy command'), 8);
});
test('code cache and remembered servers: emptied together with the saved copies of pages, and say when that last happened', () => {
  const html = renderHistoryPage(state({ history }, { cache: { nextAt: NOW + 3600e3 } }));
  for (const id of ['code-cache', 'servers']) { assert.equal(line(html, id, 'Removed:'), line(html, 'cache', 'Removed:'), id);
    assert.ok(line(html, id, 'Kept:').startsWith('none ('), id); }
  assert.equal(line(html, 'cache', 'Removed:'), 'cleared on 2 days in the last 30 days, the last time on 12 Nov 2026; offered again today at 15:05');
  assert.equal(line(html, 'code-cache', 'There now:'), 'Chrome does not tell an extension how much this is. The command below shows the size and the number of files.');
  assert.equal(line(html, 'code-cache', 'Kept:'), 'none (it is emptied together with the saved copies of pages)');
  assert.equal(line(html, 'servers', 'There now:'), 'Chrome does not tell an extension which servers it remembers. The command below counts them.');
  assert.equal(line(html, 'servers', 'Kept:'), 'none (both lists are emptied together with the saved copies of pages)');
});
test('permissions and Wi-Fi: what waits, what was removed, and what the helper said', () => {
  const h = { days: { '2026-11-12': { permissions: 1, wifi: 2 } }, cookies: {} }, at = (over, o = {}) => renderHistoryPage(state({ history: h, ...o }, over));
  let html = at({ permissions: { pending: 1 }, wifi: { pending: 3, helper: 'ok', canDelete: 'yes' } });
  assert.equal(line(html, 'permissions', 'There now:'), 'Chrome does not give an extension the list of what sites may do. The command below lists it.');
  assert.equal(line(html, 'permissions', 'Kept:'), 'all of them, unless you put one on your always-block list');
  assert.equal(line(html, 'permissions', 'Removed:'), '1 today, 1 in the last 30 days; 1 waits for you in the popup');
  assert.equal(line(html, 'wifi', 'There now:'), '3 remembered networks that were not used for 30 days or more, or never');
  assert.equal(line(html, 'wifi', 'Kept:'), 'every network in use now or used in the last 30 days');
  assert.equal(line(html, 'wifi', 'Removed:'), '2 today, 2 in the last 30 days; 3 wait for you in the popup');
  assert.equal(line(at({ wifi: { pending: 1, helper: 'ok' } }), 'wifi', 'There now:'), '1 remembered network that was not used for 30 days or more, or never');
  assert.equal(line(at({ wifi: { helper: 'ok' } }), 'wifi', 'There now:'), 'no remembered network that was not used for 30 days or more, or never');
  assert.equal(line(at({ wifi: { helper: 'missing' } }), 'wifi', 'There now:'), 'Chrome cannot see Wi-Fi networks, and the helper program that can is not installed. The command below lists them.');
  assert.equal(line(at({ wifi: { mode: 'off' } }), 'wifi', 'There now:'), 'This is switched off, so the extension has not looked. The command below lists them.');
});
test('blocked requests: the count Chrome still remembers, by site in a collapsed list, and why there is no history of it', () => {
  const blocked = [{ site: 'news.example', n: 12 }, { site: '', n: 3 }, { site: '<b>x', n: 1 }], html = renderHistoryPage(state({ blocked })), s = section(html, 'blocking');
  assert.ok(s.includes('<h2>Requests to trackers stopped before they leave (request blocking)</h2>'));
  assert.equal(line(html, 'blocking', 'There now:'), '16 requests stopped in the tabs that are open and those closed in the last few minutes. Chrome remembers no more than that, so there is no count per day.');
  assert.ok(text(s).includes('By site (3)news.example: 12a tab closed since: 3&lt;b&gt;x: 1')); assert.equal(s.includes('<b>x'), false);
  assert.equal(line(renderHistoryPage(state({ blocked: [{ site: 'a.test', n: 1 }] })), 'blocking', 'There now:').startsWith('1 request stopped in the tabs'), true);
  assert.equal(line(renderHistoryPage(state({ blocked: [] })), 'blocking', 'There now:').startsWith('no requests stopped in the tabs'), true);
  assert.equal(line(renderHistoryPage(state()), 'blocking', 'There now:'), 'Chrome did not say how many requests it stopped.');
  assert.equal(line(html, 'blocking', 'What happens if you clean this:'), 'Nothing is cleaned here: these requests never leave your computer. A page that needs one may show a gap; "Don\'t clean on this site" in the popup lets them through.');
});
