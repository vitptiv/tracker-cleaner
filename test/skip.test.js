// S2c: a link to a site already known to only pass you along goes straight to the address it names (skip.js).
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const { skipTo } = require('../extension/skip.js'), { buildReport, renderReport } = require('../extension/report-view.js');
const SITES = ['hop.example'], PAGE = 'https://social.example/feed', enc = encodeURIComponent;
const hop = (q, host = 'hop.example') => `https://${host}/r?${q}`;
const on = (o = {}) => ({ tabs: [{ id: 1, active: true, url: PAGE }], ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
// passing (1.25, H4): it sent the browser on to two different sites and added an ID
const pass = async (bg) => { for (const to of ['https://blog.example/post', 'https://shop.example/x']) { await bg.redirect({ url: hop(`to=${enc(to)}`), redirectUrl: to + '?hid=h-77ab12cd34ef', type: 'main_frame' }); await bg.settle(); } };

test('a link to a known pass-through site that names one address on another site goes straight there', () => {
  assert.equal(skipTo(hop(`c=77&to=${enc('https://blog.example/post?a=1')}`), PAGE, SITES), 'https://blog.example/post?a=1');
  assert.equal(skipTo(`/r?to=${enc('http://blog.example/')}`, 'https://hop.example/x', SITES), 'http://blog.example/');
});
test('left alone: an unknown site, a name that only looks like it, no address, two addresses, its own address, not a web address', () => {
  const to = `to=${enc('https://blog.example/post')}`;
  assert.equal(skipTo(hop(to, 'go.other.example'), PAGE, SITES), null);
  for (const host of ['evil-hop.example', 'hop.example.evil.test', 'hop.example.evil.test:8443', 'xhop.example']) assert.equal(skipTo(hop(to, host), PAGE, SITES), null, host);
  assert.equal(skipTo(`https://evil.test/r?x=hop.example&${to}`, PAGE, SITES), null);
  assert.equal(skipTo(`https://hop.example@evil.test/r?${to}`, PAGE, SITES), null);
  assert.equal(skipTo(hop('c=77'), PAGE, SITES), null);
  assert.equal(skipTo(hop(`${to}&b=${enc('https://shop.example/')}`), PAGE, SITES), null);
  assert.equal(skipTo(hop(`to=${enc('https://www.hop.example/next')}`), PAGE, SITES), null);
  for (const v of ['javascript:alert(1)', 'data:text/html,x', 'file:///etc/passwd', '//blog.example/x', 'blog.example', 'https://user:pw@blog.example/']) assert.equal(skipTo(hop(`to=${enc(v)}`), PAGE, SITES), null, v);
  assert.equal(skipTo('not a url', 'also not', SITES), null); assert.equal(skipTo(hop(to), PAGE, []), null);
});
test('never on the way of a sign-in: a sign-in address as the link or as the destination', () => {
  assert.equal(skipTo(hop(`client_id=a&redirect_uri=${enc('https://blog.example/cb')}`), PAGE, SITES), null);
  assert.equal(skipTo(`https://hop.example/login?next=${enc('https://blog.example/')}`, PAGE, SITES), null);
  assert.equal(skipTo(hop(`to=${enc('https://accounts.google.com/o/oauth2/auth')}`), PAGE, SITES), null);
  assert.equal(skipTo(hop(`to=${enc('https://blog.example/login')}`), PAGE, SITES), null);
});
const PASSERS = [];   // (1.25, L6: no shipped list any more)
const mine = (bg) => ((bg.state.storage.skip || { sites: [] }).sites).filter((x) => !PASSERS.includes(x));   // beside the shipped redirectors
const choose = async (bg) => { await pass(bg); await bg.send({ type: 'approve', group: 'bounce', site: 'hop.example', name: 'skip it next time' }); await bg.settle(); };
test('the list the page script gets: the hosts the user chose to skip (1.25, J4), while that cleaning may run; empty when paused, off or during a sign-in', async () => {
  const bg = await load(on()); await choose(bg);
  assert.deepEqual(mine(bg), ['hop.example']); assert.deepEqual(bg.state.storage.skip.off, []);
  assert.ok(bg.state.scripts.some((s) => s.id === 'skip' && s.js.join() === 'guard.js,learn.js,skip.js' && s.excludeMatches.includes('*://accounts.google.com/*')));
  await bg.send({ type: 'pause', minutes: 5 }); await bg.settle(); assert.deepEqual(bg.state.storage.skip.sites, []);
  await bg.send({ type: 'resume' }); await bg.settle(); assert.deepEqual(mine(bg), ['hop.example']);
  await bg.send({ type: 'siteOff', host: 'social.example', on: true }); await bg.settle(); assert.deepEqual(bg.state.storage.skip.off, ['social.example']);
  await bg.send({ type: 'setMode', group: 'bounce', mode: 'off' }); await bg.settle();
  assert.deepEqual(bg.state.storage.skip.sites, []); assert.equal(bg.state.scripts.some((s) => s.id === 'skip'), false);
  const signing = await load(on({ tabs: [{ id: 1, active: true, url: 'https://accounts.google.com/signin' }], storage: { skipok: ['hop.example'] } }));
  await signing.alarm('sweep'); assert.deepEqual((signing.state.storage.skip || { sites: [] }).sites, ['hop.example']);   // 1.25, L4: a sign-in holds deleting for its own sites only; the page script is never put into the sign-in hosts anyway
});
test('"Let it through again" takes a host off the list and the report offers it; only a host name is accepted', async () => {
  const bg = await load(on()); await choose(bg);
  const html = renderReport(buildReport(await bg.send({ type: 'state' }), null));
  assert.match(html, /Skipped sites \(\d+\)/); assert.ok(html.includes('hop.example') && html.includes('&quot;type&quot;:&quot;unskip&quot;'));
  assert.deepEqual(await bg.send({ type: 'unskip', site: 'hop.example' }), { ok: true }); await bg.settle();
  assert.deepEqual(mine(bg), []); assert.equal((await bg.send({ type: 'state' })).skipped.includes('hop.example'), false);
  for (const site of [undefined, 7, '<img src=x>', 'a b']) assert.deepEqual(await bg.send({ type: 'unskip', site }), { ok: false });
});
