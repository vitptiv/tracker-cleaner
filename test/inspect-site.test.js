// The inspector for one site (1.23 step 6): `cookies --site <site>` and `storage --site <site>` print the same rows in
// the same words as the report beside the page, from Chrome's own files. On the fixture profile only.
const test = require('node:test'), assert = require('node:assert'), fs = require('node:fs'), path = require('node:path'), { execSync } = require('node:child_process');
const fx = require('./fixtures/build.js').at('profile-site'), { main } = require('../tools/inspect.js'), load = require('./load-background.js');
const { buildReport, renderReport } = require('../extension/report-view.js');
test.before(() => fx.build());
const call = (...args) => { const out = []; const code = main([...args, '--profile', fx.DIR, '--cache', fx.CACHE], { print: (s) => out.push(s) }); return [code, out.join('\n')]; };
const SWITCHES = "  What happens to each one is said for the switches as they are in a new Tracker Cleaner with cleaning turned on. Your own switches, Keep and Always delete live inside Chrome and are not seen from here.";

test('cookies --site: the number first, then one row per cookie: site, name, how long it stays, what it is and what happens to it', () => {
  assert.deepEqual(call('cookies', '--site', 'www.example.com'), [0, [
    'Small files this site has saved to recognise you (cookies)',
    "  2 cookies on www.example.com, read from Chrome's own cookie file on this computer. Chrome writes that file a little late, so it can be half a minute behind.",
    "  example.com  _ga      until 20 Nov 2027       has a tracker's name, deleted automatically",
    '  example.com  session  until you close Chrome  on no tracker list, kept',
    SWITCHES,
    '  What each one holds is left out. Add --values to ask for it.'].join('\n')]);
  const [, google] = call('cookies', '--site', 'accounts.google.com');
  assert.deepEqual(google.split('\n').slice(1, 4), ['  2 cookies on accounts.google.com, read from Chrome\'s own cookie file on this computer. Chrome writes that file a little late, so it can be half a minute behind.',
    '  google.com  NID  until 1 May 2027  Google uses it to recognise you, deleted only after you say so', '  google.com  SID  until 2 Jan 2028  keeps you signed in, kept']);
});
test('cookies --site: one cookie, none, and a tracker\'s own site', () => {
  assert.ok(call('cookies', '--site', 'ad.doubleclick.net')[1].includes("  1 cookie on ad.doubleclick.net, read from Chrome's own cookie file"));
  assert.ok(call('cookies', '--site', 'ad.doubleclick.net')[1].includes("doubleclick.net  id  until you close Chrome  comes from a tracker's site, kept while you are on that site"));
  assert.deepEqual(call('cookies', '--site', 'nothing.example'), [0, 'Small files this site has saved to recognise you (cookies)\n  This site has saved no cookies.']);
});
test('the rows say what the report beside the page says for the same cookies: the same words, from the same code', async () => {
  const cookies = [{ name: '_ga', domain: 'example.com', expirationDate: new Date(2027, 10, 20, 12).getTime() / 1000 }, { name: 'session', domain: 'example.com' }];
  const bg = await load({ tabs: [{ id: 1, active: true, url: 'https://www.example.com/' }], cookies, storage: { master: true, modes: { C03: 'ask' } } });
  await bg.send({ type: 'setMode', group: 'cookies', mode: 'auto' });   // back to how a new Tracker Cleaner has it; the two cookies were there first
  const report = buildReport(await bg.send({ type: 'state' }), { id: 1, host: 'www.example.com', matched: [], cookies: (await bg.send({ type: 'cookies', host: 'www.example.com' })).cookies });
  const [, out] = call('cookies', '--site', 'www.example.com'), rows = out.split('\n').slice(2, 4).map((l) => l.trim().split(/ {2,}/));
  assert.ok(renderReport(report).includes(`<h2>${out.split('\n')[0]}</h2>`));
  assert.deepEqual(rows.find((r) => r[1] === 'session'), ['example.com', 'session', 'until you close Chrome', 'on no tracker list, kept']);
  assert.deepEqual(rows[0].slice(2), ['until 20 Nov 2027', "has a tracker's name, deleted automatically"]);
  const [, google] = call('cookies', '--site', 'www.google.com');
  for (const c of buildReport(await bg.send({ type: 'state' }), { host: 'www.google.com', cookies: [{ name: 'NID', domain: '.google.com' }, { name: 'SID', domain: '.google.com' }] }).cookies.rows)
    assert.ok(google.includes(c.what), c.what);
});
test('cookies --site --values: what is locked on disk says "not readable from the file"; what can be read is cut to 24 characters; nothing held says so', () => {
  const [code, out] = call('cookies', '--site', 'example.com', '--values');
  assert.equal(code, 0);
  assert.deepEqual(out.split('\n').slice(2), [
    "  example.com  _ga      until 20 Nov 2027       has a tracker's name, deleted automatically  holds: not readable from the file",
    `  example.com  session  until you close Chrome  on no tracker list, kept                     holds: ${fx.PLAIN.slice(0, 24)}…`,
    SWITCHES,
    '  Chrome keeps what a cookie holds locked on disk (encrypted), so it is not readable from the file. The report beside the page shows it.']);
  assert.equal(out.includes(fx.PLAIN), false); assert.equal(out.includes(fx.MARK), false);
  assert.ok(call('cookies', '--site', 'google.com', '--values')[1].includes('keeps you signed in, kept'.padEnd('Google uses it to recognise you, deleted only after you say so'.length) + '  holds: nothing'));
});
test('cookies --site: without --values nothing a cookie holds is printed, in any form of the output', () => {
  for (const flags of [[], ['--json'], ['--raw'], ['--list']]) for (const site of ['example.com', 'google.com', 'doubleclick.net']) { const [code, out] = call('cookies', '--site', site, ...flags);
    assert.equal(code, 0, flags.join()); assert.equal(out.includes(fx.MARK) || out.includes('PLAIN-'), false, flags.join()); }
  assert.equal(call('cookies', '--site', 'example.com', '--values', '--json')[1].includes(fx.MARK), false);
});
test('cookies --site --json: the same rows as data; --raw: one command that runs as printed and names the same cookies', () => {
  const j = JSON.parse(call('cookies', '--site', 'www.example.com', '--json')[1]);
  assert.deepEqual(j.rows.map((r) => [r.site, r.name, r.expires, r.what]), [['example.com', '_ga', 'until 20 Nov 2027', "has a tracker's name, deleted automatically"], ['example.com', 'session', 'until you close Chrome', 'on no tracker list, kept']]);
  const raw = call('cookies', '--site', 'www.example.com', '--raw')[1];
  assert.equal(raw.trim().split('\n').length, 1); assert.ok(raw.includes('mode=ro&immutable=1'));
  assert.deepEqual(execSync(raw, { encoding: 'utf8' }).trim().split('\n'), ['example.com _ga', 'example.com session']);
});
test('--site takes a site\'s name and nothing else: one plain sentence, exit code 1, and nothing is run', () => {
  for (const bad of ['https://www.example.com/', "x' or 1=1 --", 'a b', '']) assert.deepEqual(call('cookies', '--site', bad),
    [1, 'Name the site by its address without "https://", for example: --site www.example.com']);
  assert.deepEqual(call('storage', '--site', '$(reboot)'), [1, 'Name the site by its address without "https://", for example: --site www.example.com']);
  assert.equal(call('cache', '--site', 'example.com')[0], 0);       // a block that is not per site: the flag changes nothing
});
test('the Copy buttons of the report carry exactly these commands, and each runs', () => {
  const html = renderReport(buildReport({ groups: [] }, { id: 1, host: 'app.example', matched: [], cookies: [{ name: 'a', domain: 'app.example', value: '' }], stored: { ok: true, counts: { local: 1 } } }));
  const cmds = [...new Set([...html.matchAll(/data-copy="([^"]*)"/g)].map((m) => m[1]))];
  assert.deepEqual(cmds, ['node tools/inspect.js cookies --site app.example', 'node tools/inspect.js storage --site app.example']);
  for (const c of cmds) { const [code, out] = call(...c.split(' ').slice(2)); assert.equal(code, 0, out); assert.match(out, /^(Small files this site has saved|Other things this page has saved)/); }
});
test('storage --site: the same five kinds in the same words as the report, and what the files can tell about this site', () => {
  const [code, out] = call('storage', '--site', 'app.example'), l = out.split('\n');
  assert.equal(code, 0);
  const kinds = buildReport({ groups: [] }, { id: 1, host: 'app.example', matched: [], stored: { ok: true, counts: {} } }).stored.kinds;
  assert.ok(renderReport(buildReport({ groups: [] }, { id: 1, host: 'app.example', matched: [] })).includes(`<h2>${l[0]}</h2>`));
  assert.equal(l[0], 'Other things this page has saved in your browser');
  assert.equal(l[1], "  app.example is on Chrome's own list of sites that keep something in your browser.");
  for (const k of kinds) { const i = l.indexOf('  ' + k.title); assert.ok(i > 0, k.title); assert.equal(l[i + 1], '    ' + k.what); assert.equal(l[i + 2], '    ' + k.where); }
  const told = Object.fromEntries(kinds.map((k) => [k.id, l[l.indexOf('  ' + k.title) + 3]]));
  assert.equal(told.databases, '    On this site: it has a database folder. How many databases are in it cannot be read from outside Chrome.');
  for (const id of ['local', 'session', 'caches', 'workers']) assert.equal(told[id], '    On this site: cannot be counted from the files, which Chrome keeps packed. The report beside the page counts them.');
  assert.equal(l.length, 2 + 5 * 4);
});
test('storage --site: a site with nothing, a site on the list without a database, --json and --raw', () => {
  const [, none] = call('storage', '--site', 'nothing.example');
  assert.ok(none.includes("  nothing.example is not on Chrome's own list of sites that keep something in your browser."));
  assert.ok(none.includes('    On this site: no database folder.'));
  const [, mix] = call('storage', '--site', 'mixpanel.com');
  assert.ok(mix.includes('  mixpanel.com is on Chrome\'s own list')); assert.ok(mix.includes('    On this site: no database folder.'));
  const j = JSON.parse(call('storage', '--site', 'app.example', '--json')[1]);
  assert.deepEqual([j.site, j.listed, j.kinds.length, j.kinds[2].id, j.kinds[2].found], ['app.example', true, 5, 'databases', true]);
  assert.ok(call('storage', '--site', 'app.example', '--raw')[1].includes('ls '));
});
test('the usage text names --site and --values', () => {
  const out = []; main([], { print: (s) => out.push(s) });
  assert.ok(out[0].includes('  --site <site> only this site, in the same words as the report beside the page (cookies, storage)'));
  assert.ok(out[0].includes('  --values     with --site: also what each cookie holds, where the file lets it be read'));
});
