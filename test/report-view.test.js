// The report (1.23): buildReport(state, tab) on hand-built states and renderReport(report), with the exact sentences.
// No browser, no chrome.
const test = require('node:test'), assert = require('node:assert');
const { buildReport, renderReport } = require('../extension/report-view.js'), { GROUPS } = require('../extension/registry.js');
const NOW = new Date(2026, 10, 15, 14, 5).getTime();   // 15 Nov 2026, 14:05 local
const MODE = { signin: 'auto', blocking: 'auto', cookies: 'auto', google: 'ask', params: 'auto', unknown: 'ask', storage: 'ask', wifi: 'ask', permissions: 'ask', cache: 'ask', allowlist: 'off', tabs: 'off', tor: 'off', server: 'off' };
const NO_ASK = ['signin', 'blocking', 'params', 'server'];
const groups = (over = {}) => GROUPS.map((g) => ({ id: g.id, title: g.title, says: g.says, ask: !NO_ASK.includes(g.id), mode: MODE[g.id], pending: 0, items: [], ...over[g.id] }));
const state = (o = {}, over = {}) => ({ now: NOW, master: true, hold: {}, groups: groups(over), allow: [], always: [], sitesOff: [], history: { days: {}, cookies: {} }, ...o });
const tab = (o = {}) => ({ id: 7, host: 'www.example.com', matched: [], ...o });
const row = (r, id) => r.features.find((f) => f.id === id);
const text = (html) => html.replace(/<[^>]+>/g, '').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"');

// ---- step 1: feature rows
const SAYS = {
  signin: 'While you sign in somewhere, and for five minutes after, nothing is cleaned so the sign-in cannot break.',
  blocking: 'Pages are stopped from calling the companies that follow you from site to site, and YouTube plays without its ads.',
  cookies: 'Small files that trackers save to recognise you are deleted, while the ones that keep you signed in stay.',
  google: 'Small files that Google and YouTube save to recognise you when you are not signed in are deleted, while the ones that keep you signed in stay.',
  params: 'The extra letters that advertisers add to a link to see where you came from are cut off before the page opens.',
  unknown: 'A company that turns up on three different sites you visit, each time able to recognise you, is stopped from following you and its cookies are deleted.',
  storage: 'Other things a site has saved in your browser are emptied, but only for the sites you chose yourself.',
  wifi: 'Wi-Fi networks this computer remembers but has not used for 30 days are forgotten.',
  permissions: 'Sites you chose yourself are stopped from doing things such as sending notifications or using the camera.',
  cache: 'The copies of pages that Chrome saves to load them faster are thrown away once a day.',
  allowlist: 'Every small file that sites save to recognise you is deleted, except the ones on your own list.',
  tabs: 'When more tabs are open than the number you set, the ones you used least are closed.',
  tor: 'Chrome reaches websites through the Tor network, so they cannot see where you are.',
  server: 'A summary of what was cleaned is sent to a program on this computer, and nowhere else.' };

test('every group has one plain sentence, and the row carries it with the title', () => {
  assert.deepEqual(Object.fromEntries(GROUPS.map((g) => [g.id, g.says])), SAYS);
  const r = buildReport(state(), tab());
  assert.equal(r.site, 'www.example.com');
  assert.deepEqual(r.features.map((f) => f.id), GROUPS.map((g) => g.id));
  for (const f of r.features) { assert.equal(f.says, SAYS[f.id]); assert.equal(f.title, GROUPS.find((g) => g.id === f.id).title); }
});
test('blocked: the matches of the two blocking rule files on this tab; cleaned links: the matches of the link rule', () => {
  const r = buildReport(state(), tab({ matched: ['trackers', 'google-paths', 'trackers', 'url-params', '_dynamic'] }));
  assert.equal(row(r, 'blocking').count, '3 blocked on this page');
  assert.equal(row(r, 'params').count, '1 link cleaned on this page');
  assert.equal(row(buildReport(state(), tab({ matched: ['url-params', 'url-params'] })), 'params').count, '2 links cleaned on this page');
});
test('a row with nothing says 0, never an empty cell', () => {
  const r = buildReport(state(), tab());
  assert.equal(row(r, 'blocking').count, '0 blocked on this page');
  assert.equal(row(r, 'params').count, '0 links cleaned on this page');
  assert.equal(row(r, 'cookies').count, '0 deleted on this site today, 0 deleted today on all sites, 0 waiting');
  assert.equal(row(r, 'tabs').count, '0 closed today, 0 waiting');
  const html = renderReport(r);
  assert.ok(html.includes('0 blocked on this page')); assert.ok(html.includes('0 deleted on this site today, 0 deleted today on all sites, 0 waiting'));
});
test('Chrome did not say what it blocked (it limits how often it may be asked): the row says so', () => {
  // seen in a real Chrome: after 20 questions in 10 minutes it refuses, but not a question that follows a press of the user
  let r = buildReport(state(), tab({ matched: null }));
  assert.equal(row(r, 'blocking').count, 'Chrome did not say how many it blocked; press "Read again" to ask it');
  assert.equal(row(r, 'params').count, 'Chrome did not say how many links it cleaned; press "Read again" to ask it');
  r = buildReport(state(), null);                                   // nothing to ask about
  assert.equal(row(r, 'blocking').count, 'this tab is not a web page'); assert.equal(row(r, 'params').count, 'this tab is not a web page');
});
test('deleted today on all sites comes from the history, waiting from the queue, each with the word that fits the group', () => {
  const history = { days: { '2026-11-15': { cookies: 4, google: 1, tabs: 2, cache: 1, permissions: 3, wifi: 1 }, '2026-11-14': { cookies: 9, storage: 5 } }, cookies: {} };
  const r = buildReport(state({ history }, { google: { pending: 1 }, cookies: { pending: 12 }, wifi: { pending: 2 } }), null);   // no web page in front: no site to count for
  assert.equal(row(r, 'cookies').count, '4 deleted today on all sites, 12 waiting');
  assert.equal(row(r, 'google').count, '1 deleted today on all sites, 1 waiting');
  assert.equal(row(r, 'storage').count, '0 emptied today, 0 waiting');
  assert.equal(row(r, 'allowlist').count, '0 deleted today on all sites, 0 waiting');
  assert.equal(row(r, 'tabs').count, '2 closed today, 0 waiting');
  assert.equal(row(r, 'cache').count, '1 cleared today, 0 waiting');
  assert.equal(row(r, 'permissions').count, '3 blocked today, 0 waiting');
  assert.equal(row(r, 'wifi').count, '1 forgotten today, 2 waiting');
  for (const id of ['signin', 'tor', 'server']) assert.equal(row(r, id).count, '', id);   // nothing to count
});
test('deleted on this site today: from the per-cookie counters, for this site and the sites above and below it, per group', () => {
  const at = (h) => new Date(2026, 10, 15, h).getTime(), c = (last, d, g, n = d) => ({ first: last, last, n, d, g });
  const history = { days: { '2026-11-15': { cookies: 9, google: 2, storage: 1 } }, cookies: {
    'example.com _ga': c(at(9), 3, 'cookies', 40), 'www.example.com _gid': c(at(13), 2, 'cookies'), 'shop.example.com x': c(at(8), 1, 'cookies'), 'other.test _ga': c(at(10), 4, 'cookies'),
    'example.com old': c(at(9) - 86400e3, 7, 'cookies'),        // last deleted yesterday: nothing today
    'example.com before': { first: at(9), last: at(9), n: 2 },  // written before the counters told the day: not counted
    'google.com NID': c(at(11), 2, 'google'), 'example.com theme': c(at(12), 1, 'storage') } };
  const count = (host, id) => row(buildReport(state({ history }), tab({ host })), id).count;
  assert.equal(count('www.example.com', 'cookies'), '5 deleted on this site today, 9 deleted today on all sites, 0 waiting');
  assert.equal(count('example.com', 'cookies'), '6 deleted on this site today, 9 deleted today on all sites, 0 waiting');
  assert.equal(count('www.example.com', 'google'), '0 deleted on this site today, 2 deleted today on all sites, 0 waiting');
  assert.equal(count('www.google.com', 'google'), '2 deleted on this site today, 2 deleted today on all sites, 0 waiting');
  assert.equal(count('www.example.com', 'allowlist'), '0 deleted on this site today, 0 deleted today on all sites, 0 waiting');
  assert.equal(count('www.example.com', 'storage'), '1 emptied today, 0 waiting');   // not only cookies: counted for all sites
});
test('state words: on, asks first, off, paused, held while you sign in', () => {
  const words = (s) => Object.fromEntries(buildReport(s, tab()).features.map((f) => [f.id, f.state]));
  let w = words(state());
  assert.deepEqual([w.signin, w.blocking, w.cookies, w.google, w.params, w.tabs], ['on', 'on', 'on', 'asks first', 'on', 'off']);
  w = words(state({ master: false }));
  assert.deepEqual([...new Set(Object.values(w))], ['off']);
  w = words(state({ hold: { paused: true, pauseUntil: NOW + 6e5 } }));
  assert.deepEqual([w.blocking, w.cookies, w.google, w.tabs], ['paused', 'paused', 'paused', 'off']);
  // a sign-in is going on: what deletes by itself is held; what only asks still asks, what deletes nothing goes on
  w = words(state({ hold: { guard: true } }));
  assert.deepEqual([w.signin, w.blocking, w.cookies, w.google, w.params], ['on', 'on', 'held while you sign in', 'asks first', 'on']);
  // nothing chosen yet (a fresh install): nothing is deleted without asking
  w = words(state({ master: undefined }));
  assert.deepEqual([w.blocking, w.cookies, w.google], ['on', 'asks first', 'asks first']);
  // stored modes the group cannot have: a group with nothing to ask about is off, Wi-Fi never runs by itself
  w = words(state({}, { blocking: { mode: 'ask' }, wifi: { mode: 'auto', noAuto: true } }));
  assert.deepEqual([w.blocking, w.wifi], ['off', 'asks first']);
});
test('rendered: a heading, then per row the title, the state word, the count and the sentence; no capability code; hostile text escaped', () => {
  const html = renderReport(buildReport(state({}, { cookies: { title: '<img src=x>', says: '"><script>' } }), tab({ host: '<b>x' })));
  assert.match(html, /<h2>What Tracker Cleaner does for you<\/h2>/);
  const t = text(html);
  assert.ok(t.includes('Ads and trackers blocked as pages load' + 'on · 0 blocked on this page' + SAYS.blocking));
  assert.ok(t.includes('Pause cleaning while you sign in' + 'on' + SAYS.signin));
  assert.doesNotMatch(html, /\bC\d\d\b/); assert.doesNotMatch(html, /<img|<script|<b>x/);
});

// ---- step 2: cookie rows
const EXP = new Date(2027, 10, 20, 12).getTime() / 1000;   // 20 Nov 2027, midday local
const ck = (name, domain, o = {}) => ({ name, domain, value: 'v-' + name, session: false, expirationDate: EXP, ...o });
const what = (r, name) => r.cookies.rows.find((c) => c.name === name).what;
test('a cookie row: site, name, the start of what it holds, how long it stays', () => {
  const r = buildReport(state(), tab({ cookies: [ck('theme', '.example.com', { value: 'abcdefghijklmnopqrstuvwxyz0123456789' }), ck('lang', 'www.example.com', { value: 'en', session: true, expirationDate: undefined })] }));
  assert.equal(r.cookies.n, 2);
  assert.deepEqual(r.cookies.rows[0], { site: 'example.com', name: 'theme', value: 'abcdefghijklmnopqrstuvwx', long: true, expires: 'until 20 Nov 2027', what: 'on no tracker list, kept', signin: false, tracker: false, mine: '' });
  assert.deepEqual([r.cookies.rows[1].value, r.cookies.rows[1].long, r.cookies.rows[1].expires], ['en', false, 'until you close Chrome']);
  // the background script has cut it already and says so
  assert.equal(buildReport(state(), tab({ cookies: [ck('a', 'example.com', { value: 'x'.repeat(24), long: true })] })).cookies.rows[0].long, true);
});
test('every kind of cookie says what it is and what happens to it', () => {
  const cookies = [ck('SID', '.google.com'), ck('_ga', '.google.com'), ck('x', '.ads.doubleclick.net'), ck('NID', '.google.com'), ck('theme', '.google.com')];
  const r = buildReport(state(), tab({ host: 'www.google.com', cookies }));
  assert.equal(what(r, 'SID'), 'keeps you signed in, kept');
  assert.equal(what(r, '_ga'), "has a tracker's name, deleted automatically");
  assert.equal(what(r, 'x'), "comes from a tracker's site, deleted automatically");
  assert.equal(what(r, 'NID'), 'Google uses it to recognise you, deleted only after you say so');
  assert.equal(what(r, 'theme'), 'on no tracker list, kept');
  assert.deepEqual(r.cookies.rows.map((c) => c.signin), [true, false, false, false, false]);
});
test('a cookie that keeps you signed in and sits on a tracker\'s site says kept, and why', () => {
  const r = buildReport(state(), tab({ host: 'x.test', cookies: [ck('SID', '.doubleclick.net')] }));
  assert.equal(what(r, 'SID'), "keeps you signed in, kept even though it comes from a tracker's site");
});
test('what happens follows the switches: asks first, off, paused, a sign-in going on', () => {
  const c = [ck('_ga', '.example.com'), ck('NID', '.google.com')], w = (s) => what(buildReport(s, tab({ cookies: c })), '_ga');
  assert.equal(w(state({}, { cookies: { mode: 'ask' } })), "has a tracker's name, deleted only after you say so");
  assert.equal(w(state({}, { cookies: { mode: 'off' } })), "has a tracker's name, kept because this cleaning is switched off");
  assert.equal(w(state({ master: false })), "has a tracker's name, kept because this cleaning is switched off");
  assert.equal(w(state({ hold: { paused: true } })), "has a tracker's name, kept while cleaning is paused");
  assert.equal(w(state({ hold: { guard: true } })), "has a tracker's name, kept while you sign in");
  assert.equal(what(buildReport(state({}, { google: { mode: 'auto' } }), tab({ cookies: c })), 'NID'), 'Google uses it to recognise you, deleted automatically');
});
test('the user\'s own exceptions are said: Keep, a site not to clean, and being on the tracker\'s own site', () => {
  const c = [ck('_ga', '.example.com'), ck('_gid', '.example.com')];
  assert.equal(what(buildReport(state({ allow: [{ site: 'example.com', name: '_ga' }] }), tab({ cookies: c })), '_ga'), "has a tracker's name, kept because you chose Keep");
  const off = buildReport(state({ sitesOff: ['example.com'] }), tab({ cookies: c }));
  assert.equal(what(off, '_gid'), "has a tracker's name, kept because you told it not to clean this site");
  // mixpanel.com is on the tracker list and is also a product people use: its cookies stay while a tab is on it
  const own = buildReport(state(), tab({ host: 'app.mixpanel.com', cookies: [ck('session', '.mixpanel.com')] }));
  assert.equal(what(own, 'session'), "comes from a tracker's site, kept while you are on that site");
});
test('rendered: the number first, the rows collapsed, where they are kept, the command to check; hostile names and values escaped', () => {
  const bad = '<img src=x onerror=alert(1)>';
  const html = renderReport(buildReport(state(), tab({ cookies: [ck('"><script>x</script>', '.example.com', { value: bad }), ck('SID', '.example.com', { value: 'abcdefghijklmnopqrstuvwxyz0123456789' })] })));
  assert.match(html, /<h2>Small files this site has saved to recognise you \(cookies\)<\/h2>/);
  assert.ok(text(html).includes("2 cookies on www.example.com, read from Chrome just now. They are in Chrome's own cookie file on this computer. Only the start of what each one holds is shown here, and none of it is saved anywhere."));
  assert.match(html, /<details id="cookies"><summary>Show the 2 cookies<\/summary>/);
  assert.doesNotMatch(html, /<img|<script/); assert.ok(html.includes('&lt;img src=x onerror=alert'));
  assert.ok(html.includes('<code>abcdefghijklmnopqrstuvwx…</code>')); assert.equal(html.includes('yz0123456789'), false);
  assert.ok(text(html).includes('keeps you signed in, kept')); assert.ok(html.includes('until 20 Nov 2027'));
  assert.ok(html.includes('data-copy="node tools/inspect.js cookies --site www.example.com"'));
});
test('rendered: one cookie, none, Chrome did not say, and a tab that is not a web page', () => {
  const p = (t) => text(renderReport(buildReport(state(), t)));
  assert.ok(p(tab({ cookies: [ck('a', 'www.example.com', { value: '' })] })).includes('1 cookie on www.example.com, read from Chrome just now.'));
  assert.ok(renderReport(buildReport(state(), tab({ cookies: [ck('a', 'www.example.com', { value: '' })] }))).includes('<span class="m">holds nothing</span>'));
  assert.ok(p(tab({ cookies: [] })).includes('This site has saved no cookies.'));
  assert.ok(p(tab()).includes('Chrome did not say which cookies this site has.'));
  assert.ok(p(null).includes('This tab is not a web page, so there are no cookies to show.'));
  assert.equal(buildReport(state(), null).cookies, null);
});

// ---- step 3: cookie buttons
const unesc = (x) => x.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const buttons = (html) => [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, a, label]) => ({ label: unesc(label), disabled: / disabled/.test(a),
  act: (/data-act="([^"]*)"/.exec(a) || [])[1], msg: /data-msg="([^"]*)"/.test(a) ? JSON.parse(unesc(/data-msg="([^"]*)"/.exec(a)[1])) : undefined }));
const of = (html, name) => buttons(html).filter((b) => b.msg && b.msg.name === name).map((b) => b.label);
const LONG = 'abcdefghijklmnopqrstuvwxyz0123456789';
test('each cookie row has the buttons that make sense for it, each saying what it does', () => {
  const cookies = [ck('SID', '.example.com', { value: LONG }), ck('_ga', '.example.com'), ck('theme', 'www.example.com', { value: '' }), ck('_gid', '.example.com'), ck('old', '.example.com')];
  const html = renderReport(buildReport(state({ allow: [{ site: 'example.com', name: '_gid' }], always: [{ site: 'example.com', name: 'old' }] }), tab({ cookies })));
  assert.deepEqual(of(html, 'SID'), ['Delete (may sign you out)', 'Always delete', 'Show all of it', 'Copy what it holds']);   // kept already: no Keep
  assert.deepEqual(of(html, '_ga'), ['Delete', 'Keep', 'Always delete', 'Copy what it holds']);
  assert.deepEqual(of(html, 'theme'), ['Delete', 'Always delete']);                    // holds nothing: nothing to show or copy
  assert.deepEqual(of(html, '_gid'), ['Delete', 'Always delete', 'Copy what it holds']);   // the user chose Keep already
  assert.deepEqual(of(html, 'old'), ['Delete', 'Keep', 'Copy what it holds', 'Stop always deleting']);
  const b = buttons(html).filter((x) => x.msg && x.msg.name === '_ga');
  assert.deepEqual(b.map((x) => x.msg), [{ type: 'drop', kind: 'cookie', site: 'example.com', name: '_ga' }, { type: 'allow', site: 'example.com', name: '_ga' },
    { type: 'always', site: 'example.com', name: '_ga' }, { type: 'cookieValue', site: 'example.com', name: '_ga' }]);
  assert.deepEqual(b.map((x) => x.act), [undefined, undefined, undefined, 'copy']);
  assert.equal(buttons(html).find((x) => x.label === 'Show all of it').act, 'full');
});
test('a cookie on the always-delete list says so, and what happens follows that group\'s switch', () => {
  const s = (over) => state({ always: [{ site: 'example.com', name: 'theme' }, { site: 'example.com', name: 'SID' }] }, over), c = [ck('theme', '.example.com'), ck('SID', '.example.com')];
  let r = buildReport(s(), tab({ cookies: c }));
  assert.equal(what(r, 'theme'), 'on your always-delete list, deleted automatically');   // your own choice: it does not wait, though the group asks first
  assert.equal(what(r, 'SID'), 'on your always-delete list, deleted automatically');     // the list beats a sign-in name
  assert.deepEqual(r.cookies.rows.map((x) => x.mine), ['always', 'always']);
  r = buildReport(s({ storage: { mode: 'auto' } }), tab({ cookies: c }));
  assert.equal(what(r, 'theme'), 'on your always-delete list, deleted automatically');
  const w = (st) => what(buildReport(st, tab({ cookies: c })), 'theme'), mine = { always: [{ site: 'example.com', name: 'theme' }] };
  assert.equal(w(s({ storage: { mode: 'off' } })), 'on your always-delete list, kept because this cleaning is switched off');
  assert.equal(w(state({ ...mine, master: false })), 'on your always-delete list, kept because this cleaning is switched off');
  assert.equal(w(state({ ...mine, hold: { paused: true } })), 'on your always-delete list, kept while cleaning is paused');
  assert.equal(w(state({ ...mine, hold: { guard: true } })), 'on your always-delete list, kept while you sign in');
  assert.equal(w(state({ ...mine, master: undefined })), 'on your always-delete list, deleted only after you say so');   // cleaning was never turned on
});
test('"Delete all" has the number of what will go on the button; beside it, how many stay and why; one box to take those too', () => {
  const cookies = [ck('SID', '.example.com'), ck('HSID', '.example.com'), ck('_ga', '.example.com'), ck('theme', 'www.example.com'), ck('lang', 'www.example.com'), ck('_gid', '.example.com')];
  const draw = (list, o = {}) => renderReport(buildReport(state(o), tab({ cookies: list }))), kept = { allow: [{ site: 'example.com', name: '_gid' }] };
  let html = draw(cookies, kept);
  const all = buttons(html).find((b) => b.msg && b.msg.type === 'dropSite');
  assert.deepEqual([all.label, all.msg, all.disabled], ['Delete 3 cookies on this site', { type: 'dropSite', host: 'www.example.com' }, false]);
  assert.ok(text(html).includes('3 stay: 2 keep you signed in, 1 you chose to keep'));
  assert.ok(html.includes(' data-some="Delete 3 cookies on this site" data-all="Delete 6 cookies on this site"'));   // the page puts the right number on the button when the box is ticked
  assert.ok(html.includes('<label><input type="checkbox" data-also="kept"> also the ones that keep me signed in and the ones I chose to keep</label>'));
  html = draw(cookies.slice(0, 5));                                  // sign-ins only
  assert.ok(text(html).includes('2 stay: 2 keep you signed in')); assert.ok(html.includes('data-also="kept"> also the 2 that keep me signed in</label>'));
  html = draw(cookies.slice(1, 3));
  assert.ok(buttons(html).some((b) => b.label === 'Delete 1 cookie on this site'));
  assert.ok(text(html).includes('1 stays: 1 keeps you signed in')); assert.ok(html.includes('also the 1 that keeps me signed in'));
  html = draw(cookies.slice(2), kept);                               // a cookie you chose to keep only
  assert.ok(buttons(html).some((b) => b.label === 'Delete 3 cookies on this site'));
  assert.ok(text(html).includes('1 stays: 1 you chose to keep')); assert.ok(html.includes('data-also="kept"> also the 1 I chose to keep</label>'));
  html = draw(cookies.slice(2, 5));                                  // nothing stays: no line, no box
  assert.equal(html.includes('data-also'), false); assert.equal(/\d stays?:/.test(text(html)), false);
  // a sign-in cookie you put on your always-delete list is not one that stays
  html = draw(cookies.slice(0, 3), { always: [{ site: 'example.com', name: 'SID' }] });
  assert.ok(buttons(html).some((b) => b.label === 'Delete 2 cookies on this site')); assert.ok(text(html).includes('1 stays: 1 keeps you signed in'));
});
test('while cleaning is paused or switched off the deleting buttons are greyed out, with one sentence why', () => {
  const cookies = [ck('_ga', '.example.com', { value: LONG })];
  for (const [o, why] of [[{ hold: { paused: true } }, 'Cleaning is paused, so nothing can be deleted from here right now.'], [{ master: false }, 'Cleaning is switched off, so nothing can be deleted from here right now.']]) {
    const html = renderReport(buildReport(state(o), tab({ cookies })));
    assert.ok(text(html).includes(why));
    assert.deepEqual(buttons(html).filter((b) => b.disabled).map((b) => b.label), ['Clear the saved copies of pages', 'Delete 1 cookie on this site', 'Delete', 'Always delete']);
  }
  assert.equal(buttons(renderReport(buildReport(state(), tab({ cookies })))).some((b) => b.disabled), false);
});
test('what is on the always-delete list for this site is listed, also when the cookie is gone, with the way back', () => {
  const s = state({ always: [{ site: 'example.com', name: 'theme' }, { site: 'shop.example.com', name: '<i>' }, { site: 'other.test', name: 'x' }] });
  const r = buildReport(s, tab({ host: 'example.com', cookies: [] }));
  assert.deepEqual(r.always, [{ site: 'example.com', name: 'theme' }, { site: 'shop.example.com', name: '<i>' }]);
  const html = renderReport(r);
  assert.match(html, /<details id="always"><summary>Always deleted on this site \(2\)<\/summary>/); assert.doesNotMatch(html, /<i>/);
  assert.deepEqual(buttons(html).filter((b) => b.label === 'Stop always deleting').map((b) => b.msg)[0], { type: 'always', site: 'example.com', name: 'theme', on: false });
  assert.equal(renderReport(buildReport(state(), tab({ cookies: [] }))).includes('id="always"'), false);
});
test('deleting from a terminal is not offered, and the report says why', () => {
  const html = renderReport(buildReport(state(), tab({ cookies: [ck('a', 'www.example.com')] })));
  assert.ok(text(html).includes("Deleting them from a terminal is not offered: Chrome's cookie file cannot be changed safely while Chrome is running. Use the buttons here."));
});

// ---- step 4: the other kinds of things a page saves
const KINDS = [
  ['local', 'Notes a site keeps in your browser (local storage)', 'A site can write things down in your browser and read them again at every visit, such as your settings or a number to recognise you. They stay until someone deletes them.',
    "In Chrome's own folder on this computer, in the part called Local Storage."],
  ['session', 'Notes a site keeps for one tab (session storage)', 'The same kind of notes, but for one tab only. They are gone when you close the tab.',
    "In Chrome's own folder on this computer, in the part called Session Storage, until the tab is closed."],
  ['databases', 'Databases a site keeps in your browser (IndexedDB)', 'A bigger store for a site that wants to keep a lot, such as your mail so that it also works without internet.',
    "In Chrome's own folder on this computer, in the part called IndexedDB."],
  ['caches', 'Copies of its own pages a site put aside (cache storage)', 'A site can put its pages and pictures aside so that it opens faster, or without internet. These are separate from the copies Chrome saves by itself.',
    "In Chrome's own folder on this computer, in the part called Service Worker, CacheStorage."],
  ['workers', 'Programs a site leaves in Chrome (service workers)', 'A small program a site puts into Chrome that can run when the site is not open, for example to show you notifications.',
    "In Chrome's own folder on this computer, in the part called Service Worker."]];
const counts = { local: 3, session: 1, databases: 2, caches: 0, workers: 0 };
test('nothing is looked at until asked: one button that says what it does', () => {
  const r = buildReport(state(), tab()), html = renderReport(r);
  assert.deepEqual(r.stored, { asked: false });
  assert.match(html, /<h2>Other things this page has saved in your browser<\/h2>/);
  const b = buttons(html).find((x) => x.msg && x.msg.type === 'stored');
  assert.deepEqual([b.label, b.msg], ['Count what this page has saved', { type: 'stored', tabId: 7 }]);
  assert.ok(text(html).includes('Nothing on the page is looked at until you press this.'));
});
test('each kind: what it is, where it lives, how many on this page, and the command to see it', () => {
  const r = buildReport(state(), tab({ stored: { ok: true, counts } }));
  assert.deepEqual(r.stored.kinds.map((k) => [k.id, k.title, k.what, k.where]), KINDS);
  assert.deepEqual(r.stored.kinds.map((k) => k.count), ['3 on this page', '1 on this page', '2 on this page', '0 on this page', '0 on this page']);
  const html = renderReport(r), t = text(html);
  for (const [, title, is, where] of KINDS) { assert.ok(t.includes(title), title); assert.ok(t.includes(is), title); assert.ok(t.includes(where), title); }
  assert.ok(t.includes('Read from the page just now. Only names and the start of what is saved are shown here, and none of it is saved anywhere else.'));
  assert.equal(html.split('data-copy="node tools/inspect.js storage --site www.example.com"').length - 1, 5);
  assert.deepEqual(buttons(html).filter((b) => b.msg && b.msg.show).map((b) => [b.label, b.msg]),
    [['Show the 3', { type: 'stored', tabId: 7, show: 'local' }], ['Show the 1', { type: 'stored', tabId: 7, show: 'session' }], ['Show the 2', { type: 'stored', tabId: 7, show: 'databases' }]]);
  assert.doesNotMatch(html, /\bC\d\d\b/);
});
test('a kind the page itself may not use says so instead of a number', () => {
  const r = buildReport(state(), tab({ stored: { ok: true, counts: { ...counts, local: null } } }));
  assert.equal(r.stored.kinds[0].count, 'this page is not allowed to use it');
});
test('a page that refuses scripts: one sentence', () => {
  const r = buildReport(state(), tab({ stored: { ok: false, refused: true } }));
  assert.deepEqual(r.stored, { refused: true });
  assert.ok(text(renderReport(r)).includes('Chrome does not let extensions look at this page.'));
  assert.equal(buttons(renderReport(r)).some((b) => b.msg && b.msg.type === 'stored'), false);
});
test('Show: the names, with the start of each value and never more than 24 characters of it; hostile text escaped', () => {
  const items = [{ name: 'uid', value: LONG, long: false }, { name: '<b>k', value: '<script>1</script>', long: false }, { name: 'empty', value: '', long: false }];
  const r = buildReport(state(), tab({ stored: { ok: true, counts, shown: 'local', items } }));
  assert.deepEqual(r.stored.kinds[0].items, [{ name: 'uid', value: LONG.slice(0, 24), long: true }, { name: '<b>k', value: '<script>1</script>', long: false }, { name: 'empty', value: '', long: false }]);
  assert.equal(r.stored.kinds[1].items, undefined);
  const html = renderReport(r);
  assert.ok(html.includes(`uid <code>${LONG.slice(0, 24)}…</code>`)); assert.equal(html.includes(LONG), false);
  assert.doesNotMatch(html, /<b>k|<script>/); assert.ok(html.includes('empty <span class="m">holds nothing</span>'));
  // a kind with names only (databases)
  const db = renderReport(buildReport(state(), tab({ stored: { ok: true, counts, shown: 'databases', items: [{ name: 'mail' }, { name: 'drafts' }] } })));
  assert.ok(db.includes('<div class="c">mail</div><div class="c">drafts</div>'));
});
test('a tab that is not a web page has nothing of this to show', () => {
  const r = buildReport(state(), null);
  assert.equal(r.stored, null);
  assert.ok(text(renderReport(r)).includes('This tab is not a web page, so there is nothing saved by it to show.'));
});

// ---- step 5: the top line, what waits, and when it was read
const boxes = (html) => [...html.matchAll(/<label><input type="checkbox" data-msg="([^"]*)"( checked)?> ([^<]*)<\/label>/g)].map(([, m, c, label]) => [label, JSON.parse(unesc(m)), !!c]);
const labels = (html, upTo = '<h2>') => buttons(html.slice(0, html.indexOf(upTo))).map((b) => b.label);
test('top line, cleaning on: the switch, the state in words, Pause, what can be put back, and clearing the saved copies', () => {
  const undo = [{ t: NOW - 60e3, site: 'a.test', name: 'x' }, { t: NOW - 9 * 60e3, site: 'a.test', name: 'y' }, { t: NOW - 11 * 60e3, site: 'a.test', name: 'old' }];
  const r = buildReport(state({ undo }), tab()), html = renderReport(r);
  assert.deepEqual(r.top, { master: true, says: 'Cleaning is on', paused: false, undo: 2 });
  assert.deepEqual(boxes(html), [['On', { type: 'setMaster' }, true]]);
  assert.ok(text(html).trim().startsWith('On Cleaning is on'));
  const b = buttons(html).slice(0, 3);
  assert.deepEqual(b.map((x) => [x.label, x.msg, x.disabled]), [['Pause 10 min', { type: 'pause', minutes: 10 }, false], ['Put back 2 deleted cookies', { type: 'restoreAll' }, false],
    ['Clear the saved copies of pages', { type: 'drop', kind: 'servers' }, false]]);
});
test('top line: nothing to put back says so with a number; one cookie; and "300+" when the list is full', () => {
  const t = (undo) => renderReport(buildReport(state({ undo }), tab()));
  assert.ok(text(t([])).includes('0 cookies deleted in the last 10 minutes')); assert.equal(labels(t([])).some((l) => l.startsWith('Put back')), false);
  assert.ok(labels(t([{ t: NOW - 1, site: 'a.test', name: 'x' }])).includes('Put back 1 deleted cookie'));
  assert.ok(labels(t(Array.from({ length: 300 }, (_, i) => ({ t: NOW - i, site: 'a.test', name: 'x' + i })))).includes('Put back 300+ deleted cookies'));
});
test('top line: paused, switched off, held while you sign in, and never turned on', () => {
  const top = (o) => { const r = buildReport(state(o), tab()), html = renderReport(r); return [r.top.says, labels(html), html]; };
  let [says, b, html] = top({ hold: { paused: true, pauseUntil: NOW + 10 * 60e3 } });
  assert.equal(says, 'Cleaning is paused until 14:15'); assert.deepEqual(b, ['Resume', 'Clear the saved copies of pages', 'Read again']);
  assert.deepEqual(buttons(html)[0].msg, { type: 'resume' });
  [says, b, html] = top({ master: false });
  assert.equal(says, 'Cleaning is off'); assert.deepEqual(b, ['Clear the saved copies of pages', 'Read again']); assert.deepEqual(boxes(html), [['Off', { type: 'setMaster' }, false]]);
  [says, b] = top({ hold: { guard: true } });
  assert.equal(says, 'Cleaning is on, but held while you sign in'); assert.deepEqual(b, ['Pause 10 min', 'Clear the saved copies of pages', 'Read again']);
  [says, b, html] = top({ master: undefined });
  assert.equal(says, 'Cleaning is off until you turn it on.'); assert.deepEqual(b, ['Turn on', 'Read again']);
  assert.deepEqual(buttons(html)[0].msg, { type: 'setMaster', on: true }); assert.deepEqual(boxes(html), []);
});
test('which page the report is about and when it was read, with a button to read again', () => {
  const html = renderReport(buildReport(state({ now: NOW + 9e3 }), tab()));
  assert.ok(text(html).includes('This page: www.example.com · Read at 14:05:09'));
  const b = buttons(html).find((x) => x.label === 'Read again');
  assert.deepEqual([b.act, b.msg], ['refresh', undefined]);
  assert.ok(text(renderReport(buildReport(state(), null))).includes('This tab is not a web page · Read at 14:05:00'));
  assert.doesNotMatch(renderReport(buildReport(state(), tab({ host: '<b>x' }))), /<b>x/);
});
test('what waits for an answer: per group the number, a button that says what it does and to how many, Postpone, and the list collapsed', () => {
  const it = (kind, site, name, why) => ({ cap: 'C03', kind, site, name, why, t: NOW });
  const many = Array.from({ length: 20 }, (_, i) => it('cookie', 'example.com', '_ga' + i, 'name'));
  const r = buildReport(state({}, { google: { pending: 1, items: [it('cookie', 'google.com', 'NID', 'google')] }, cookies: { pending: 31, items: many },
    cache: { pending: 1, items: [it('cache', '*', 'http-cache', 'daily')] }, tabs: { pending: 2, items: [it('tabs', 'news.example', '7'), it('tabs', 'shop.example', '9')] },
    storage: { pending: 1, items: [it('storage', 'bad.test', 'storage')] }, permissions: { pending: 1, items: [it('permission', 'https://bad.test', 'camera')] },
    wifi: { pending: 1, helper: 'ok', canDelete: 'yes', items: [it('wifi', 'Cafe', 'uuid-1', 'not used for 30 days or more')] } }), tab());
  assert.deepEqual(r.waiting.map((w) => [w.id, w.line, w.button]), [
    ['cookies', "Trackers' cookies: 31 waiting", 'Remove 31 cookies'], ['google', 'Cookies Google uses to recognise you: 1 waiting', 'Remove 1 cookie'],
    ['storage', 'Data that sites keep (site storage): 1 waiting', 'Empty what 1 site has saved'], ['wifi', 'Remembered Wi-Fi networks: 1 waiting', 'Remove 1 saved network'],
    ['permissions', 'What sites may do (site permissions): 1 waiting', 'Block 1 permission'], ['cache', 'Saved copies of pages (HTTP cache): 1 waiting', 'Clear the saved copies of pages'],
    ['tabs', 'Limit how many tabs stay open: 2 waiting', 'Close 2 tabs']]);
  assert.deepEqual(r.waiting.slice(1).map((w) => w.items), [['NID on google.com'], ['what bad.test has saved'], ['Cafe (not used for 30 days or more)'], ['camera on https://bad.test'], ['the saved copies of pages'], ['news.example', 'shop.example']]);
  const html = renderReport(r), g = buttons(html).filter((b) => b.msg && b.msg.group === 'google');
  assert.deepEqual(g.map((b) => [b.label, b.msg]), [['Remove 1 cookie', { type: 'approve', group: 'google' }], ['Postpone 1 hour', { type: 'postpone', group: 'google', minutes: 60 }]]);
  assert.match(html, /<details id="wait-google"><summary>Show what is waiting<\/summary><div class="c">NID on google.com<\/div><\/details>/);
  assert.match(html, /<details id="wait-cookies"><summary>Show what is waiting \(the newest 20 of 31\)<\/summary>/);
  assert.ok(text(html).includes('Removing a saved network cannot be undone here.'));
  assert.doesNotMatch(html.slice(0, html.indexOf('<h2>What Tracker Cleaner')), /\bC\d\d\b|pending/);
});
test('what waits: nothing says so; put off says until when; paused or off greys the button out; a cookie that keeps coming back is marked; hostile text escaped', () => {
  const it = (name, why) => ({ cap: 'C03', kind: 'cookie', site: '<i>x', name, why, t: NOW });
  assert.ok(text(renderReport(buildReport(state(), tab()))).includes('Nothing is waiting for your answer.'));
  const g = (over) => ({ google: { pending: 1, items: [it('<b>NID', 'this site keeps putting it back')], ...over } });
  let r = buildReport(state({}, g({ postponedUntil: NOW + 3600e3 })), tab());
  assert.equal(r.waiting[0].line, 'Cookies Google uses to recognise you: 1 waiting, put off until 15:05');
  assert.equal(buildReport(state({}, g({ postponedUntil: 'restart' })), tab()).waiting[0].line, 'Cookies Google uses to recognise you: 1 waiting, put off until Chrome starts again');
  assert.deepEqual(r.waiting[0].items, ['<b>NID on <i>x (its site keeps putting it back)']);
  assert.doesNotMatch(renderReport(r), /<b>NID|<i>x/);
  for (const o of [{ hold: { paused: true } }, { master: false }]) { const b = buttons(renderReport(buildReport(state(o, g()), tab()))).find((x) => x.label === 'Remove 1 cookie'); assert.equal(b.disabled, true); }
  // Wi-Fi: this user may not remove saved networks: no button, one sentence
  r = buildReport(state({}, { wifi: { pending: 1, helper: 'ok', canDelete: 'no', items: [{ kind: 'wifi', site: 'Cafe', name: 'u', why: 'never used' }] } }), tab());
  assert.equal(r.waiting[0].button, ''); assert.ok(text(renderReport(r)).includes('This user is not allowed to remove saved networks without a password, so nothing can be removed from here.'));
});

// ---- 1.24, R1: a tracker on no list is asked about in one sentence, with Approve and Not now
test('R1: "X followed you on 3 sites. Stop it?" with Approve and Not now for that one; stopped ones can be let through again', () => {
  const it = { cap: 'C25', kind: 'tracker', site: 'trk.example', name: 'followed you on 3 sites', why: 'on no list' };
  const r = buildReport(state({ stopped: ['old.example'] }, { unknown: { pending: 1, items: [it] } }), tab()), html = renderReport(r);
  assert.deepEqual(r.waiting.find((w) => w.id === 'unknown').asks, [{ site: 'trk.example', line: 'trk.example followed you on 3 sites. Stop it?' }]);
  assert.ok(text(html).includes('trk.example followed you on 3 sites. Stop it?ApproveNot now'));
  assert.ok(html.includes('data-msg="{&quot;type&quot;:&quot;approve&quot;,&quot;group&quot;:&quot;unknown&quot;,&quot;site&quot;:&quot;trk.example&quot;}"'));
  assert.ok(html.includes('{&quot;type&quot;:&quot;notNow&quot;,&quot;group&quot;:&quot;unknown&quot;,&quot;site&quot;:&quot;trk.example&quot;}'));
  assert.ok(text(html).includes('Trackers you stopped (1)old.exampleLet it through again'));
  assert.equal(row(r, 'unknown').count, '0 stopped today, 1 waiting');
});
test('R1: a cookie of a company the user stopped is called a tracker\'s', () => {
  const r = buildReport(state({ stopped: ['trk.example'] }), tab({ host: 'news.example', cookies: [{ domain: '.trk.example', name: 'uid', value: 'x' }] }));
  assert.equal(r.cookies.rows[0].what, "comes from a tracker's site, deleted automatically");
});
