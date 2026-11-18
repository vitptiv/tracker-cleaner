// Chunk 8 (C23): tracking parameters are stripped from links by a declarativeNetRequest redirect rule. DNR does not
// run in Node, so stripParams (core.js, same list) shows what the rule does; the ruleset's gating is tested end to end.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const L = require('../extension/lists.js'), { stripParams } = require('../extension/core.js')(L);
const ALL = ['trackers', 'google-paths', 'url-params'];

test('stripParams: the listed parameters go; everything else, the order and the fragment stay', () => {
  assert.equal(stripParams('https://shop.test/p?id=7&gclid=abc&color=red&utm_source=news&utm_medium=mail#top'), 'https://shop.test/p?id=7&color=red#top');
  assert.equal(stripParams('https://shop.test/p?fbclid=x'), 'https://shop.test/p');
  assert.equal(stripParams('https://shop.test/p?fbclid=x&msclkid=y#frag?gclid=1'), 'https://shop.test/p#frag?gclid=1');
  assert.equal(stripParams('https://shop.test/?b=2&a=1&b=3&utm_id=9&flag'), 'https://shop.test/?b=2&a=1&b=3&flag');
  for (const p of L.URL_PARAMS) assert.equal(stripParams(`https://a.test/x?keep=1&${p}=v`), 'https://a.test/x?keep=1', p);
});
test('stripParams: a URL without them comes back unchanged, to the character', () => {
  for (const u of ['https://a.test/', 'https://a.test/?', 'https://a.test/?q=a+b%20c&x=%zz&&y', 'https://a.test/p?utm_sourcex=1&xgclid=2&GCLID=3&my_utm_source=4',
    'https://a.test/p#gclid=1', 'not a url', 'https://a.test/gclid=1/utm_source'])
    assert.equal(stripParams(u), u, u);
});
test('stripParams: an OAuth redirect keeps state, code and the rest', () => {
  const u = 'https://app.test/cb?state=xyz&code=4/abc&scope=openid%20email&session_state=s&client_id=c&redirect_uri=https%3A%2F%2Fapp.test%2Fcb&nonce=n';
  assert.equal(stripParams(u), u); assert.equal(stripParams(u + '&utm_campaign=x'), u);
});
test('the url-params ruleset is on by default, follows C23 alone, and is off while paused', async () => {
  const bg = await load({ limits: { blocking: false }, storage: { modes: { C15: 'auto' } } });
  assert.deepEqual(bg.state.rulesets, ['url-params']);               // the server's blocking switch is not its switch
  const b2 = await load();
  assert.deepEqual(b2.state.rulesets, ALL);
  assert.deepEqual(await b2.send({ type: 'setMode', group: 'params', mode: 'off' }), { ok: true, modes: { C23: 'off' } }); await b2.settle();
  assert.deepEqual(b2.state.rulesets, ['trackers', 'google-paths']);
  await b2.send({ type: 'setMode', group: 'params', mode: 'auto' }); await b2.send({ type: 'setMode', group: 'blocking', mode: 'off' }); await b2.settle();
  assert.deepEqual(b2.state.rulesets, ['url-params']);
  await b2.send({ type: 'pause' }); await b2.settle(); assert.deepEqual(b2.state.rulesets, []);
  await b2.send({ type: 'resume' }); await b2.settle(); assert.deepEqual(b2.state.rulesets, ['url-params']);
  await b2.send({ type: 'setMaster', on: false }); await b2.settle(); assert.deepEqual(b2.state.rulesets, []);
});
test('C23 has its own popup row', async () => {
  const { GROUPS, cap } = require('../extension/registry.js'), g = GROUPS.find((x) => x.id === 'params');
  assert.deepEqual([g.title, g.caps], ['Tracking tags removed from links', ['C23']]); assert.equal(cap('C23').group, 'params');
  assert.equal(GROUPS.length, 18); assert.deepEqual(GROUPS.find((x) => x.id === 'blocking').caps, ['C01', 'C02', 'C05', 'C26']);
});
