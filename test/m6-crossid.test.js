// M6 (1.26, C33): first-party address/referrer collection (F8) -- the page posting its own URL to its OWN server --
// cannot be blocked without breaking the site. When no cross-site id is involved the cleaner does NOT fake a win: it
// records the site so the report says "cannot stop (the site's own server)". It never blocks such a request.
const test = require('node:test'), assert = require('node:assert'), load = require('./load-background.js');
const on = (o = {}) => ({ ...o, storage: { master: true, cacheClearedAt: 1.8e12, ...o.storage } });
const ID = 'xq7m2k9p4w1z8c3v';
const body = (s) => ({ requestBody: { raw: [{ bytes: new TextEncoder().encode(s).buffer }] } });
const beacon = async (bg, site, path, payload, o = {}) => { await bg.request({ url: `https://${site}${path}`, initiator: `https://${site}`, type: 'xmlhttprequest', method: 'POST', ...body(payload), ...o }); await bg.settle(); };
const cannot = (bg) => Object.keys(bg.state.session.xcannot || {}).length;

test('a page posting its own address to its own server is recorded as "cannot stop" and never blocked', async () => {
  const bg = await load(on({ limits: {}, storage: { modes: { C15: 'auto' } } }));   // C15 on so the report is actually sent
  await bg.opens('https://a.example/');
  await beacon(bg, 'a.example', '/log', '{"url":"https://a.example/article/5","ref":"https://a.example/"}');
  await bg.alarm('sweep');
  assert.equal(cannot(bg), 1, 'first-party address collection was not recorded');
  assert.equal(bg.blocks('https://a.example/log'), false, 'the site\'s own collection was blocked (would break the site)');
  const rep = bg.reports.find((r) => r.cannotStop);
  assert.ok(rep && rep.cannotNote === "cannot stop (the site's own server)", 'the report does not say it cannot stop this');
});
test('a first-party request that does not carry the page address is not flagged', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/');
  await beacon(bg, 'a.example', '/api', '{"event":"click","n":3}');
  await bg.alarm('sweep');
  assert.equal(cannot(bg), 0);
});
test('a confirmed cross-site collector endpoint is blocked (M2), not reported as a cannot', async () => {
  const bg = await load(on());
  await bg.opens('https://a.example/'); await bg.opens('https://b.example/');
  await bg.request({ url: `https://a.example/f/hit?cid=${ID}`, initiator: 'https://a.example', type: 'image' }); await bg.settle();
  await bg.request({ url: `https://b.example/f/hit?cid=${ID}`, initiator: 'https://b.example', type: 'image' }); await bg.settle();
  await bg.alarm('sweep');   // confirms the cross-site id; a.example/f/ is now blocked
  await beacon(bg, 'a.example', '/f/hit', '{"url":"https://a.example/x"}');   // a POST to the blocked collector path
  await bg.alarm('sweep');
  assert.equal(cannot(bg), 0, 'a blocked cross-site collector was mislabelled "cannot"');
  assert.ok(bg.blocks('https://a.example/f/hit'), 'the collector path should be blocked');
});
test('C33 off: nothing is recorded', async () => {
  const bg = await load(on({ storage: { modes: { C33: 'off' } } }));
  await bg.opens('https://a.example/');
  await beacon(bg, 'a.example', '/log', '{"url":"https://a.example/x"}');
  await bg.alarm('sweep');
  assert.equal(cannot(bg), 0);
});
