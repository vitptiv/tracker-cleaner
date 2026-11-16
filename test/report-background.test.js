// The report (1.23) end to end: what background.js answers, built and rendered by report-view.js.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { buildReport, renderReport } = require('../extension/report-view.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const TAB = { id: 1, active: true, url: 'https://www.example.com/' };
const row = (r, id) => r.features.find((f) => f.id === id);

// ---- step 1
test('feature rows from the real state: sentences, state words, deleted today and waiting', async () => {
  const bg = await load(on({ tabs: [TAB], cookies: [{ name: '_ga', domain: '.example.com' }, { name: 'NID', domain: '.google.com' }] }));
  await bg.alarm('sweep');
  const state = { ...(await bg.send({ type: 'state' })), history: await bg.send({ type: 'history' }) };
  const r = buildReport(state, { id: 1, host: 'www.example.com', matched: ['trackers'] });
  assert.equal(row(r, 'cookies').says, 'Small files that trackers save to recognise you are deleted, while the ones that keep you signed in stay.');
  assert.deepEqual([row(r, 'cookies').state, row(r, 'cookies').count], ['on', '1 deleted today, 0 waiting']);
  assert.deepEqual([row(r, 'google').state, row(r, 'google').count], ['asks first', '0 deleted today, 1 waiting']);
  assert.deepEqual([row(r, 'blocking').state, row(r, 'blocking').count], ['on', '1 blocked on this page']);
  await bg.send({ type: 'pause' });
  assert.equal(row(buildReport(await bg.send({ type: 'state' }), null), 'cookies').state, 'paused');
  assert.match(renderReport(r), /Cookies Google uses to recognise you.*asks first · 0 deleted today, 1 waiting/s);
});

// ---- step 2
const SECRET = 'SECRET-0123456789-abcdefghijklmnopqrstuvwxyz', SHOWN = SECRET.slice(0, 24);
const site = (bg, host = 'www.example.com') => bg.send({ type: 'cookies', host });
const jar = () => [{ name: 'SID', domain: '.example.com', value: SECRET }, { name: 'theme', domain: 'www.example.com', value: 'dark' },
  { name: 'cart', domain: 'shop.example.com', value: SECRET }, { name: 'other', domain: '.other.test', value: SECRET }];
test('cookies of the tab\'s site, read live: the site itself, the sites above and below it, values cut to 24 characters', async () => {
  const bg = await load(on({ tabs: [TAB], cookies: jar() }));
  const r = await site(bg);
  assert.deepEqual(r.cookies.map((c) => [c.domain, c.name, c.value, c.long]), [['.example.com', 'SID', SHOWN, true], ['www.example.com', 'theme', 'dark', false]]);
  assert.deepEqual((await site(bg, 'example.com')).cookies.map((c) => c.name), ['SID', 'theme', 'cart']);
  assert.equal(JSON.stringify(r).includes(SECRET), false);
  for (const host of [undefined, '', 'a b', '<x>', 7]) assert.deepEqual(await bg.send({ type: 'cookies', host }), { ok: false });
});
test('after a report is built and drawn, no value is anywhere in storage, in the report to 8088, or whole in the page', async () => {
  const bg = await load(on({ limits: {}, tabs: [TAB], cookies: jar(), storage: { modes: { C15: 'auto' } } }));
  const state = { ...(await bg.send({ type: 'state' })), history: await bg.send({ type: 'history' }) };
  const html = renderReport(buildReport(state, { id: 1, host: 'www.example.com', matched: [], cookies: (await site(bg)).cookies }));
  await bg.alarm('sweep');
  assert.ok(html.includes(SHOWN)); assert.equal(html.includes(SECRET), false);
  for (const kept of [bg.state.storage, bg.state.session, bg.state.sync, bg.reports]) assert.equal(JSON.stringify(kept).includes(SHOWN), false);
  assert.ok(bg.reports.length > 0);
});
test('the cookies message is answered to the extension\'s own pages only', async () => {
  const bg = await load(on({ cookies: jar() }));
  assert.equal(await bg.send({ type: 'cookies', host: 'www.example.com' }, { id: bg.chrome.runtime.id, url: 'https://www.example.com/', tab: { id: 1 } }), undefined);
});

// ---- step 3: each button's message is taken from the drawn report and sent, as the page will
const unesc = (x) => x.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const draw = async (bg, host = 'www.example.com') => { const state = { ...(await bg.send({ type: 'state' })), history: await bg.send({ type: 'history' }) };
  const report = buildReport(state, { id: 1, host, matched: [], cookies: (await site(bg, host)).cookies });
  return { report, html: renderReport(report) }; };
const button = (html, label, name) => { const all = [...html.matchAll(/<button([^>]*)>([^<]*)<\/button>/g)].map(([, a, l]) => ({ label: unesc(l), msg: JSON.parse(unesc((/data-msg="([^"]*)"/.exec(a) || [, 'null'])[1])) }));
  const b = all.find((x) => x.label.startsWith(label) && x.msg && (name === undefined || x.msg.name === name)); assert.ok(b, `no button "${label}" for ${name}`); return b; };
const press = async (bg, label, name, extra) => { const r = await bg.send({ ...button((await draw(bg)).html, label, name).msg, ...extra }); await bg.settle(); return r; };
const what = async (bg, name) => ((await draw(bg)).report.cookies.rows.find((c) => c.name === name) || {}).what;
const asks = (o = {}) => on({ tabs: [TAB], ...o, storage: { modes: { C03: 'ask' }, ...o.storage } });   // trackers' cookies wait, so there is something to press on
const mine = () => [{ name: 'SID', domain: '.example.com', value: SECRET }, { name: 'theme', domain: 'www.example.com', value: SECRET }, { name: '_ga', domain: '.example.com', value: 'GA1.2.3' },
  { name: 'cart', domain: 'shop.example.com' }, { name: 'other', domain: '.other.test' }];
const log = (bg) => (bg.state.storage.log || []).map((l) => [l.kind, l.site, l.name, l.did].join(' '));

test('Delete: the cookie goes through the drop path: gone, in the log, and Undo can put it back', async () => {
  const bg = await load(asks({ cookies: mine() }));
  assert.deepEqual(await press(bg, 'Delete', 'theme'), { ok: true, verified: true });
  assert.deepEqual(await bg.names(), ['SID', '_ga', 'cart', 'other']);
  assert.ok(log(bg).includes('cookie www.example.com theme removed'));
  assert.deepEqual((await bg.send({ type: 'state' })).undo.map((u) => u.name), ['theme']);
  assert.equal(JSON.stringify(bg.state.storage).includes(SHOWN), false);   // the undo buffer in memory is the one place that has it
  assert.equal((await bg.send({ type: 'restore', site: 'www.example.com', name: 'theme' })).restored, 1);
  assert.ok((await bg.names()).includes('theme'));
});
test('Delete is refused while paused and while cleaning is switched off', async () => {
  const bg = await load(asks({ cookies: mine() })), msg = button((await draw(bg)).html, 'Delete', 'theme').msg;
  await bg.send({ type: 'pause' });
  assert.equal((await bg.send(msg)).why, 'paused');
  await bg.send({ type: 'resume' }); await bg.send({ type: 'setMaster', on: false });
  assert.equal((await bg.send(msg)).why, 'off');
  assert.ok((await bg.names()).includes('theme'));
});
test('Keep: the cookie goes on the keep list and survives automatic cleaning; the row says so', async () => {
  const bg = await load(asks({ cookies: mine() }));
  assert.equal(await what(bg, '_ga'), "has a tracker's name, deleted only after you say so");
  assert.equal((await press(bg, 'Keep', '_ga')).ok, true);
  assert.deepEqual(bg.state.storage.allow, [{ site: 'example.com', name: '_ga' }]);
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'auto' }); await bg.alarm('sweep');
  assert.ok((await bg.names()).includes('_ga'));
  assert.equal(await what(bg, '_ga'), "has a tracker's name, kept because you chose Keep");
});
test('Always delete: an ordinary cookie nobody kept is deleted now and goes on a list kept in the extension, with no 8088 server', async () => {
  const bg = await load(asks({ cookies: mine(), storage: { modes: { C03: 'ask', C07: 'auto' } } }));
  assert.equal(await what(bg, 'theme'), 'on no tracker list, kept');
  assert.deepEqual(await press(bg, 'Always delete', 'theme'), { ok: true, always: [{ site: 'www.example.com', name: 'theme' }] });
  assert.equal((await bg.names()).includes('theme'), false);
  assert.deepEqual(bg.state.storage.always, [{ site: 'www.example.com', name: 'theme' }]);
  await bg.setCookie({ url: 'https://www.example.com/', name: 'theme', value: SECRET });   // the site puts it back: gone again
  assert.equal((await bg.names()).includes('theme'), false);
  assert.deepEqual((await draw(bg)).report.always, [{ site: 'www.example.com', name: 'theme' }]);
  assert.equal(JSON.stringify(bg.state.storage).includes(SHOWN), false);
});
test('Always delete follows its group\'s switch afterwards: while that asks first, the cookie waits when it comes back; a later Keep takes it off the list', async () => {
  const bg = await load(asks({ cookies: mine() }));
  await press(bg, 'Always delete', 'theme');
  assert.equal((await bg.names()).includes('theme'), false);        // now, because the user pressed the button
  await bg.setCookie({ url: 'https://www.example.com/', name: 'theme', value: 'again' });
  assert.ok((await bg.names()).includes('theme'));
  assert.deepEqual(bg.state.storage.pending.storage.items.map((i) => `${i.site} ${i.name}`), ['www.example.com theme']);
  assert.equal(await what(bg, 'theme'), 'on your always-delete list, deleted only after you say so');
  assert.equal((await press(bg, 'Keep', 'theme')).ok, true);
  assert.deepEqual([bg.state.storage.always, bg.state.storage.allow], [[], [{ site: 'www.example.com', name: 'theme' }]]);
  assert.deepEqual((bg.state.storage.pending.storage || { items: [] }).items, []);
  await bg.send({ type: 'setMode', group: 'storage', mode: 'auto' }); await bg.alarm('sweep');
  assert.ok((await bg.names()).includes('theme'));
  assert.equal(await what(bg, 'theme'), 'on no tracker list, kept');
});
test('Always delete after Keep takes the cookie off the keep list; "Stop always deleting" is the way back', async () => {
  const bg = await load(asks({ cookies: mine(), storage: { modes: { C03: 'ask', C07: 'auto' }, allow: [{ site: 'example.com', name: '_ga' }] } }));
  await press(bg, 'Always delete', '_ga');
  assert.deepEqual([bg.state.storage.allow, bg.state.storage.always], [[], [{ site: 'example.com', name: '_ga' }]]);
  assert.equal((await bg.names()).includes('_ga'), false);
  assert.deepEqual(await press(bg, 'Stop always deleting', '_ga'), { ok: true, always: [] });
  for (const m of [{}, { site: 'example.com' }, { site: 'a b', name: 'x' }, { site: 5, name: 'x' }]) assert.deepEqual(await bg.send({ type: 'always', ...m }), { ok: false });
});
test('the always-delete list of the 8088 server is added to the local one when the server answers', async () => {
  const bg = await load(on({ limits: { cookieBlacklist: [{ h: 'other.test', n: 'other' }] }, cookies: mine(), storage: { modes: { C07: 'auto', C03: 'ask' }, always: [{ site: 'shop.example.com', name: 'cart' }] } }));
  await bg.alarm('sweep');
  assert.deepEqual(await bg.names(), ['SID', 'theme', '_ga']);
  bg.limits = undefined; await bg.setCookie({ url: 'https://shop.example.com/', name: 'cart' });   // the server went away: the local list still counts
  assert.deepEqual(await bg.names(), ['SID', 'theme', '_ga']);
});
test('Always delete is refused while paused: nothing is deleted and nothing is listed', async () => {
  const bg = await load(asks({ cookies: mine() })), msg = button((await draw(bg)).html, 'Always delete', 'theme').msg;
  await bg.send({ type: 'pause' });
  assert.equal((await bg.send(msg)).why, 'paused');
  assert.equal(bg.state.storage.always, undefined); assert.ok((await bg.names()).includes('theme'));
});
test('Show all of it and Copy: the whole value is read from Chrome at that moment, for the extension\'s own page only, and kept nowhere', async () => {
  const bg = await load(asks({ cookies: mine() })), { html } = await draw(bg);
  assert.equal(html.includes(SECRET), false);
  for (const label of ['Show all of it', 'Copy what it holds']) assert.deepEqual(await bg.send(button(html, label, 'SID').msg), { ok: true, value: SECRET });
  for (const kept of [bg.state.storage, bg.state.session, bg.state.sync]) assert.equal(JSON.stringify(kept).includes(SHOWN), false);
  assert.deepEqual(await bg.send({ type: 'cookieValue', site: 'example.com', name: 'gone' }), { ok: false });
  assert.deepEqual(await bg.send({ type: 'cookieValue', site: '<x>', name: 'SID' }), { ok: false });
  assert.equal(await bg.send({ type: 'cookieValue', site: 'example.com', name: 'SID' }, { id: bg.chrome.runtime.id, url: 'https://www.example.com/' }), undefined);
});
test('Delete all on this site: the number on the button is what goes; sign-ins stay unless the box is ticked; other sites are untouched', async () => {
  const bg = await load(asks({ cookies: mine() }));
  const b = button((await draw(bg)).html, 'Delete 2 cookies on this site');
  assert.deepEqual(b.msg, { type: 'dropSite', host: 'www.example.com' });
  assert.deepEqual(await bg.send(b.msg), { ok: true, done: 2, of: 2 }); await bg.settle();
  assert.deepEqual(await bg.names(), ['SID', 'cart', 'other']);
  assert.deepEqual(log(bg).filter((l) => l.endsWith('removed')), ['cookie www.example.com theme removed', 'cookie example.com _ga removed']);
  assert.equal((await bg.send({ type: 'state' })).undo.length, 2);
  assert.deepEqual(await bg.send({ ...b.msg, signins: true }), { ok: true, done: 1, of: 1 });   // the box "also the 1 that keeps me signed in"
  assert.deepEqual(await bg.names(), ['cart', 'other']);
});
test('Delete all is refused while paused or switched off, and for a host that is not one', async () => {
  const bg = await load(asks({ cookies: mine() }));
  await bg.send({ type: 'pause' });
  assert.equal((await bg.send({ type: 'dropSite', host: 'www.example.com' })).why, 'paused');
  await bg.send({ type: 'resume' }); await bg.send({ type: 'setMaster', on: false });
  assert.equal((await bg.send({ type: 'dropSite', host: 'www.example.com' })).why, 'off');
  assert.deepEqual(await bg.send({ type: 'dropSite', host: 'a b' }), { ok: false });
  assert.equal((await bg.names()).length, 5);
});
